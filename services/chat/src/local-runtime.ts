import { Pool } from "pg";

import {
  emptyEvidence,
  loadLocalRuntimeEvidence,
  loadVerifierFactsForRefs,
  loadVerifierRowsForRefs,
  type LocalRuntimeClaimEvidence,
  type LocalRuntimeEvidence,
  type LocalRuntimeEvidenceInput,
} from "../../evidence/src/local-runtime-evidence.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import { hashJsonValue, toolCallArgsDigest } from "../../observability/src/tool-call.ts";
import { serializeJsonValue, type JsonValue } from "../../observability/src/types.ts";
import type { SnapshotManifestDraft, SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { STAGED_SNAPSHOT_MANIFEST } from "../../snapshot/src/manifest-staging.ts";
import { sealSnapshotWithPool } from "../../snapshot/src/snapshot-sealer.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { planningModelFromRouter } from "../../financial-engine/src/planner.ts";
import { createLlmRouterFromEnv } from "../../llm/src/index.ts";
import {
  createRegistryBackedAnalystToolRuntime,
  type ChatAnalystToolRuntime,
  type ChatAnalystToolRuntimeResult,
  type ChatAnalystToolRuntimeToolCall,
  type ChatAssistantMessagePersistence,
  type ChatAssistantMessagePersistenceInput,
  type ChatPriorSubjectsLoader,
  type ChatThreadTitleGenerator,
} from "./coordinator.ts";
import { answerTurn, type AnswerTraceInput } from "./answer-trace.ts";
import { isUuid, noteBlock } from "./chat-ids.ts";
import { claimSelection } from "./evidence-packet.ts";
import { readingAsks, readsEngine, resolveResearchScope, type ResearchScope, type ScopeProposal } from "./research-scope.ts";
import { proposeScope } from "./scope-proposal.ts";
import { frozenDataMode, hydrateYtdBars, marketHydrationOrigin, turnNow } from "./ytd-hydration.ts";
import { companyListings, listingTimeZones, loadPerfComparisonBlocks, priceListingsForTurn, turnCompanies } from "./perf-block.ts";
import { loadPriorScope, loadPriorSubjects as loadThreadPriorSubjects, loadRecentConversation } from "./thread-context.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { createLlmThreadTitleModel } from "./llm-runtime.ts";
import { structuredRefsFromHandoff } from "./local-runtime-structured.ts";
import { createChatFinancialRuntime, type ChatFinancialRuntime, type ChatFinancialTurnContext } from "./financial-runtime.ts";
import { saveCommentary } from "./engine-commentary.ts";
import { createChatMessagePersistence } from "./messages.ts";
import {
  preResolveChatSubjectWithResolver,
  type ChatResolvedSubjectPreResolution,
  type ChatSubjectPreResolution,
  type ChatSubjectPreResolveRequest,
} from "./subjects.ts";
import { createThreadTitleGenerationJob } from "./thread-title.ts";

let localPool: Pool | null = null;

export function preResolveSubject(
  request: ChatSubjectPreResolveRequest,
): Promise<ChatSubjectPreResolution> {
  return preResolveChatSubjectWithResolver(pool(), request);
}

// Chat tolerates a missing research-claims read: a freshly-covered subject (or a
// transient DB hiccup) should still answer from price + fundamentals rather than
// failing the turn. This is the chat-specific policy boundary — the shared
// evidence loader keeps throwing for callers that don't want to degrade.
// loadStructuredSubjectContext already self-degrades, so both loads are now
// uniformly empty-on-failure and the caller just Promise.all's them.
export async function loadEvidenceOrEmpty(
  db: QueryExecutor,
  input: LocalRuntimeEvidenceInput,
): Promise<LocalRuntimeEvidence & { unavailable?: true }> {
  try {
    return await loadLocalRuntimeEvidence(db, input);
  } catch (reason) {
    console.warn("[chat] evidence load failed; serving without research claims", reason);
    // Unavailable, not "none on file": the packet says so (#207), and names
    // nothing the failed read might have held.
    return { ...emptyEvidence(input.subject_refs), unavailable: true };
  }
}

export const analystToolRuntime: ChatAnalystToolRuntime = async (context) => {
  const resolved = context.subjectPreResolution?.status === "resolved"
    ? context.subjectPreResolution
    : null;
  // Every company the turn covers (primary first); see resolveTurnSubjects.
  const carriedSubjects = context.subjectPreResolutions ?? (resolved ? [resolved] : []);
  // What the turn asks for, keeping a follow-up's unchanged scope (#206). A
  // window asked for now is cut off at the turn's asOf, which a follow-up keeps.
  const scopeAt = await analystTurnScope(context.threadId, context.userIntent ?? "", carriedSubjects, context.reading?.() ?? Promise.resolve(null));
  // A live YTD request fetches its prices first, so the cutoff below covers them (#232).
  await hydrateYtdWindow(scopeAt(turnNow(process.env)), carriedSubjects);
  const asOf = turnNow(process.env);
  const scope = scopeAt(asOf);
  // A carried-forward company the scope dropped (an auto-selected peer turned
  // off) is not covered either, so the next follow-up does not bring it back.
  const scoped = new Set(scope.companies.map((company) => company.issuer_id));
  const covered = carriedSubjects.filter((subject) => {
    const issuer = structuredRefsFromHandoff(subject.handoff).issuer;
    return issuer === null || scoped.has(issuer.id);
  });
  const subjectRefs = covered.length > 0
    ? covered.map((subject) => subject.subject_ref)
    : [{ kind: "screen" as const, id: context.threadId }];
  const registryRuntime = createRegistryBackedAnalystToolRuntime({
    executeTool: async ({ toolName, arguments: args }) => {
      const evidence = await loadEvidenceOrEmpty(pool(), {
        subject_refs: subjectRefs,
        user_id: context.userId ?? null,
        // The route's claims first, none published after the turn's cutoff (#207).
        as_of: asOf,
        selection: claimSelection(scope, asOf),
      });
      return {
        kind: "local_evidence_tool_result",
        status: "ok",
        tool_name: toolName,
        arguments: args,
        manifest_contribution: {
          subject_refs: subjectRefs,
          claim_refs: evidence.claim_refs,
          document_refs: evidence.document_refs,
          source_ids: evidence.source_ids,
        },
        evidence,
      };
    },
  });
  const result = await registryRuntime(context);
  const toolCalls = result.tool_calls ?? [];
  const claims = evidenceForToolCalls(toolCalls).flatMap((evidence) => evidence.claims);
  await writeLocalToolCallLogs(context.threadId, toolCalls);
  const toolCallIds = toolCalls
    .filter((toolCall) => toolCall.status === "ok")
    .map((toolCall) => toolCall.tool_call_id);
  // The analyst shows no figure of its own: every number is the engine's (#398),
  // but for a comparison's year-to-date price chart, market data outside the
  // engine and labelled not verified until #444's price observations (D2). A
  // turn re-reading an engine answer, or asking only for metrics no reader
  // serves, charts nothing.
  const window = scope.reads !== "unavailable_metric" && !readsEngine(scope.reads) ? scope.price_window : null;
  const [performance, conversation] = await Promise.all([
    window ? ytdChart(scope, window, requestedListingsOf(covered), result.snapshot_id, asOf) : Promise.resolve([]),
    loadRecentConversation(pool(), { threadId: context.threadId, limit: CONVERSATION_MESSAGES }),
  ]);
  const factBlocks = [...performance, ...scopeGapBlocks(scope, { snapshotId: result.snapshot_id, asOf }, await context.reading?.() ?? null)];
  let answeredBy: string | undefined;
  const answerInput: AnswerTraceInput = {
    // Only what the answer reads: the turn context also holds callbacks.
    context: { userIntent: context.userIntent, bundleId: context.bundleId },
    blocks: result.blocks,
    toolCalls,
    factBlocks,
    conversation,
    // Auto-selected peers named for the packet; the saved scope keeps them
    // unlabelled, which is how a later turn knows they were auto-selected.
    scope: await withCompanyLabels(scope, asOf),
    cutoff: asOf,
  };
  // While the judge reads the answer's inferences, the answer shows a line in
  // each one's place; `judging` brings each verdict's blocks as it settles,
  // and the blocks the turn saves (answer-trace.ts).
  const answer = await answerTurn(answerInput, {
    thread_id: context.threadId,
    run_id: context.runId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    question: context.userIntent ?? "",
  }, {
    env: process.env,
    traceDir: process.env.CHAT_TRACE_DIR?.trim(),
    onAnswered: (deployment) => {
      answeredBy = deployment;
    },
  });
  const answerUsage = answer.exchange?.usage;
  const { judging } = answer;
  const normalize = (block: Record<string, unknown>, refs: CitedRefs) =>
    normalizeAssistantBlock(block, {
      snapshotId: result.snapshot_id,
      asOf,
      subjectRefs,
      defaultRefs: refs,
      toolCallIds,
    });
  const turnBlocks = (llmBlocks: ReadonlyArray<Record<string, unknown>>) => [
    ...llmBlocks.map((block) => normalize(block, citedRefs(block, claims))),
    ...factBlocks.map((block) => normalize(block, NO_DEFAULT_REFS)),
  ];
  return {
    ...result,
    blocks: turnBlocks(answer.blocks),
    ...(judging
      ? {
        judging: {
          watch: (listener: (blocks: ReadonlyArray<Record<string, unknown>>) => void) => judging.watch((blocks) => listener(turnBlocks(blocks))),
          done: judging.done.then(({ blocks, assertions }) => ({
            blocks: turnBlocks(blocks),
            ...(assertions ? { assertion_report: assertions } : {}),
          })),
        },
      }
      : {}),
    ...(answeredBy ? { answered_by: answeredBy } : {}),
    ...(answerUsage ? { answer_usage: answerUsage } : {}),
    ...(answer.assertions ? { assertion_report: answer.assertions } : {}),
    research_scope: scope,
  } satisfies ChatAnalystToolRuntimeResult;
};

const CONVERSATION_MESSAGES = 6;

// The year-to-date chart of the companies the scope records, peers already
// resolved (comparedCompanies). An inherited window keeps the cutoff it was
// charted at. Empty when the listings cannot be read: the chart never costs
// the turn its answer.
async function ytdChart(
  scope: ResearchScope,
  window: NonNullable<ResearchScope["price_window"]>,
  requestedListings: ReadonlyMap<string, { listing_id: string; label: string }>,
  snapshotId: string,
  asOf: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const listings = await priceListingsForTurn(pool(), { issuers: issuersOfScope(scope), wantsPeers: false, requestedListings, asOf }).catch((reason) => {
    console.warn("[chat] company listings unavailable; answering without the price chart", reason);
    return [];
  });
  return loadPerfComparisonBlocks(pool(), {
    listings,
    snapshotId,
    asOf: scope.inherited.includes("price_window") ? window.cutoff : asOf,
    frozenPrices: frozenDataMode(process.env),
  });
}

// What the scope asks for and the data does not hold, each as a note (#206):
// a year-to-date window over one company, which only a comparison charts; a
// price return over another window than year to date; a benchmark index; and
// for a turn re-reading the engine's answer or declined request, where its
// evidence is.
export function scopeGapBlocks(scope: ResearchScope, input: { snapshotId: string; asOf: string }, reading: ScopeProposal | null = null): ReadonlyArray<Record<string, unknown>> {
  const names = scope.companies.flatMap((company) => company.label ?? []).join(", ") || "these companies";
  const notes: Array<readonly [string, string]> = [];
  if (scope.reads === "financial_answer") {
    notes.push(["gap:financial_answer", "The previous answer's figures were calculated and verified by the financial engine; each one links to its sources in that answer, and no other figure is shown in their place."]);
  }
  if (scope.reads === "financial_gap") {
    notes.push(["gap:financial_gap", "The previous answer showed no figure, so there is no evidence to show; no other figure is shown in its place."]);
  }
  if (scope.price_window !== null && scope.companies.length < 2 && !readsEngine(scope.reads)) {
    notes.push(["gap:price_window", `A year-to-date price return is charted only to compare two or more companies, so none is shown for ${names}.`]);
  }
  if (reading !== null && readingAsks(reading).asks.has("price_history")) {
    notes.push(["gap:price_history", "Only a year-to-date price return is charted here, not the window this question asks for."]);
  }
  if (scope.benchmark) {
    notes.push(["gap:benchmark", scope.companies.length > 1
      ? "A benchmark index is not in this data, so the companies are compared only with each other."
      : `A benchmark index is not in this data, so ${names} is not compared with one.`]);
  }
  return notes.map(([key, text]) => noteBlock(input, key, text));
}

// The scope with every company named by its ticker (else legal name), for the
// evidence packet. Unchanged if the lookup fails: the packet then names an
// unlabelled company by issuer.
async function withCompanyLabels(scope: ResearchScope, asOf: string): Promise<ResearchScope> {
  const unlabelled = scope.companies.filter((company) => company.label === undefined).map((company) => company.issuer_id);
  if (unlabelled.length === 0) return scope;
  const listings = await companyListings(pool(), unlabelled, asOf).catch((reason) => {
    console.warn("[chat] company labels unavailable for the evidence packet", reason);
    return new Map<string, { label: string }>();
  });
  return {
    ...scope,
    companies: scope.companies.map((company) => {
      const label = company.label ?? listings.get(company.issuer_id)?.label;
      return label === undefined ? company : { ...company, label };
    }),
  };
}

// An analyst turn's scope at a cutoff: what the question asks for and turns
// off, as the turn's reading has it (scope-proposal.ts).
export function analystTurnScope(
  threadId: string,
  question: string,
  covered: ReadonlyArray<ChatResolvedSubjectPreResolution>,
  reading: Promise<ScopeProposal | null>,
): Promise<(cutoff: string) => ResearchScope> {
  return turnScope(threadId, question, covered, false, reading);
}

export const readQuestion = (question: string) => proposeScope({ question });

// The turn's research scope at a cutoff (research-scope.ts): what it asks for,
// keeping the previous answer's scope where it continues it. The companies are
// the ones the answer compares, auto-selected peers included, so the price
// fetch and a follow-up about a peer both see them.
async function turnScope(
  threadId: string,
  question: string,
  covered: ReadonlyArray<ChatResolvedSubjectPreResolution>,
  served: boolean,
  // The model's reading of the question, awaited beside the previous scope;
  // null asks for nothing new.
  proposal: Promise<ScopeProposal | null>,
): Promise<(cutoff: string) => ResearchScope> {
  const carried = companiesOf(covered);
  const [prior, read] = await Promise.all([continuedScope(threadId, carried), proposal]);
  // Peers turned off: the previous answer's auto-selected peers (saved with no
  // label) go with them, though the follow-up carried them forward.
  const autoPeers = new Set(prior?.peers ? prior.companies.flatMap((company) => company.label === undefined ? [company.issuer_id] : []) : []);
  // An auto-selected peer the follow-up no longer carries was dropped by name
  // ("drop AMD"): it is not selected again. With none left, peers are off.
  const carriedIds = new Set(carried.map((company) => company.issuer_id));
  const dropped = new Set([...autoPeers].filter((id) => !carriedIds.has(id)));
  const allDropped = autoPeers.size > 0 && dropped.size === autoPeers.size;
  const peersOff = autoPeers.size > 0 && (allDropped ||
    !resolveResearchScope({ companies: carried, prior, asOf: turnNow(process.env), served, proposal: read }).peers);
  const named = peersOff ? carried.filter((company) => !autoPeers.has(company.issuer_id)) : carried;
  const resolve = (cutoff: string) =>
    resolveResearchScope({ companies: named, prior, asOf: cutoff, served, peersOff: allDropped, proposal: read });
  const base = resolve(turnNow(process.env));
  // An evidence follow-up keeps the previous answer's companies as they were; a
  // financial answer covers exactly the companies its plan requested.
  const compared = (base.route === "evidence_followup" || served ? base.companies : await comparedCompanies(named, base.peers))
    .filter((company) => !dropped.has(company.issuer_id));
  // An auto-selected peer stays one (no label) while peers stay on, however
  // many turns later they are turned off, unless the question names it.
  const words = new Set(question.split(/[^A-Za-z0-9.]+/));
  const companies = compared.map((company) =>
    autoPeers.has(company.issuer_id) && !(company.label !== undefined && words.has(company.label)) ? { issuer_id: company.issuer_id } : company
  );
  return (cutoff) => ({ ...resolve(cutoff), companies });
}

// The companies the answer compares: the ones the turn covers, or for a peers
// request one company plus its auto-selected peers (turnCompanies, the set the
// fact blocks chart).
async function comparedCompanies(
  named: ResearchScope["companies"],
  peers: boolean,
): Promise<ResearchScope["companies"]> {
  if (!peers || named.length !== 1) return named;
  const issuers = await turnCompanies(pool(), named.map((company) => ({ kind: "issuer" as const, id: company.issuer_id })), true);
  return issuers.map((issuer) => named.find((company) => company.issuer_id === issuer.id) ?? { issuer_id: issuer.id });
}

// The previous answer's scope when this turn continues it: it covers one of
// that answer's companies, however it named them (carried forward, named
// again, or the ticker page's subject). A turn about other companies, or about
// none, starts fresh.
async function continuedScope(
  threadId: string,
  companies: ResearchScope["companies"],
): Promise<ResearchScope | null> {
  if (companies.length === 0) return null;
  const prior = await loadPriorScope(pool(), { threadId });
  const ids = new Set(companies.map((company) => company.issuer_id));
  return prior !== null && prior.companies.some((company) => ids.has(company.issuer_id)) ? prior : null;
}

// Live mode only (marketHydrationOrigin): fetches and stores the YTD window's
// bars for the companies the chart will cover. Never throws; a failure leaves
// the chart to name what is missing. An inherited window is fetched again at
// its cutoff, so a company the turn adds gets its prices and an earlier failed
// fetch is retried.
// ponytail: the chart rereads stored bars at the inherited cutoff, so a provider
// correction to them since shows corrected returns; reusing the earlier
// snapshot's sealed observations is the upgrade if that matters.
async function hydrateYtdWindow(
  scope: ResearchScope,
  covered: ReadonlyArray<ChatResolvedSubjectPreResolution>,
): Promise<void> {
  const origin = marketHydrationOrigin(process.env);
  if (origin === null || scope.price_window === null) return;
  const now = scope.price_window.cutoff;
  try {
    const listings = await priceListingsForTurn(pool(), {
      issuers: issuersOfScope(scope),
      wantsPeers: false,
      requestedListings: requestedListingsOf(covered),
      asOf: now,
    });
    const zones = await listingTimeZones(pool(), listings);
    await hydrateYtdBars({
      origin,
      listings: listings.map((listing) => ({ id: listing.id, timeZone: zones.get(listing.id) ?? "UTC" })),
      now,
    });
  } catch (reason) {
    console.warn("[chat] YTD price fetch skipped; charting from the bars already stored", reason);
  }
}

// The previous answer's companies, for follow-ups ("compare it with AMD").
export const loadPriorSubjects: ChatPriorSubjectsLoader = ({ threadId }) =>
  loadThreadPriorSubjects(pool(), { threadId });

// For companies the user named by listing, that listing (and its ticker).
function requestedListingsOf(
  subjects: ReadonlyArray<ChatResolvedSubjectPreResolution>,
): Map<string, { listing_id: string; label: string }> {
  const out = new Map<string, { listing_id: string; label: string }>();
  for (const subject of subjects) {
    if (subject.subject_ref.kind !== "listing") continue;
    const refs = structuredRefsFromHandoff(subject.handoff);
    const listing = refs.listings.find((candidate) => candidate.ref.id === subject.subject_ref.id);
    if (refs.issuer === null || listing === undefined || out.has(refs.issuer.id)) continue;
    out.set(refs.issuer.id, { listing_id: listing.ref.id, label: listing.ticker ?? subject.display_label });
  }
  return out;
}

// The turn's canonical companies, primary first, as its scope records them.
function companiesOf(subjects: ReadonlyArray<ChatResolvedSubjectPreResolution>): ResearchScope["companies"] {
  const seen = new Set<string>();
  return subjects.flatMap((subject) => {
    const issuer = structuredRefsFromHandoff(subject.handoff).issuer;
    if (issuer === null || seen.has(issuer.id)) return [];
    seen.add(issuer.id);
    // The ticker, as answers name companies ("AMD"), else the display label.
    return [{ issuer_id: issuer.id, label: subject.handoff.display_labels?.ticker ?? subject.display_label }];
  });
}

function issuersOfScope(scope: ResearchScope): IssuerSubjectRef[] {
  return scope.companies.map((company) => ({ kind: "issuer" as const, id: company.issuer_id }));
}

const NO_DEFAULT_REFS: CitedRefs = Object.freeze({
  source_refs: [],
  claim_refs: [],
  document_refs: [],
  provenance_fact_refs: [],
});

// A published financial answer saves its scope too, so a period it asks for
// carries into the next follow-up (#206). Its metrics are the published plan's
// (financial-runtime.ts).
export async function financialResearchScope(
  context: ChatFinancialTurnContext,
  reading: Promise<ScopeProposal | null>,
): Promise<ResearchScope> {
  const covered = context.subjectPreResolutions ??
    (context.subjectPreResolution?.status === "resolved" ? [context.subjectPreResolution] : []);
  return (await turnScope(context.threadId, context.userIntent ?? "", covered, true, reading))(turnNow(process.env));
}

export const financialRuntime: ChatFinancialRuntime = createChatFinancialRuntime({
  pool: { query: (text, values) => pool().query(text, values), connect: () => pool().connect() },
  planningModel: async (request) => {
    const router = await createLlmRouterFromEnv(process.env);
    if (!router) throw new Error("LLM router is not configured");
    return planningModelFromRouter(router)(request);
  },
  resolveMention: (mention) => preResolveSubject({ text: mention }),
  priorSubjects: (threadId) => loadPriorSubjects({ threadId }),
  evidence: createEvidenceFinancialPort,
  researchScope: financialResearchScope,
  commentary: (db, input) => saveCommentary(db, (answer, turn, onAnswered) =>
    answerTurn(answer, turn, { env: process.env, traceDir: process.env.CHAT_TRACE_DIR?.trim(), onAnswered }), input),
});

export const persistAssistantMessage: ChatAssistantMessagePersistence = async (message) =>
  createChatMessagePersistence({
    pool: pool(),
    sealSnapshot: sealAssistantMessageSnapshot,
  })(message);

export const generateThreadTitle: ChatThreadTitleGenerator = async (job) =>
  createThreadTitleGenerationJob({
    db: pool(),
    model: createLlmThreadTitleModel(),
  })(job);

async function sealAssistantMessageSnapshot(input: ChatAssistantMessagePersistenceInput) {
  const blocks = input.blocks as ReadonlyArray<Record<string, unknown>>;
  const snapshotId = snapshotIdFromBlocks(blocks);
  const asOf = maxBlockAsOf(blocks) ?? turnNow(process.env);
  const userId = await threadUserId(input.threadId);
  const manifest = await manifestFromBlockRefs({
    subjectRefs: subjectRefsFromBlocks(blocks, input.threadId),
    asOf,
    modelVersion: "chat-local-runtime",
    blocks,
  });
  // Independent reads off the built manifest — load the source/doc/claim rows
  // and the fact rows the verifier needs in parallel.
  const [verifierRows, facts] = await Promise.all([
    loadVerifierRowsForRefs(pool(), {
      source_ids: manifest.source_ids,
      document_refs: manifest.document_refs,
      claim_refs: manifest.claim_refs,
      user_id: userId,
    }),
    // As of the snapshot, like the readers that chose these facts (#159).
    loadVerifierFactsForRefs(pool(), { fact_refs: manifest.fact_refs, cutoff: asOf }),
  ]);
  return sealSnapshotWithPool(pool(), {
    snapshot_id: snapshotId,
    thread_id: input.threadId,
    manifest,
    blocks: blocks as never,
    facts,
    sources: verifierRows.sources,
    documents: verifierRows.documents,
    claims: verifierRows.claims,
  });
}

async function threadUserId(threadId: string): Promise<string | null> {
  const { rows } = await pool().query<{ user_id: string }>(
    `select user_id::text as user_id
       from chat_threads
      where thread_id = $1::uuid`,
    [threadId],
  );
  return rows[0]?.user_id ?? null;
}

function evidenceForToolCalls(
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
): ReadonlyArray<LocalRuntimeEvidence> {
  return Object.freeze(
    toolCalls.flatMap((toolCall) => {
      if (toolCall.status !== "ok" || !isJsonObject(toolCall.result)) return [];
      return isLocalRuntimeEvidence(toolCall.result.evidence) ? [toolCall.result.evidence] : [];
    }),
  );
}

type CitedRefs = Readonly<{
  source_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  provenance_fact_refs: ReadonlyArray<string>;
}>;

/**
 * What an analyst answer's block cites, for its seal: the claims its segments
 * quote, with their documents and sources, and the sources its figures name.
 * Nothing it loaded and did not use.
 */
export function citedRefs(
  block: Record<string, unknown>,
  claims: ReadonlyArray<Pick<LocalRuntimeClaimEvidence, "claim_id" | "document_id" | "source_id">>,
): CitedRefs {
  const segments = Array.isArray(block.segments) ? block.segments as Array<{ type?: unknown; ref_kind?: unknown; ref_id?: unknown }> : [];
  const quoted = new Set(segments.flatMap((segment) => segment.type === "ref" && segment.ref_kind === "claim" && typeof segment.ref_id === "string" ? [segment.ref_id] : []));
  const cited = claims.filter((claim) => quoted.has(claim.claim_id));
  const sources = Array.isArray(block.source_refs) ? block.source_refs.filter((id): id is string => typeof id === "string") : [];
  return {
    source_refs: firstSeen([...sources, ...cited.map((claim) => claim.source_id)]),
    claim_refs: firstSeen(cited.map((claim) => claim.claim_id)),
    document_refs: firstSeen(cited.map((claim) => claim.document_id)),
    provenance_fact_refs: [],
  };
}

async function manifestFromBlockRefs(input: {
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
  asOf: string;
  modelVersion: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
}): Promise<SnapshotManifestDraft> {
  const toolCallIds = uuidRefsFromBlocks(input.blocks, "tool_call_ids");
  const toolCallResultHashes = await loadToolCallResultHashes(toolCallIds);
  const seriesSpecs = input.blocks.flatMap((block) =>
    Array.isArray(block.provenance_series_specs) ? block.provenance_series_specs as JsonValue[] : []
  );
  return Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true as const,
    subject_refs: Object.freeze([...input.subjectRefs]),
    fact_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "provenance_fact_refs")),
    claim_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "claim_refs")),
    event_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "event_refs")),
    document_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "document_refs")),
    // Sealed price series cited by chart blocks (see perf-block.ts).
    series_specs: Object.freeze(seriesSpecs),
    source_ids: Object.freeze(uuidRefsFromBlocks(input.blocks, "source_refs")),
    tool_call_ids: Object.freeze(toolCallIds),
    tool_call_result_hashes: Object.freeze(toolCallResultHashes),
    as_of: input.asOf,
    // Describe the sealed series' data (adjusted percent returns) when there is
    // one; a snapshot with no price series keeps the raw defaults.
    ...seriesSemantics(seriesSpecs),
    coverage_start: null,
    allowed_transforms: Object.freeze({}),
    model_version: input.modelVersion,
    parent_snapshot: null,
  });
}

