import { Pool } from "pg";

import {
  emptyEvidence,
  loadLocalRuntimeEvidence,
  loadVerifierFactsForRefs,
  loadVerifierRowsForRefs,
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
import { parseFinancialMode } from "../../financial-engine/src/request.ts";
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
import { loadTurnFactBlocks, mayOfferOtherFacts, priceListingsForTurn, scopeGapBlocks, turnCompanies } from "./fact-blocks.ts";
import { resolveResearchScope, type ResearchScope } from "./research-scope.ts";
import { frozenDataMode, hydrateYtdBars, marketHydrationOrigin } from "./ytd-hydration.ts";
import { listingTimeZones } from "./perf-block.ts";
import { loadPriorScope, loadPriorSubjects as loadThreadPriorSubjects, loadRecentConversation } from "./thread-context.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import {
  composeAnalystBlocksWithLlm,
  createLlmThreadTitleModel,
  type AnswerUsage,
} from "./llm-runtime.ts";
import {
  loadStructuredSubjectContext,
  NO_STRUCTURED_REFS,
  structuredEvidenceStatus,
  structuredRefsFromHandoff,
  subjectLabelsFromHandoff,
} from "./local-runtime-structured.ts";
import { createChatFinancialRuntime, type ChatFinancialRuntime } from "./financial-runtime.ts";
import { createChatMessagePersistence } from "./messages.ts";
import {
  preResolveChatSubjectWithResolver,
  type ChatResolvedSubjectPreResolution,
  type ChatSubjectPreResolution,
  type ChatSubjectPreResolveRequest,
} from "./subjects.ts";
import { createThreadTitleGenerationJob } from "./thread-title.ts";

let localPool: Pool | null = null;

// The default chat runtime resolves subjects in-process against the same pool,
// so the dev/default server grounds turns without a separately-configured
// CHAT_SUBJECT_RESOLVER_MODULE. Wired by loadChatServerOptionsFromEnv alongside
// the analyst runtime and persistence.
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
): Promise<LocalRuntimeEvidence> {
  try {
    return await loadLocalRuntimeEvidence(db, input);
  } catch (reason) {
    console.warn("[chat] evidence load failed; serving without research claims", reason);
    return emptyEvidence(input.subject_refs);
  }
}

