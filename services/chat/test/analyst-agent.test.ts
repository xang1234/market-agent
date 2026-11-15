import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, IDS } from "../../financial-engine/test/db-fixtures.ts";
import { LlmRouterError, type ControlledRouter, type LlmChatRequest, type LlmExecutionControls, type LlmToolCall } from "../../llm/src/router.ts";
import { analystAgentRouter, analystAgentRunner, certifiedAsk, perStepDeadlines, statusNote, stopNotes, type AnalystAgentDeps } from "../src/analyst-agent.ts";
import type { AnalystToolResult } from "../src/analyst-tools.ts";
import { answerPath, answerTurn } from "../src/answer-trace.ts";
import { createChatCoordinator, type ChatAssistantMessagePersistence, type ChatTurnInput } from "../src/coordinator.ts";
import { figureCompanies, mergePackets, type EvidencePacket, type PacketClaim } from "../src/evidence-packet.ts";
import { proposedMetric, resolveResearchScope, type ResearchScope } from "../src/research-scope.ts";
import { ENGINE_READS_BY_CATALOG_METRIC } from "../src/scope-figures.ts";
import { loadPriorSubjects } from "../src/thread-context.ts";
import { loadToolRegistry } from "../../tools/src/registry.ts";
import { chatDatabase, comparing, FY2023_REVENUE, NO_ASKS, readingOf, resolveMention, revenueModel } from "./financial-fixtures.ts";

const LLM_ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1,o3",
  LITELLM_MODEL: "openai/gpt-4.1",
  AGENT_LITELLM_MODEL: "openai/o3",
};

