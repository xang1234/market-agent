// Chat's financial lane. A turn that asks for a financial calculation is
// planned by the engine's planner against the server-resolved subject set,
// executed on evidence, and published only through finalization — whose
// transaction also writes the assistant message, so an answer exists exactly
// when its snapshot and certificate do. Nothing in this lane calls the legacy
// free-text composer: when a calculation cannot be planned or verified, the
// turn gets a structured gap, never a model-written number.
//
// A turn's companies are the ones the analyst path would take for it
// (coordinator.ts resolveTurnSubjects): each is resolved, asked about, or
// named in the answer as not found, and one carried from the previous answer
// is named as carried.

import { randomUUID } from "node:crypto";

import {
  createRuntimeAuthority,
  hashCanonical,
  METRIC_CATALOG_V1,
  operationDependencies,
  RATIO_CATALOG_V1,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type FinancialSubjectRef,
  type MarginNode,
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
import { publishRequest, type RequestGap } from "../../financial-engine/src/request.ts";
import { findPlanForRequest } from "../../financial-engine/src/run-repo.ts";
import { comparativeTurn, labelList, resolveTurnSubjects, type ChatTurnRunContext, type TurnSubjects } from "./coordinator.ts";
import { contentHashForText, financialMessageId } from "./chat-ids.ts";
import { noteBlock } from "./fact-blocks.ts";
import { logUnreadMessage, readChatMessage, type ChatReadMessage } from "./messages.ts";
import { COMPARATIVE, companyKey, extractSubjectMentions } from "./subject-extraction.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "./subjects.ts";
import {
  BALANCE_SHEET_ITEMS,
  PROPOSABLE_METRICS,
  proposedMetric,
  readingAsks,
  type IncomeItem,
  type RequestedMetric,
  type ResearchScope,
  type ScopeFacet,
  type ScopeProposal,
} from "./research-scope.ts";

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
  /** Throws unless verified finance is ready; the server awaits it before serving any turn. */
  assertReady(): Promise<void>;
}>;