export const analystToolRuntime: ChatAnalystToolRuntime = async (context) => {
  const resolved = context.subjectPreResolution?.status === "resolved"
    ? context.subjectPreResolution
    : null;
  // Every company the turn covers (primary first); see resolveTurnSubjects.
  const covered = context.subjectPreResolutions ?? (resolved ? [resolved] : []);
  // What the turn asks for, keeping a follow-up's unchanged scope (#206). A
  // window asked for now is cut off at the turn's asOf, which a follow-up keeps.
  const scopeAt = await turnScope(context.threadId, context.userIntent ?? "", covered);
  // A live YTD request fetches its prices first, so the cutoff below covers them (#232).
  await hydrateYtdWindow(scopeAt(new Date().toISOString()), covered);
  const asOf = new Date().toISOString();
  const scope = scopeAt(asOf);
  const subjectRefs = covered.length > 0
    ? covered.map((subject) => subject.subject_ref)
    : [{ kind: "screen" as const, id: context.threadId }];
  // Structured loaders key off the resolver's already-hydrated issuer/listings,
  // not the raw subject_ref — no SQL re-derivation of the subject graph.
  const structuredRefs = resolved ? structuredRefsFromHandoff(resolved.handoff) : NO_STRUCTURED_REFS;
  const registryRuntime = createRegistryBackedAnalystToolRuntime({
    executeTool: async ({ toolName, arguments: args }) => {
      // Research claims are only one evidence type. A subject often has a live
      // quote and issuer fundamentals but no extracted claims (every subject in
      // dev, and any freshly-covered name in prod); gating solely on claims made
      // the analyst answer "insufficient data" for those. Load the structured
      // context too so the analyst can ground an answer in price + fundamentals,
      // and only report insufficient_evidence when nothing at all exists.
      //
      // Both loaders are empty-on-failure (loadEvidenceOrEmpty wraps the claims
      // read; loadStructuredSubjectContext self-degrades its facts/quote reads),
      // so a DB hiccup or one malformed row keeps the surviving evidence instead
      // of failing the turn — and when nothing loads, the analyst gets a clean
      // insufficient_evidence signal rather than a 500.
      const [evidence, structured] = await Promise.all([
        loadEvidenceOrEmpty(pool(), {
          subject_refs: subjectRefs,
          user_id: context.userId ?? null,
        }),
        loadStructuredSubjectContext(pool(), structuredRefs, { now: asOf }),
      ]);
      return {
        kind: "local_evidence_tool_result",
        status: "ok",
        tool_name: toolName,
        arguments: args,
        evidence_status: structuredEvidenceStatus({
          claimCount: evidence.claim_refs.length,
          factCount: structured.facts.length,
          quote: structured.quote,
        }),
        manifest_contribution: {
          subject_refs: subjectRefs,
          claim_refs: evidence.claim_refs,
          document_refs: evidence.document_refs,
          source_ids: evidence.source_ids,
        },
        // Surfaced to the analyst LLM via summarizeToolCall(result) so it can
        // compose from price + fundamentals, not just research claims.
        structured_context: {
          quote: structured.quote,
          facts: structured.facts,
          source_ids: structured.source_ids,
          fact_recency: structured.fact_recency,
        },
        evidence,
      };
    },
  });
  const result = await registryRuntime(context);
  const toolCalls = result.tool_calls ?? [];
  const evidence = evidenceForToolCalls(toolCalls);
  await writeLocalToolCallLogs(context.threadId, toolCalls);
  const structured = structuredContextForToolCalls(toolCalls);
  const defaultRefs = combinedDefaultRefs(evidence, structured);
  const toolCallIds = toolCalls
    .filter((toolCall) => toolCall.status === "ok")
    .map((toolCall) => toolCall.tool_call_id);
  const requestedListings = requestedListingsOf(covered);
  // Charts and tables come from facts, never from the model (see fact-blocks.ts).
  // A turn asking only for metrics no reader serves reads no other facts, nor
  // does one re-reading a financial-engine answer, whose evidence is in it (#206).
  const readsFacts = scope.reads !== "unavailable_metric" && scope.reads !== "financial_answer";
  const [shownBlocks, conversation] = await Promise.all([
    readsFacts ? loadTurnFactBlocks(pool(), {
      // The companies the scope records, peers already resolved (comparedCompanies),
      // so the blocks chart exactly the set the scope saves.
      issuers: issuersOfScope(scope),
      wantsPeers: false,
      wantsSegments: scope.segments,
      wantsMarginTrend: scope.margin_trend,
      // A request for segments alone; one also asking for a margin (its latest
      // value or its trend) reads both.
      segmentsOnly: scope.reads === "segments" && !scope.margins,
      requestedListings,
      fiscalYear: scope.fiscal_year ?? undefined,
      priceWindow: scope.price_window?.kind,
      // An inherited window keeps the cutoff it was charted at.
      ...(scope.inherited.includes("price_window") ? { priceAsOf: scope.price_window!.cutoff } : {}),
      frozenPrices: frozenDataMode(process.env),
      snapshotId: result.snapshot_id,
      asOf,
    }) : Promise.resolve([]),
    loadRecentConversation(pool(), { threadId: context.threadId, limit: CONVERSATION_MESSAGES }),
  ]);
  const factBlocks = [...shownBlocks, ...scopeGapBlocks(scope, shownBlocks, { snapshotId: result.snapshot_id, asOf })];
  let narrativeRemoved: ReadonlyArray<string> = [];
  let answeredBy: string | undefined;
  let answerUsage: AnswerUsage | undefined;
  const llmBlocks = await composeAnalystBlocksWithLlm({
    context,
    blocks: result.blocks,
    toolCalls,
    factBlocks,
    subjectLabels: covered.flatMap((subject) => subjectLabelsFromHandoff(subject.handoff)),
    conversation,
    availableData: mayOfferOtherFacts(scope, shownBlocks),
    onAnswered: (deployment) => {
      answeredBy = deployment;
    },
    onUsage: (usage) => {
      answerUsage = usage;
    },
    onNarrativeRemoved: (sentences) => {
      narrativeRemoved = sentences;
    },
  });
  const normalize = (block: Record<string, unknown>, refs: typeof defaultRefs) =>
    normalizeAssistantBlock(block, {
      snapshotId: result.snapshot_id,
      asOf,
      subjectRefs,
      defaultRefs: refs,
      toolCallIds,
    });
  return {
    ...result,
    blocks: [
      ...llmBlocks.map((block) => normalize(block, defaultRefs)),
      // Fact blocks cite exactly their own facts and sources; the narrative's
      // default claim/document refs would demand sources they do not show.
      ...factBlocks.map((block) => normalize(block, NO_DEFAULT_REFS)),
    ],
    ...(narrativeRemoved.length > 0 ? { narrative_removed: narrativeRemoved } : {}),
    ...(answeredBy ? { answered_by: answeredBy } : {}),
    ...(answerUsage ? { answer_usage: answerUsage } : {}),
    research_scope: scope,
  } satisfies ChatAnalystToolRuntimeResult;
};

const CONVERSATION_MESSAGES = 6;

