// Chat's financial lane. A turn that asks for a financial calculation is
// planned by the engine's planner against the server-resolved subject set,
// executed on evidence, and published only through finalization — whose
// transaction also writes the assistant message, so an answer exists exactly
// when its snapshot and certificate do. Nothing in this lane calls the legacy
// free-text composer: when a calculation cannot be planned or verified, the
// turn gets a structured gap, never a model-written number.
//
// Every company the request names is either resolved, asked about, or kept as
// an explicit gap in the answer; none is dropped to reach a conclusion about
// fewer companies than were asked about.

import { randomUUID } from "node:crypto";

import {
  createRuntimeAuthority,
  METRIC_CATALOG_V1,
  operationDependencies,
  RATIO_CATALOG_V1,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type FinancialSubjectRef,
  type OperationNode,
} from "../../financial-core/src/index.ts";
import { cashResilienceDraft, LATEST_FISCAL_YEAR, type CashResiliencePeriod } from "../../financial-engine/src/cash-resilience.ts";
import type { PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import {
  buildDeterministicPlan,
  planFinancialRequest,
  resolveClarification,
  type Clarification,
  type PlanningContext,
  type PlanningModel,
  type PlanningResult,
  type RequestedSubject,
} from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { requireFinancialReadiness } from "../../financial-engine/src/readiness.ts";
import { publishRequest, type FinancialMode, type RequestGap } from "../../financial-engine/src/request.ts";
import { findPlanForRequest } from "../../financial-engine/src/run-repo.ts";
import type { ChatTurnRunContext } from "./coordinator.ts";
import { contentHashForText, financialMessageId } from "./chat-ids.ts";
import { logUnreadMessage, readChatMessage, type ChatReadMessage } from "./messages.ts";
import { COMPARATIVE, companyKey, extractSubjectMentions } from "./subject-extraction.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "./subjects.ts";
import { proposedMetric, type RequestedMetric, type ResearchScope } from "./research-scope.ts";

export type ChatFinancialMode = FinancialMode;

/** The user's pick for a clarification this lane offered earlier. */
export type ChatClarificationAnswer = Readonly<{ clarification_id: string; choice_id: string }>;

export type ChatFinancialTurn =
  | Readonly<{ kind: "clarification"; clarification: Clarification }>
  | Readonly<{ kind: "gap"; reason_code: string; text: string }>
  | Readonly<{ kind: "published"; run_id: string; message_id: string; message: ChatReadMessage | null }>;

export type ChatFinancialTurnContext = ChatTurnRunContext & { clarificationAnswer?: ChatClarificationAnswer };

export type ChatFinancialRuntime = Readonly<{
  /** Whether this lane takes the turn. Cheap and synchronous, so the stream can say so before any work. */
  answers(context: ChatFinancialTurnContext): boolean;
  /** The lane's outcome. Call only after answers(context); it throws otherwise. */
  run(context: ChatFinancialTurnContext): Promise<ChatFinancialTurn>;
  /** Throws unless verified finance is ready; the server awaits it before serving turns with the lane on. */
  assertReady(): Promise<void>;
}>;

export type ChatFinancialRuntimeDeps = Readonly<{
  mode: ChatFinancialMode;
  pool: FinancialPool;
  /** Null when no planning model is configured: financial turns then get a gap, never a guess. */
  planningModel: PlanningModel | null;
  resolveMention(mention: string): Promise<ChatSubjectPreResolution>;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  /** The turn's research scope, saved with a published answer (#206); absent, none is saved. */
  researchScope?: (context: ChatFinancialTurnContext) => Promise<ResearchScope>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PLANNING_MODEL_CALLS = 2;

/** A turn's gap: the engine's reason, or a unit the verifier refused. A failed commit is a turn error instead. */
type ChatGap = Exclude<RequestGap, "publication_failed"> | "verification_failed";

const GAP_TEXT: Readonly<Record<ChatGap, string>> = {
  planning_unavailable: "I can't verify a calculation for this request right now, so I won't give an unverified number.",
  unsupported: "This request asks for a calculation outside the verified financial definitions I can compute.",
  configuration_needed: "This request needs a subject or definition I can't resolve to one verified meaning.",
  verification_failed: "The calculation did not pass verification, so no number is shown.",
  run_failed: "The calculation could not be completed, so no number is shown.",
  run_in_progress: "This calculation is already running. Its verified answer will appear when it finishes.",
  run_cancelled: "This calculation was cancelled, so no number is shown.",
  request_conflict: "This turn was already answered with a different calculation.",
  parent_authority_required: "This calculation could not be run for this conversation.",
};

export function createChatFinancialRuntime(deps: ChatFinancialRuntimeDeps): ChatFinancialRuntime {
  const answers = (context: ChatFinancialTurnContext) =>
    deps.mode !== "off" && isFinancialRequest(context.userIntent ?? "") && Boolean(context.userId) && UUID.test(context.threadId);
  const run = async (context: ChatFinancialTurnContext): Promise<ChatFinancialTurn> => {
    if (!answers(context)) throw new Error("the financial lane does not take this turn");
    const text = context.userIntent!;
    const turnId = context.turnId ?? context.runId;
    const authority = chatAuthority(context.userId!, context.threadId, turnId);

    const messageId = financialMessageId(context.threadId, turnId);
    // The scope only informs follow-ups: failing to resolve it never fails the answer.
    // This lane runs before the analyst path resolves the turn's companies, so
    // the scope gets the companies the plan requests (requestedMentions).
    const scope = await (deps.researchScope ? scopeWithCompanies(deps, context, text) : Promise.resolve(null)).catch((reason) => {
      console.warn("[chat] research scope unavailable; saving the financial answer without it", reason);
      return null;
    }) ?? null;
    // A retry of this turn resumes what the first attempt reserved; it never plans again.
    const outcome = await publishRequest(deps.pool, {
      authority,
      request_key: turnId,
      // Planning runs on the client publishRequest has checked out; a second
      // pool acquire here could wait forever on a one-connection pool.
      plan: (db) => planTurn(deps, db, context, text, authority, new Date()),
      evidence: deps.evidence,
      persistParent: persistAssistantMessage(context.threadId, messageId, scope, { authority, request_key: turnId }),
    });
    switch (outcome.status) {
      case "clarification":
        return { kind: "clarification", clarification: outcome.clarification };
      case "gap":
        // A commit that failed is an error of this turn, not an answer; the retry publishes it.
        if (outcome.reason === "publication_failed") throw new Error("the financial answer could not be committed");
        return gap(outcome.reason);
      case "driven": {
        const [unit] = outcome.report?.finalized ?? [];
        const committed = outcome.report === null || unit?.result.status === "published" || unit?.result.status === "existing" ||
          (!unit && outcome.report.existing > 0);
        if (committed) return published(deps.pool, outcome.run_id, context.threadId, messageId);
        return gap(unit?.result.status === "rejected" ? "verification_failed" : "run_failed");
      }
    }
  };
  const assertReady = () => requireFinancialReadiness(deps.pool, deps.mode === "off" ? [] : ["chat"]);
  return Object.freeze({ answers, run, assertReady });
}

// The mentions a turn's plan requests: an explicit subject (a thread opened
// from a ticker page) first; like the analyst path, the message's companies
// join it only in a comparison ("Compare revenue with AMD" from the NVDA page
// plans both, "Revenue for AMD" plans NVDA).
function requestedMentions(context: ChatFinancialTurnContext, text: string): string[] {
  const explicit = context.subjectText?.trim();
  return explicit
    ? [explicit, ...(COMPARATIVE.test(text) ? extractSubjectMentions(text) : [])]
    : extractSubjectMentions(text);
}

// The turn's research scope over the companies its plan requests, resolved.
// ponytail: a company picked in a clarification answer is not in it; the scope
// then names the companies the message itself resolved.
async function scopeWithCompanies(deps: ChatFinancialRuntimeDeps, context: ChatFinancialTurnContext, text: string): Promise<ResearchScope> {
  const resolutions = await Promise.all(requestedMentions(context, text).map((mention) => deps.resolveMention(mention)));
  const resolved = resolutions.filter((resolution): resolution is ChatResolvedSubjectPreResolution => resolution.status === "resolved");
  return deps.researchScope!({ ...context, subjectPreResolution: resolved[0], subjectPreResolutions: resolved });
}

async function planTurn(
  deps: ChatFinancialRuntimeDeps,
  db: SqlExecutor,
  context: ChatFinancialTurnContext,
  text: string,
  authority: FinancialRuntimeAuthority,
  cutoff: Date,
): Promise<PlanningResult> {
  const mentions = requestedMentions(context, text);
  const resolutions = await Promise.all(mentions.map(async (mention) => ({ mention, resolution: await deps.resolveMention(mention) })));
  // One entry per company: "NVIDIA" (the page) and "NVDA" (the message) are one.
  const seen = new Set<string>();
  const requested = resolutions.flatMap(({ mention, resolution }): RequestedSubject[] => {
    const key = resolution.status === "resolved" ? companyKey(resolution) : `mention:${mention}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ mention, resolution: requestedResolution(resolution) }];
  });
  const planningContext = (subjects: ReadonlyArray<RequestedSubject>): PlanningContext => ({
    plan_id: randomUUID(),
    origin: { kind: "chat_request", ref: `chat:${context.threadId}:${context.turnId ?? context.runId}` },
    knowledge_cutoff: cutoff.toISOString(),
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: deps.planningModel ? MAX_PLANNING_MODEL_CALLS : 0,
    requested_subjects: subjects,
    publication_unit_kind: "chat_section",
  });

  let subjects: ReadonlyArray<RequestedSubject> = requested;
  if (context.clarificationAnswer) {
    // The chosen company may already be requested (the explicit subject), so
    // de-duplicate again once the answer resolves the ambiguous mention.
    subjects = await distinctRequested(db, await applyAnswer(subjects, context.clarificationAnswer, planningContext, text));
  }
  if (CASH_RESILIENCE.test(text)) return planCashResilience(planningContext(subjects), text);
  // A failing or unreachable model is a planning gap (publishRequest); the narrative composer is never a fallback for numbers.
  return planFinancialRequest(planningContext(subjects), text, deps.planningModel ?? noModel);
}

const CASH_RESILIENCE = /\bcash[- ]resilience\b/iu;
// The view is annual and has no score, rank, or cash/debt measure; a request
// for one is unsupported rather than answered with the annual view.
const OUTSIDE_CASH_RESILIENCE = /\b(?:quarters?|quarterly|Q[1-4]|TTM|LTM|trailing|scores?|scoring|rank|ranks|ranking|peers?|debt|net cash)\b/iu;
const FISCAL_YEAR = /\b(?:FY\s?)?(20\d{2})\b/u;

/**
 * An explicit cash-resilience request is planned deterministically, with no
 * model: the fixed annual view for each requested company, for the fiscal
 * year the message names or the latest one. An unresolved company is asked
 * about first, exactly as the model path asks before planning.
 */
async function planCashResilience(context: PlanningContext, text: string): Promise<PlanningResult> {
  if (OUTSIDE_CASH_RESILIENCE.test(text)) {
    return { outcome: "unsupported", reason: "cash resilience is an annual view without scores, peer ranks, or cash and debt measures", issues: [], model_calls: 0 };
  }
  if (context.requested_subjects.some((subject) => subject.resolution.status !== "resolved")) return planFinancialRequest(context, text, noModel);
  const year = FISCAL_YEAR.exec(text)?.[1];
  const period: CashResiliencePeriod = year ? { kind: "fiscal_period", fiscal_year: Number(year), fiscal_period: "FY" } : LATEST_FISCAL_YEAR;
  const slots = context.requested_subjects.map((subject, index) => ({ slot_id: `s${index}`, mention: subject.mention }));
  const parts = slots.map((slot) => cashResilienceDraft(slot.slot_id, period, ""));
  return buildDeterministicPlan(context, {
    subjects: slots,
    operations: parts.flatMap((part) => part.operations),
    outputs: parts.flatMap((part) => part.outputs),
    thresholds: [],
  });
}

/**
 * Applies the user's pick to the mention it was offered for. The clarification
 * is regenerated from the same request and must match the answered one
 * exactly; a stale or foreign answer changes nothing and the question is
 * asked again.
 */
async function applyAnswer(
  subjects: ReadonlyArray<RequestedSubject>,
  answer: ChatClarificationAnswer,
  planningContext: (subjects: ReadonlyArray<RequestedSubject>) => PlanningContext,
  text: string,
): Promise<ReadonlyArray<RequestedSubject>> {
  const pending = await planFinancialRequest(planningContext(subjects), text, noModel);
  if (pending.outcome !== "needs_clarification" || pending.clarification.clarification_id !== answer.clarification_id) return subjects;
  let choice;
  try {
    choice = resolveClarification(pending.clarification, answer);
  } catch {
    return subjects;
  }
  const picked = choice.subject_ref;
  if (!picked) return subjects;
  return subjects.map((subject) =>
    subject.resolution.status === "ambiguous" && subject.resolution.options.some((option) => sameRef(option.subject_ref, picked))
      ? { mention: subject.mention, resolution: { status: "resolved", subject_ref: picked, label: choice.label } }
      : subject);
}

const noModel: PlanningModel = async () => {
  throw new Error("no planning model is configured");
};

function requestedResolution(resolution: ChatSubjectPreResolution): RequestedSubject["resolution"] {
  if (resolution.status === "resolved") {
    const ref = financialRef(resolution.subject_ref);
    return ref ? { status: "resolved", subject_ref: ref, label: resolution.display_label } : { status: "not_found" };
  }
  if (resolution.status === "needs_clarification") {
    const options = resolution.candidates.flatMap((candidate) => {
      const ref = financialRef(candidate.subject_ref);
      return ref ? [{ subject_ref: ref, label: candidate.display_name }] : [];
    });
    return options.length > 0 ? { status: "ambiguous", options } : { status: "not_found" };
  }
  return { status: "not_found" };
}

function financialRef(ref: { kind: string; id: string }): FinancialSubjectRef | null {
  return ref.kind === "issuer" || ref.kind === "listing" ? { kind: ref.kind, id: ref.id } : null;
}

// One entry per company, the earlier one kept. A clarification choice is a bare
// ref with no handoff, and the resolver offers listings for a ticker but an
// issuer for a legal name, so a listing counts as its issuer (#154).
async function distinctRequested(
  db: SqlExecutor,
  subjects: ReadonlyArray<RequestedSubject>,
): Promise<ReadonlyArray<RequestedSubject>> {
  const keys = await Promise.all(subjects.map((subject) =>
    subject.resolution.status === "resolved" ? companyRefKey(db, subject.resolution.subject_ref) : null));
  const seen = new Set<string>();
  return subjects.filter((_, index) => {
    const key = keys[index];
    if (key === null || key === undefined) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function companyRefKey(db: SqlExecutor, ref: FinancialSubjectRef): Promise<string> {
  if (ref.kind === "issuer") return `issuer:${ref.id}`;
  const { rows } = await db.query<{ issuer_id: string }>(
    `select i.issuer_id::text as issuer_id
       from listings l join instruments i on i.instrument_id = l.instrument_id
      where l.listing_id = $1::uuid`,
    [ref.id],
  );
  return rows[0] ? `issuer:${rows[0].issuer_id}` : `listing:${ref.id}`;
}

function sameRef(left: FinancialSubjectRef, right: FinancialSubjectRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function chatAuthority(userId: string, threadId: string, turnId: string): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: userId,
    egress_channel: "chat",
    // Each turn is its own request; a later turn never edits an earlier answer.
    parent: { kind: "chat_thread", id: threadId, version: `turn:${turnId}` },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}

/** Writes the assistant message inside the finalization transaction, under the thread's owner. */
function persistAssistantMessage(
  threadId: string,
  messageId: string,
  scope: ResearchScope | null,
  request: { authority: FinancialRuntimeAuthority; request_key: string },
): PersistParentArtifact {
  return async (tx, publication) => {
    const blocks = [publication.block];
    // The scope names the figures the published plan computed, so a follow-up
    // ("why did it change?") reads them (#378 review).
    const plan = scope === null ? null : await findPlanForRequest(tx.client, request);
    const saved = scope === null || plan === null ? scope : { ...scope, metrics: planMetrics(plan) };
    const inserted = await tx.client.query(
      `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash, research_scope)
       select $1::uuid, t.thread_id, 'assistant'::chat_role, $3::uuid, $4::jsonb, $5, $7::jsonb
         from chat_threads t where t.thread_id = $2::uuid and t.user_id = $6::uuid
       returning message_id`,
      [
        messageId,
        threadId,
        publication.snapshot_id,
        JSON.stringify(blocks),
        contentHashForText(JSON.stringify(blocks)),
        tx.run.user_id,
        saved === null ? null : JSON.stringify(saved),
      ],
    );
    if (inserted.rows.length === 0) throw new Error("the chat thread no longer belongs to the run's owner");
  };
}

// The chat catalog key (research-scope.ts) of each figure the engine names,
// or null for a figure no chat reader serves: a follow-up reads the others.
// Every engine metric is listed (#381), so a new one cannot silently drop out.
export const SCOPE_METRICS: Readonly<Record<string, string | null>> = {
  revenue: "income_statement",
  gross_profit: "income_statement",
  operating_income: "income_statement",
  net_income: "income_statement",
  gross_margin: "income_statement",
  operating_margin: "income_statement",
  net_margin: "income_statement",
  free_cash_flow: "free_cash_flow",
  operating_cash_flow: "operating_cash_flow",
  capex: "capex",
  eps_basic: "eps_basic",
  eps_diluted: "eps_diluted",
  total_assets: "total_assets",
  total_liabilities: "total_liabilities",
  total_equity: "total_equity",
  // SEC ingestion certifies no share count, so the engine shows one only from
  // another source, and no chat reader has one.
  weighted_average_diluted_shares: null,
  shares_outstanding: null,
};

// The figures a plan's outputs show, as the chat scope names them: a change,
// sum, ratio, threshold or ranking is of the figures it reads.
function planMetrics(plan: FinancialPlanV1): RequestedMetric[] {
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const figures = (node: OperationNode): string[] => {
    const key = node.operation === "reported_metric" ? node.metric_key : node.operation;
    if (Object.hasOwn(SCOPE_METRICS, key)) return SCOPE_METRICS[key] === null ? [] : [SCOPE_METRICS[key]!];
    return operationDependencies(node).flatMap((id) => figures(nodes.get(id)!));
  };
  const keys = new Set(plan.outputs.flatMap((output) => figures(nodes.get(output.node_id)!)));
  return [...keys].map((key) => proposedMetric(key, null, null)!);
}

async function published(db: SqlExecutor, runId: string, threadId: string, messageId: string): Promise<ChatFinancialTurn> {
  let message: ChatReadMessage | null;
  try {
    message = await readChatMessage(db, { thread_id: threadId, message_id: messageId });
  } catch (error) {
    logUnreadMessage(messageId, error);
    return { kind: "published", run_id: runId, message_id: messageId, message: null };
  }
  return message ? { kind: "published", run_id: runId, message_id: messageId, message } : gap("run_failed");
}

function gap(reason_code: ChatGap): Extract<ChatFinancialTurn, { kind: "gap" }> {
  return { kind: "gap", reason_code, text: GAP_TEXT[reason_code] };
}

const FINANCIAL_TERMS = new RegExp(
  `\\b(${[
    // Catalog labels without qualifiers: "EPS (basic)" is asked about as "EPS".
    ...[...METRIC_CATALOG_V1.values(), ...RATIO_CATALOG_V1.values()].map((definition) => definition.label.replace(/\s*\(.*\)$/u, "")),
    "sales", "margin", "margins", "earnings per share", "EPS", "profit", "cash flow", "free cash flow", "capex", "cash resilience", "net income", "operating income",
  ].map((term) => term.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join("|")})\\b`,
  "iu",
);

/** Whether a message asks about a financial quantity this lane can verify. Anything else stays narrative. */
export function isFinancialRequest(text: string): boolean {
  return FINANCIAL_TERMS.test(text);
}
