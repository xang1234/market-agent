import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, IDS } from "../../financial-engine/test/db-fixtures.ts";
import { LlmClientError, LlmProviderError, LlmRouterError, type ControlledRouter, type LlmChatRequest, type LlmToolCall } from "../../llm/src/router.ts";
import { analystAgentRouter, analystAgentRunner, analystSectionRunner, certifiedAsk, priceAsk, statusNote, stepLabel, stopNotes, type AnalystAgentDeps } from "../src/analyst-agent.ts";
import type { AnalystToolResult } from "../src/analyst-tools.ts";
import { answerTurn } from "../src/answer-trace.ts";
import type { AssertionReport } from "../src/assertions.ts";
import { createChatCoordinator, resolveTurnSubjects, type ChatAssistantMessagePersistence, type ChatTurnInput } from "../src/coordinator.ts";
import { figureCompanies, mergePackets, type EvidencePacket, type PacketClaim, type PacketFigure } from "../src/evidence-packet.ts";
import { chatAuthority, chatGapText, createChatFinancialRuntime, requestedSubjects, type ChatFinancialRuntime } from "../src/financial-runtime.ts";
import { ANSWER_DEADLINES, composeAnalystBlocksWithLlm } from "../src/llm-runtime.ts";
import { proposedMetric, resolveResearchScope, type ResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import { ENGINE_READS_BY_CATALOG_METRIC, INCOME_LINE_READS } from "../src/scope-figures.ts";
import { loadPriorSubjects } from "../src/thread-context.ts";
import type { TurnHydrator } from "../src/turn-hydration.ts";
import { loadToolRegistry } from "../../tools/src/registry.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { chatDatabase, comparing, FY2023_REVENUE, GONE_LISTING, LISTING_A, NO_ASKS, readingOf, resolveMention, resolveNamedListing, revenueModel, SEC_ISSUER, SEC_ISSUER_B, SEC_ISSUER_E, seedListingA } from "./financial-fixtures.ts";

const LLM_ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1,o3",
  LITELLM_MODEL: "openai/gpt-4.1",
  AGENT_LITELLM_MODEL: "openai/o3",
};

test("the agent's router leads with the agent model, not the primary one or Analyze's", async () => {
  const models: string[] = [];
  const router = await analystAgentRouter({ ...LLM_ENV, ANALYZE_LITELLM_MODEL: "openai/gpt-4.1" }, {
    createClient: () => async (deployment) => {
      models.push(deployment.model);
      return { text: "DONE" };
    },
  });
  assert.ok(router);
  await router.complete({ messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(models, ["o3"]);
});

test("each step of the agent's router gets an attempt deadline of its own", async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const router = await analystAgentRouter(LLM_ENV, {
    createClient: () => async (_deployment, _request, options) => {
      signals.push(options?.signal);
      return { text: "DONE" };
    },
  });
  assert.ok(router);
  await router.complete({ messages: [] });
  await router.complete({ messages: [] });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal), "each attempt runs under a deadline");
  assert.notEqual(signals[0], signals[1], "a fresh deadline per step");
});

test("the agent's tools name companies as the agent takes them, by issuer", () => {
  type Ref = { properties: { kind: { enum: string[] } } };
  const kinds = (schema: unknown) => {
    const { subject_ref, subject_refs } = (schema as { properties: { subject_ref?: Ref; subject_refs?: { items: Ref } } }).properties;
    return [subject_ref, subject_refs?.items].flatMap((ref) => (ref ? [ref.properties.kind.enum] : []));
  };
  const agentTools = loadToolRegistry().tools.filter((tool) => tool.bundles.includes("analyst_agent"));
  assert.deepEqual(agentTools.map((tool) => [tool.name, kinds(tool.input_json_schema)]).sort(), [
    ["certified_financials", [["issuer"]]],
    ["get_analyst_consensus", [["issuer"]]],
    ["get_claims", [["issuer"], ["issuer"]]],
    ["get_company_profile", [["issuer"]]],
    ["get_findings", [["issuer"]]],
    ["get_non_gaap_history", [["issuer"]]],
    ["get_peer_set", [["issuer"]]],
    ["get_price_performance", [["issuer"]]],
  ]);
});

test("the registry's certified_financials metrics are the ones the engine plans with no model", () => {
  const tool = loadToolRegistry().getTool("certified_financials");
  const schema = tool?.input_json_schema as { properties: { metrics: { items: { enum: string[] } } } };
  assert.deepEqual(schema.properties.metrics.items.enum, [...Object.keys(ENGINE_READS_BY_CATALOG_METRIC), ...Object.keys(INCOME_LINE_READS)]);
});

const A = IDS.issuerA;
const B = IDS.issuerB;
const KNOWN = new Map([
  [A, { mention: "AAA", resolution: { status: "resolved" as const, subject_ref: { kind: "issuer" as const, id: A }, label: "AAA" } }],
  [B, { mention: "BBB", resolution: { status: "resolved" as const, subject_ref: { kind: "issuer" as const, id: B }, label: "BBB" } }],
]);

test("a certified ask is the same ask whatever order or case it names its companies in", () => {
  const ask = (refs: string[], extra: Record<string, unknown> = {}) => certifiedAsk({
    subject_refs: refs.map((id) => ({ kind: "issuer", id })),
    metrics: ["revenue"],
    question: "Revenue",
    ...extra,
  } as never, KNOWN);
  const one = ask([A, B]);
  const two = ask([B.toUpperCase(), A], { question: "Compare their revenue" });
  assert.ok("fingerprint" in one && "fingerprint" in two);
  assert.equal(one.fingerprint, two.fingerprint, "named metrics: the question does not change the ask");
  assert.deepEqual(one.choice, { kind: "kept_figures", metrics: ["revenue"], period: { kind: "latest", period: null } });
  const planned = certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "Revenue last year" } as never, KNOWN);
  const reworded = certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "R&D spending last year" } as never, KNOWN);
  assert.ok("fingerprint" in planned && "fingerprint" in reworded);
  assert.equal(planned.choice.kind, "planner");
  assert.notEqual(planned.fingerprint, reworded.fingerprint, "a planner ask is its question");
  assert.deepEqual(
    [
      certifiedAsk({ subject_refs: [{ kind: "issuer", id: randomUUID() }], question: "x" } as never, KNOWN),
      certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "x", metrics: ["ebitda"] } as never, KNOWN),
      certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "x", period: { kind: "fiscal_year" } } as never, KNOWN),
      certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: " " } as never, KNOWN),
    ].map((result) => "invalid" in result),
    [true, true, true, true],
  );
});

const filingClaim = (claim_id: string, text: string, issuer = A, predicate = "business.products") => ({
  claim_id, document_id: randomUUID(), source_id: randomUUID(), text_canonical: text, predicate, polarity: "neutral",
  effective_time: null, published_at: "2026-02-25T00:00:00.000Z", filer_issuer_id: issuer, filer_label: "Alpha Industries", accession: "0001-26-1", document_title: "10-K", link: null,
});
const readOf = (issuer: string, state: "read" | "unread" = "read") => ({
  filer_issuer_id: issuer, filer_label: "Alpha Industries", item: "1" as const, state, cut: null,
  filing: { document_id: randomUUID(), source_id: randomUUID(), title: "10-K", accession: "0001-26-1", published_at: "2026-02-25T00:00:00.000Z", link: null },
  newer_unread: null,
});
const engine = (company: string, values: string[]): EvidencePacket => ({
  route: "financial_engine", cutoff: "2026-11-01T00:00:00.000Z", companies: [company],
  figures: values.map((value, i) => ({ id: `F${i + 1}`, metric: "Revenue", period: `FY${2024 + i}`, value, result_id: randomUUID(), source_ids: [] })),
  coverage: [{ company, status: "shown" }], gaps: [], query_bounds: {}, claims: [], disagreements: [], claims_status: "none", claims_truncated: false, periods_shown: true,
});

test("the agent's packet numbers every certified figure and every claim in one pass, each stored claim once", () => {
  const shared = randomUUID();
  const route: EvidencePacket = {
    ...engine("AAA", []), route: "analyst", figures: [], coverage: [],
    claims: [{ id: "C1", text: "Demand stayed strong.", predicate: "management.tone", stance: "supporting", company: "AAA", claim_id: shared, source_id: randomUUID() } satisfies PacketClaim],
    claims_status: "available",
  };
  const profile: AnalystToolResult = {
    tool: "get_company_profile", status: "ok", truncated: true, reads: [readOf(A)], no_filing: [],
    claims: [filingClaim(shared, "Demand stayed strong."), filingClaim(randomUUID(), "We sell widgets.")],
  };
  const consensus: AnalystToolResult = {
    tool: "get_analyst_consensus", status: "ok", company: "AAA", captured_on: "2026-10-30",
    values: [{ capture_id: randomUUID(), source_id: randomUUID(), provider: "Finviz", field_key: "price_target", label: "price target", raw_value: "250", unit: "usd_per_share", fiscal_period: null }],
  };
  const peers: AnalystToolResult = {
    tool: "get_peer_set", status: "ok", company: "AAA", industry: "Widgets", industry_source_id: randomUUID(),
    peers: [{ issuer_id: B, label: "BBB", industry_source_id: randomUUID(), market_cap_source_id: null }],
  };
  const noFiling: AnalystToolResult = { tool: "get_claims", status: "no_filing", truncated: false, reads: [], no_filing: [{ issuer_id: B, label: "BBB" }] };
  const packet = mergePackets({
    engine: [engine("AAA", ["$1.0B", "$2.0B"]), engine("AAA", ["$3.0B"])],
    route,
    analyst: [profile, consensus, peers, noFiling],
    figuresAskedFor: ["AAA"],
    notes: ["AAA: no analyst consensus captured in the 7 days to the cutoff is on file."],
    labels: new Map([[A, "AAA"]]),
    cutoff: "2026-11-01T00:00:00.000Z",
  });
  assert.deepEqual(packet.figures.map((figure) => `${figure.id} ${figure.value}`), ["F1 $1.0B", "F2 $2.0B", "F3 $3.0B"]);
  assert.ok(packet.figures.every((figure) => figure.result_id), "each figure keeps the result it shows");
  assert.deepEqual(packet.claims.map((claim) => `${claim.id} ${claim.company} ${claim.text}`), [
    "C1 AAA Demand stayed strong.",
    "C2 AAA We sell widgets.",
    "C3 AAA attributed consensus: Finviz price target, captured 2026-10-30: 250 USD per share",
    "C4 AAA Industry peer: BBB shares AAA's industry (Widgets)",
  ]);
  assert.deepEqual(packet.claims.slice(2).map((claim) => claim.claim_id.split(":")[0]), ["consensus", "peer"], "no claim row stores these");
  assert.deepEqual(packet.gaps, ["AAA: no analyst consensus captured in the 7 days to the cutoff is on file.", "BBB has no 10-K on file, so no business or risk factor claims from one."]);
  assert.deepEqual([packet.route, packet.companies, packet.claims_truncated, packet.claims_status, packet.periods_shown], ["financial_engine", ["AAA"], true, "available", true]);
});

test("each certified call's figures keep their company in the agent's packet", () => {
  const packet = mergePackets({ engine: [engine("AAA", ["$1.0B"]), engine("BBB", ["$2.0B"])], analyst: [], figuresAskedFor: ["AAA", "BBB"], notes: [], labels: new Map(), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(packet.figures.map((figure) => [figure.id, ...figureCompanies(figure, packet)]), [["F1", "AAA"], ["F2", "BBB"]]);
});

test("a read that could not be made marks the packet's claims unavailable, and its note says nothing is known of them", () => {
  const unavailable: AnalystToolResult = { tool: "get_claims", status: "unavailable", reason: "the read failed" };
  const packet = mergePackets({ engine: [], analyst: [unavailable], figuresAskedFor: [], notes: [], labels: new Map(), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual([packet.route, packet.claims_status], ["analyst_agent", "unavailable"]);
  assert.equal(statusNote(unavailable, "AAA"), "AAA: the stored sources could not be read just now, so this says nothing about what is on file.");
});

test("an item a read left unread is a gap of the packet, whatever the read's status", () => {
  const incomplete: AnalystToolResult = { tool: "get_claims", status: "incomplete_read", truncated: false, reads: [readOf(A, "unread")], no_filing: [] };
  const packet = mergePackets({ engine: [], analyst: [incomplete], figuresAskedFor: [], notes: [], labels: new Map([[A, "AAA"]]), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.equal(packet.gaps.length, 1);
  assert.match(packet.gaps[0]!, /^AAA.*was not read.*\.$/);
});

test("every read that found nothing leaves a typed note, and a read the model asked wrongly leaves none", () => {
  const reads = { truncated: false, reads: [readOf(A)], no_filing: [] };
  const notes = ([
    { tool: "get_company_profile", status: "no_business_claims", ...reads },
    { tool: "get_claims", status: "no_claims", ...reads },
    { tool: "get_peer_set", status: "no_peers", reason: "no_industry" },
    { tool: "get_analyst_consensus", status: "no_consensus" },
    { tool: "get_claims", status: "incomplete_read", ...reads, truncated: true },
    { tool: "get_claims", status: "invalid_arguments", reason: "role is subject or competitor" },
    { tool: "get_claims", status: "no_subject", reason: "a subject_ref names no stored issuer" },
    { tool: "get_claims", status: "no_filing", truncated: false, reads: [], no_filing: [{ issuer_id: A, label: "AAA" }] },
  ] as AnalystToolResult[]).map((result) => statusNote(result, "AAA"));
  const noneNaming = statusNote({ tool: "get_claims", status: "no_claims", ...reads }, "AAA", true);
  assert.deepEqual(notes, [
    "AAA: its latest 10-K's business section (Item 1) was read in full and states no business claims.",
    "AAA: the 10-K items read in full state no claims of the kind asked for.",
    "AAA: no industry peers are on file (no source gives its industry).",
    "AAA: no analyst consensus captured in the 7 days to the cutoff is on file.",
    "AAA: a read limit left some 10-K filers or claims out.",
    null,
    null,
    null,
  ]);
  assert.equal(noneNaming, "AAA: no other company's 10-K on file names it as a competitor.");
});

function completed(events: ReadonlyArray<{ type: string } & Record<string, unknown>>) {
  const last = events.at(-1)!;
  assert.equal(last.type, "turn.completed", JSON.stringify(last));
  return last;
}

type Step = { text?: string; toolCalls?: LlmToolCall[] };

function scripted(steps: Step[]): ControlledRouter & { sent: LlmChatRequest[] } {
  const sent: LlmChatRequest[] = [];
  return {
    sent,
    complete: async (request) => {
      sent.push(request);
      const step = steps[sent.length - 1];
      if (!step) throw new Error(`no step ${sent.length} in the script`);
      return { text: step.text ?? "", ...(step.toolCalls ? { toolCalls: step.toolCalls } : {}), deployment: { channel: "openai", model: "o3" } };
    },
  };
}

const call = (name: string, args: Record<string, unknown>): LlmToolCall => ({ id: `call-${randomUUID()}`, name, arguments: args as never });
const INCOME_2023 = { subject_refs: [{ kind: "issuer", id: A }], metrics: ["income_statement"], period: { kind: "fiscal_year", fiscal_year: 2023 }, question: "AAA's income statement for fiscal 2023" };
const REVENUE = { subject_refs: [{ kind: "issuer", id: A }], question: "AAA revenue in fiscal 2023" };
const OBSERVE_F1 = '```assertions\n[{"kind":"observation","text":"Revenue was $383.0B.","evidence":["F1"]}]\n```';
const noRead: AnalystAgentDeps["read"] = async () => assert.fail("no stored read in this turn");
// As a real router fails a call its client's guard refuses: a terminal client failure.
const guarded = (beforeModelCall: () => void) => {
  try {
    beforeModelCall();
  } catch (error) {
    throw new LlmRouterError("client_failed", (error as Error).message, []);
  }
};
const metered = (router: ControlledRouter, beforeModelCall: () => void): ControlledRouter => ({
  complete: async (request, controls) => {
    guarded(beforeModelCall);
    return router.complete(request, controls);
  },
});
const meteredPlanner = (model: PlanningModel, beforeModelCall: () => void): PlanningModel => async (request) => {
  guarded(beforeModelCall);
  return model(request);
};

test("a statement ask is keyed by its own words, never by the turn's reading, which only decides whether the planner reads it", () => {
  const ask = (question: string, lines: string[]) => certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], metrics: ["income_statement"], question } as never, KNOWN, lines);
  const [revenue, margin, unread] = [ask("AAA revenue", ["revenue", "gross_margin"]), ask("AAA gross margin", ["revenue", "gross_margin"]), ask("AAA revenue", [])];
  assert.ok("fingerprint" in revenue && "fingerprint" in margin && "fingerprint" in unread);
  assert.deepEqual([revenue.choice.kind, unread.choice.kind], ["planner", "kept_figures"]);
  assert.notEqual(revenue.fingerprint, margin.fingerprint, "two asks for different lines are two asks");
  assert.equal(revenue.fingerprint, unread.fingerprint, "an ask is the same ask whatever the reading names");
  const twice = certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], metrics: ["income_statement", "income_statement"], question: "AAA revenue" } as never, KNOWN, ["revenue"]);
  assert.ok("fingerprint" in twice);
  assert.equal(twice.fingerprint, revenue.fingerprint, "a metric named twice is named once");
});