// The turn's research scope at a cutoff (research-scope.ts): what it asks for,
// keeping the previous answer's scope where it continues it. The companies are
// the ones the answer compares, auto-selected peers included, so the price
// fetch and a follow-up about a peer both see them.
async function turnScope(
  threadId: string,
  question: string,
  covered: ReadonlyArray<ChatResolvedSubjectPreResolution>,
  served = false,
): Promise<(cutoff: string) => ResearchScope> {
  const named = companiesOf(covered);
  const prior = await continuedScope(threadId, named);
  const resolve = (cutoff: string) => resolveResearchScope({ question, companies: named, prior, asOf: cutoff, served });
  const base = resolve(new Date().toISOString());
  // An evidence follow-up keeps the previous answer's companies as they were; a
  // financial answer covers exactly the companies its plan requested.
  const compared = base.route === "evidence_followup" || served ? base.companies : await comparedCompanies(named, base.peers);
  return (cutoff) => ({ ...resolve(cutoff), companies: compared });
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

const NO_DEFAULT_REFS = Object.freeze({
  source_refs: [],
  claim_refs: [],
  document_refs: [],
  provenance_fact_refs: [],
});

// Financial requests go through the verified engine. Off unless
// CHAT_FINANCIAL_MODE is "shadow" or "enforce"; without a configured LLM router,
// financial turns in enforce mode get a structured gap instead of a guess.
export const financialRuntime: ChatFinancialRuntime = createChatFinancialRuntime({
  mode: parseFinancialMode(process.env.CHAT_FINANCIAL_MODE, "CHAT_FINANCIAL_MODE"),
  pool: { query: (text, values) => pool().query(text, values), connect: () => pool().connect() },
  planningModel: async (request) => {
    const router = await createLlmRouterFromEnv(process.env);
    if (!router) throw new Error("LLM router is not configured");
    return planningModelFromRouter(router)(request);
  },
  resolveMention: (mention) => preResolveSubject({ text: mention }),
  evidence: createEvidenceFinancialPort,
  // A published financial answer saves its scope too, so a period it asks for
  // carries into the next follow-up (#206).
  researchScope: async (context) => {
    const covered = context.subjectPreResolutions ??
      (context.subjectPreResolution?.status === "resolved" ? [context.subjectPreResolution] : []);
    // The engine answered the metrics it published, so they are not gaps.
    return (await turnScope(context.threadId, context.userIntent ?? "", covered, true))(new Date().toISOString());
  },
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
  const asOf = maxBlockAsOf(blocks) ?? new Date().toISOString();
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

// The structured-context provenance carried in a tool result: the quote +
// fundamentals source_ids, and the fundamentals fact_ids. Mirrors
// evidenceForToolCalls — extracted so the sealed manifest can cite them
// (fra-eegq), instead of dropping them after the LLM composes its answer.
type StructuredContextRefs = {
  source_ids: ReadonlyArray<string>;
  facts: ReadonlyArray<{ fact_id: string }>;
};

function structuredContextForToolCalls(
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
): ReadonlyArray<StructuredContextRefs> {
  return Object.freeze(
    toolCalls.flatMap((toolCall) => {
      if (toolCall.status !== "ok" || !isJsonObject(toolCall.result)) return [];
      const ctx = toolCall.result.structured_context;
      if (!isJsonObject(ctx)) return [];
      const source_ids = Array.isArray(ctx.source_ids)
        ? ctx.source_ids.filter((id): id is string => typeof id === "string")
        : [];
      const facts = Array.isArray(ctx.facts)
        ? ctx.facts.flatMap((fact) =>
            isJsonObject(fact) && typeof fact.fact_id === "string" ? [{ fact_id: fact.fact_id }] : [],
          )
        : [];
      return [{ source_ids, facts }];
    }),
  );
}

function defaultEvidenceRefs(evidence: ReadonlyArray<LocalRuntimeEvidence>): {
  source_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
} {
  return {
    source_refs: firstSeen(evidence.flatMap((item) => item.source_ids)),
    claim_refs: firstSeen(evidence.flatMap((item) => item.claim_refs)),
    document_refs: firstSeen(evidence.flatMap((item) => item.document_refs)),
  };
}

// Block default-refs: research-claim evidence plus the structured context. The
// structured source_ids (fact + quote sources) union into source_refs (a passive
// citation). The fundamentals fact_ids become provenance_fact_refs — NOT block
// fact_refs: the verifier treats a block.fact_refs entry as a rendering binding
// (the block must bind that fact's value), but these facts only informed the
// prose. provenance_fact_refs is a non-extracted carrier that manifestFromBlockRefs
// promotes to manifest.fact_refs, where the verifier accepts them as manifest-only
// (metadata-checked, no per-block binding).
export function combinedDefaultRefs(
  evidence: ReadonlyArray<LocalRuntimeEvidence>,
  structured: ReadonlyArray<StructuredContextRefs>,
): {
  source_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  provenance_fact_refs: ReadonlyArray<string>;
} {
  const base = defaultEvidenceRefs(evidence);
  return {
    source_refs: firstSeen([...base.source_refs, ...structured.flatMap((s) => s.source_ids)]),
    claim_refs: base.claim_refs,
    document_refs: base.document_refs,
    provenance_fact_refs: firstSeen(structured.flatMap((s) => s.facts.map((f) => f.fact_id))),
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
    defaultRefs: {
      source_refs: ReadonlyArray<string>;
      claim_refs: ReadonlyArray<string>;
      document_refs: ReadonlyArray<string>;
      provenance_fact_refs: ReadonlyArray<string>;
    };
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

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