function seriesSemantics(specs: ReadonlyArray<JsonValue>): {
  basis: SnapshotManifestDraft["basis"];
  normalization: SnapshotManifestDraft["normalization"];
} {
  const bases = new Set(specs.map((spec) => (spec as { adjustment_basis?: unknown }).adjustment_basis));
  const normalizations = new Set(specs.map((spec) => (spec as { normalization?: unknown }).normalization));
  const [basis] = bases;
  const [normalization] = normalizations;
  // One chart, one basis: a mixed set would not describe any single series.
  if (bases.size !== 1 || normalizations.size !== 1) return { basis: "unadjusted", normalization: "raw" };
  return {
    basis: basis as SnapshotManifestDraft["basis"],
    normalization: normalization as SnapshotManifestDraft["normalization"],
  };
}

async function loadToolCallResultHashes(
  toolCallIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<{ tool_call_id: string; result_hash: string }>> {
  if (toolCallIds.length === 0) return Object.freeze([]);
  const { rows } = await pool().query<{ tool_call_id: string; result_hash: string }>(
    `select tool_call_id::text as tool_call_id,
            result_hash
       from tool_call_logs
      where tool_call_id = any($1::uuid[])
        and status = 'ok'
        and result_hash is not null`,
    [toolCallIds],
  );
  const byId = new Map(rows.map((row) => [row.tool_call_id, row.result_hash]));
  return Object.freeze(
    toolCallIds.flatMap((tool_call_id) => {
      const result_hash = byId.get(tool_call_id);
      return result_hash === undefined ? [] : [Object.freeze({ tool_call_id, result_hash })];
    }),
  );
}

async function writeLocalToolCallLogs(
  threadId: string,
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
): Promise<void> {
  for (const toolCall of toolCalls) {
    if (toolCall.status !== "ok" || toolCall.result === undefined) continue;
    const args = (toolCall.arguments ?? {}) as JsonValue;
    const result = toolCall.result;
    await pool().query(
      `insert into tool_call_logs
         (tool_call_id, thread_id, tool_name, args, result_hash, duration_ms, status, error_code)
       values ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8)
       on conflict (tool_call_id) do update
          set result_hash = excluded.result_hash,
              status = excluded.status,
              error_code = excluded.error_code`,
      [
        toolCall.tool_call_id,
        threadId,
        toolCall.tool_name,
        serializeJsonValue(toolCallArgsDigest(args)),
        hashJsonValue(result),
        0,
        "ok",
        null,
      ],
    );
  }
}

function uuidRefsFromBlocks(
  blocks: ReadonlyArray<Record<string, unknown>>,
  key: string,
): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const block of blocks) {
    const values = block[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== "string" || !isUuid(value) || seen.has(value)) continue;
      seen.add(value);
      refs.push(value);
    }
  }
  return refs;
}

