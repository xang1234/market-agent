// Chat's financial lane. A turn about a company is
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
  dependencyClosure,
  hashCanonical,
  operationDependencies,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type FinancialSubjectRef,
  type OperationNode,
} from "../../financial-core/src/index.ts";
import { cashResilienceDraft, LATEST_FISCAL_YEAR, type CashResiliencePeriod } from "../../financial-engine/src/cash-resilience.ts";
import { ParentRefusedError, type PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import {
  buildDeterministicPlan,
  planFinancialRequest,
  PlanningModelError,
  resolveClarification,
  type Clarification,
  type PlanningContext,
  type PlanningModel,
  type PlanningResult,
  type RequestedSubject,
  type UnsupportedReason,
} from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { requireFinancialReadiness } from "../../financial-engine/src/readiness.ts";
import { publishRequest, type RequestGap } from "../../financial-engine/src/request.ts";
import { findPlanForRequest } from "../../financial-engine/src/run-repo.ts";
import { comparedAdditions, labelList, MAX_TURN_SUBJECTS, resolveTurnSubjects, type ChatTurnRunContext, type TurnSubjects } from "./coordinator.ts";
import { contentHashForText, financialMessageId } from "./chat-ids.ts";
import { overviewPeers, overviewSubjects, planCompanyOverview, resolvedCompanies, type PeersOf } from "./company-overview.ts";
import { noteBlock } from "./fact-blocks.ts";
import { logUnreadMessage, readChatMessage, type ChatReadMessage } from "./messages.ts";
import { companyKey, extractSubjectMentions } from "./subject-extraction.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "./subjects.ts";
import {
  BALANCE_SHEET_ITEMS,
  companyWordsIn,
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
  // A gap the turn declined with names the companies it was asked about and
  // saves its scope, so a follow-up continues them (#425). It is saved under
  // the id the turn's answer takes (message_id): an answer saved first keeps
  // it, and an answer saved later replaces it.
  | Readonly<{
    kind: "gap";
    reason_code: string;
    text: string;
    message_id?: string;
    subject_refs?: ReadonlyArray<FinancialSubjectRef>;
    research_scope?: ResearchScope;
  }>
  // A company overview's commentary is written once the answer is shown:
  // commentary() saves it and reads the message back.
  | Readonly<{ kind: "published"; run_id: string; message_id: string; message: ChatReadMessage | null; commentary?: () => Promise<ChatReadMessage> }>
  // A gap an earlier attempt of the turn saved, as a retry returns it.
  | Readonly<{ kind: "saved"; message_id: string; message: ChatReadMessage | null }>;

/** What a company overview's commentary is written from. */
export type CommentaryRequest = Readonly<{
  message: ChatReadMessage;
  request: { authority: FinancialRuntimeAuthority; request_key: string };
  // By issuer, the ticker the turn named each company by.
  labels: ReadonlyMap<string, string>;
  turn: { thread_id: string; run_id: string; turn_id?: string; question: string };
}>;

export type ChatFinancialTurnContext = ChatTurnRunContext & { clarificationAnswer?: ChatClarificationAnswer };

export type ChatFinancialRuntime = Readonly<{
  /**
   * The lane's outcome for a turn about a company: one the turn names, a
   * follow-up keeps, or a clarification asks about. Null leaves the turn to
   * the analyst path.
   */
  take(context: ChatFinancialTurnContext): Promise<(() => Promise<ChatFinancialTurn>) | null>;
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
  /** The turn's research scope, saved with a published answer (#206); absent, none is saved. */
  researchScope?: (context: ChatFinancialTurnContext, reading: Promise<ScopeProposal | null>) => Promise<ResearchScope>;
  /** The knowledge cutoff a new turn plans at; the wall clock when absent. */
  clock?: () => Date;
  /**
   * Writes a company overview's analyst commentary onto its saved answer
   * (engine-commentary.ts saveCommentary); absent, none is written. Injected,
   * so the engine's type check, which reaches this file, never reaches the
   * model client.
   */
  commentary?: (db: SqlExecutor, input: CommentaryRequest) => Promise<void>;
}>;

// What a question asks the engine to show beside its metrics.
const FIGURE_ASKS: ReadonlySet<ScopeFacet> = new Set(["margins", "margin_trend", "segments", "latest_quarter", "peers"]);
// What the analyst path answers and the engine does not: the previous
// answer's evidence, which it re-reads; guidance, which it reads from claims;
// and market data (#398 D2).
const ANALYST_ASKS: ReadonlySet<ScopeFacet> = new Set(["evidence", "guidance", "price_window", "benchmark"]);

// The analyst path keeps a turn whose reading asks for no figure and for
// something only it answers, or whose scope keeps market data.
function analystReads(reading: ScopeProposal | null, scope: ResearchScope | null): boolean {
  if (reading === null || reading.metrics.length > 0 || reading.income_items.length > 0) return false;
  const asks = [...reading.asks];
  if (asks.some((facet) => FIGURE_ASKS.has(facet))) return false;
  return asks.some((facet) => ANALYST_ASKS.has(facet)) || (scope !== null && (scope.price_window !== null || scope.benchmark));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PLANNING_MODEL_CALLS = 2;

/**
 * A turn's gap: the engine's reason, or a unit the verifier refused. A failed commit is a turn error instead.
 */
type ChatGap = Exclude<RequestGap, "publication_failed"> | "verification_failed";

const UNSUPPORTED = "This request asks for a calculation outside the verified financial definitions I can compute";

const GAP_TEXT: Readonly<Record<ChatGap, string>> = {
  planning_unavailable: "I can't verify a calculation for this request right now, so I won't give an unverified number.",
  unsupported: `${UNSUPPORTED}.`,
  configuration_needed: "This request needs a subject or definition I can't resolve to one verified meaning.",
  verification_failed: "The calculation did not pass verification, so no number is shown.",
  run_failed: "The calculation could not be completed, so no number is shown.",
  run_in_progress: "This calculation is already running. Its verified answer will appear when it finishes.",
  run_cancelled: "This calculation was cancelled, so no number is shown.",
  request_conflict: "This turn was already answered with a different calculation.",
  parent_authority_required: "This calculation could not be run for this conversation.",
};

// Whether a request's gap declines the turn, or is a notice about its run:
// running, answered otherwise, cancelled, or not this thread's. A newer
// notice must not hide the turn's answer from the next follow-up.
const DECLINES: Readonly<Record<Exclude<RequestGap, "publication_failed">, boolean>> = {
  planning_unavailable: true,
  unsupported: true,
  configuration_needed: true,
  run_failed: true,
  run_in_progress: false,
  run_cancelled: false,
  request_conflict: false,
  parent_authority_required: false,
};

export function createChatFinancialRuntime(deps: ChatFinancialRuntimeDeps): ChatFinancialRuntime {
  const take = async (context: ChatFinancialTurnContext): Promise<(() => Promise<ChatFinancialTurn>) | null> => {
    if (!context.userId || !UUID.test(context.threadId)) return null;
    const text = context.userIntent ?? "";
    const turnId = context.turnId ?? context.runId;
    const authority = chatAuthority(context.userId, context.threadId, turnId);

    const messageId = financialMessageId(context.threadId, turnId);
    // A retry of a turn whose answer is saved returns that answer: the thread
    // holds it by now, so the turn's companies are not picked again. Before
    // the answer is saved the thread is as the first attempt found it. A gap
    // the turn declined with is returned as saved, with nothing planned again.
    const { rows: [existing] } = await deps.pool.query<{ kind: string | null }>(
      `select blocks->0->>'kind' as kind from chat_messages where message_id = $1::uuid`,
      [messageId],
    );
    if (existing) {
      return existing.kind === "financial_answer"
        ? () => runTurn(context, text, turnId, authority, messageId, true, NO_COMPANIES, null, null)
        : () => savedGap(deps.pool, context.threadId, messageId);
    }
    const requested = await requestedSubjects(deps, context, text);
    const { clarify } = requested;
    if (clarify) return async () => ({ kind: "clarification", clarification: companyQuestion(clarify) });
    if (requested.subjects.length === 0) return null;
    const reading = await context.reading?.() ?? null;
    // The scope gets the companies the message resolved, as this lane runs
    // before the analyst path resolves them; the answer saves the ones it
    // answered for (answeredCompanies). One that throws is no scope.
    const { resolved } = requested;
    const { researchScope } = deps;
    const scope = await (async () => researchScope
      ? researchScope({ ...context, subjectPreResolution: resolved[0], subjectPreResolutions: resolved }, Promise.resolve(reading))
      : null)().catch((reason) => {
      console.warn("[chat] research scope unavailable; saving the financial answer without it", reason);
      return null;
    });
    if (analystReads(reading, scope)) return null;
    return () => runTurn(context, text, turnId, authority, messageId, false, withinScope(requested, scope), reading, scope);
  };
  const runTurn = async (
    context: ChatFinancialTurnContext,
    text: string,
    turnId: string,
    authority: FinancialRuntimeAuthority,
    messageId: string,
    answered: boolean,
    requested: TurnCompanies,
    read: ScopeProposal | null,
    saved: ResearchScope | null,
  ): Promise<ChatFinancialTurn> => {
    // The saved answer has its reading and scope already.
    const reading = Promise.resolve(read);
    const scope = Promise.resolve(saved);
    const { planningModel } = deps;
    const prepared = () => Promise.all([scope, reading]);
    // What planning settled, for a gap: the companies it was asked about, a
    // clarification pick (recorded before the model is called) or the peers
    // an overview added included, and the planner's result.
    let asked = requested.subjects;
    let planned: PlanningResult | undefined;
    let overview = false;
    const declinedGap = async (reason: ChatGap) => {
      // ponytail: a retry that resumes a reserved run does not plan, so its
      // gap names the companies the message resolved, without a pick or peers.
      const refs = asked.flatMap((subject) => subject.resolution.status === "resolved" ? [subject.resolution.subject_ref] : []);
      // One about no company leaves the previous answer's companies and scope.
      if (refs.length === 0) return gap(reason, planned);
      const [saved] = await prepared();
      return {
        ...gap(reason, planned),
        // Another attempt may answer the turn meanwhile (a run it finished
        // reads here as run_failed): the gap never replaces that answer.
        message_id: messageId,
        subject_refs: refs,
        // It computed no figure, so it names none, and no reader re-reads it.
        ...(saved === null ? {} : {
          research_scope: {
            ...saved,
            route: "financial_gap" as const,
            reads: "financial_gap" as const,
            companies: answeredCompanies(refs.map((ref) => ref.id), saved, requested.labels),
            metrics: [],
          },
        }),
      };
    };
    // ponytail: only the attempt that planned the overview writes its
    // commentary, so an attempt that did not plan writes none. Two do not: a
    // retry that resumes a reserved run after a failed commit, and a retry of
    // a saved answer. Either leaves the answer without commentary. Upgrade
    // path: mark the overview in the plan's provenance, so any publishing
    // attempt can compose.
    const withCommentary = (answer: ChatFinancialTurn): ChatFinancialTurn => {
      const { commentary: save } = deps;
      if (!overview || !save || answer.kind !== "published" || !answer.message) return answer;
      const { message } = answer;
      return {
        ...answer,
        commentary: async () => {
          // The answer is committed and shown: nothing after it may fail the turn.
          try {
            await save(deps.pool, {
              message,
              request: { authority, request_key: turnId },
              labels: requested.labels,
              turn: { thread_id: context.threadId, run_id: context.runId, ...(context.turnId ? { turn_id: context.turnId } : {}), question: text },
            });
          } catch (error) {
            // The append may have committed before the error: the turn ends on the row as read back.
            console.error(`[chat] the analyst commentary on message ${messageId} failed; the turn completes with the message as read back`, error);
          }
          return (await readBack(deps.pool, context.threadId, messageId)) ?? message;
        },
      };
    };
    // A retry of this turn resumes what the first attempt reserved; it never plans again.
    const outcome = await publishRequest(deps.pool, {
      authority,
      request_key: turnId,
      plan: async (db) => {
        planned = await planTurn(planningModel, context, text, requested.subjects, authority, deps.clock?.() ?? new Date(), (subjects) => {
          asked = subjects;
        }, {
          prepare: prepared,
          evidence: deps.evidence(db),
          peersOf: (issuer) => overviewPeers(db, issuer),
          onOverview: () => {
            overview = true;
          },
        });
        return planned;
      },
      evidence: deps.evidence,
      // The reading and the scope settle outside any transaction; the scope
      // queued its reads before this request took its client.
      beforeDrive: prepared,
      persistParent: persistAssistantMessage(context.threadId, messageId, {
        // Decided before the drive; never a model call inside the transaction.
        prepared,
        carried: requested.carried,
        notFound: requested.notFound,
        labels: requested.labels,
      }, { authority, request_key: turnId }),
    });
    switch (outcome.status) {
      case "clarification":
        return { kind: "clarification", clarification: outcome.clarification };
      case "gap":
        // A commit that failed is an error of this turn, not an answer; the retry publishes it.
        if (outcome.reason === "publication_failed") throw new Error("the financial answer could not be committed");
        return DECLINES[outcome.reason] ? declinedGap(outcome.reason) : gap(outcome.reason);
      case "driven": {
        const [unit] = outcome.report?.finalized ?? [];
        const committed = outcome.report === null || unit?.result.status === "published" || unit?.result.status === "existing" ||
          (!unit && outcome.report.existing > 0);
        if (committed) return withCommentary(await published(deps.pool, outcome.run_id, context.threadId, messageId));
        // A drive cancelled midway is a notice, as a cancelled run is.
        if (outcome.report.execution === "cancelled") return gap("run_failed");
        return declinedGap(unit?.result.status === "rejected" ? "verification_failed" : "run_failed");
      }
    }
  };
  const assertReady = () => requireFinancialReadiness(deps.pool, ["chat"]);
  return Object.freeze({ take, assertReady });
}

// The mentions a turn's plan requests: an explicit subject (a thread opened
// from a ticker page) first; like the analyst path, the companies a
// comparison's reading adds join it ("Compare revenue with AMD" from the NVDA
// page plans both, "Revenue for AMD" plans NVDA). A company the reading adds
// is written with a capital letter outside the catalogs (companyNameIn), so a
// message that writes no such word but the page's plans the page's company
// without waiting on the reading.
async function requestedMentions(context: ChatFinancialTurnContext, text: string): Promise<string[]> {
  const explicit = context.subjectText?.trim();
  const mentions = extractSubjectMentions(text);
  if (!explicit) return mentions;
  const page = explicit.toLowerCase();
  if ([...mentions, ...companyWordsIn(text)].every((name) => name.toLowerCase() === page)) return [explicit];
  return [explicit, ...comparedAdditions(await context.reading?.() ?? null)];
}

type TurnCompanies = Readonly<{
  // One per company, primary first, as the planner takes them.
  subjects: ReadonlyArray<RequestedSubject>;
  resolved: ReadonlyArray<ChatResolvedSubjectPreResolution>;
  // Labels of the companies carried from the previous answer.
  carried: ReadonlyArray<string>;
  // Names a comparison gave that match no company.
  notFound: ReadonlyArray<string>;
  // By issuer, the label each company the turn may answer for takes in its saved scope.
  labels: ReadonlyMap<string, string>;
  // A change to the compared companies too unclear to plan: the question to ask.
  clarify?: string;
}>;

const label = (resolution: ChatResolvedSubjectPreResolution) => resolution.handoff?.display_labels?.ticker ?? resolution.display_label;

async function requestedSubjects(deps: ChatFinancialRuntimeDeps, context: ChatFinancialTurnContext, text: string): Promise<TurnCompanies> {
  // Each name is resolved once, though the analyst path's rules read the message again.
  const resolutions = new Map<string, Promise<ChatSubjectPreResolution>>();
  const resolve = (mention: string) => resolutions.get(mention) ?? resolutions.set(mention, deps.resolveMention(mention)).get(mention)!;
  const mentioned = await Promise.all((await requestedMentions(context, text)).map(async (mention) => ({ mention, resolution: await resolve(mention) })));
  // A carried company is named to the planner by its ticker, unless the
  // message gives that name to another company ("the other AMB"): then by its
  // legal name, so the two stay apart.
  const typed = new Set(mentioned.map(({ mention }) => mention));
  const carriedName = (resolution: ChatResolvedSubjectPreResolution) => typed.has(label(resolution)) ? resolution.display_label : label(resolution);
  let entries: ReadonlyArray<Readonly<{ mention: string; resolution: ChatSubjectPreResolution }>> = mentioned;
  let turn: TurnSubjects | null = null;
  let notFound: ReadonlyArray<string> = [];
  const explicit = Boolean(context.subjectText?.trim());
  if (explicit) {
    // The page's company first; a compared name that matches no company is named in the answer.
    const [page, ...compared] = mentioned;
    notFound = compared.filter(({ resolution }) => resolution.status === "not_found").map(({ mention }) => mention);
    entries = [page!, ...compared.filter(({ resolution }) => resolution.status !== "not_found")];
  } else {
    turn = await resolveTurnSubjects(
      context,
      (request) => resolve(request.text),
      deps.priorSubjects && ((input) => deps.priorSubjects!(input.threadId)),
    );
    const clarify = turn.clarify ?? (turn.ambiguous && !turn.named ? turn.ambiguous.message : undefined);
    if (clarify) return { subjects: [], resolved: [], carried: [], notFound: [], labels: new Map(), clarify };
    // A company keeps the mention that first named it; one carried takes its ticker.
    // A name to ask about is asked about beside every company the turn covers.
    const mentionOf = new Map(mentioned.flatMap(({ mention, resolution }) => resolution.status === "resolved" ? [[companyKey(resolution), mention] as const] : []).reverse());
    entries = (turn.named ? [...turn.carried ?? [], ...turn.named] : turn.subjects).map((resolution) => ({
      mention: resolution.status === "resolved" ? mentionOf.get(companyKey(resolution)) ?? carriedName(resolution) : resolution.input_text,
      resolution,
    }));
  }
  const issuers = await issuersOf(deps.pool, entries.map(({ resolution }) => resolution));
  // One entry per company ("NVIDIA" the page and "NVDA" the message are one),
  // as many as the analyst path takes (resolveTurnSubjects caps its own). A
  // name to ask about is always asked about, as the analyst path asks before
  // it caps; resolved companies take the slots left, in order.
  const distinct = distinctBy(
    entries.map((entry) => ({ entry, subject: { mention: entry.mention, resolution: requestedResolution(entry.resolution, issuers) } satisfies RequestedSubject })),
    ({ subject }) => requestedKey(subject),
  );
  const toAsk = distinct.filter(({ subject }) => subject.resolution.status !== "resolved");
  const fitting = distinct.filter(({ subject }) => subject.resolution.status === "resolved").slice(0, Math.max(0, MAX_TURN_SUBJECTS - toAsk.length));
  const kept = distinct.filter((item) => toAsk.includes(item) || fitting.includes(item));
  return {
    subjects: kept.map(({ subject }) => subject),
    resolved: kept.flatMap(({ entry }) => entry.resolution.status === "resolved" ? [entry.resolution] : []),
    carried: (turn?.carried ?? []).map(carriedName),
    notFound: turn?.notFound ?? notFound,
    labels: companyLabels(kept.map(({ entry }) => entry.resolution), issuers),
  };
}

// A company's label: its ticker, else the name it was resolved or offered
// under. A listing offered in a clarification names its company by ticker.
function companyLabels(resolutions: ReadonlyArray<ChatSubjectPreResolution>, issuers: IssuerOf): Map<string, string> {
  const labels = new Map<string, string>();
  const add = (ref: { kind: string; id: string }, text: string) => {
    const id = issuers(ref)?.id.toLowerCase();
    if (id !== undefined && !labels.has(id)) labels.set(id, text);
  };
  for (const resolution of resolutions) {
    if (resolution.status === "resolved") add(resolution.subject_ref, label(resolution));
    if (resolution.status !== "needs_clarification") continue;
    for (const candidate of resolution.candidates) if (candidate.display_labels?.ticker) add(candidate.subject_ref, candidate.display_labels.ticker);
    for (const candidate of resolution.candidates) add(candidate.subject_ref, candidate.display_name);
  }
  return labels;
}

// A question about the companies to compare, which only a new message answers.
function companyQuestion(question: string): Clarification {
  return { clarification_id: hashCanonical("clarification", { kind: "request", question, choices: [] }), kind: "request", question, choices: [] };
}

// A carried company the scope dropped (an auto-selected peer turned off) is
// not planned, as the analyst path does not cover it.
function withinScope(requested: TurnCompanies, scope: ResearchScope | null): TurnCompanies {
  const scoped = new Set(scope?.companies.map((company) => company.issuer_id.toLowerCase()));
  if (scoped.size === 0) return requested;
  const dropped = requested.subjects.filter((subject) => subject.resolution.status === "resolved" && !scoped.has(subject.resolution.subject_ref.id.toLowerCase()));
  if (dropped.length === 0) return requested;
  const mentions = new Set(dropped.map((subject) => subject.mention));
  return {
    ...requested,
    subjects: requested.subjects.filter((subject) => !dropped.includes(subject)),
    carried: requested.carried.filter((name) => !mentions.has(name)),
  };
}

const NO_COMPANIES: TurnCompanies = { subjects: [], resolved: [], carried: [], notFound: [], labels: new Map() };

async function planTurn(
  model: PlanningModel | null,
  context: ChatFinancialTurnContext,
  text: string,
  requested: ReadonlyArray<RequestedSubject>,
  authority: FinancialRuntimeAuthority,
  cutoff: Date,
  // Called with the companies to plan once a clarification pick is applied,
  // before the model is, and with the overview's once it replaces the planner.
  onSubjects: (subjects: ReadonlyArray<RequestedSubject>) => void,
  turn: Readonly<{
    prepare: () => Promise<[ResearchScope | null, ScopeProposal | null]>;
    evidence: FinancialEvidencePort;
    peersOf: PeersOf;
    onOverview: () => void;
  }>,
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
    max_model_calls: model ? MAX_PLANNING_MODEL_CALLS : 0,
    requested_subjects: subjects,
    publication_unit_kind: "chat_section",
  });

  let subjects = requested;
  if (context.clarificationAnswer) {
    // The chosen company may already be requested (the explicit subject), so
    // de-duplicate again once the answer resolves the ambiguous mention.
    subjects = distinctBy(await applyAnswer(subjects, context.clarificationAnswer, planningContext, text), requestedKey);
  }
  onSubjects(subjects);
  if (CASH_RESILIENCE.test(text)) return planCashResilience(planningContext(subjects), text);
  // A failing or unreachable model is a planning gap (publishRequest); the narrative composer is never a fallback for numbers.
  let dropped = false;
  // A planner the overview drops reaches the model no more (its repair call).
  const planning: PlanningModel | null = model && ((request) => dropped ? Promise.reject(DROPPED) : model(request));
  const planned = planFinancialRequest(planningContext(subjects), text, planning ?? noModel);
  if (!resolvedCompanies(subjects)) return planned;
  // Settled now, or a planner that fails while the overview is decided is an unhandled rejection.
  const failure = planned.then(() => null, (reason: unknown) => ({ reason }));
  let companies: ReadonlyArray<RequestedSubject> | null;
  let overview: PlanningResult | null;
  try {
    const [scope, reading] = await turn.prepare();
    companies = await overviewSubjects(subjects, reading, scope, turn.peersOf);
    overview = companies && await planCompanyOverview(planningContext(companies), turn.evidence);
  } catch (reason) {
    // A defect fails the turn, so the planner's answer is not needed either.
    dropped = true;
    throw reason;
  }
  if (!companies || !overview) return planned;
  onSubjects(companies);
  turn.onOverview();
  dropped = true;
  void failure.then((failed) => {
    if (failed === null) return;
    if (failed.reason instanceof PlanningModelError && failed.reason.cause === DROPPED) {
      console.warn("[chat] the planner was dropped for the company overview; its next model call was not made");
    } else {
      console.warn("[chat] the planner the company overview replaced had failed", failed.reason);
    }
  });
  return overview;
}

const DROPPED = new Error("dropped for the company overview");

const CASH_RESILIENCE = /\bcash[- ]resilience\b/iu;
const CASH_RESILIENCE_VIEW = "cash_resilience_view";
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
    return { outcome: "unsupported", reason: CASH_RESILIENCE_VIEW, issues: [], model_calls: 0 };
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

// One item per key, the earlier one kept.
function distinctBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(key(item))) return false;
    seen.add(key(item));
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
    // Market data is Polygon's prices only (sourceClassOf): the operator
    // allowed figures derived from them in chat, from the user's own key (#444).
    allowed_source_classes: ["sec_filing", "market_data"],
    feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}