export type ChatFinancialRuntimeDeps = Readonly<{
  pool: FinancialPool;
  /** Null when no planning model is configured: financial turns then get a gap, never a guess. */
  planningModel: PlanningModel | null;
  resolveMention(mention: string): Promise<ChatSubjectPreResolution>;
  /** The companies the thread's previous answer covered, for a question that names none. */
  priorSubjects?: (threadId: string) => Promise<ReadonlyArray<ChatResolvedSubjectPreResolution>>;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  /** What a model reads the question to ask for (scope-proposal.ts); null or absent, no ask is named as uncovered. */
  readQuestion?: (question: string) => Promise<ScopeProposal | null>;
  /** The turn's research scope, saved with a published answer (#206); absent, none is saved. */
  researchScope?: (context: ChatFinancialTurnContext, reading: Promise<ScopeProposal | null>) => Promise<ResearchScope>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PLANNING_MODEL_CALLS = 2;

/**
 * A turn's gap: the engine's reason, a unit the verifier refused, or a
 * question that names no company. A failed commit is a turn error instead.
 */
type ChatGap = Exclude<RequestGap, "publication_failed"> | "verification_failed" | "no_company";

const GAP_TEXT: Readonly<Record<ChatGap, string>> = {
  no_company: "Name the company this calculation is for.",
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
    isFinancialRequest(context.userIntent ?? "") && Boolean(context.userId) && UUID.test(context.threadId);
  const run = async (context: ChatFinancialTurnContext): Promise<ChatFinancialTurn> => {
    if (!answers(context)) throw new Error("the financial lane does not take this turn");
    const text = context.userIntent!;
    const turnId = context.turnId ?? context.runId;
    const authority = chatAuthority(context.userId!, context.threadId, turnId);

    const messageId = financialMessageId(context.threadId, turnId);
    // A retry of a turn whose answer is saved returns that answer: the thread
    // holds it by now, so the turn's companies are not picked again. Before
    // the answer is saved the thread is as the first attempt found it.
    const answered = (await deps.pool.query(`select 1 from chat_messages where message_id = $1::uuid`, [messageId])).rows.length > 0;
    const requested = answered ? ANSWERED : await requestedSubjects(deps, context, text);
    if (requested.clarify) return { kind: "clarification", clarification: companyQuestion(requested.clarify) };
    if (!answered && requested.subjects.length === 0) return gap("no_company");
    const reading = (deps.readQuestion?.(text) ?? Promise.resolve(null)).catch((reason) => {
      console.warn("[chat] no reading of the question; the financial answer names no uncovered ask", reason);
      return null;
    });
    // This lane runs before the analyst path resolves the turn's companies, so
    // the scope gets the ones the turn resolved; the answer saves the plan's
    // own (persistAssistantMessage).
    const { resolved } = requested;
    const scope = (deps.researchScope
      ? deps.researchScope({ ...context, subjectPreResolution: resolved[0], subjectPreResolutions: resolved }, reading)
      : Promise.resolve(null)).catch((reason) => {
      console.warn("[chat] research scope unavailable; saving the financial answer without it", reason);
      return null;
    });
    // A retry of this turn resumes what the first attempt reserved; it never plans again.
    const outcome = await publishRequest(deps.pool, {
      authority,
      request_key: turnId,
      plan: () => planTurn(deps, context, text, requested.subjects, authority, new Date()),
      evidence: deps.evidence,
      // The reading and the scope settle outside any transaction; the scope
      // queued its reads before this request took its client.
      beforeDrive: () => Promise.all([scope, reading]),
      persistParent: persistAssistantMessage(context.threadId, messageId, { scope, reading, carried: requested.carried, notFound: requested.notFound }, { authority, request_key: turnId }),
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
  const assertReady = () => requireFinancialReadiness(deps.pool, ["chat"]);
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

type TurnCompanies = Readonly<{
  // One per company, primary first, as the planner takes them.
  subjects: ReadonlyArray<RequestedSubject>;
  resolved: ReadonlyArray<ChatResolvedSubjectPreResolution>;
  // Labels of the companies carried from the previous answer.
  carried: ReadonlyArray<string>;
  // Names a comparison gave that match no company.
  notFound: ReadonlyArray<string>;
  // A change to the compared companies too unclear to plan: the question to ask.
  clarify?: string;
}>;

async function requestedSubjects(deps: ChatFinancialRuntimeDeps, context: ChatFinancialTurnContext, text: string): Promise<TurnCompanies> {
  const label = (resolution: ChatResolvedSubjectPreResolution) => resolution.handoff?.display_labels?.ticker ?? resolution.display_label;
  const mentioned = await Promise.all(requestedMentions(context, text).map(async (mention) => ({ mention, resolution: await deps.resolveMention(mention) })));
  let entries: ReadonlyArray<Readonly<{ mention: string; resolution: ChatSubjectPreResolution }>> = mentioned;
  let turn: TurnSubjects | null = null;
  let carried: ReadonlyArray<ChatResolvedSubjectPreResolution> = [];
  let notFound: ReadonlyArray<string> = [];
  const explicit = Boolean(context.subjectText?.trim());
  if (explicit) {
    // The page's company first; a compared name that matches no company is named in the answer.
    const [page, ...compared] = mentioned;
    notFound = compared.filter(({ resolution }) => resolution.status === "not_found").map(({ mention }) => mention);
    entries = [page!, ...compared.filter(({ resolution }) => resolution.status !== "not_found")];
  } else if (mentioned.some(({ resolution }) => resolution.status === "needs_clarification")) {
    // An ambiguous company is asked about beside every company named, and in a
    // comparison beside the previous answer's, so the answer covers them all.
    const namedKeys = new Set(mentioned.flatMap(({ resolution }) => resolution.status === "resolved" ? [companyKey(resolution)] : []));
    // As the analyst path does, a name that matches no company is named in a
    // comparison's answer and ignored outside one.
    const comparison = comparativeTurn(text);
    const prior = comparison ? await deps.priorSubjects?.(context.threadId) ?? [] : [];
    carried = prior.filter((resolution, index) =>
      !namedKeys.has(companyKey(resolution)) && prior.findIndex((other) => companyKey(other) === companyKey(resolution)) === index);
    const unmatched = mentioned.filter(({ resolution }) => resolution.status === "not_found");
    notFound = comparison ? unmatched.map(({ mention }) => mention) : [];
    entries = [...carried.map((resolution) => ({ mention: label(resolution), resolution })), ...mentioned.filter((entry) => !unmatched.includes(entry))];
  } else if (!explicit) {
    turn = await resolveTurnSubjects(
      context,
      (request) => deps.resolveMention(request.text),
      deps.priorSubjects && ((input) => deps.priorSubjects!(input.threadId)),
    );
    if (turn.clarify) return { subjects: [], resolved: [], carried: [], notFound: [], clarify: turn.clarify };
    // A company keeps the mention that named it; one carried takes its ticker.
    const mentionOf = new Map(mentioned.flatMap(({ mention, resolution }) => resolution.status === "resolved" ? [[companyKey(resolution), mention] as const] : []));
    entries = turn.subjects.map((resolution) => ({ mention: mentionOf.get(companyKey(resolution)) ?? label(resolution), resolution }));
  }
  const issuers = await issuersOf(deps.pool, entries.map(({ resolution }) => resolution));
  const requested = entries.map(({ mention, resolution }): RequestedSubject => ({ mention, resolution: requestedResolution(resolution, issuers) }));
  return {
    // One entry per company: "NVIDIA" (the page) and "NVDA" (the message) are one.
    subjects: distinctRequested(requested),
    resolved: entries.flatMap(({ resolution }) => resolution.status === "resolved" ? [resolution] : []),
    carried: (turn?.carried ?? carried).map(label),
    notFound: turn?.notFound ?? notFound,
  };
}

const ANSWERED: TurnCompanies = { subjects: [], resolved: [], carried: [], notFound: [] };

// A question about the companies to compare, which only a new message answers.
function companyQuestion(question: string): Clarification {
  return { clarification_id: hashCanonical("clarification", { kind: "request", question, choices: [] }), kind: "request", question, choices: [] };
}

async function planTurn(
  deps: ChatFinancialRuntimeDeps,
  context: ChatFinancialTurnContext,
  text: string,
  requested: ReadonlyArray<RequestedSubject>,
  authority: FinancialRuntimeAuthority,
  cutoff: Date,
): Promise<PlanningResult> {
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

  let subjects = requested;
  if (context.clarificationAnswer) {
    // The chosen company may already be requested (the explicit subject), so
    // de-duplicate again once the answer resolves the ambiguous mention.
    subjects = distinctRequested(await applyAnswer(subjects, context.clarificationAnswer, planningContext, text));
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

function requestedResolution(resolution: ChatSubjectPreResolution, issuers: IssuerOf): RequestedSubject["resolution"] {
  if (resolution.status === "resolved") {
    const ref = issuers(resolution.subject_ref);
    return ref ? { status: "resolved", subject_ref: ref, label: resolution.display_label } : { status: "not_found" };
  }
  if (resolution.status === "needs_clarification") {
    const offeredIssuers = new Set<string>();
    const refs = resolution.candidates.map((candidate) => ({ candidate, ref: issuers(candidate.subject_ref) }));
    const options = refs.flatMap(({ candidate, ref }) => {
      if (!ref || offeredIssuers.has(ref.id.toLowerCase())) return [];
      offeredIssuers.add(ref.id.toLowerCase());
      return [{ subject_ref: ref, label: candidate.display_name }];
    });
    // Candidates that are all one company need no question; one that maps to none still does.
    if (options.length === 1 && refs.every(({ ref }) => ref !== null)) return { status: "resolved", ...options[0]! };
    return options.length > 0 ? { status: "ambiguous", options } : { status: "not_found" };
  }
  return { status: "not_found" };
}

type IssuerOf = (ref: { kind: string; id: string }) => FinancialSubjectRef | null;

// The engine reads a company's facts under its issuer, and the resolver
// offers a listing for a ticker (#154): each listing is planned on its issuer,
// so a clarification offers issuers too.
async function issuersOf(db: SqlExecutor, resolutions: ReadonlyArray<ChatSubjectPreResolution>): Promise<IssuerOf> {
  const refs = resolutions.flatMap((resolution) => resolution.status === "resolved"
    ? [resolution.subject_ref]
    : resolution.status === "needs_clarification" ? resolution.candidates.map((candidate) => candidate.subject_ref) : []);
  const listingIds = refs.flatMap((ref) => ref.kind === "listing" ? [ref.id] : []);
  const { rows } = listingIds.length === 0 ? { rows: [] } : await db.query<{ listing_id: string; issuer_id: string }>(
    `select l.listing_id::text as listing_id, i.issuer_id::text as issuer_id
       from listings l join instruments i on i.instrument_id = l.instrument_id
      where l.listing_id = any($1::uuid[])`,
    [listingIds],
  );
  const issuerOf = new Map(rows.map((row) => [row.listing_id, row.issuer_id]));
  return (ref) => {
    const id = ref.kind === "issuer" ? ref.id : ref.kind === "listing" ? issuerOf.get(ref.id.toLowerCase()) : undefined;
    return id === undefined ? null : { kind: "issuer", id };
  };
}

const requestedKey = (subject: RequestedSubject) => subject.resolution.status === "resolved"
  ? `${subject.resolution.subject_ref.kind}:${subject.resolution.subject_ref.id.toLowerCase()}`
  : `mention:${subject.mention}`;

// One entry per company, the earlier one kept.
function distinctRequested(subjects: ReadonlyArray<RequestedSubject>): ReadonlyArray<RequestedSubject> {
  const seen = new Set<string>();
  return subjects.filter((subject) => {
    const key = requestedKey(subject);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  turn: Readonly<{
    scope: Promise<ResearchScope | null>;
    reading: Promise<ScopeProposal | null>;
    carried: ReadonlyArray<string>;
    notFound: ReadonlyArray<string>;
  }>,
  request: { authority: FinancialRuntimeAuthority; request_key: string },
): PersistParentArtifact {
  return async (tx, publication) => {
    // Both settled before the run was driven (beforeDrive).
    const [scope, reading] = await Promise.all([turn.scope, turn.reading]);
    const plan = scope === null && reading === null ? null : await findPlanForRequest(tx.client, request);
    const missing = reading === null || plan === null ? [] : uncoveredAsks(reading, plan);
    const note = [
      ...(turn.notFound.length === 0 ? [] : [`No company matched ${labelList(turn.notFound)}.`]),
      ...(turn.carried.length === 0 ? [] : [`${labelList(turn.carried)} ${turn.carried.length > 1 ? "are" : "is"} carried from the previous answer.`]),
      ...(missing.length === 0 ? [] : [`Not covered by this answer: ${missing.join("; ")}.`]),
    ].join(" ");
    const blocks = [
      publication.block,
      ...(note === "" ? [] : [noteBlock({ snapshotId: publication.snapshot_id, asOf: publication.block.as_of }, "uncovered", note)]),
    ];
    // The scope names the companies and figures the published plan answered,
    // so a follow-up ("why did it change?") continues them (#378 review): a
    // company picked in a clarification, or named by several listings, too.
    const saved = scope === null || plan === null ? scope : { ...scope, companies: planCompanies(plan, scope), metrics: planMetrics(plan) };
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

const figureKey = (node: OperationNode) => node.operation === "reported_metric" ? node.metric_key : node.operation;

// The figures a plan's outputs show: a change, sum, ratio, threshold or
// ranking is of the figures it reads.
function shownFigures(plan: FinancialPlanV1): OperationNode[] {
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const figures = (node: OperationNode): OperationNode[] =>
    Object.hasOwn(SCOPE_METRICS, figureKey(node)) ? [node] : operationDependencies(node).flatMap((id) => figures(nodes.get(id)!));
  return plan.outputs.flatMap((output) => figures(nodes.get(output.node_id)!));
}

// The companies a plan answered for, in its order, each with the label the scope gave it, if any.
function planCompanies(plan: FinancialPlanV1, scope: ResearchScope): ResearchScope["companies"] {
  const labels = new Map(scope.companies.flatMap((company) => company.label === undefined ? [] : [[company.issuer_id.toLowerCase(), company.label] as const]));
  return [...plan.subjects.members].sort((left, right) => left.display_order - right.display_order).map((member) => {
    const label = labels.get(member.subject_ref.id.toLowerCase());
    return label === undefined ? { issuer_id: member.subject_ref.id } : { issuer_id: member.subject_ref.id, label };
  });
}

// The figures a plan shows, as the chat scope names them.
function planMetrics(plan: FinancialPlanV1): RequestedMetric[] {
  const keys = new Set(shownFigures(plan).flatMap((node) => SCOPE_METRICS[figureKey(node)] ?? []));
  return [...keys].map((key) => proposedMetric(key, null, null)!);
}

const NEVER_PLANNED: Partial<Readonly<Record<ScopeFacet, string>>> = {
  segments: "revenue by segment",
  peers: "peers the question did not name",
  price_window: "a stock price return",
  benchmark: "a comparison with a benchmark index",
  guidance: "company guidance",
  explains: "the cause of these figures",
};
const CATALOG = new Map(PROPOSABLE_METRICS.map((metric) => [metric.metric_key, metric]));
const INCOME_ITEM_FIGURE: Readonly<Record<IncomeItem, string | null>> = {
  revenue: "revenue",
  gross_margin: "gross_margin",
  operating_expenses: null,
  operating_income: "operating_income",
  net_income: "net_income",
};

/**
 * What a question asks for, as the model read it, that its plan does not
 * compute, so the answer names it instead of leaving it out.
 * ponytail: a qualified metric ("EPS growth", "adjusted EPS") is not checked,
 * as nothing records which qualifier the plan computed; record its base and
 * qualifier on RequestedMetric to check it.
 */
export function uncoveredAsks(reading: ScopeProposal, plan: FinancialPlanV1): string[] {
  const { asks, offMetrics } = readingAsks(reading);
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const shown = shownFigures(plan);
  const margins = shown.filter((node): node is MarginNode =>
    node.operation === "gross_margin" || node.operation === "operating_margin" || node.operation === "net_margin");
  const numerators = margins.flatMap((node) => {
    const numerator = nodes.get(node.numerator);
    return numerator?.operation === "reported_metric" ? [numerator.metric_key] : [];
  });
  // ponytail: a margin also answers the income item it divides, because the
  // reading has no operating or net margin item and names operating income for
  // an operating margin; a request for operating income answered by its margin
  // alone is not named (#425). Add the margin items to INCOME_ITEMS to drop this.
  const read = new Set([...shown.flatMap((node) => [figureKey(node), SCOPE_METRICS[figureKey(node)] ?? []].flat()), ...numerators]);
  const periodOf = (id: string) => {
    const node = nodes.get(id);
    return node?.operation === "reported_metric" ? JSON.stringify(node.period) : id;
  };
  const marginPeriods = new Set(margins.map((node) => periodOf(node.revenue)));
  const metrics = [...new Map(reading.metrics
    .filter((metric) => CATALOG.has(metric.metric_key))
    .flatMap((metric) => metric.metric_key === "balance_sheet" ? BALANCE_SHEET_ITEMS.map((key) => CATALOG.get(key)!) : [metric])
    .filter((metric) => !offMetrics.has(metric.metric_key))
    .map((metric) => [metric.metric_key, metric])).values()];
  const items = reading.income_items.filter((item) => !read.has(INCOME_ITEM_FIGURE[item] ?? "")).map((item) => item.replaceAll("_", " "));
  return [
    // The income items name its figures more closely than the whole statement does.
    ...metrics.filter((metric) => !read.has(metric.metric_key) && !(metric.metric_key === "income_statement" && reading.income_items.length > 0))
      .map((metric) => inSentence(metric.label)),
    ...items,
    ...(asks.has("margin_trend") && marginPeriods.size < 2 ? ["a margin over several periods"]
      : asks.has("margins") && marginPeriods.size === 0 && !items.includes("gross margin") ? ["a margin"]
      : []),
    ...Object.entries(NEVER_PLANNED).flatMap(([facet, item]) => asks.has(facet as ScopeFacet) ? [item] : []),
  ];
}

// A catalog label inside a sentence: "Free cash flow" reads "free cash flow", "EBITDA" stays.
function inSentence(label: string): string {
  return label.length > 1 && label[1] === label[1]!.toLowerCase() ? `${label[0]!.toLowerCase()}${label.slice(1)}` : label;
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