function normalizeAssistantBlock(
  block: Record<string, unknown>,
  input: {
    snapshotId: string;
    asOf: string;
    subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
    defaultRefs: CitedRefs;
    toolCallIds: ReadonlyArray<string>;
  },
): Record<string, unknown> {
  const kind = typeof block.kind === "string" && block.kind.length > 0 ? block.kind : "rich_text";
  // Keep data_ref.params: fact blocks carry their fact_bindings there.
  const params = (block.data_ref as { params?: unknown } | undefined)?.params;
  return {
    ...block,
    kind,
    snapshot_id: input.snapshotId,
    data_ref: { kind, id: String(block.id ?? input.snapshotId), ...(params === undefined ? {} : { params }) },
    source_refs: Array.isArray(block.source_refs) && block.source_refs.length > 0
      ? block.source_refs
      : input.defaultRefs.source_refs,
    claim_refs: Array.isArray(block.claim_refs) && block.claim_refs.length > 0
      ? block.claim_refs
      : input.defaultRefs.claim_refs,
    document_refs: Array.isArray(block.document_refs) && block.document_refs.length > 0
      ? block.document_refs
      : input.defaultRefs.document_refs,
    // Provenance facts (informed the answer, not rendered by this block). Carried
    // in a non-`fact_refs` field so the verifier does not demand a per-block fact
    // binding; manifestFromBlockRefs promotes these to manifest.fact_refs.
    provenance_fact_refs: Array.isArray(block.provenance_fact_refs) && block.provenance_fact_refs.length > 0
      ? block.provenance_fact_refs
      : input.defaultRefs.provenance_fact_refs,
    tool_call_ids: input.toolCallIds,
    // A block built from sealed price series keeps its stored range's date (it
    // may be stale); every other block, including any the model wrote, is dated
    // by the answer. Never later than the answer.
    as_of: Array.isArray(block.provenance_series_specs) && typeof block.as_of === "string" && block.as_of <= input.asOf
      ? block.as_of
      : input.asOf,
    subject_refs: subjectRefsForBlock(block, input.subjectRefs),
  };
}