test("the agent's router leads with the agent model, not the primary one", async () => {
  const models: string[] = [];
  const router = await analystAgentRouter(LLM_ENV, {
    createClient: () => async (deployment) => {
      models.push(deployment.model);
      return { text: "DONE" };
    },
  });
  assert.ok(router);
  await router.complete({ messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(models, ["o3"]);
});

test("each step of the agent's loop gets deadlines of its own", async () => {
  const controls: Array<LlmExecutionControls | undefined> = [];
  const inner: ControlledRouter = {
    complete: async (_request, given) => {
      controls.push(given);
      return { text: "DONE", deployment: { channel: "openai", model: "o3" } };
    },
  };
  const router = perStepDeadlines(inner);
  await router.complete({ messages: [] });
  await router.complete({ messages: [] });
  assert.equal(controls.length, 2);
  assert.notEqual(controls[0], controls[1], "a fresh withDeadlines per step");
  assert.deepEqual(controls.map((given) => [given?.maxAttempts, typeof given?.executeAttempt]), [[2, "function"], [2, "function"]]);
});

test("the registry's certified_financials metrics are the ones the engine plans with no model", () => {
  const tool = loadToolRegistry().getTool("certified_financials");
  const schema = tool?.input_json_schema as { properties: { metrics: { items: { enum: string[] } } } };
  assert.deepEqual(schema.properties.metrics.items.enum, Object.keys(ENGINE_READS_BY_CATALOG_METRIC));
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
    metrics: ["income_statement"],
    question: "Revenue",
    ...extra,
  } as never, KNOWN);
  const one = ask([A, B]);
  const two = ask([B.toUpperCase(), A], { question: "Compare their revenue" });
  assert.ok("fingerprint" in one && "fingerprint" in two);
  assert.equal(one.fingerprint, two.fingerprint, "named metrics: the question does not change the ask");
  assert.deepEqual(one.choice, { kind: "kept_figures", metrics: ["income_statement"], period: { kind: "latest", period: null } });
  const planned = certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "Revenue last year" } as never, KNOWN);
  const reworded = certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "R&D spending last year" } as never, KNOWN);
  assert.ok("fingerprint" in planned && "fingerprint" in reworded);
  assert.equal(planned.choice.kind, "planner");
  assert.notEqual(planned.fingerprint, reworded.fingerprint, "a planner ask is its question");
  assert.deepEqual(
    [
      certifiedAsk({ subject_refs: [{ kind: "issuer", id: randomUUID() }], question: "x" } as never, KNOWN),
      certifiedAsk({ subject_refs: [{ kind: "issuer", id: A }], question: "x", metrics: ["revenue"] } as never, KNOWN),
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
    asked: ["AAA"],
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
  const packet = mergePackets({ engine: [engine("AAA", ["$1.0B"]), engine("BBB", ["$2.0B"])], analyst: [], asked: ["AAA", "BBB"], notes: [], labels: new Map(), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(packet.figures.map((figure) => [figure.id, ...figureCompanies(figure, packet)]), [["F1", "AAA"], ["F2", "BBB"]]);
});

test("a read that could not be made marks the packet's claims unavailable, and its note says nothing is known of them", () => {
  const unavailable: AnalystToolResult = { tool: "get_claims", status: "unavailable", reason: "the read failed" };
  const packet = mergePackets({ engine: [], analyst: [unavailable], asked: [], notes: [], labels: new Map(), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual([packet.route, packet.claims_status], ["analyst_agent", "unavailable"]);
  assert.equal(statusNote(unavailable, "AAA"), "AAA: the stored sources could not be read just now, so this says nothing about what is on file.");
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

test("only a company a certified call asked figures of can be said to have none, and claims beside figures take the analyst's rules", () => {
  const profile: AnalystToolResult = { tool: "get_company_profile", status: "ok", truncated: false, reads: [readOf(A)], no_filing: [], claims: [filingClaim(randomUUID(), "We sell widgets.")] };
  const claimsOnly = mergePackets({ engine: [], analyst: [profile], asked: [], notes: [], labels: new Map([[A, "AAA"]]), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(claimsOnly.coverage, []);
  const mixed = mergePackets({ engine: [engine("AAA", ["$1.0B"])], analyst: [profile], asked: ["AAA", "BBB"], notes: [], labels: new Map([[A, "AAA"]]), cutoff: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(mixed.coverage, [{ company: "AAA", status: "shown" }, { company: "BBB", status: "not_shown" }]);
  assert.deepEqual([answerPath({ packet: mixed }), answerPath({ packet: engine("AAA", ["$1.0B"]) })], ["analyst", "engine"]);
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
  };
  const agentOf = (router: ControlledRouter, answer: string, options: AgentOptions = {}) => analystAgentRunner({
    financial: {
      pool,
      planningModel: options.planningModel ?? null,
      evidence: options.evidence ?? createEvidenceFinancialPort,
      resolveMention,
      ...(options.hydrate ? { hydrate: options.hydrate } : {}),
      ...(options.researchScope ? { researchScope: options.researchScope } : {}),
    },
    router: async () => router,
    read: options.read ?? noRead,
    compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: answer }), onAnswered }),
    asOf: () => new Date().toISOString(),
    ...(options.logged === false ? {} : { logToolCalls: persist.logToolCalls }),
  });
  const run = async (agent: ReturnType<typeof agentOf>, input: Omit<ChatTurnInput, "runId"> & { turnId: string }, during?: (stop: () => void) => void, readQuestion?: ReturnType<typeof readingOf>) => {
    const coordinator = createChatCoordinator({ analystAgent: agent, persistAssistantMessage: persist, runner: () => assert.fail("the agent takes the turn"), ...(readQuestion ? { readQuestion } : {}) });
    const handle = coordinator.getOrCreateTurn({ ...input, runId: input.turnId });
    during?.(() => coordinator.stopTurn({ userId: input.userId, threadId: input.threadId, runId: input.turnId, turnId: input.turnId }));
    await handle.completed;
    return handle.events;
  };
  const keysOf = async (turnId: string) => (await db.query(`select request_key from financial_runs where request_key like $1 order by request_key`, [`turn:${turnId}:%`])).rows.map((row) => row.request_key);

  await t.test("two certified calls give two certified blocks under their own keys, and the card cites their F ids", async () => {
    const turnId = randomUUID();
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023), call("certified_financials", REVENUE)] }, { text: "DONE" }]);
    const events = await run(agentOf(router, OBSERVE_F1, { planningModel: revenueModel(["AAA"]) }), { ...base, turnId, userIntent: "AAA revenue and income statement" });
    const done = completed(events);
    assert.equal(done.bundle_id, "analyst_agent");
    assert.deepEqual(await keysOf(turnId), [`turn:${turnId}:1`, `turn:${turnId}:2`]);
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
      financial: { pool, planningModel: null, evidence: createEvidenceFinancialPort, resolveMention },
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
      financial: { pool, planningModel: null, evidence: createEvidenceFinancialPort, resolveMention },
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
    const done = completed(await run(judged, { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    const card = (done.message as { blocks: Array<Record<string, unknown>> }).blocks.find((block) => block.analyst_commentary === true);
    assert.deepEqual((card?.commentary as Array<{ kind: string }>).map((part) => part.kind), ["figures", "inference"]);
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

  await t.test("a free-text final reply is rejected, and the turn answers with its certified blocks alone", async () => {
    const turnId = randomUUID();
    const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(router, "AAA's revenue was about $383 billion, roughly double BBB's."), { ...base, turnId, userIntent: "AAA revenue" }));
    const blocks = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
    assert.deepEqual(blocks.map((block) => [block.kind, block.analyst_commentary ?? null]), [["financial_answer", null], ["rich_text", null]]);
    assert.deepEqual((blocks[1]!.segments as Array<{ text: string }>).map((segment) => segment.text), ["Commentary is unavailable for this answer."]);
    assert.ok(!JSON.stringify(blocks).includes("roughly double"));
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

  await t.test("a retried turn computes again each call an earlier attempt published, as its figures left with that attempt", async () => {
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
    assert.deepEqual(await keysOf(turnId), [`turn:${turnId}:1`, `turn:${turnId}:2`]);
    const ANOTHER = { ...REVENUE, question: "AAA top line in fiscal 2023" };
    const retry = scripted([{ toolCalls: [call("certified_financials", REVENUE), call("certified_financials", INCOME_2023), call("certified_financials", ANOTHER)] }, { text: "DONE" }]);
    const done = completed(await run(agentOf(retry, '```assertions\n[]\n```', { planningModel: revenueModel(["AAA"]) }), { ...base, turnId, userIntent: "AAA revenue and income statement" }));
    assert.equal((await keysOf(turnId)).length, 5, "each published ask takes a new key, and the new ask one more");
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
    const done = completed(await run(agentOf(retry, OBSERVE_F1, { planningModel: planner }), { ...base, turnId, userIntent: "AAA revenue and what it sells" }));
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

  await t.test("an answer that cannot be written with no figures ends the turn with a fixed error", async () => {
    const agent = analystAgentRunner({
      financial: { pool, planningModel: null, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => scripted([{ toolCalls: [call("get_company_profile", { subject_ref: { kind: "issuer", id: A } })] }, { text: "DONE" }]),
      read: async (name) => ({ tool: name, status: "no_business_claims", truncated: false, reads: [readOf(A)], no_filing: [] }) as AnalystToolResult,
      compose: async () => {
        throw new LlmRouterError("all_deployments_failed", "relation chat_secret_table: every deployment failed", []);
      },
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const last = (await run(agent, { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" })).at(-1)!;
    assert.deepEqual([last.type, last.error_code, last.message], ["turn.error", "analyst_agent_failed", "The answer could not be completed."]);
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
    assert.ok(JSON.stringify((done.message as { blocks: unknown }).blocks).includes("No company matched ZZZ."));
  });

  await t.test("the planner gets what the turn's model calls leave after the loop's steps", async () => {
    const planner = revenueModel(["AAA"]);
    const asks = ["AAA revenue in fiscal 2023", "AAA sales in fiscal 2023", "AAA turnover in fiscal 2023"].map((question) => call("certified_financials", { ...REVENUE, question }));
    const router = scripted([{ toolCalls: asks }, { text: "DONE" }]);
    completed(await run(agentOf(router, OBSERVE_F1, { planningModel: planner }), { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    assert.equal(planner.calls, 2);
    const statuses = router.sent[1]!.messages.flatMap((message) => (message.role === "toolResult" ? [JSON.parse(message.content as string).status] : []));
    assert.deepEqual(statuses.sort(), ["declined", "published", "published"]);
  });

  const savedText = (done: Record<string, unknown>) => JSON.stringify((done.message as { blocks: unknown }).blocks);
  const profileOf = (...texts: string[]): AnalystAgentDeps["read"] => async (name) => ({
    tool: name, status: "ok", truncated: false, reads: [readOf(A)], no_filing: [], claims: texts.map((text) => filingClaim(randomUUID(), text)),
  }) as AnalystToolResult;
  const PROFILE = { subject_ref: { kind: "issuer", id: A } };

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

  await t.test("an amount in words over claims beside certified figures is not shown", async () => {
    const consensus: AnalystAgentDeps["read"] = async () => ({
      tool: "get_analyst_consensus", status: "ok", company: "AAA", captured_on: "2026-10-30",
      values: [{ capture_id: randomUUID(), source_id: IDS.sourceV1, provider: "Finviz", field_key: "target_price", label: "price target", raw_value: "250", unit: "usd_per_share", fiscal_period: null }],
    });
    const router = scripted([{ toolCalls: [call("get_analyst_consensus", PROFILE), call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
    const worded = "Analysts see it worth about two hundred and fifty dollars a share.";
    const agent = analystAgentRunner({
      financial: { pool, planningModel: null, evidence: createEvidenceFinancialPort, resolveMention },
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
      financial: { pool, planningModel: planner, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => router,
      read: async (name) => ({ tool: name, status: name === "get_analyst_consensus" ? "no_consensus" : "no_business_claims", truncated: false, reads: [readOf(A)], no_filing: [] }) as AnalystToolResult,
      compose: (input, turn, onAnswered, guard) => answerTurn(input, turn, {
        env: { ...LLM_ENV, JUDGE_LITELLM_MODEL: "openai/gpt-4.1" },
        createClient: () => async (_deployment, request) => {
          guard();
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
    assert.ok(savedText(done).includes("Reading stopped at its step limit, so part of the question may be unanswered."));
  });

  await t.test("a turn's reading ends at its deadline, and the figures it read are still shown", async () => {
    let calls = 0;
    const router = await analystAgentRouter(LLM_ENV, {
      createClient: () => async () => {
        calls += 1;
        if (calls === 1) return { text: "", toolCalls: [call("certified_financials", INCOME_2023)] };
        return new Promise<never>(() => {});
      },
    });
    const agent = analystAgentRunner({
      financial: { pool, planningModel: null, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => router,
      read: noRead,
      compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: OBSERVE_F1 }), onAnswered }),
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
      turnMs: 1_500,
    });
    const started = Date.now();
    const done = completed(await run(agent, { ...base, turnId: randomUUID(), userIntent: "AAA revenue" }));
    assert.ok(Date.now() - started < 20_000, "the hung step did not hold the turn");
    assert.ok(savedText(done).includes("Reading stopped at the turn's time limit, so part of the question may be unanswered."));
    assert.equal((done.message as { blocks: Array<{ kind: string }> }).blocks[0]!.kind, "financial_answer");
  });

  await t.test("a comparison naming a company still to be picked is left to the runner that asks, with a page's company or without", async () => {
    for (const [input, readQuestion] of [[{ userIntent: "Compare AAA and AMB revenue" }, undefined], [{ subjectText: "AAA", userIntent: "Compare revenue with AMB" }, comparing("AMB")]] as const) {
      const router = scripted([{ toolCalls: [call("certified_financials", INCOME_2023)] }, { text: "DONE" }]);
      const coordinator = createChatCoordinator({
        analystAgent: agentOf(router, OBSERVE_F1),
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
    }
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
      financial: { pool, planningModel: null, evidence: createEvidenceFinancialPort, resolveMention },
      router: async () => router,
      read,
      compose: (input, turn, onAnswered) => {
        rules.push([...(input.instructions ?? [])]);
        return answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: '```assertions\n[{"kind":"management_attribution","text":"It sells widgets.","evidence":["C1"]}]\n```' }), onAnswered });
      },
      asOf: () => new Date().toISOString(),
      logToolCalls: persist.logToolCalls,
    });
    const describe = completed(await run(recording(scripted([{ toolCalls: [call("get_company_profile", PROFILE)] }, { text: "DONE" }]), profileOf("We sell widgets.")), { ...base, turnId: randomUUID(), userIntent: "What does AAA sell?" }));
    completed(await run(recording(scripted([{ toolCalls: [call("get_company_profile", PROFILE), call("certified_financials", INCOME_2023)] }, { text: "DONE" }]), profileOf("We sell widgets.")), { ...base, turnId: randomUUID(), userIntent: "AAA revenue, and what it sells" }));
    assert.deepEqual(rules.map((given) => [given.some((rule) => rule.includes("write no analyst_inference")), given.some((rule) => rule.includes("the takeaway and the counterpoint"))]), [[true, false], [false, true]]);
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
    const rivals = completed(await run(agentOf(asking([call("get_peer_set", PROFILE)]), OBSERVE_F1, { read: reads }), { ...base, turnId: randomUUID(), userIntent: "Who does AAA compete with?" }));
    assert.ok(savedText(rivals).includes("AAA: no other company's 10-K on file names it as a competitor."));
  });

  await t.test("a turn the agent reads nothing for goes on to the next runner", async () => {
    const turnId = randomUUID();
    let next = 0;
    const coordinator = createChatCoordinator({
      analystAgent: agentOf(scripted([{ text: "DONE" }]), OBSERVE_F1),
      persistAssistantMessage: persist,
      runner: async (context) => {
        next += 1;
        context.emit("turn.completed", {});
      },
    });
    await coordinator.getOrCreateTurn({ ...base, runId: turnId, turnId, userIntent: "How has AAA's stock done this year?" }).completed;
    assert.equal(next, 1);
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