test("a turn's companies by its reading keep each company a fresh question writes, and only the reading's on a follow-up", async () => {
  const aaa = await resolveMention("AAA") as Extract<Awaited<ReturnType<typeof resolveMention>>, { status: "resolved" }>;
  const companies = async (userIntent: string, change: ScopeProposal["companies"], prior: typeof aaa[]) => (await resolveTurnSubjects(
    { threadId: randomUUID(), runId: randomUUID(), userIntent, emit: () => {}, reading: async () => ({ ...NO_ASKS, companies: change }) } as never,
    async (request) => (request.text === "Beta Holdings" ? { ...(await resolveMention("BBB")), input_text: request.text } : resolveMention(request.text)),
    async () => prior,
    true,
  )).subjects.map((subject) => subject.subject_ref.id);
  assert.deepEqual(await companies("Compare AAA and BBB revenue", { kind: "as_named", names: ["AAA"] }, []), [A, B], "a written ticker the reading left out");
  assert.deepEqual(await companies("How does AAA's revenue compare with BBB's?", { kind: "compare", add: ["BBB"] }, []), [A, B], "the companies in the order the question writes them");
  assert.deepEqual(await companies("Compare Beta Holdings and AAA revenue", { kind: "as_named", names: ["Beta Holdings", "AAA"] }, []), [B, A], "a company written by name keeps its place before a ticker");
  assert.deepEqual(await companies("AAA/BBB revenue", { kind: "as_named", names: ["BBB"] }, []), [A, B], "tickers joined by a slash are each written");
  assert.deepEqual(await companies("Switch from AAA to BBB", { kind: "only", names: ["BBB"] }, [aaa]), [B], "a company switched away from");
  assert.deepEqual(await companies("Compare BBB with AAA", { kind: "compare", add: ["BBB"] }, [aaa]), [A, B], "the earlier company stays first");
});

test("a turn's companies match a message's own words as written, and a reading's names by the names companies go by (#668)", async () => {
  const subjectRef = { kind: "issuer" as const, id: randomUUID() };
  const hello = {
    status: "resolved" as const, input_text: "hello", normalized_input: "hello", subject_ref: subjectRef, identity_level: "issuer" as const,
    display_label: "Hello Group Inc ADR", resolution_path: "auto_advanced" as const, confidence: 0.8,
    handoff: { subject_ref: subjectRef, identity_level: "issuer" as const, display_label: "Hello Group Inc ADR", display_labels: { primary: "Hello Group Inc ADR" }, normalized_input: "hello", resolution_path: "auto_advanced" as const, confidence: 0.8, context: {} },
  };
  const deps = {
    pool: {} as never,
    resolveMention: async (mention: string, exactOnly?: true) =>
      mention.toLowerCase() === "hello" && !exactOnly ? hello : { status: "not_found" as const, input_text: mention, normalized_input: mention, message: `no ${mention}` },
  };
  const mentions = async (userIntent: string, reading: ScopeProposal | null) => (await requestedSubjects(
    deps,
    { threadId: randomUUID(), runId: randomUUID(), userIntent, emit: () => {}, reading: async () => reading } as never,
    userIntent,
    true,
  )).subjects.map((subject) => subject.mention);
  for (const message of ["hello", "HELLO"]) assert.deepEqual(await mentions(message, null), [], message);
  assert.deepEqual(await mentions("and Hello?", { ...NO_ASKS, companies: { kind: "as_named", names: ["Hello"] } }), ["Hello Group Inc ADR"], "a name the reading gives");
});

test("a planner ask says its period, and two that differ only by their year are two asks", () => {
  const ask = (fiscal_year: number) => certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "AAA revenue", period: { kind: "fiscal_year", fiscal_year } } as never, KNOWN);
  const [y2024, y2025] = [ask(2024), ask(2025)];
  assert.ok("fingerprint" in y2024 && "fingerprint" in y2025);
  assert.notEqual(y2024.fingerprint, y2025.fingerprint);
  assert.deepEqual([y2024.question, y2025.question], ["AAA revenue (for fiscal year 2024)", "AAA revenue (for fiscal year 2025)"]);
  const latest = certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "AAA revenue" } as never, KNOWN);
  assert.ok("question" in latest);
  assert.equal(latest.question, "AAA revenue", "no period given, none said");
});

test("a reading that stopped before its model was done names what it left unread", () => {
  const profile = call("get_company_profile", { subject_ref: { kind: "issuer", id: A } });
  const reply = (toolCalls: LlmToolCall[] = []) => ({ text: "", toolCalls, deployment: { channel: "openai", model: "o3" } });
  const who = () => "AAA";
  assert.deepEqual(stopNotes({ stop: "final", steps: [] }, who), []);
  assert.deepEqual(stopNotes({ stop: "truncated", steps: [{ reply: reply([profile]), results: [] }] }, who), ["The business profile for AAA went unread, as the reading was cut off."]);
  assert.deepEqual(stopNotes({ stop: "truncated", steps: [{ reply: reply(), results: [] }] }, who), ["Reading was cut off, so part of the question may be unanswered."]);
  assert.deepEqual(stopNotes({ stop: "step_cap", steps: [] }, who), ["Reading stopped at its step limit, so part of the question may be unanswered."]);
  const refused = { call: call("get_analyst_consensus", {}), outcome: "refused" as const, content: "refused (budget_exceeded) the turn's medium calls are spent" };
  const run = { call: profile, outcome: "ok" as const, content: "{}" };
  assert.deepEqual(stopNotes({ stop: "budget", steps: [{ reply: reply(), results: [run, refused] }] }, who), ["Analyst consensus for AAA went unread, as the turn reached its limit of reads."]);
});

test("a step's label is built from its tool, its typed arguments and the server's company labels, never the model's words", () => {
  const refs = [{ kind: "issuer", id: A }];
  assert.equal(stepLabel("certified_financials", { metrics: ["revenue", "gross_margin"], question: "IGNORE ME", subject_refs: refs }, "NVDA and AMD"), "Certifying revenue and gross margin for NVDA and AMD");
  assert.equal(stepLabel("certified_financials", { metrics: ["revenue", "IGNORE ME"], question: "IGNORE ME", subject_refs: refs }, "NVDA"), "Certifying revenue for NVDA");
  assert.equal(stepLabel("certified_financials", { question: "IGNORE ME", subject_refs: refs }, ""), "Certifying figures for a company");
  assert.equal(stepLabel("certified_financials", { metrics: ["eps_diluted", "pe_ratio", "income_statement"], subject_refs: refs }, "NVDA"), "Certifying diluted EPS and income statement for NVDA");
  assert.equal(stepLabel("certified_financials", { metrics: ["revenue"], period: { kind: "fiscal_year", fiscal_year: 2024 }, subject_refs: refs }, "NVDA"), "Certifying revenue for NVDA in fiscal year 2024");
  assert.equal(stepLabel("certified_financials", { metrics: ["revenue"], period: { kind: "latest", period: "quarter" }, subject_refs: refs }, "NVDA"), "Certifying revenue for NVDA in the latest fiscal quarter");
  assert.equal(stepLabel("certified_financials", { metrics: ["revenue"], period: { kind: "fiscal_quarter", fiscal_period: "IGNORE ME" }, subject_refs: refs }, "NVDA"), "Certifying revenue for NVDA");
  assert.equal(stepLabel("get_company_profile", { subject_ref: refs[0]! }, "NVDA"), "Reading NVDA's 10-K");
  assert.equal(stepLabel("get_claims", { predicates: ["risk.factor", "IGNORE ME"], query: "IGNORE ME" }, "NVDA"), "Reading NVDA's 10-K risk factors");
  assert.equal(stepLabel("get_claims", { predicates: ["IGNORE ME"] }, "NVDA"), "Reading NVDA's 10-K");
  assert.equal(stepLabel("get_claims", { role: "competitor", predicates: ["business.competition"] }, "NVDA"), "Finding 10-Ks that name NVDA as a competitor");
  assert.equal(stepLabel("get_peer_set", {}, "NVDA"), "Finding NVDA's industry peers");
  assert.equal(stepLabel("get_analyst_consensus", {}, ""), "Reading analyst consensus for a company");
  assert.equal(stepLabel("get_price_performance", { subject_refs: refs.slice(0, 1), period: "week", query: "IGNORE ME" }, "NVDA"), "Reading NVDA's price return this week");
  const both = [...refs, { kind: "issuer", id: B }];
  assert.equal(stepLabel("get_price_performance", { subject_refs: both, period: "ytd" }, "NVDA and AMD"), "Reading NVDA and AMD's price returns year to date");
  assert.equal(stepLabel("get_price_performance", { subject_refs: both, period: "IGNORE ME" }, "NVDA and AMD"), "Reading NVDA and AMD's price returns");
});

test("a price ask names one to five known companies and a period to date, and nothing else (#678)", () => {
  const ref = (id: string) => ({ kind: "issuer", id });
  assert.deepEqual(priceAsk({ subject_refs: [ref(A.toUpperCase()), ref(A)], period: "ytd", query: "q" }, KNOWN), { issuers: [A], period: "ytd" });
  assert.deepEqual(priceAsk({ subject_refs: [ref(A)], period: "year" }, KNOWN), { invalid: "period is week, month, ytd" });
  assert.deepEqual(priceAsk({ subject_refs: [], period: "week" }, KNOWN), { invalid: "subject_refs names one to 5 companies, as the prompt lists them" });
  assert.deepEqual(priceAsk({ subject_refs: [ref(randomUUID())], period: "week" }, KNOWN), { invalid: "name each company by a subject_ref the prompt or a peer read gave" });
  assert.deepEqual(priceAsk({ subject_refs: [ref(A)], period: "week", range: "1y" }, KNOWN), { invalid: "range not supported" });
});

test("an Analyze section is neither offered the price tool nor told of it (#678)", async () => {
  const router = scripted([{ text: "DONE" }]);
  const runId = randomUUID();
  const section = analystSectionRunner({
    financial: { pool: {} as never, evidence: createEvidenceFinancialPort },
    router: async () => router,
    read: noRead,
    compose: async () => assert.fail("nothing was read"),
  });
  await section({ subject: { issuer_id: A, label: "AAA" }, goal: "How has AAA's share price done this year?", sectionId: "prices", userId: IDS.owner, runId, authority: chatAuthority(IDS.owner, runId, runId), snapshotId: randomUUID(), asOf: "2026-11-17T05:51:00.000Z" });
  const [request] = router.sent;
  assert.ok(!request!.tools!.some((tool) => tool.name === "get_price_performance"));
  assert.ok(!JSON.stringify(request!.messages).includes("get_price_performance"));
});