// A block that lists its own subjects (perf_comparison: one per label and line)
// keeps exactly those. Other blocks carry the turn's companies plus any they
// name (a comparison's issuers). The sealed manifest collects every block's
// subject_refs, so it covers every subject shown either way.
export function subjectRefsForBlock(
  block: Record<string, unknown>,
  turnRefs: ReadonlyArray<SnapshotSubjectRef>,
): SnapshotSubjectRef[] {
  const own = Array.isArray(block.subject_refs) ? block.subject_refs.filter(isSnapshotSubjectRef) : [];
  if (own.length > 0) return own;
  const named = Array.isArray(block.subjects) ? block.subjects.filter(isSnapshotSubjectRef) : [];
  return distinctSubjectRefs([...turnRefs, ...named]);
}

function distinctSubjectRefs(refs: ReadonlyArray<SnapshotSubjectRef>): SnapshotSubjectRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function snapshotIdFromBlocks(blocks: ReadonlyArray<Record<string, unknown>>): string {
  const snapshotId = blocks.find((block) => typeof block.snapshot_id === "string")?.snapshot_id;
  if (typeof snapshotId !== "string" || !isUuid(snapshotId)) {
    throw new Error("assistant blocks must carry a UUID snapshot_id before sealing");
  }
  return snapshotId;
}

