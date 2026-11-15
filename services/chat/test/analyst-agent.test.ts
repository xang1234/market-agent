import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, IDS } from "../../financial-engine/test/db-fixtures.ts";
import type { ControlledRouter, LlmChatRequest, LlmExecutionControls, LlmToolCall } from "../../llm/src/router.ts";
import { analystAgentRouter, analystAgentRunner, certifiedAsk, perStepDeadlines, statusNote, type AnalystAgentDeps } from "../src/analyst-agent.ts";
import type { AnalystToolResult } from "../src/analyst-tools.ts";
import { answerTurn } from "../src/answer-trace.ts";
import { createChatCoordinator, type ChatAssistantMessagePersistence, type ChatTurnInput } from "../src/coordinator.ts";
import { mergePackets, type EvidencePacket, type PacketClaim } from "../src/evidence-packet.ts";
import { ENGINE_READS_BY_CATALOG_METRIC } from "../src/scope-figures.ts";
import { loadToolRegistry } from "../../tools/src/registry.ts";
import { chatDatabase, resolveMention, revenueModel } from "./financial-fixtures.ts";

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
  assert.deepEqual(packet.gaps, ["AAA: no analyst consensus captured in the 7 days to the cutoff is on file.", "BBB has no 10-K on file, so no business or risk factor claims from one"]);
  assert.deepEqual([packet.route, packet.companies, packet.claims_truncated, packet.claims_status, packet.periods_shown], ["financial_engine", ["AAA"], true, "available", true]);
});

test("a read that could not be made marks the packet's claims unavailable, and its note says nothing is known of them", () => {
  const unavailable: AnalystToolResult = { tool: "get_claims", status: "unavailable", reason: "the read failed" };
  const packet = mergePackets({ engine: [], analyst: [unavailable], notes: [], labels: new Map(), cutoff: "2026-11-01T00:00:00.000Z" });
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
});

// The turn's completion; a failure names the error the turn ended on.
function completed(events: ReadonlyArray<{ type: string } & Record<string, unknown>>) {
  const last = events.at(-1)!;
  assert.equal(last.type, "turn.completed", JSON.stringify(last));
  return last;
}

type Step = { text?: string; toolCalls?: LlmToolCall[] };

// A router that answers each step from its script, and records what each step was sent.
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

test("the analyst agent", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker is not available");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-agent");
  const persist = await savingMessages(t, databaseUrl(db));
  const base = { threadId, userId: IDS.owner };

  const agentOf = (router: ControlledRouter, answer: string, options: { planningModel?: PlanningModel | null; read?: AnalystAgentDeps["read"]; logged?: boolean } = {}) => analystAgentRunner({
    financial: { pool, planningModel: options.planningModel ?? null, evidence: createEvidenceFinancialPort, resolveMention },
    router: async () => router,
    read: options.read ?? noRead,
    compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: answer }), onAnswered }),
    asOf: () => new Date().toISOString(),
    ...(options.logged === false ? {} : { logToolCalls: persist.logToolCalls }),
  });
  const run = async (agent: ReturnType<typeof agentOf>, input: Omit<ChatTurnInput, "runId"> & { turnId: string }, during?: (stop: () => void) => void) => {
    const coordinator = createChatCoordinator({ analystAgent: agent, persistAssistantMessage: persist, runner: () => assert.fail("the agent takes the turn") });
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

  await t.test("a retried turn keeps each ask's key, and shows a call an earlier attempt published as a typed gap", async () => {
    const turnId = randomUUID();
    // The first attempt publishes both runs and is stopped before its save.
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
    const keys = await keysOf(turnId);
    assert.deepEqual(keys, [`turn:${turnId}:1`, `turn:${turnId}:2`]);
    // The retry asks them in the other order, and asks one more.
    const ANOTHER = { ...REVENUE, question: "AAA top line in fiscal 2023" };
    const retry = scripted([{ toolCalls: [call("certified_financials", REVENUE), call("certified_financials", INCOME_2023), call("certified_financials", ANOTHER)] }, { text: "DONE" }]);
    const planner = revenueModel(["AAA"]);
    const done = completed(await run(agentOf(retry, '```assertions\n[]\n```', { planningModel: planner }), { ...base, turnId, userIntent: "AAA revenue and income statement" }));
    assert.equal(planner.calls, 1, "a reused key resumes its plan; only the new ask plans");
    assert.deepEqual(await keysOf(turnId), [`turn:${turnId}:1`, `turn:${turnId}:2`, `turn:${turnId}:3`], "the new ask takes a new key");
    const blocks = (done.message as { blocks: Array<Record<string, unknown>> }).blocks;
    assert.deepEqual(blocks.filter((block) => block.kind === "financial_answer").length, 1, "only the new ask's figures are shown");
    const note = blocks.find((block) => block.kind === "rich_text" && JSON.stringify(block.segments).includes("earlier attempt"));
    assert.ok(note, "the published calls read as a typed gap");
    const contents = retry.sent[1]!.messages.flatMap((message) => (message.role === "toolResult" ? [JSON.parse(message.content).status] : []));
    assert.deepEqual(contents, ["existing", "existing", "published"]);
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

// The chat server's own seal and save (local-runtime.ts) on this database.
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