const UNCHECKED = "It was not checked whether this answer covers everything the question asks for.";

/** Writes the assistant message inside the finalization transaction, under the thread's owner. */
function persistAssistantMessage(
  threadId: string,
  messageId: string,
  turn: Readonly<{
    // The scope and the reading, settled before the run was driven (beforeDrive).
    prepared: () => Promise<[ResearchScope | null, ScopeProposal | null]>;
    carried: ReadonlyArray<string>;
    notFound: ReadonlyArray<string>;
    labels: ReadonlyMap<string, string>;
  }>,
  request: { authority: FinancialRuntimeAuthority; request_key: string },
): PersistParentArtifact {
  return async (tx, publication) => {
    const [scope, reading] = await turn.prepared();
    const plan = scope === null && reading === null ? null : await findPlanForRequest(tx.client, request);
    // A plan member the turn gave no label is a peer the overview selected. The
    // saved plan says so, as a retry that resumes the run does not plan again.
    const answeredPeers = plan?.subjects.members.some((member) => !turn.labels.has(member.subject_ref.id.toLowerCase())) ?? false;
    const missing = reading === null || plan === null ? [] : uncoveredAsks(answeredPeers ? withoutPeers(reading) : reading, plan, turn.labels);
    const note = [
      ...(turn.notFound.length === 0 ? [] : [`No company matched ${labelList(turn.notFound)}.`]),
      ...(turn.carried.length === 0 ? [] : [`${labelList(turn.carried)} ${turn.carried.length > 1 ? "are" : "is"} carried from the previous answer.`]),
      ...(reading === null ? [UNCHECKED] : missing.length === 0 ? [] : [`Not covered by this answer: ${missing.join("; ")}.`]),
    ].join(" ");
    const blocks = [
      publication.block,
      ...(note === "" ? [] : [noteBlock({ snapshotId: publication.snapshot_id, asOf: publication.block.as_of }, "uncovered", note)]),
    ];
    // The scope names the companies and figures the published plan answered,
    // so a follow-up ("why did it change?") continues them (#378 review, #425).
    const saved = scope === null || plan === null ? scope : {
      ...scope,
      // Its figures are in this answer, whatever an evidence follow-up re-read.
      reads: "financial_answer" as const,
      companies: answeredCompanies(plan.subjects.members.map((member) => member.subject_ref.id), scope, turn.labels),
      metrics: planMetrics(plan),
      ...(reading === null ? { coverage_unchecked: true as const } : {}),
    };
    // It replaces a gap another attempt of the turn saved under its id.
    const inserted = await tx.client.query(
      `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash, research_scope)
       select $1::uuid, t.thread_id, 'assistant'::chat_role, $3::uuid, $4::jsonb, $5, $7::jsonb
         from chat_threads t where t.thread_id = $2::uuid and t.user_id = $6::uuid
       on conflict (message_id) do update
         set snapshot_id = excluded.snapshot_id, blocks = excluded.blocks, content_hash = excluded.content_hash, research_scope = excluded.research_scope
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
    if (inserted.rows.length === 0) throw new ParentRefusedError("the chat thread no longer belongs to the run's owner");
    // As any saved message does, so the thread never points at a replaced gap's snapshot.
    await tx.client.query(`update chat_threads set latest_snapshot_id = $2::uuid, updated_at = now() where thread_id = $1::uuid`, [threadId, publication.snapshot_id]);
  };
}

const withoutPeers = (reading: ScopeProposal): ScopeProposal => ({ ...reading, asks: new Set([...reading.asks].filter((facet) => facet !== "peers")) });

/**
 * The companies a turn answered for, in its order. A missing label marks an
 * auto-selected peer (local-runtime.ts turnScope), so each keeps the scope's
 * entry; one the scope lacks (a clarification pick, the company two listings
 * name) takes the label the request gave it, and one the request gave none is
 * a peer the overview selected.
 */
function answeredCompanies(issuerIds: ReadonlyArray<string>, scope: ResearchScope, labels: ReadonlyMap<string, string>): ResearchScope["companies"] {
  const kept = new Map(scope.companies.map((company) => [company.issuer_id.toLowerCase(), company]));
  return issuerIds.map((id) => {
    const labelled = labels.get(id.toLowerCase());
    return kept.get(id.toLowerCase()) ?? (labelled === undefined ? { issuer_id: id } : { issuer_id: id, label: labelled });
  });
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
  cash_and_equivalents: "cash_and_equivalents",
  total_assets: "total_assets",
  total_liabilities: "total_liabilities",
  total_equity: "total_equity",
  // No chat reader serves a share count.
  weighted_average_basic_shares: null,
  weighted_average_diluted_shares: null,
  shares_outstanding: null,
  // A share price is shown only beside the valuation it prices.
  share_price: null,
  market_cap: "market_cap",
  pe_ratio: "pe_ratio",
};

const figureKey = (node: OperationNode) => node.operation === "reported_metric" ? node.metric_key : node.operation;

// The figures a node shows: a change, sum, ratio, threshold or ranking is of
// the figures it reads.
function figuresOf(nodes: ReadonlyMap<string, OperationNode>): (node: OperationNode) => OperationNode[] {
  const figures = (node: OperationNode): OperationNode[] =>
    Object.hasOwn(SCOPE_METRICS, figureKey(node)) ? [node] : operationDependencies(node).flatMap((id) => figures(nodes.get(id)!));
  return figures;
}

function shownFigures(plan: FinancialPlanV1): OperationNode[] {
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const figures = figuresOf(nodes);
  return plan.outputs.flatMap((output) => figures(nodes.get(output.node_id)!));
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
  operating_margin: "operating_margin",
  net_income: "net_income",
  net_margin: "net_margin",
};

/**
 * What a question asks for, as the model read it, that its plan does not
 * compute, so the answer names it instead of leaving it out. Each company is
 * checked on its own figures: what some companies' figures answer is named
 * for the others, by the label `labels` gives each issuer.
 */
export function uncoveredAsks(reading: ScopeProposal, plan: FinancialPlanV1, labels: ReadonlyMap<string, string> = new Map()): string[] {
  const { asks, offMetrics } = readingAsks(reading);
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  // A figure's period and company are those of its reported inputs.
  const input = (node: OperationNode) => nodes.get(operationDependencies(node)[0]!)!;
  const periodOf = (node: OperationNode): string => node.operation === "reported_metric" ? JSON.stringify(node.period) : periodOf(input(node));
  const slotOf = (node: OperationNode): string => node.operation === "reported_metric" ? node.subject_slot : slotOf(input(node));
  const shown = shownFigures(plan);
  const reached = [...dependencyClosure(plan, plan.outputs.map((output) => output.node_id))].map((id) => nodes.get(id)!);
  const companies = plan.subjects.members.map((member) => {
    const ofCompany = (node: OperationNode) => slotOf(node) === member.slot_id;
    const own = shown.filter(ofCompany);
    const margins = own.filter((node) => node.operation === "gross_margin" || node.operation === "operating_margin" || node.operation === "net_margin");
    return {
      label: labels.get(member.subject_ref.id.toLowerCase()),
      shown: own,
      reached: reached.filter(ofCompany),
      read: new Set(own.flatMap((node) => [figureKey(node), SCOPE_METRICS[figureKey(node)] ?? []].flat())),
      marginPeriods: new Set(margins.map(periodOf)).size,
    };
  });
  type Company = (typeof companies)[number];
  // An engine figure is as reported, so a qualified metric is computed only as
  // its base's growth (a change whose two inputs are that figure itself, not
  // a ratio or sum that reads it) or its trend (it over several periods).
  const computes = (metric: RequestedMetric, company: Company) => {
    const ofBase = (node: OperationNode) => SCOPE_METRICS[figureKey(node)] === metric.base;
    if (metric.adjustment !== undefined) return false;
    if (metric.qualifier === "growth") {
      return company.reached.some((node) => (node.operation === "percent_change_positive_base" || node.operation === "absolute_change") &&
        ofBase(nodes.get(node.current)!) && ofBase(nodes.get(node.prior)!));
    }
    return metric.qualifier === "trend" && new Set(company.shown.filter(ofBase).map(periodOf)).size > 1;
  };
  const metrics = [...new Map(reading.metrics
    .filter((metric) => CATALOG.has(metric.metric_key))
    .flatMap((metric) => metric.metric_key === "balance_sheet" ? BALANCE_SHEET_ITEMS.map((key) => CATALOG.get(key)!) : [metric])
    .filter((metric) => !offMetrics.has(metric.metric_key))
    .map((metric) => [metric.metric_key, metric])).values()];
  const items = reading.income_items.map((item) => ({ text: item.replaceAll("_", " "), missing: (company: Company) => !company.read.has(INCOME_ITEM_FIGURE[item] ?? "") }));
  const marginItems = items.filter((item) => item.text.endsWith("margin"));
  // Each ask, in the order the question gives them, and whether a company's figures leave it out.
  const asked: ReadonlyArray<Readonly<{ text: string; missing: (company: Company) => boolean }>> = [
    // The income items name its figures more closely than the whole statement does.
    ...metrics.filter((metric) => !(metric.metric_key === "income_statement" && reading.income_items.length > 0))
      .map((metric) => ({ text: inSentence(metric.label), missing: (company: Company) => !company.read.has(metric.metric_key) })),
    ...reading.metrics.filter((metric) => metric.base !== undefined && !offMetrics.has(metric.metric_key))
      .map((metric) => ({ text: inSentence(metric.label), missing: (company: Company) => !computes(metric, company) })),
    ...items,
    // A margin item left out names the margin already.
    ...(asks.has("margin_trend") ? [{ text: "a margin over several periods", missing: (company: Company) => company.marginPeriods < 2 }]
      : asks.has("margins") ? [{ text: "a margin", missing: (company: Company) => company.marginPeriods === 0 && !marginItems.some((item) => item.missing(company)) }]
      : []),
  ];
  return [
    ...asked.flatMap((ask) => {
      const lacking = companies.filter(ask.missing);
      if (lacking.length === 0) return [];
      const labelled = lacking.flatMap((company) => company.label ?? []);
      return [lacking.length < companies.length && labelled.length === lacking.length ? `${ask.text} for ${labelList(labelled)}` : ask.text];
    }),
    ...Object.entries(NEVER_PLANNED).flatMap(([facet, item]) => asks.has(facet as ScopeFacet) ? [item] : []),
  ];
}

// A catalog label inside a sentence: "Free cash flow" reads "free cash flow", "EBITDA" and "P/E ratio" stay.
function inSentence(label: string): string {
  return /\p{Ll}/u.test(label[1] ?? "") ? `${label[0]!.toLowerCase()}${label.slice(1)}` : label;
}

// A saved message as the thread reads it; undefined when it cannot be read
// back, so the turn completes without it.
async function readBack(db: SqlExecutor, threadId: string, messageId: string): Promise<ChatReadMessage | null | undefined> {
  try {
    return await readChatMessage(db, { thread_id: threadId, message_id: messageId });
  } catch (error) {
    logUnreadMessage(messageId, error);
    return undefined;
  }
}

// A gap an earlier attempt of the turn saved.
async function savedGap(db: SqlExecutor, threadId: string, messageId: string): Promise<ChatFinancialTurn> {
  return { kind: "saved", message_id: messageId, message: (await readBack(db, threadId, messageId)) ?? null };
}

async function published(db: SqlExecutor, runId: string, threadId: string, messageId: string): Promise<ChatFinancialTurn> {
  const message = await readBack(db, threadId, messageId);
  return message === null ? gap("run_failed") : { kind: "published", run_id: runId, message_id: messageId, message: message ?? null };
}

// What an unsupported request asks for, by the planner's reason (its closed
// list) or the cash-resilience view's; any other reason gets the plain text,
// so no model-written words reach the gap.
const REASON_TEXT: Readonly<Record<Exclude<UnsupportedReason, "other"> | typeof CASH_RESILIENCE_VIEW, string>> = {
  segments: "revenue or results by business segment",
  forecast: "guidance, estimates or forecasts",
  adjusted: "adjusted or non-GAAP figures",
  undefined_metric: "a metric with no verified definition",
  cash_resilience_view: "cash resilience is an annual view without scores, peer ranks, or cash and debt measures",
};

function gap(reason_code: ChatGap, planned?: PlanningResult): Extract<ChatFinancialTurn, { kind: "gap" }> {
  const reason = reason_code === "unsupported" && planned?.outcome === "unsupported" && Object.hasOwn(REASON_TEXT, planned.reason)
    ? REASON_TEXT[planned.reason as keyof typeof REASON_TEXT]
    : null;
  return { kind: "gap", reason_code, text: reason === null ? GAP_TEXT[reason_code] : `${UNSUPPORTED}: ${reason}.` };
}