function subjectRefsFromBlocks(
  blocks: ReadonlyArray<Record<string, unknown>>,
  fallbackId: string,
): ReadonlyArray<SnapshotSubjectRef> {
  const refs: SnapshotSubjectRef[] = [];
  for (const block of blocks) {
    const subjectRefs = block.subject_refs;
    if (!Array.isArray(subjectRefs)) continue;
    for (const subjectRef of subjectRefs) {
      if (isSnapshotSubjectRef(subjectRef)) refs.push(subjectRef);
    }
  }
  if (refs.length > 0) return refs;
  return [{ kind: "screen", id: fallbackId }];
}

function maxBlockAsOf(blocks: ReadonlyArray<Record<string, unknown>>): string | null {
  const values = blocks
    .map((block) => block.as_of)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return values.at(-1) ?? null;
}

function pool(): Pool {
  if (localPool) return localPool;
  const databaseUrl = process.env.CHAT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for chat local runtime");
  }
  localPool = new Pool({ connectionString: databaseUrl });
  return localPool;
}

export async function closeLocalRuntimePoolForTests(): Promise<void> {
  const poolToClose = localPool;
  localPool = null;
  await poolToClose?.end();
}

function firstSeen(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return Object.freeze(result);
}

function isLocalRuntimeEvidence(value: unknown): value is LocalRuntimeEvidence {
  if (!isJsonObject(value)) return false;
  return Array.isArray(value.source_ids) &&
    Array.isArray(value.document_refs) &&
    Array.isArray(value.claim_refs) &&
    Array.isArray(value.verifier_sources) &&
    Array.isArray(value.verifier_documents) &&
    Array.isArray(value.verifier_claims);
}

function isSnapshotSubjectRef(value: unknown): value is SnapshotSubjectRef {
  if (!isJsonObject(value)) return false;
  return isSnapshotSubjectKind(value.kind) && typeof value.id === "string" && isUuid(value.id);
}

function isSnapshotSubjectKind(value: unknown): value is SnapshotSubjectRef["kind"] {
  return value === "issuer" ||
    value === "instrument" ||
    value === "listing" ||
    value === "theme" ||
    value === "macro_topic" ||
    value === "portfolio" ||
    value === "screen";
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