test("only a company a certified call asked figures of can be said to have none", () => {
  const profile: AnalystToolResult = { tool: "get_company_profile", status: "ok", truncated: false, reads: [readOf(A)], no_filing: [], claims: [filingClaim(randomUUID(), "We sell widgets.")] };
  const claimsOnly = mergePackets({ engine: [], analyst: [profile], figuresAskedFor: [], notes: [], labels: new Map([[A, "AAA"]]), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(claimsOnly.coverage, []);
  const mixed = mergePackets({ engine: [engine("AAA", ["$1.0B"])], analyst: [profile], figuresAskedFor: ["AAA", "BBB"], notes: [], labels: new Map([[A, "AAA"]]), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(mixed.coverage, [{ company: "AAA", status: "shown" }, { company: "BBB", status: "not_shown" }]);
});

test("a step that starts after the first step's whole deadline has passed still gets a full attempt", async (t) => {
  const real = performance.now.bind(performance);
  let offset = 0;
  t.mock.method(performance, "now", () => real() + offset);
  const signals: AbortSignal[] = [];
  const router = await analystAgentRouter(LLM_ENV, {
    createClient: () => async (_deployment, _request, options) => {
      signals.push(options!.signal!);
      return { text: "DONE" };
    },
  });
  await router!.complete({ messages: [] });
  offset += ANSWER_DEADLINES.totalMs + 1_000;
  await router!.complete({ messages: [] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(signals[1]!.aborted, false, "the second step's attempt was cut to the first step's window");
});

test("an answer given a shape is asked for in the shape's words, and an inference it lists is not shown", async () => {
  const sent: string[] = [];
  let report: AssertionReport | undefined;
  const id = randomUUID();
  const blocks = await composeAnalystBlocksWithLlm({
    env: LLM_ENV,
    context: { userIntent: "What does AAA sell?", bundleId: "analyst_agent" },
    blocks: [{ id, kind: "rich_text", snapshot_id: randomUUID(), data_ref: { kind: "rich_text", id }, source_refs: [], as_of: "2026-11-01T00:00:00.000Z", analyst_commentary: true, segments: [] }],
    toolCalls: [],
    packet: { ...engine("AAA", ["$1.0B"]), route: "analyst" },
    answerShape: ["List only what the sources say."],
    inferences: false,
    createClient: () => async (_deployment, request) => {
      sent.push(String(request.messages[0]!.content));
      return { text: '```assertions\n[{"kind":"observation","text":"Revenue was $1.0B.","evidence":["F1"]},{"kind":"analyst_inference","text":"It is a strong franchise.","supports":[0]}]\n```' };
    },
    onAssertions: (checked) => {
      report = checked;
    },
  });
  assert.ok(sent[0]!.includes("List only what the sources say.") && !sent[0]!.includes("Answer as a buy-side analyst would"), "the shape replaces the analyst's");
  assert.deepEqual(report?.rejected.map((entry) => [entry.index, entry.check]), [[1, "limit"]]);
  assert.ok(!JSON.stringify(blocks(new Map())).includes("strong franchise"));
});

test("the agent's production wiring meters its reading, router, planner and answer, one attempt each", async () => {
  const { meteredAgentDeps } = await import("../src/local-runtime.ts");
  let attempts = 0;
  const base = () => async () => {
    attempts += 1;
    return { text: '```assertions\n[{"kind":"observation","text":"Revenue was $1.0B.","evidence":["F1"]}]\n```' };
  };
  const deps = meteredAgentDeps({ ...LLM_ENV, CHAT_SCOPE_PROPOSAL: "on" }, base);
  const id = randomUUID();
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["reading", async () => deps.readQuestion("AAA revenue", meter)],
    ["router", async () => (await deps.router(meter))!.complete({ messages: [] })],
    ["planner", async () => deps.planner(meter)({ messages: [{ role: "user", content: "AAA revenue" }] })],
    ["answer", async () => deps.compose({
      context: { userIntent: "AAA revenue", bundleId: "analyst_agent" },
      blocks: [{ id, kind: "rich_text", snapshot_id: randomUUID(), data_ref: { kind: "rich_text", id }, source_refs: [], as_of: "2026-11-01T00:00:00.000Z", analyst_commentary: true, segments: [] }],
      toolCalls: [],
      packet: engine("AAA", ["$1.0B"]),
    }, { thread_id: randomUUID(), run_id: randomUUID(), question: "AAA revenue" }, () => {}, meter)],
  ];
  let metered = 0;
  let refuse = false;
  function meter() {
    if (refuse) throw new LlmClientError("spent");
    metered += 1;
  }
  for (const [name, made] of calls) {
    await made().catch(() => undefined);
    assert.deepEqual([metered, attempts], [1, 1], `${name}: one metered attempt`);
    refuse = true;
    await made().catch(() => undefined);
    assert.equal(attempts, 1, `${name}: a refused attempt reaches no deployment`);
    [metered, attempts, refuse] = [0, 0, false];
  }
});

test("the analyst agent", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker is not available");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-agent");
  const persist = await savingMessages(t, databaseUrl(db));
  const base = { threadId, userId: IDS.owner };

  type AgentOptions = {
    planningModel?: PlanningModel | null;
    read?: AnalystAgentDeps["read"];
    logged?: boolean;
    hydrate?: AnalystAgentDeps["financial"]["hydrate"];
    evidence?: AnalystAgentDeps["financial"]["evidence"];
    researchScope?: AnalystAgentDeps["financial"]["researchScope"];
    resolveMention?: AnalystAgentDeps["financial"]["resolveMention"];
  };
  const agentOf = (router: ControlledRouter, answer: string, options: AgentOptions = {}) => analystAgentRunner({
    financial: {
      pool,
      evidence: options.evidence ?? createEvidenceFinancialPort,
      resolveMention: options.resolveMention ?? resolveMention,
      ...(options.hydrate ? { hydrate: options.hydrate } : {}),
      ...(options.researchScope ? { researchScope: options.researchScope } : {}),
    },
    router: async (beforeModelCall) => metered(router, beforeModelCall),
    ...(options.planningModel ? { planner: (beforeModelCall: () => void) => meteredPlanner(options.planningModel!, beforeModelCall) } : {}),
    read: options.read ?? noRead,
    compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: answer }), onAnswered }),
    asOf: () => new Date().toISOString(),
    ...(options.logged === false ? {} : { logToolCalls: persist.logToolCalls }),
  });
  const run = async (agent: ReturnType<typeof agentOf>, input: Omit<ChatTurnInput, "runId"> & { turnId: string; runId?: string }, during?: (stop: () => void, events: () => ReadonlyArray<Record<string, unknown>>) => void, readQuestion?: ReturnType<typeof readingOf>, financialRuntime?: ChatFinancialRuntime) => {
    const coordinator = createChatCoordinator({ analystAgent: agent, persistAssistantMessage: persist, runner: () => assert.fail("the agent takes the turn"), ...(readQuestion ? { readQuestion } : {}), ...(financialRuntime ? { financialRuntime } : {}) });
    const runId = input.runId ?? input.turnId;
    const handle = coordinator.getOrCreateTurn({ ...input, runId });
    during?.(() => coordinator.stopTurn({ userId: input.userId, threadId: input.threadId, runId, turnId: input.turnId }), () => [...handle.events]);
    await handle.completed;
    return handle.events;
  };
  const savedText = (done: Record<string, unknown>) => JSON.stringify((done.message as { blocks: unknown }).blocks);
  const keysOf = async (turnId: string) => (await db.query(`select request_key from financial_runs where request_key like $1 order by request_key`, [`turn:${turnId}:%`])).rows.map((row) => row.request_key);
  const profileOf = (...texts: string[]): AnalystAgentDeps["read"] => async (name) => ({
    tool: name, status: "ok", truncated: false, reads: [readOf(A)], no_filing: [], claims: texts.map((text) => filingClaim(randomUUID(), text)),
  }) as AnalystToolResult;
  const PROFILE = { subject_ref: { kind: "issuer", id: A } };

  await t.test("two certified calls give two certified blocks under their own keys, and the card cites their F ids", async () => {
    const turnId = randomUUID();
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023), call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const events = await run(agentOf(router, OBSERVE_F1, { planningModel: revenueModel(["AAA"]) }), { ...base, turnId, userIntent: "AAA revenue and income statement" });
    const done = completed(events);
    assert.equal(done.bundle_id, "analyst_agent");
    assert.equal((await keysOf(turnId)).length, 2);
    const blocks = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
    assert.deepEqual(blocks.map((block) => block.kind), ["financial_answer", "financial_answer", "rich_text"]);
    const card = blocks[2]!;
    assert.equal(card.analyst_commentary, true);
    const result = (card.segments as Array<Record<string, unknown>>).find((segment) => segment.type === "ref");
    assert.equal(result?.ref_kind, "result");
    const firstBlock = blocks[0] as { financial: { results: Array<{ result_id: string }> } };
    assert.ok(firstBlock.financial.results.some((entry) => entry.result_id === result?.ref_id), "the card's figure is the first block's result");
    const proofs = (done.message as { block_proofs: Record<string, { calculation: string }> }).block_proofs;
    assert.deepEqual(blocks.slice(0, 2).map((block) => proofs[block.id as string]?.calculation), ["verified", "verified"]);
    assert.ok(router.sent[0]!.tools!.map((tool) => tool.name).includes("certified_financials"));
  });

  await t.test("the answer's trace lists the tools the agent called", async () => {
    const traced: string[] = [];
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("certified_financials", INCOME_2023), call("get_company_profile", { subject_ref: { kind: "issuer", id: A } })] }, { text: "DONE" }]),
      read: async (name) => ({ tool: name, status: "no_business_claims", truncated: false, reads: [readOf(A)], no_filing: [] }) as AnalystToolResult,
      compose: (input, turn, onAnswered) => {
        traced.push(...input.toolCalls.map((entry) => entry.tool_name));
        return answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered });
      },
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA revenue, and what it sells" }));
    assert.deepEqual(traced.sort(), ["certified_financials", "get_company_profile"]);
  });

  await t.test("an answer the judge reads is saved as its verdicts leave it, with nothing revealed after its seal", async () => {
    const judged = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]),
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: () => async (_deployment, request) => {
          const transcript = request.messages.map((message) => message.content).join("\n");
          if (transcript.startsWith("You check the analyst inferences")) return { text: '{"verdicts":[{"id":1,"verdict":"entailed","worded_amount":false}]}' };
          return { text: '```assertions\n[{"kind":"observation","text":"Revenue was $383.0B.","evidence":["F1"]},{"kind":"analyst_inference","text":"Its revenue base gives it scale.","supports":[0]}]\n```' };
        },
        onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const events = await run(judged, { ...base, turnId: randomUUID(), userIntent: "AAA revenue" });
    const done = completed(events);
    const card = (done.message as { blocks: Array<Record<string, unknown>> }).blocks.find((block) => block.analyst_commentary === true);
    assert.deepEqual((card?.commentary as Array<{ kind: string }>).map((part) => part.kind), ["figures", "inference"]);
    assert.deepEqual(events.filter((event) => event.type === "tool.completed").map((event) => [event.tool_name, event.label, event.status]), [
      ["certified_financials", "Certifying income statement for AAA in fiscal year 2023", "ok"],
      ["write_answer", "Writing the answer", "ok"],
      ["judge_answer", "Checking the answer's inferences", "ok"],
    ]);
  });

  await t.test("the turn's steps stream as they run, each under a server-built label, and none is replayed after", async () => {
    const turnId = randomUUID();
    let open = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    let reached = () => {};
    const reading = new Promise<void>((resolve) => { reached = resolve; });
    const read: AnalystAgentDeps["read"] = async (name) => {
      reached();
      await gate;
      return { tool: name, status: "no_peers", reason: "no_industry" } as AnalystToolResult;
    };
    const hydrate: AnalystAgentDeps["financial"]["hydrate"] = async (companies, turn) => {
      const step = { tool_call_id: `fetch_filings-${turn.turnId}`, tool_name: "fetch_filings", label: `Fetching filings for ${companies.map((company) => company.label).join()}` };
      turn.emit("tool.started", step);
      turn.emit("tool.completed", { ...step, status: "ok" });
      return new Set();
    };
    let live: ReadonlyArray<Record<string, unknown>> = [];
    const router = scripted([{ toolCalls: [call("certified_financials", REVENUE), call("get_peer_set", { subject_ref: { kind: "issuer", id: A } })] }, { text: "DONE" }]);
    const events = await run(agentOf(router, OBSERVE_F1, { planningModel: revenueModel(["AAA"]), read, hydrate }), { ...base, turnId, userIntent: "AAA revenue, and its peers" }, (_stop, sofar) => {
      void reading.then(() => {
        live = sofar();
        open();
      });
    });
    completed(events);
    assert.deepEqual(live.filter((event) => event.type === "turn.started").map((event) => event.bundle_id), ["analyst_agent"]);
    assert.equal(live.find((event) => event.type === "tool.started" && event.tool_name === "get_peer_set")?.label, "Finding AAA's industry peers");

    assert.equal(events.filter((event) => event.type === "turn.started").length, 1);
    const steps = (type: string) => events.filter((event) => event.type === type).map((event) => [event.tool_call_id, event.tool_name, event.label]);
    assert.deepEqual(steps("tool.completed").sort(), steps("tool.started").sort());
    assert.deepEqual(steps("tool.started").map(([, name, label]) => [name, label]).sort(), [
      ["certified_financials", "Certifying figures for AAA"],
      ["fetch_filings", "Fetching filings for AAA"],
      ["get_peer_set", "Finding AAA's industry peers"],
      ["write_answer", "Writing the answer"],
    ]);
    assert.equal(steps("tool.started").find(([, name]) => name === "fetch_filings")?.[0], `fetch_filings-${turnId}:${A}`);
    assert.deepEqual(events.filter((event) => event.type.startsWith("tool.") && "arguments" in event), []);
    assert.deepEqual(events.flatMap((event) => (event.tool_name === "write_answer" ? [`${event.type} write_answer`] : event.type === "snapshot.sealed" ? [event.type] : [])), [
      "tool.started write_answer",
      "tool.completed write_answer",
      "snapshot.sealed",
    ]);
  });

  await t.test("each certified call plans its own ask, with no pick the turn's clarification offered", async () => {
    const turnId = randomUUID();
    const asked: string[] = [];
    const planner = (async (request: Parameters<PlanningModel>[0]) => {
      asked.push(request.messages.map((message) => message.content).join("\n"));
      return revenueModel(["AAA"])(request);
    }) as PlanningModel;
    const router = scripted([{ toolCalls: [call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    completed(await run(agentOf(router, OBSERVE_F1, { planningModel: planner }), {
      ...base, turnId, userIntent: "Tell me everything about AAA", clarificationAnswer: { clarification_id: "c", choice_id: "x" },
    }));
    assert.equal(asked.length, 1);
    assert.ok(asked[0]!.includes("AAA revenue in fiscal 2023"), "the call's own ask");
    assert.ok(!asked[0]!.includes("Tell me everything"), "not the turn's question");
  });

  await t.test("a company's filings are fetched once a turn, before its first certified call, and one still loading is named", async () => {
    const fetchedFor: string[] = [];
    const hydrate: AnalystAgentDeps["financial"]["hydrate"] = async (companies) => {
      fetchedFor.push(...companies.map((company) => company.issuer_id));
      return new Set([A]);
    };
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { toolCalls: [call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, OBSERVE_F1, { planningModel: revenueModel(["AAA"]), hydrate }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    assert.deepEqual(fetchedFor, [A]);
    assert.ok(JSON.stringify((done.message as { blocks: unknown }).blocks).includes("Filings for AAA are still loading; ask again in a minute."));
  });

  await t.test("a company named by one of its listings has that listing fetched with its filings (#678)", async () => {
    await seedListingA(db);
    const fetchedFor: Array<string | undefined> = [];
    const hydrate: TurnHydrator = async (companies) => {
      fetchedFor.push(...companies.map((company) => company.listing_id));
      return new Set();
    };
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    completed(await run(agentOf(router, OBSERVE_F1, { planningModel: revenueModel(["ALPX"]), hydrate, resolveMention: resolveNamedListing }), { ...base, turnId: randomUUID(), userIntent: "ALPX revenue" }));
    assert.deepEqual(fetchedFor, [LISTING_A]);
  });

  await t.test("a free-text final reply is rejected, and the turn answers with its certified blocks alone", async () => {
    const turnId = randomUUID();
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, "AAA's revenue was about $383 billion, roughly double BBB's."), { ...base, turnId, userIntent: "AAA revenue" }));
    const blocks = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
    assert.deepEqual(blocks.map((block) => [block.kind, block.analyst_commentary ?? null]), [["financial_answer", null], ["rich_text", null]]);
    assert.deepEqual((blocks[1]!.segments as Array<{ text: string }>).map((segment) => segment.text), ["Commentary is unavailable for this answer."]);
    assert.ok(!JSON.stringify(blocks).includes("roughly double"));
  });

  // OPM tags its capex as PP&E, as AAPL does, and PAX as productive assets, as NVIDIA does. SWX switched from
  // productive assets to PP&E with its FY2020 10-K, as CAT did.
  await t.test("free cash flow over productive-assets capex is never ranked against PP&E's, nor capex trended across a change of tag (#731)", async () => {
    for (const metricKey of ["operating_cash_flow", "capex"]) {
      await db.query(
        `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
         values ($1, $2, $2, 'currency', 'sum', 'neutral', 'gaap') on conflict do nothing`,
        [randomUUID(), metricKey],
      );
    }
    const filers = [
      [SEC_ISSUER, 320190, { Revenues: [[2023, "383285000000"]], NetCashProvidedByUsedInOperatingActivities: [[2023, "110543000000"]], PaymentsToAcquirePropertyPlantAndEquipment: [[2023, "10959000000"]] }],
      [SEC_ISSUER_B, 320191, { Revenues: [[2023, "60922000000"]], NetCashProvidedByUsedInOperatingActivities: [[2023, "28090000000"]], PaymentsToAcquireProductiveAssets: [[2023, "1069000000"]] }],
      [SEC_ISSUER_E, 320194, { Revenues: [[2019, "53800000000"], [2020, "41748000000"]], PaymentsToAcquireProductiveAssets: [[2019, "1056000000"]], PaymentsToAcquirePropertyPlantAndEquipment: [[2020, "978000000"]] }],
    ] as const;
    for (const [issuer, cik, concepts] of filers) {
      await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuer, `Filer ${cik}`, String(cik)]);
      const annual = ([fy, val]: readonly [number, string]) => ({
        start: `${fy}-01-01`, end: `${fy}-12-31`, val: Number(val), val_token: val, accn: `0000${cik}-${fy + 1 - 2000}-000010`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-01-10`,
      });
      const usGaap = Object.fromEntries(Object.entries(concepts).map(([concept, values]) => [concept, { label: "", description: "", units: { USD: values.map(annual) } }]));
      const statements = createSecBackedStatementRepository(pool, {
        fetcher: secCompanyFetcher(() => ({ cik, entityName: `Filer ${cik}`, facts: { "us-gaap": usGaap } }), { completed_at: "2024-02-01T15:05:00.000Z" }),
        sourceId: randomUUID(),
        logger: { warn: () => {} },
      });
      for (const [fy] of concepts.Revenues) assert.ok(await statements.find({ issuer_id: issuer, family: "income", basis: "as_reported", fiscal_year: fy, fiscal_period: "FY" }));
    }
    const ids = (figures: ReadonlyArray<PacketFigure>, metric: string) => figures.filter((figure) => figure.metric.startsWith(metric)).map((figure) => figure.id);
    // The agent asks for the figures, then writes the claims its packet's figures give.
    const ask = async (calls: Array<Record<string, unknown>>, question: string, claims: (figures: ReadonlyArray<PacketFigure>) => unknown[]) => {
      const router = scripted([{ toolCalls: calls.map((args) => call("certified_financials", args)) }, { text: "DONE" }]);
      let figures: ReadonlyArray<PacketFigure> = [];
      const agent = analystAgentRunner({
        financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
        router: async (beforeModelCall) => metered(router, beforeModelCall),
        read: noRead,
        compose: (input, turn, onAnswered) => answerTurn(input, turn, {
          env: LLM_ENV,
          createClient: () => async () => {
            figures = input.packet!.figures;
            return { text: `\`\`\`assertions\n${JSON.stringify(claims(figures))}\n\`\`\`` };
          },
          onAnswered,
        }),
        asOf: () => new Date().toISOString(),
        logToolCalls: persist.logToolCalls,
      });
      const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: question }));
      return { report: done.assertion_report as AssertionReport, shown: savedText(done), figures };
    };
    const refused = (texts: string[]) => texts.map((text) => ["comparative", text, "comparison: a comparison is of one metric"]);
    const rejected = (report: AssertionReport) => report.rejected.map((entry) => [entry.check, entry.text, entry.reason]);

    const ranked = await ask(
      [{ subject_refs: [{ kind: "issuer", id: SEC_ISSUER }, { kind: "issuer", id: SEC_ISSUER_B }], metrics: ["free_cash_flow"], period: { kind: "fiscal_year", fiscal_year: 2023 }, question: "OPM and PAX free cash flow in fiscal 2023" }],
      "Which had the higher free cash flow in fiscal 2023, OPM or PAX?",
      (figures) => {
        const [opm, pax] = ids(figures, "Free cash flow");
        return [
          { kind: "comparison", text: "OPM had the highest free cash flow.", evidence: [opm, pax], op: "highest", result: opm },
          { kind: "comparison", text: "OPM then PAX.", evidence: [opm, pax], op: "order", result: [opm, pax] },
        ];
      },
    );
    assert.doesNotMatch(ranked.shown, /highest/);
    assert.deepEqual([rejected(ranked.report), ranked.report.accepted.length], [refused(["OPM had the highest free cash flow.", "OPM then PAX."]), 0]);
    assert.deepEqual(ranked.figures.filter((figure) => figure.metric.startsWith("Free cash flow")).map((figure) => [figure.company, figure.metric]), [
      ["OPM", "Free cash flow (OCF less PP&E cash capex)"],
      ["PAX", "Free cash flow (OCF less productive-asset capex)"],
    ]);

    const capex = (fiscal_year: number) => ({ subject_refs: [{ kind: "issuer", id: SEC_ISSUER_E }], metrics: ["capex"], period: { kind: "fiscal_year", fiscal_year }, question: `SWX capex in fiscal ${fiscal_year}` });
    const trend = await ask([capex(2019), capex(2020)], "How did SWX's capex move from fiscal 2019 to 2020?", (figures) => [
      { kind: "comparison", text: "SWX's capex fell.", evidence: ids(figures, "Capital expenditures"), op: "trend", result: "fell" },
    ]);
    assert.doesNotMatch(trend.shown, /fell/);
    assert.deepEqual([rejected(trend.report), trend.report.accepted.length], [refused(["SWX's capex fell."]), 0]);
    // The two certified calls run at once, so their figures reach the packet in either order.
    assert.deepEqual(trend.figures.map((figure) => [figure.metric, figure.value]).sort(), [
      ["Capital expenditures (PP&E cash payments)", "$978.0M"],
      ["Capital expenditures (productive-asset cash payments, may include intangibles)", "$1.1B"],
    ]);
  });

  await t.test("an assertion citing a figure outside the packet is rejected", async () => {
    const turnId = randomUUID();
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const outside = '```assertions\n[{"kind":"observation","text":"Revenue was $383.0B.","evidence":["F1"]},{"kind":"observation","text":"Revenue was $999B.","evidence":["F99"]}]\n```';
    const done = completed(await run(agentOf(router, outside), { ...base, turnId, userIntent: "AAA revenue" }));
    const report = done.assertion_report as { accepted: Array<{ index: number }>; rejected: Array<{ index: number; check: string }> };
    assert.deepEqual(report.rejected.map((entry) => [entry.index, entry.check]), [[1, "reference"]]);
    const shown = (done.message as { blocks: Array<{ segments?: Array<{ text?: string; format?: string }> }> }).blocks.flatMap((block) => block.segments ?? []);
    assert.ok(!shown.some((segment) => `${segment.text ?? ""}${segment.format ?? ""}`.includes("$999B")));
  });

  await t.test("a stop during a tool step leaves no message, and the turn ends stopped", async () => {
    const turnId = randomUUID();
    let stop: () => void = () => assert.fail("not started");
    const read: AnalystAgentDeps["read"] = async (name) => {
      stop();
      return { tool: name, status: "no_consensus" } as AnalystToolResult;
    };
    const router = scripted([{ toolCalls: [call("get_analyst_consensus", { subject_ref: { kind: "issuer", id: A } })] }, { text: "DONE" }]);
    const events = await run(agentOf(router, OBSERVE_F1, { read }), { ...base, turnId, userIntent: "What do analysts expect for AAA?" }, (given) => {
      stop = given;
    });
    assert.equal(events.at(-1)!.type, "turn.stopped");
    const { rows } = await db.query(`select count(*)::int as n from chat_messages where thread_id = $1 and role = 'assistant' and blocks::text like '%no analyst consensus%'`, [threadId]);
    assert.equal(rows[0].n, 0);
  });

  await t.test("a turn asked again computes again each call an earlier attempt published, as its figures left with that attempt", async () => {
    const turnId = randomUUID();
    let stop: () => void = () => assert.fail("not started");
    const first = scripted([{ toolCalls: [call("certified_financials", INCOME_2023), call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const stopping: ControlledRouter = {
      complete: async (request, controls) => {
        if (first.sent.length === 1) stop();
        return first.complete(request, controls);
      },
    };
    const events = await run(agentOf(stopping, OBSERVE_F1, { planningModel: revenueModel(["AAA"]) }), { ...base, turnId, userIntent: "AAA revenue and income statement" }, (given) => {
      stop = given;
    });
    assert.equal(events.at(-1)!.type, "turn.stopped");
    assert.equal((await keysOf(turnId)).length, 2);
    const ANOTHER = { ...REVENUE, question: "AAA top line in fiscal 2023" };
    const retry = scripted([{ toolCalls: [call("certified_financials", REVENUE), call("certified_financials", INCOME_2023), call("certified_financials", ANOTHER)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(retry, '```assertions\n[]\n```', { planningModel: revenueModel(["AAA"]) }), { ...base, turnId, runId: randomUUID(), userIntent: "AAA revenue and income statement" }));
    assert.equal((await keysOf(turnId)).length, 5, "each ask of the new attempt takes a key of its own");
    const blocks = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
    assert.equal(blocks.filter((block) => block.kind === "financial_answer").length, 3, "every ask's figures are shown");
    assert.ok(!JSON.stringify(blocks).includes("earlier attempt"));
    const contents = retry.sent[1]!.messages.flatMap((message) => (message.role === "toolResult" ? [JSON.parse(message.content).status] : []));
    assert.deepEqual(contents, ["published", "published", "published"]);
  });

  await t.test("an ask resumes the run an earlier attempt left unfinished, whatever order the asks come in", async () => {
    const turnId = randomUUID();
    const B_ASK = { subject_refs: [{ kind: "issuer", id: B }], question: "BBB revenue in fiscal 2023" };
    const noPlannerForB = (async (request: Parameters<PlanningModel>[0]) => {
      if (JSON.stringify(request).includes("BBB")) throw new Error("the planner is down");
      return revenueModel(["AAA"])(request);
    }) as PlanningModel;
    let stop: () => void = () => assert.fail("not started");
    let stopped = false;
    const stopMidDrive: AgentOptions["evidence"] = (executor) => {
      const port = createEvidenceFinancialPort(executor);
      return {
        ...port,
        listInputCandidates: async (request) => {
          if (!stopped) {
            stopped = true;
            stop();
          }
          return port.listInputCandidates(request);
        },
      };
    };
    const first = scripted([{ toolCalls: [call("certified_financials", B_ASK), call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const events = await run(agentOf(first, OBSERVE_F1, { planningModel: noPlannerForB, evidence: stopMidDrive }), { ...base, turnId, userIntent: "BBB revenue and AAA income statement" }, (given) => {
      stop = given;
    });
    assert.equal(events.at(-1)!.type, "turn.stopped");
    const again = scripted([{ toolCalls: [call("certified_financials", INCOME_2023), call("certified_financials", B_ASK)] }, { text: "DONE" }]);
    completed(await run(agentOf(again, OBSERVE_F1, { planningModel: noPlannerForB }), { ...base, turnId, userIntent: "BBB revenue and AAA income statement" }));
    const { rows } = await db.query(
      `select r.execution_state from financial_runs r join financial_plans p using (plan_id) where r.request_key like $1`,
      [`turn:${turnId}:%`],
    );
    assert.deepEqual(rows.map((row) => row.execution_state), ["completed"], "the one run of the asks that planned, resumed and completed");
  });

  await t.test("a read that throws while a certified call runs fails the turn only once that call is done, and a retry shows its figures", async () => {
    const turnId = randomUUID();
    const slow = revenueModel(["AAA"]);
    const planner = (async (request: Parameters<PlanningModel>[0]) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return slow(request);
    }) as PlanningModel;
    const read: AnalystAgentDeps["read"] = async () => {
      throw new Error("a defect in a read");
    };
    const router = scripted([{ toolCalls: [call("get_company_profile", { subject_ref: { kind: "issuer", id: A } }), call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const events = await run(agentOf(router, OBSERVE_F1, { planningModel: planner, read }), { ...base, turnId, userIntent: "AAA revenue and what it sells" });
    assert.equal(events.at(-1)!.type, "turn.error");
    const atEnd = await keysOf(turnId);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(await keysOf(turnId), atEnd, "nothing of the turn still runs once it has failed");
    assert.equal(atEnd.length, 1);
    const retry = scripted([{ toolCalls: [call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(retry, OBSERVE_F1, { planningModel: planner }), { ...base, turnId, runId: randomUUID(), userIntent: "AAA revenue and what it sells" }));
    assert.deepEqual((done.message as { blocks: Array<{ kind: string }> }).blocks.map((block) => block.kind), ["financial_answer", "rich_text"]);
  });

  await t.test("a stored read gets lowercase issuer ids, and its typed status reaches the model and the notes", async () => {
    const turnId = randomUUID();
    const seen: unknown[] = [];
    const read: AnalystAgentDeps["read"] = async (name, args) => {
      seen.push(args);
      return { tool: name, status: "no_consensus" } as AnalystToolResult;
    };
    const router = scripted([{ toolCalls: [call("get_analyst_consensus", { subject_ref: { kind: "issuer", id: A.toUpperCase() } })] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, OBSERVE_F1, { read }), { ...base, turnId, userIntent: "What do analysts expect for AAA?" }));
    assert.deepEqual(seen, [{ subject_ref: { kind: "issuer", id: A } }]);
    const result = router.sent[1]!.messages.find((message) => message.role === "toolResult");
    assert.deepEqual(JSON.parse(result!.content as string), { tool: "get_analyst_consensus", status: "no_consensus" });
    const blocks = (done.message as { blocks: Array<{ segments: Array<{ text: string }> }> }).blocks;
    assert.deepEqual(blocks.map((block) => block.segments.map((segment) => segment.text).join("")), ["AAA: no analyst consensus captured in the 7 days to the cutoff is on file."]);
  });

  await t.test("a card quoting a stored source seals with the tool calls that read it", async () => {
    const consensus: AnalystAgentDeps["read"] = async () => ({
      tool: "get_analyst_consensus", status: "ok", company: "AAA", captured_on: "2026-10-30",
      values: [{ capture_id: randomUUID(), source_id: IDS.sourceV1, provider: "Finviz", field_key: "target_price", label: "price target", raw_value: "250", unit: "usd_per_share", fiscal_period: null }],
    });
    const cites = '```assertions\n[{"kind":"management_attribution","text":"Analysts target 250.","evidence":["C1"]}]\n```';
    const ask = () => scripted([{ toolCalls: [call("get_analyst_consensus", { subject_ref: { kind: "issuer", id: A } })] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(ask(), cites, { read: consensus }), { ...base, turnId: randomUUID(), userIntent: "What do analysts expect for AAA?" }));
    const [card] = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
    assert.deepEqual([card!.analyst_commentary, card!.source_refs], [true, [IDS.sourceV1]]);
    assert.ok(JSON.stringify(card!.segments).includes("attributed consensus: Finviz price target, captured 2026-10-30: 250 USD per share"));
    const unlogged = await run(agentOf(ask(), cites, { read: consensus, logged: false }), { ...base, turnId: randomUUID(), userIntent: "What do analysts expect for AAA?" });
    assert.equal(unlogged.at(-1)!.type, "turn.error", "a source no logged call read does not seal");
  });

  const failing = (step: number, router: ControlledRouter): ControlledRouter => {
    let made = 0;
    return {
      complete: async (request, controls) => {
        made += 1;
        if (made === step) throw new LlmRouterError("all_deployments_failed", "every deployment failed", []);
        return router.complete(request, controls);
      },
    };
  };

  await t.test("a model failure while reading keeps the figures read before it, and says reading stopped", async () => {
    const router = failing(2, scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }]));
    const done = completed(await run(agentOf(router, OBSERVE_F1), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    const blocks = (done.message as { blocks: Array<{ kind: string }> }).blocks;
    assert.deepEqual(blocks.map((block) => block.kind), ["financial_answer", "rich_text", "rich_text"]);
    assert.ok(JSON.stringify(blocks).includes("Reading stopped early, as the model failed, so part of the question may be unanswered."));
  });

  await t.test("an ask for no figures whose answer fails or runs out of time says so, and leaks nothing", async () => {
    const failing: ReadonlyArray<AnalystAgentDeps["compose"]> = [
      async () => {
        throw new LlmRouterError("all_deployments_failed", "relation chat_secret_table: every deployment failed", []);
      },
      (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => () => new Promise<never>(() => {}), onAnswered }),
    ];
    for (const compose of failing) {
      const agent = analystAgentRunner({
        financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
        router: async () => scripted([{ toolCalls: [call("get_company_profile", PROFILE), call("get_analyst_consensus", PROFILE)] }, { text: "DONE" }]),
        read: async (name, args, turn) => (name === "get_analyst_consensus" ? { tool: name, status: "no_consensus" } as AnalystToolResult : profileOf("We sell widgets.")(name, args, turn)),
        compose,
        asOf: () => new Date().toISOString(),
        logToolCalls: persist.logToolCalls,
        deadlines: { readMs: 5_000, turnMs: 1_500 },
      });
      const started = Date.now();
      const events = await run(agent, { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" });
      const text = savedText(completed(events));
      assert.deepEqual(events.filter((event) => event.tool_name === "write_answer").map((event) => [event.type, event.status ?? null]), [["tool.started", null], ["tool.completed", "error"]]);
      assert.ok(Date.now() - started < 20_000, "the hung answer did not hold the turn");
      assert.ok(text.includes("The answer could not be written, as the model failed or ran out of time; ask again in a minute."), text);
      assert.ok(text.includes("AAA: no analyst consensus captured in the 7 days to the cutoff is on file."), text);
      assert.ok(!text.includes("chat_secret_table"));
    }
  });

  await t.test("a read naming a company the turn does not know is refused unread, and a turn of refusals is the next runner's", async () => {
    let next = 0;
    const router = scripted([{ toolCalls: [call("get_peer_set", { subject_ref: { kind: "issuer", id: B } })] }, { text: "DONE" }]);
    const coordinator = createChatCoordinator({
      analystAgent: agentOf(router, OBSERVE_F1),
      persistAssistantMessage: persist,
      runner: async (context) => {
        next += 1;
        context.emit("turn.completed", {});
      },
    });
    const turnId = randomUUID();
    await coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, userIntent: "Who are AAA's peers?" }).completed;
    assert.equal(next, 1);
    const refused = router.sent[1]!.messages.find((message) => message.role === "toolResult");
    assert.equal(JSON.parse(refused!.content as string).status, "invalid_arguments");
  });

  await t.test("a company no listing matched is named in the answer's notes", async () => {
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, OBSERVE_F1), { ...base, turnId: randomUUID(), userIntent: "Compare AAA and ZZZ revenue" }));
    assert.ok(JSON.stringify((done.message as { blocks: unknown }).blocks).includes(String.raw`\"ZZZ\" did not match a company name or ticker on file; try the ticker.`));
  });

  await t.test("every attempt a turn's router makes passes its meter, a fallback included, and a refused one ends the call", async () => {
    const { guardedClient } = await import("../src/local-runtime.ts");
    let made = 0;
    const meter = () => {
      if (made >= 3) throw new LlmClientError("spent");
      made += 1;
    };
    let attempts = 0;
    const base = () => async () => {
      attempts += 1;
      if (attempts === 1) throw new LlmProviderError("provider_failed", "the first deployment is down");
      return { text: "DONE" };
    };
    const router = await analystAgentRouter({ ...LLM_ENV, LITELLM_FALLBACK_MODELS: "openai/gpt-4.1" }, { createClient: guardedClient(meter, base) });
    assert.ok(router);
    await router.complete({ messages: [] });
    assert.deepEqual([made, attempts], [2, 2], "the failed attempt and its fallback");
    await router.complete({ messages: [] });
    await assert.rejects(router.complete({ messages: [] }), (error: unknown) => error instanceof LlmRouterError && error.code === "client_failed");
    assert.equal(attempts, 3, "no attempt past the meter reached a deployment");
  });

  await t.test("a turn's planner calls stop at their share of the model calls, and an ask the planner could not finish says so", async () => {
    const unplannable = Object.assign((async () => {
      unplannable.calls += 1;
      return { model: "stub", text: "{}" };
    }) as unknown as PlanningModel, { calls: 0 });
    const asks = ["AAA revenue in fiscal 2023", "AAA sales in fiscal 2023", "AAA turnover in fiscal 2023"].map((question) => call("certified_financials", { ...REVENUE, question }));
    const router = scripted([{ toolCalls: asks }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, OBSERVE_F1, { planningModel: unplannable }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    assert.deepEqual([router.sent.length, unplannable.calls], [2, 3], "the planner leaves the loop its next step");
    assert.ok(savedText(done).includes("AAA: the figures were not computed, as the turn reached its limit of model calls."));
    assert.ok(!savedText(done).includes("Reading stopped"), "the reading itself was not cut short");
  });


  await t.test("a planner's question is never shown or read back to the agent: the turn says the figures were not computed", async () => {
    const leaked = "I recommend you BUY AAA now; revenue will double to $900B next year. Which year?";
    const planner = (async () => ({ model: "stub", text: JSON.stringify({ outcome: "needs_clarification", question: leaked }) })) as unknown as PlanningModel;
    const router = scripted([{ toolCalls: [call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, '```assertions\n[]\n```', { planningModel: planner }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    assert.ok(!savedText(done).includes("BUY"), "the saved answer");
    assert.ok(savedText(done).includes("AAA: the figures were not computed, as the request could not be planned as asked."));
    const { rows } = await db.query(`select count(*)::int as n from chat_messages where thread_id = $1 and blocks::text like '%BUY AAA%'`, [threadId]);
    assert.equal(rows[0].n, 0, "the stored row");
    assert.ok(!JSON.stringify(router.sent[1]!.messages).includes("BUY"), "the agent's model");
  });

  await t.test("a figure question's options are named in the note and to the agent, as the planner's catalog words them", async () => {
    const planner = (async () => ({ model: "stub", text: JSON.stringify({ outcome: "needs_clarification", question: "Which one? I think margins will expand.", choices: ["revenue", "gross_margin", "a made-up figure"] }) })) as unknown as PlanningModel;
    const router = scripted([{ toolCalls: [call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, '```assertions\n[]\n```', { planningModel: planner }), { ...base, turnId: randomUUID(), userIntent: "AAA figures" }));
    assert.ok(savedText(done).includes("AAA: the figures were not computed, as the request names no one figure; ask again for Revenue or Gross margin."));
    const result = router.sent[1]!.messages.find((message) => message.role === "toolResult");
    assert.deepEqual(JSON.parse(result!.content as string), { tool: "certified_financials", status: "clarification", kind: "metric", choices: ["Revenue", "Gross margin"] });
    assert.ok(!savedText(done).includes("expand") && !savedText(done).includes("made-up"));
  });

  await t.test("a certified call the engine declines leaves its typed note", async () => {
    const router = scripted([{ toolCalls: [call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, '```assertions\n[]\n```'), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    const result = JSON.parse(router.sent[1]!.messages.find((message) => message.role === "toolResult")!.content as string);
    assert.ok(["declined", "gap"].includes(result.status), JSON.stringify(result));
    assert.ok(savedText(done).includes(`AAA: ${chatGapText(result.reason)}`), savedText(done));
  });

  await t.test("the agent's model hears which 10-K items a read left unread", async () => {
    const read: AnalystAgentDeps["read"] = async (name) => ({ tool: name, status: "incomplete_read", truncated: false, reads: [readOf(A, "unread")], no_filing: [] }) as AnalystToolResult;
    const router = scripted([{ toolCalls: [call("get_claims", PROFILE)] }, { text: "DONE" }]);
    completed(await run(agentOf(router, OBSERVE_F1, { read }), { ...base, turnId: randomUUID(), userIntent: "What are AAA's risks?" }));
    const result = JSON.parse(router.sent[1]!.messages.find((message) => message.role === "toolResult")!.content as string);
    assert.deepEqual(result.unread_items, [{ filer: "Alpha Industries", item: "1", state: "unread" }]);
  });

  await t.test("a certified plan's cutoff is the turn's, as its reads' are", async () => {
    const turnId = randomUUID();
    const cutoff = "2026-10-01T00:00:00.000Z";
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => router,
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered }),
      asOf: () => cutoff,
      logToolCalls: persist.logToolCalls,
    });
    completed(await run(agent, { ...base, turnId, userIntent: "AAA income statement" }));
    const { rows } = await db.query(`select p.plan->'time'->>'knowledge_cutoff' as cutoff from financial_runs r join financial_plans p using (plan_id) where r.request_key like $1`, [`turn:${turnId}:%`]);
    assert.deepEqual(rows.map((row) => Date.parse(row.cutoff)), [Date.parse(cutoff)]);
  });

  await t.test("an amount in words over claims beside certified figures is not shown", async () => {
    const consensus: AnalystAgentDeps["read"] = async () => ({
      tool: "get_analyst_consensus", status: "ok", company: "AAA", captured_on: "2026-10-30",
      values: [{ capture_id: randomUUID(), source_id: IDS.sourceV1, provider: "Finviz", field_key: "target_price", label: "price target", raw_value: "250", unit: "usd_per_share", fiscal_period: null }],
    });
    const router = scripted([{ toolCalls: [call("get_analyst_consensus", PROFILE), call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const worded = "Analysts see it worth about two hundred and fifty dollars a share.";
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => router,
      read: consensus,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: () => async (_deployment, request) => {
          if (request.messages.map((message) => message.content).join("\n").startsWith("You check the analyst inferences")) return { text: '{"verdicts":[{"id":1,"verdict":"entailed","worded_amount":true}]}' };
          return { text: `\`\`\`assertions\n[{"kind":"management_attribution","text":"Analysts target 250.","evidence":["C1"]},{"kind":"analyst_inference","text":"${worded}","supports":[0]}]\n\`\`\`` };
        },
        onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA analysts and income" }));
    assert.ok(!savedText(done).includes("two hundred and fifty"));
  });

  await t.test("a step cut off names the read it never ran", async () => {
    const steps = [
      { text: "", toolCalls: [call("certified_financials", INCOME_2023)] },
      { text: "I also need what AAA sells", toolCalls: [call("get_company_profile", PROFILE)], truncated: true },
    ];
    let n = 0;
    const router: ControlledRouter = { complete: async () => ({ ...steps[n++]!, deployment: { channel: "openai", model: "o3" } }) };
    const done = completed(await run(agentOf(router, OBSERVE_F1), { ...base, turnId: randomUUID(), userIntent: "AAA revenue and what it sells" }));
    assert.ok(savedText(done).includes("The business profile for AAA went unread, as the reading was cut off."));
  });

  await t.test("a turn makes at most eight model calls across its reading, planner, answer, judge and repair", async () => {
    const planner = revenueModel(["AAA"]);
    const router = scripted([
      { toolCalls: [call("certified_financials", REVENUE), call("certified_financials", { ...REVENUE, question: "AAA sales in fiscal 2023" })] },
      { toolCalls: [call("get_analyst_consensus", PROFILE)] },
      { toolCalls: [call("get_company_profile", PROFILE)] },
    ]);
    const kinds: string[] = [];
    const list = '```assertions\n[{"kind":"observation","text":"Revenue was $383.0B.","evidence":["F1"]},{"kind":"analyst_inference","text":"Its revenue base gives it scale.","supports":[0]},{"kind":"analyst_inference","text":"Scale may help it absorb costs.","supports":[0]}]\n```';
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async (beforeModelCall) => metered(router, beforeModelCall),
      planner: (beforeModelCall) => meteredPlanner(planner, beforeModelCall),
      read: async (name) => ({ tool: name, status: name === "get_analyst_consensus" ? "no_consensus" : "no_business_claims", truncated: false, reads: [readOf(A)], no_filing: [] }) as AnalystToolResult,
      compose: (input, turn, onAnswered, beforeModelCall) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: () => async (_deployment, request) => {
          beforeModelCall();
          if (request.messages.map((message) => message.content).join("\n").startsWith("You check the analyst inferences")) {
            kinds.push("judge");
            return { text: '{"verdicts":[{"id":1,"verdict":"contradicted","worded_amount":false}]}' };
          }
          kinds.push(kinds.includes("answer") ? "repair" : "answer");
          return { text: kinds.at(-1) === "answer" ? list : '```assertions\n[]\n```' };
        },
        onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA revenue and what it sells" }));
    assert.equal(router.sent.length + planner.calls + kinds.length, 8, JSON.stringify({ loop: router.sent.length, planner: planner.calls, answer: kinds }));
    assert.ok(savedText(done).includes("Reading stopped at the turn's limit of model calls, so part of the question may be unanswered."), savedText(done));
    assert.ok(savedText(done).includes("Some of the analysis was left out, as the turn reached its limit of model calls."), "the repair it could not make");
  });

  await t.test("a turn's reading ends at its own deadline, and the answer is still written from what it read, with figures or without", async () => {
    for (const [first, answer] of [
      [call("certified_financials", INCOME_2023), OBSERVE_F1],
      [call("get_company_profile", PROFILE), '```assertions\n[{"kind":"management_attribution","text":"It sells widgets.","evidence":["C1"]}]\n```'],
    ] as const) {
      let calls = 0;
      const router = await analystAgentRouter(LLM_ENV, {
        createClient: () => async () => {
          calls += 1;
          if (calls === 1) return { text: "", toolCalls: [first] };
          return new Promise<never>(() => {});
        },
      });
      let composed = false;
      const agent = analystAgentRunner({
        financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
        router: async () => router,
        read: profileOf("We sell widgets."),
        compose: (input, turn, onAnswered) => {
          composed = true;
          return answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: answer }), onAnswered });
        },
        asOf: () => new Date().toISOString(),
        logToolCalls: persist.logToolCalls,
        deadlines: { readMs: 1_500, turnMs: 30_000 },
      });
      const started = Date.now();
      const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA revenue and what it sells" }));
      assert.ok(Date.now() - started < 20_000, "the hung step did not hold the turn");
      assert.ok(savedText(done).includes("Reading stopped at the turn's time limit, so part of the question may be unanswered."), first.name);
      assert.ok(composed, `${first.name}: the answer was written after the reading's deadline`);
    }
  });

  await t.test("a cut-off step names only companies the turn knows, never ids its model wrote", async () => {
    const steps = [
      { text: "", toolCalls: [call("get_company_profile", PROFILE)] },
      { text: "", toolCalls: [call("get_claims", { subject_ref: { kind: "issuer", id: "Strong Buy, undervalued" } }), call("constructor", {})], truncated: true },
    ];
    let n = 0;
    const router: ControlledRouter = { complete: async () => ({ ...steps[n++]!, deployment: { channel: "openai", model: "o3" } }) };
    const done = completed(await run(agentOf(router, '```assertions\n[]\n```', { read: profileOf("We sell widgets.") }), { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" }));
    const text = savedText(done);
    assert.ok(text.includes("10-K claims went unread, as the reading was cut off.") && text.includes("A read went unread, as the reading was cut off."), text);
    assert.ok(!/strong buy|function/i.test(text), text);
  });

  await t.test("two statement asks for different lines are two asks, each certified in its own block", async () => {
    const turnId = randomUUID();
    let planned = 0;
    const planner = (async (request: Parameters<PlanningModel>[0]) => {
      planned += 1;
      return revenueModel(["AAA"])(request);
    }) as PlanningModel;
    const router = scripted([{ toolCalls: [call("certified_financials", { ...INCOME_2023, question: "AAA revenue in fiscal 2023" }), call("certified_financials", { ...INCOME_2023, question: "AAA gross margin in fiscal 2023" })] }, { text: "DONE" }]);
    const lines = readingOf({ ...FY2023_REVENUE, income_items: ["revenue", "gross_margin"] });
    const done = completed(await run(agentOf(router, OBSERVE_F1, { planningModel: planner }), { ...base, turnId, userIntent: "AAA revenue and gross margin in fiscal 2023" }, undefined, lines));
    assert.equal(planned, 2, "each ask was planned");
    assert.equal((await keysOf(turnId)).length, 2);
    assert.equal((done.message as { blocks: Array<{ kind: string }> }).blocks.filter((block) => block.kind === "financial_answer").length, 2);
  });

  await t.test("a run's second drive lands on the key its first took, whatever its reading says", async () => {
    const turnId = randomUUID();
    let planned = 0;
    const planner = (async (request: Parameters<PlanningModel>[0]) => {
      planned += 1;
      return revenueModel(["AAA"])(request);
    }) as PlanningModel;
    let stop: () => void = () => assert.fail("not started");
    let stopped = false;
    const stopMidDrive: AgentOptions["evidence"] = (executor) => {
      const port = createEvidenceFinancialPort(executor);
      return {
        ...port,
        listInputCandidates: async (request) => {
          if (!stopped) {
            stopped = true;
            stop();
          }
          return port.listInputCandidates(request);
        },
      };
    };
    const ask = () => scripted([{ toolCalls: [call("certified_financials", { ...INCOME_2023, question: "AAA revenue in fiscal 2023" })] }, { text: "DONE" }]);
    const events = await run(agentOf(ask(), OBSERVE_F1, { planningModel: planner, evidence: stopMidDrive }), { ...base, turnId, userIntent: "AAA revenue in fiscal 2023" }, (given) => {
      stop = given;
    }, readingOf(FY2023_REVENUE));
    assert.equal(events.at(-1)!.type, "turn.stopped");
    const first = await keysOf(turnId);
    assert.deepEqual([first.length, planned], [1, 1]);
    const done = completed(await run(agentOf(ask(), OBSERVE_F1, { planningModel: planner }), { ...base, turnId, userIntent: "AAA revenue in fiscal 2023" }, undefined, readingOf(null)));
    assert.deepEqual(await keysOf(turnId), first, "the drive without a reading resumed the run");
    assert.equal(planned, 1, "nothing was planned again");
    const results = (done.message as { blocks: Array<{ kind: string; financial?: { results: unknown[] } }> }).blocks.flatMap((block) => (block.kind === "financial_answer" ? [block.financial!.results.length] : []));
    assert.deepEqual(results, [1], "the revenue its first drive planned, not the whole statement");
  });

  await t.test("a listing with no issuer is noted as matching no company, and the turn answers the rest", async () => {
    const gone = { status: "resolved", subject_ref: { kind: "listing", id: GONE_LISTING }, display_label: "Gone Corp.", handoff: { display_labels: { ticker: "GONE" } } } as unknown as Awaited<ReturnType<typeof resolveMention>>;
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention: async (mention) => (mention === "GONE" ? gone : resolveMention(mention)) },
      router: async () => router,
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "Compare AAA and GONE revenue" }));
    assert.ok(savedText(done).includes("No company matched GONE."), savedText(done));
  });

  const lane = () => {
    const taken: string[] = [];
    return { taken, runtime: { take: async (context: { userIntent?: string; companiesByReading?: true }) => (taken.push(`${context.userIntent ?? ""}${context.companiesByReading ? " (by reading)" : ""}`), null), claim: async () => null, everyOfferedChoice: async () => null, assertReady: async () => {} } };
  };

  await t.test("a comparison naming a company still to be picked goes to the financial lane, which asks, with a page's company or without", async () => {
    for (const [input, readQuestion] of [[{ userIntent: "Compare AAA and AMB revenue" }, undefined], [{ subjectText: "AAA", userIntent: "Compare revenue with AMB" }, comparing("AMB")]] as const) {
      const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
      const financial = lane();
      const coordinator = createChatCoordinator({
        analystAgent: agentOf(router, OBSERVE_F1),
        financialRuntime: financial.runtime,
        persistAssistantMessage: persist,
        runner: async (context) => {
          context.emit("turn.completed", {});
        },
        ...(readQuestion ? { readQuestion } : {}),
      });
      const turnId = randomUUID();
      const handle = coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, ...input });
      await handle.completed;
      assert.equal(router.sent.length, 0, `${input.userIntent}: the agent read nothing`);
      assert.ok(!handle.events.some((event) => event.bundle_id === "analyst_agent"), input.userIntent);
      assert.deepEqual(financial.taken, [`${input.userIntent} (by reading)`], "the financial lane was asked to take it, reading its companies as the agent did");
    }
  });

  await t.test("a ticker cut out of a longer word is no company the question writes, so a company to pick is asked as base asks it", async () => {
    const fund = "CCC&P 3X Fund";
    const ambiguous = { ...(await resolveMention("AMB")), input_text: fund } as Awaited<ReturnType<typeof resolveMention>>;
    const resolve = (mention: string) => (mention === fund ? Promise.resolve(ambiguous) : resolveMention(mention));
    const asked = async (flagOn: boolean) => {
      const coordinator = createChatCoordinator({
        ...(flagOn ? { analystAgent: analystAgentRunner({ financial: { pool, evidence: createEvidenceFinancialPort, resolveMention: resolve }, router: async () => assert.fail("a company to pick is asked first"), read: noRead, compose: () => assert.fail("nothing is answered"), asOf: () => new Date().toISOString() }) } : {}),
        financialRuntime: createChatFinancialRuntime({ pool, planningModel: revenueModel(["AAA"]), resolveMention: resolve, evidence: createEvidenceFinancialPort }),
        persistAssistantMessage: persist,
        runner: () => assert.fail("the financial lane asks"),
        readQuestion: readingOf({ ...NO_ASKS, companies: { kind: "as_named", names: [fund] } }),
      });
      const turnId = randomUUID();
      const handle = coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, userIntent: `What does ${fund} sell?` });
      await handle.completed;
      return [...savedText(completed(handle.events)).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
    };
    const flagOff = await asked(false);
    assert.ok(flagOff.some((text) => text!.includes("Which company did you mean")), JSON.stringify(flagOff));
    assert.deepEqual(await asked(true), flagOff);
  });

  await t.test("the saved scope is the turn's reading, as two turns change its figure and year", async () => {
    const thread = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.owner]);
    let prior: ResearchScope | null = null;
    const researchScope: AgentOptions["researchScope"] = async (_context, read) => {
      prior = resolveResearchScope({ companies: [{ issuer_id: A, label: "AAA" }], prior, asOf: new Date().toISOString(), served: true, proposal: await read });
      return prior;
    };
    const ask = async (userIntent: string, reading: typeof FY2023_REVENUE) => {
      const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
      completed(await run(agentOf(router, OBSERVE_F1, { researchScope }), { threadId: thread, userId: IDS.owner, turnId: randomUUID(), userIntent }, undefined, readingOf(reading)));
      const { rows } = await db.query(`select research_scope from chat_messages where thread_id = $1 and role = 'assistant' order by created_at desc limit 1`, [thread]);
      const scope = rows[0].research_scope as { fiscal_year: number | null; metrics: Array<{ metric_key: string }> };
      return [scope.fiscal_year, scope.metrics.map((metric) => metric.metric_key)];
    };
    assert.deepEqual(await ask("AAA revenue in fiscal 2023", FY2023_REVENUE), [2023, ["income_statement"]]);
    const freeCashFlow2024 = { ...NO_ASKS, metrics: [proposedMetric("free_cash_flow", null, null)!], period: { kind: "fiscal_year" as const, fiscal_year: 2024 } };
    assert.deepEqual(await ask("AAA free cash flow in fiscal 2024", freeCashFlow2024), [2024, ["free_cash_flow"]]);
  });

  await t.test("a peer a certified call compared is a company the next turn continues, kept as a peer", async () => {
    const thread = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.owner]);
    const peers: AnalystAgentDeps["read"] = async () => ({
      tool: "get_peer_set", status: "ok", company: "AAA", industry: "Widgets", industry_source_id: IDS.sourceV1,
      peers: [{ issuer_id: B, label: "BBB", industry_source_id: IDS.sourceV1, market_cap_source_id: null }],
    });
    const both = { ...INCOME_2023, subject_refs: [{ kind: "issuer", id: A }, { kind: "issuer", id: B }], question: "AAA and BBB income statements for fiscal 2023" };
    const router = scripted([{ toolCalls: [call("get_peer_set", PROFILE)] }, { toolCalls: [call("certified_financials", both)] }, { text: "DONE" }]);
    const researchScope: AgentOptions["researchScope"] = async () => resolveResearchScope({ companies: [{ issuer_id: A, label: "AAA" }], prior: null, asOf: new Date().toISOString(), served: true, proposal: null });
    completed(await run(agentOf(router, OBSERVE_F1, { read: peers, researchScope }), { threadId: thread, userId: IDS.owner, turnId: randomUUID(), userIntent: "How does AAA compare with its peers?" }));
    const prior = await loadPriorSubjects(pool, { threadId: thread });
    assert.deepEqual(prior.map((subject) => subject.subject_ref.id.toLowerCase()).sort(), [A, B].sort());
    const { rows } = await db.query(`select research_scope from chat_messages where thread_id = $1 and role = 'assistant'`, [thread]);
    assert.deepEqual(rows[0].research_scope.companies, [{ issuer_id: A, label: "AAA" }, { issuer_id: B }]);
  });

  await t.test("an ask for no figures is answered as its sources describe it, and one for figures keeps its counterpoint", async () => {
    const rules: string[][] = [];
    const recording = (router: ControlledRouter, read: AnalystAgentDeps["read"]) => analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => router,
      read,
      compose: (input, turn, onAnswered) => {
        rules.push([...(input.instructions ?? []), ...(input.answerShape ?? [])]);
        return answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: '```assertions\n[{"kind":"management_attribution","text":"It sells widgets.","evidence":["C1"]}]\n```' }), onAnswered });
      },
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const describe = completed(await run(recording(scripted([{ toolCalls: [call("get_company_profile", PROFILE)] }, { text: "DONE" }]), profileOf("We sell widgets.")), { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" }));
    completed(await run(recording(scripted([{ toolCalls: [call("get_company_profile", PROFILE), call("certified_financials", INCOME_2023)] }, { text: "DONE" }]), profileOf("We sell widgets.")), { ...base, turnId: randomUUID(), userIntent: "AAA revenue, and what it sells" }));
    completed(await run(recording(scripted([{ toolCalls: [call("get_company_profile", PROFILE), call("certified_financials", REVENUE)] }, { text: "DONE" }]), profileOf("We sell widgets.")), { ...base, turnId: randomUUID(), userIntent: "AAA revenue, and what it sells" }));
    assert.deepEqual(rules.map((given) => [given.some((rule) => rule.includes("write no analyst_inference")), given.some((rule) => rule.includes("the takeaway and the counterpoint"))]), [[true, false], [false, true], [true, false]], "an ask whose figures were not computed is described");
    assert.ok(!savedText(describe).includes("No figures are shown"), "a company no certified call asked about lacks none");
  });

  await t.test("that no other filer names a company a competitor is said only when the turn read competition", async () => {
    const reads: AnalystAgentDeps["read"] = async (name, args) => {
      if (name === "get_peer_set") return { tool: name, status: "no_peers", reason: "no_industry" } as AnalystToolResult;
      if (name === "get_claims" && args.role === "competitor") return { tool: name, status: "no_claims", truncated: false, reads: [], no_filing: [] } as AnalystToolResult;
      return { tool: name, status: "no_filing", truncated: false, reads: [], no_filing: [{ issuer_id: A, label: "AAA" }] } as AnalystToolResult;
    };
    const asking = (extra: LlmToolCall[]) => scripted([{ toolCalls: [call("get_company_profile", PROFILE), call("get_claims", { ...PROFILE, role: "competitor" }), ...extra] }, { text: "DONE" }]);
    const products = completed(await run(agentOf(asking([]), OBSERVE_F1, { read: reads }), { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" }));
    assert.ok(!savedText(products).includes("names it as a competitor"));
    for (const competition of [call("get_peer_set", PROFILE), call("get_claims", PROFILE)]) {
      const rivals = completed(await run(agentOf(asking([competition]), OBSERVE_F1, { read: reads }), { ...base, turnId: randomUUID(), userIntent: "Who does AAA compete with?" }));
      assert.ok(savedText(rivals).includes("AAA: no other company's 10-K on file names it as a competitor."), competition.name);
    }
    const failing: AnalystAgentDeps["read"] = async (name, args) => (name === "get_claims" && args.role === "competitor" ? { tool: name, status: "unavailable", reason: "the read failed" } as AnalystToolResult : reads(name, args, { as_of: "", user_id: null }));
    const failed = completed(await run(agentOf(asking([]), OBSERVE_F1, { read: failing }), { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" }));
    assert.ok(savedText(failed).includes("AAA: the stored sources could not be read just now"), "a failed read is said whatever was asked");
  });

  await t.test("a turn the agent reads nothing for goes on to the next runner", async () => {
    const turnId = randomUUID();
    let next = 0;
    const financial = lane();
    const coordinator = createChatCoordinator({
      analystAgent: agentOf(scripted([{ text: "DONE" }]), OBSERVE_F1),
      financialRuntime: financial.runtime,
      persistAssistantMessage: persist,
      runner: async (context) => {
        next += 1;
        context.emit("turn.completed", {});
      },
    });
    await coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, userIntent: "How has AAA's stock done this year?" }).completed;
    assert.deepEqual([next, financial.taken.length], [1, 0]);
  });

  await t.test("a turn whose model fails before anything is read goes on to the next runner, told the model failed (#695)", async () => {
    const told: Array<true | undefined> = [];
    // A reading that runs out of time is not a model failure.
    const hung = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => analystAgentRouter(LLM_ENV, { createClient: () => () => new Promise<never>(() => {}) }),
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered }),
      asOf: () => new Date().toISOString(),
      deadlines: { readMs: 1_000, turnMs: 30_000 },
    });
    for (const analystAgent of [agentOf(failing(1, scripted([])), OBSERVE_F1), agentOf(scripted([{ text: "DONE" }]), OBSERVE_F1), hung]) {
      const turnId = randomUUID();
      const coordinator = createChatCoordinator({
        analystAgent,
        persistAssistantMessage: persist,
        runner: async (context) => {
          told.push(context.modelFailed);
          context.emit("turn.completed", {});
        },
      });
      await coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, userIntent: "How has AAA's stock done this year?" }).completed;
    }
    assert.deepEqual(told, [true, undefined, undefined]);
  });

  const meteredReading = (reading: Awaited<ReturnType<ReturnType<typeof readingOf>>>) => async (_question: string, beforeModelCall?: () => void) => {
    beforeModelCall?.();
    made.readings += 1;
    return reading;
  };
  const made = { readings: 0 };
  const judgedBy = (answer: string, verdict: "entailed" | "unsupported" | "contradicted", kinds: string[], beforeModelCall?: () => void) => () => async (_deployment: unknown, request: LlmChatRequest) => {
    beforeModelCall?.();
    if (request.messages.map((message) => message.content).join("\n").startsWith("You check the analyst inferences")) {
      kinds.push("judge");
      return { text: `{"verdicts":[{"id":1,"verdict":"${verdict}","worded_amount":false}]}` };
    }
    kinds.push(kinds.includes("answer") ? "repair" : "answer");
    return { text: kinds.at(-1) === "answer" ? answer : "```assertions\n[]\n```" };
  };
  const TWO_INFERENCES = '```assertions\n[{"kind":"observation","text":"Revenue was $383.0B.","evidence":["F1"]},{"kind":"analyst_inference","text":"Its revenue base gives it scale.","supports":[0]},{"kind":"analyst_inference","text":"Scale may help it absorb costs.","supports":[0]}]\n```';

  // The financial lane's claim reads a cash-resilience ask first, and finds it the analyst's; the agent reuses that reading.
  const claimed = createChatFinancialRuntime({ pool, planningModel: null, resolveMention, evidence: createEvidenceFinancialPort });
  const askingGuidance: ScopeProposal = { ...NO_ASKS, asks: new Set(["guidance"]), companies: { kind: "as_named", names: ["AAA"] } };
  for (const [name, userIntent, reading, financialRuntime] of [
    ["", "AAA revenue and what it sells", null, undefined],
    [", when the financial lane's claim made it", "Why did AAA's cash resilience drop?", askingGuidance, claimed],
  ] as const) await t.test(`the turn's reading of its question is one of its eight model calls${name}`, async () => {
    made.readings = 0;
    const planner = revenueModel(["AAA"]);
    const router = scripted([
      { toolCalls: [call("certified_financials", REVENUE), call("certified_financials", { ...REVENUE, question: "AAA sales in fiscal 2023" })] },
      { toolCalls: [call("get_analyst_consensus", PROFILE)] },
      { toolCalls: [call("get_company_profile", PROFILE)] },
    ]);
    const kinds: string[] = [];
    const agent = analystAgentRunner({
      financial: {
        pool, evidence: createEvidenceFinancialPort, resolveMention,
        researchScope: async (_context, read) => resolveResearchScope({ companies: [{ issuer_id: A, label: "AAA" }], prior: null, asOf: new Date().toISOString(), served: true, proposal: await read }),
      },
      router: async (beforeModelCall) => metered(router, beforeModelCall),
      planner: (beforeModelCall) => meteredPlanner(planner, beforeModelCall),
      read: async (name) => ({ tool: name, status: name === "get_analyst_consensus" ? "no_consensus" : "no_business_claims", truncated: false, reads: [readOf(A)], no_filing: [] }) as AnalystToolResult,
      compose: (input, turn, onAnswered, beforeModelCall) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" }, createClient: judgedBy(TWO_INFERENCES, "contradicted", kinds, beforeModelCall), onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    completed(await run(agent, { ...base, turnId: randomUUID(), userIntent }, undefined, meteredReading(reading), financialRuntime));
    assert.equal(made.readings, 1);
    assert.equal(made.readings + router.sent.length + planner.calls + kinds.length, 8, JSON.stringify({ readings: made.readings, loop: router.sent.length, planner: planner.calls, answer: kinds }));
  });

  await t.test("a reading the financial lane's claim made counts toward the agent's turn deadline", async () => {
    const READ_MS = 4_000;
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("get_company_profile", PROFILE)] }, { text: "DONE" }]),
      read: profileOf("We sell widgets."),
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => () => new Promise<never>(() => {}), onAnswered }),
      asOf: () => new Date().toISOString(),
      deadlines: { readMs: 30_000, turnMs: READ_MS },
    });
    const coordinator = createChatCoordinator({
      analystAgent: agent,
      financialRuntime: claimed,
      persistAssistantMessage: persist,
      readQuestion: async () => {
        await new Promise((resolve) => setTimeout(resolve, READ_MS));
        return askingGuidance;
      },
      runner: async (context) => {
        context.emit("turn.completed", {});
      },
    });
    const turnId = randomUUID();
    const started = Date.now();
    await coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, userIntent: "Why did AAA's cash resilience drop?" }).completed;
    const took = Date.now() - started;
    assert.ok(took < READ_MS * 1.6, `the turn took ${took} ms, past its ${READ_MS} ms deadline by more than the time to save it`);
  });

  await t.test("the reading's steps leave the answer and its judge their calls, however many the planner takes", async () => {
    made.readings = 0;
    const planner = revenueModel(["AAA"]);
    const asks = ["AAA revenue in fiscal 2023", "AAA sales in fiscal 2023", "AAA turnover in fiscal 2023"].map((question) => call("certified_financials", { ...REVENUE, question }));
    const router = scripted([{ toolCalls: asks }, { toolCalls: [call("get_company_profile", PROFILE)] }, { toolCalls: [call("get_analyst_consensus", PROFILE)] }]);
    const kinds: string[] = [];
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async (beforeModelCall) => metered(router, beforeModelCall),
      planner: (beforeModelCall) => meteredPlanner(planner, beforeModelCall),
      read: async (name) => ({ tool: name, status: name === "get_analyst_consensus" ? "no_consensus" : "no_business_claims", truncated: false, reads: [readOf(A)], no_filing: [] }) as AnalystToolResult,
      compose: (input, turn, onAnswered, beforeModelCall) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" }, createClient: judgedBy(TWO_INFERENCES, "entailed", kinds, beforeModelCall), onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const text = savedText(completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }, undefined, meteredReading(null))));
    assert.deepEqual([router.sent.length, planner.calls, kinds], [2, 2, ["answer", "judge", "judge"]]);
    assert.ok(text.includes("Reading stopped at the turn's limit of model calls"), text);
    assert.ok(!text.includes("Some of the analysis was left out"), "the judge had its calls");
  });

  await t.test("an ask for no figures shows no inference its answer lists, whatever its judge says", async () => {
    const kinds: string[] = [];
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("get_analyst_consensus", PROFILE)] }, { text: "DONE" }]),
      read: async () => ({
        tool: "get_analyst_consensus", status: "ok", company: "AAA", captured_on: "2026-10-30",
        values: [{ capture_id: randomUUID(), source_id: IDS.sourceV1, provider: "Finviz", field_key: "target_price", label: "price target", raw_value: "250", unit: "usd_per_share", fiscal_period: null }],
      }),
      compose: (input, turn, onAnswered) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: judgedBy('```assertions\n[{"kind":"management_attribution","text":"Analysts target 250.","evidence":["C1"]},{"kind":"analyst_inference","text":"AAA looks undervalued against that target.","supports":[0]}]\n```', "entailed", kinds),
        onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "What do analysts expect for AAA?" }));
    assert.ok(savedText(done).includes("captured 2026-10-30: 250 USD per share") && !savedText(done).includes("undervalued"), savedText(done));
    const card = (done.message as { blocks: Array<Record<string, unknown>> }).blocks.find((block) => block.analyst_commentary === true);
    assert.ok(!(card?.commentary as Array<{ kind: string }>).some((part) => part.kind === "inference"), JSON.stringify(card?.commentary));
    assert.deepEqual(kinds, ["answer"], "no inference was judged or repaired");
    const repairing: string[] = [];
    const failingInference = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("get_analyst_consensus", PROFILE)] }, { text: "DONE" }]),
      read: async () => ({
        tool: "get_analyst_consensus", status: "ok", company: "AAA", captured_on: "2026-10-30",
        values: [{ capture_id: randomUUID(), source_id: IDS.sourceV1, provider: "Finviz", field_key: "target_price", label: "price target", raw_value: "250", unit: "usd_per_share", fiscal_period: null }],
      }),
      compose: (input, turn, onAnswered) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: judgedBy('```assertions\n[{"kind":"management_attribution","text":"Analysts target 250.","evidence":["C1"]},{"kind":"analyst_inference","text":"AAA looks undervalued against that target.","supports":[7]}]\n```', "entailed", repairing),
        onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const unrepaired = completed(await run(failingInference, { ...base, turnId: randomUUID(), userIntent: "What do analysts expect for AAA?" }));
    assert.deepEqual(repairing, ["answer"], "an inference a check rejected is not sent to repair");
    assert.ok(!savedText(unrepaired).includes("undervalued"), savedText(unrepaired));
  });

  await t.test("an inference its judge does not entail is not shown in the agent's answer, not even as an unverified view", async () => {
    const kinds: string[] = [];
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]),
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: judgedBy('```assertions\n[{"kind":"observation","text":"Revenue was $383.0B.","evidence":["F1"]},{"kind":"analyst_inference","text":"Its revenue leaves it exposed to memory competitors.","supports":[0]}]\n```', "unsupported", kinds),
        onAnswered,
      }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const text = savedText(completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA income statement" })));
    assert.deepEqual(kinds, ["answer", "judge"]);
    assert.ok(text.includes("revenue was") && !text.includes("memory competitors") && !text.includes("Unverified"), text);
  });

  await t.test("a company the question names by name is resolved from its reading, or named as matching none", async () => {
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const unmatched = readingOf({ ...NO_ASKS, companies: { kind: "compare", add: ["AAA", "Zephyr"] } });
    const done = completed(await run(agentOf(router, OBSERVE_F1), { ...base, turnId: randomUUID(), userIntent: "Compare AAA and Zephyr revenue" }, undefined, unmatched));
    assert.ok(savedText(done).includes(String.raw`\"Zephyr\" did not match a company name or ticker on file; try the ticker.`) && !savedText(done).includes("No company matched"), savedText(done));
    const named = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const agent = analystAgentRunner({
      financial: { pool, evidence: createEvidenceFinancialPort, resolveMention: (mention) => resolveMention(mention === "Beta Holdings" ? "BBB" : mention) },
      router: async () => named,
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const beta = readingOf({ ...NO_ASKS, companies: { kind: "as_named", names: ["AAA", "Beta Holdings"] } });
    completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "Compare AAA and Beta Holdings revenue" }, undefined, beta));
    const listed = JSON.parse(named.sent[0]!.messages[1]!.content as string) as { companies: Array<{ subject_ref: { id: string } }> };
    assert.deepEqual(listed.companies.map((company) => company.subject_ref.id), [A, B]);
    const partial = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const oneOfTwo = readingOf({ ...NO_ASKS, companies: { kind: "as_named", names: ["AAA"] } });
    completed(await run(agentOf(partial, OBSERVE_F1), { ...base, turnId: randomUUID(), userIntent: "Compare AAA and BBB revenue" }, undefined, oneOfTwo));
    const both = JSON.parse(partial.sent[0]!.messages[1]!.content as string) as { companies: Array<{ subject_ref: { id: string } }> };
    assert.deepEqual(both.companies.map((company) => company.subject_ref.id), [A, B], "a written ticker the reading left out is kept");
    const narrowing = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const followUp = analystAgentRunner({
      financial: {
        pool, evidence: createEvidenceFinancialPort, resolveMention,
        priorSubjects: async () => [await resolveMention("AAA"), await resolveMention("BBB")] as Array<Extract<Awaited<ReturnType<typeof resolveMention>>, { status: "resolved" }>>,
      },
      router: async () => narrowing,
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    completed(await run(followUp, { ...base, turnId: randomUUID(), userIntent: "Just AAA now, not BBB" }, undefined, oneOfTwo));
    const kept = JSON.parse(narrowing.sent[0]!.messages[1]!.content as string) as { companies: Array<{ subject_ref: { id: string } }> };
    assert.deepEqual(kept.companies.map((company) => company.subject_ref.id), [A], "a follow-up's reading may leave a written company out");
  });

  await t.test("an income statement ask whose question names its lines is planned from its own words, and a line may be asked alone", async () => {
    const resultsOf = (done: Record<string, unknown>) => (done.message as { blocks: Array<{ kind: string; financial?: { results: unknown[] } }> }).blocks
      .filter((block) => block.kind === "financial_answer").map((block) => block.financial!.results.length);
    const asked: string[] = [];
    const planner = (async (request: Parameters<PlanningModel>[0]) => {
      asked.push(request.messages.map((message) => message.content).join("\n"));
      return revenueModel(["AAA"])(request);
    }) as PlanningModel;
    const statement = scripted([{ toolCalls: [call("certified_financials", { ...INCOME_2023, question: "AAA revenue in fiscal 2023" })] }, { text: "DONE" }]);
    const planned = completed(await run(agentOf(statement, OBSERVE_F1, { planningModel: planner }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue in fiscal 2023" }, undefined, readingOf(FY2023_REVENUE)));
    assert.deepEqual(resultsOf(planned), [1]);
    assert.equal(asked.length, 1);
    assert.ok(asked[0]!.includes("AAA revenue in fiscal 2023 (for fiscal year 2023)"), "the planner reads the ask's own words");
    const line = scripted([{ toolCalls: [call("certified_financials", { ...INCOME_2023, metrics: ["revenue"] })] }, { text: "DONE" }]);
    assert.deepEqual(resultsOf(completed(await run(agentOf(line, OBSERVE_F1, { planningModel: planner }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue in fiscal 2023" }))), [1]);
    assert.equal(asked.length, 1, "a line asked alone needs no planner");
    const mixed = scripted([{ toolCalls: [call("certified_financials", { ...INCOME_2023, metrics: ["income_statement", "free_cash_flow"] })] }, { text: "DONE" }]);
    completed(await run(agentOf(mixed, OBSERVE_F1, { planningModel: planner }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue and free cash flow in fiscal 2023" }, undefined, readingOf(FY2023_REVENUE)));
    assert.equal(asked.length, 1, "the statement beside another metric is planned with no model, as base plans it");
  });

  await t.test("a question asking no figure reads on after a step that found no 10-K, one read a step, with steps to say it is done", async () => {
    const ran: string[] = [];
    const reads: AnalystAgentDeps["read"] = async (name) => {
      ran.push(name);
      return (name === "get_analyst_consensus"
        ? { tool: name, status: "no_consensus" }
        : { tool: name, status: "no_filing", truncated: false, reads: [], no_filing: [{ issuer_id: A.toUpperCase(), label: "AAA" }] }) as AnalystToolResult;
    };
    const router = scripted([{ toolCalls: [call("get_company_profile", PROFILE)] }, { toolCalls: [call("get_claims", { ...PROFILE, predicates: ["risk.factor"] })] }, { toolCalls: [call("get_analyst_consensus", PROFILE)] }, { text: "DONE" }]);
    const text = savedText(completed(await run(agentOf(router, "```assertions\n[]\n```", { read: reads }), { ...base, turnId: randomUUID(), userIntent: "What do analysts expect AAA to earn next year, and what does AAA sell?" }, undefined, readingOf(NO_ASKS))));
    assert.deepEqual(ran, ["get_company_profile", "get_claims", "get_analyst_consensus"]);
    assert.ok(text.includes("AAA has no 10-K on file") && text.includes("no analyst consensus") && !text.includes("step limit"), text);
  });

  await t.test("a price read charts the week from stored closes, its return and close are chips the seal accepts, and no prices is a note (#678)", async () => {
    // Tuesday Nov 17, 2026 at 00:51 New York: the week began Monday Nov 16.
    const cutoff = "2026-11-17T05:51:00.000Z";
    const [instrumentA, listingA, instrumentB, listingB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock'), ($3, $4, 'common_stock')`, [instrumentA, A, instrumentB, B]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1, $2, 'XNAS', 'AAA', 'USD', 'America/New_York'), ($3, $4, 'XNAS', 'BBB', 'USD', 'America/New_York')`,
      [listingA, instrumentA, listingB, instrumentB],
    );
    const { rows: [range] } = await db.query<{ bar_range_id: string }>(
      `insert into market_bar_ranges (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end, as_of, delay_class, currency, fetched_at, expires_at)
       values ($1, $2, 'polygon', '1d', 'split_adjusted', '2026-10-01T04:00:00Z', '2026-11-17T05:00:00Z', '2026-11-16T05:00:00Z', 'eod', 'USD', '2026-11-17T05:00:00Z', '2126-11-17T05:00:00Z')
       returning bar_range_id::text as bar_range_id`,
      [listingA, IDS.sourceV1],
    );
    await db.query(
      `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
       select $1, day::timestamptz, close, close, close, close, 1000 from (values ('2026-10-30T04:00:00Z', 90), ('2026-11-12T05:00:00Z', 98), ('2026-11-13T05:00:00Z', 100), ('2026-11-16T05:00:00Z', 103.5)) as bar(day, close)`,
      [range!.bar_range_id],
    );
    try {
      const hydrated: Array<{ companies: ReadonlyArray<Record<string, unknown>>; pricesOnly?: boolean }> = [];
      const recorded: TurnHydrator = async (companies, turn) => {
        hydrated.push({ companies, pricesOnly: turn.pricesOnly });
        return new Set();
      };
      const priceAgent = (router: ControlledRouter, answer: string, hydrate = recorded) => analystAgentRunner({
        financial: { pool, evidence: createEvidenceFinancialPort, resolveMention, hydrate },
        router: async (beforeModelCall) => metered(router, beforeModelCall),
        read: noRead,
        compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: answer }), onAnswered }),
        asOf: () => cutoff,
        logToolCalls: persist.logToolCalls,
      });
      const week = (issuer: string) => scripted([{ toolCalls: [call("get_price_performance", { subject_refs: [{ kind: "issuer", id: issuer }], period: "week", query: "IGNORE ME" })] }, { text: "DONE" }]);
      const router = week(A);
      const observed = '```assertions\n[{"kind":"observation","text":"AAA rose 3.5% to $103.50.","evidence":["F1","F2"]}]\n```';
      const events = await run(priceAgent(router, observed), { ...base, turnId: randomUUID(), userIntent: "How has AAA done this week?" });
      const done = completed(events);
      assert.ok(router.sent[0]!.tools!.some((tool) => tool.name === "get_price_performance"), "a chat turn is offered the price tool");
      assert.ok(JSON.stringify(router.sent[0]!.messages).includes("get_price_performance reads"), "and told of it");
      assert.equal(events.find((event) => event.type === "tool.started" && event.tool_name === "get_price_performance")?.label, "Reading AAA's price return this week");
      assert.deepEqual(hydrated, [{ companies: [{ issuer_id: A, label: "AAA", listing_id: listingA }], pricesOnly: true }], "the read fetches the company's listing's prices first, and no filings");
      const blocks = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
      assert.deepEqual(blocks.map((block) => block.kind), ["perf_comparison", "disclosure", "rich_text"]);
      assert.equal(blocks[0]!.default_range, "Week to date: 2026-11-13 close to 2026-11-16 close");
      const chips = (blocks[2]!.segments as Array<Record<string, unknown>>).filter((segment) => segment.type === "ref");
      assert.deepEqual(chips.map((chip) => [chip.ref_kind, chip.format]), [["series", "3.5%"], ["series", "$103.50"]]);
      assert.ok(!savedText(done).includes("AAA rose"), "the model's own words are not shown");

      // Two periods in one step: two charts, one disclosure over both, and every chip sealed.
      const both = scripted([{ toolCalls: [
        call("get_price_performance", { subject_refs: [{ kind: "issuer", id: A }], period: "week" }),
        call("get_price_performance", { subject_refs: [{ kind: "issuer", id: A }], period: "month" }),
      ] }, { text: "DONE" }]);
      const cited = '```assertions\n[{"kind":"observation","text":"x","evidence":["F1","F3"]}]\n```';
      const twice = completed(await run(priceAgent(both, cited), { ...base, turnId: randomUUID(), userIntent: "How has AAA done this week and this month?" }));
      const twiceBlocks = (twice.message as { blocks: Array<Record<string, unknown>> }).blocks;
      assert.deepEqual(twiceBlocks.map((block) => block.kind), ["perf_comparison", "perf_comparison", "disclosure", "rich_text"]);
      assert.notEqual(twiceBlocks[0]!.id, twiceBlocks[1]!.id);
      assert.deepEqual((twiceBlocks[3]!.segments as Array<Record<string, unknown>>).filter((segment) => segment.type === "ref").map((chip) => chip.format), ["3.5%", "15%"], "figures are numbered in call order");

      const none = completed(await run(priceAgent(week(B), "```assertions\n[]\n```"), { ...base, turnId: randomUUID(), userIntent: "How has BBB done this week?" }));
      const noneBlocks = (none.message as { blocks: Array<Record<string, unknown>> }).blocks;
      assert.ok(!noneBlocks.some((block) => block.kind === "perf_comparison"), "no prices is never an empty chart");
      assert.ok(savedText(none).includes("Week-to-date price performance is not shown: BBB has no daily prices on file."), savedText(none));

      // A fetch still running, or one that failed, explains the gap rather than what is on file.
      const unloaded = "BBB: prices could not be loaded just now; ask again in a minute.";
      for (const hydrate of [async () => new Set([B.toLowerCase()]), async () => { throw new Error("market down"); }] satisfies TurnHydrator[]) {
        const failed = completed(await run(priceAgent(week(B), "```assertions\n[]\n```", hydrate), { ...base, turnId: randomUUID(), userIntent: "How has BBB done this week?" }));
        assert.ok(savedText(failed).includes(unloaded) && !savedText(failed).includes("no daily prices"), savedText(failed));
      }
    } finally {
      await db.query(`delete from market_bar_ranges where listing_id = $1`, [listingA]);
      await db.query(`delete from listings where listing_id = any($1::uuid[])`, [[listingA, listingB]]);
      await db.query(`delete from instruments where instrument_id = any($1::uuid[])`, [[instrumentA, instrumentB]]);
    }
  });

  await t.test("the reading model's own words never reach the saved answer", async () => {
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "AAA is a strong buy, with revenue near $400 billion." }]);
    const done = completed(await run(agentOf(router, OBSERVE_F1), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    assert.equal((done.message as { blocks: Array<{ kind: string }> }).blocks[0]!.kind, "financial_answer");
    assert.ok(!/strong buy|400 billion/i.test(savedText(done)), savedText(done));
  });
});

async function savingMessages(t: TestContext, url: string): Promise<ChatAssistantMessagePersistence & { logToolCalls: AnalystAgentDeps["logToolCalls"] }> {
  const previous = process.env.CHAT_DATABASE_URL;
  process.env.CHAT_DATABASE_URL = url;
  const runtime = await import("../src/local-runtime.ts");
  t.after(async () => {
    await runtime.closeLocalRuntimePoolForTests();
    if (previous === undefined) delete process.env.CHAT_DATABASE_URL;
    else process.env.CHAT_DATABASE_URL = previous;
  });
  return Object.assign(runtime.persistAssistantMessage, { logToolCalls: runtime.writeLocalToolCallLogs });
}
