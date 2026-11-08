// P/E scenarios in chat (#201): bear, base, and bull multiples stated for one
// company seal one unit with its diluted EPS beside each scenario value. A
// multiple that is missing, bad, or unlabelled declines the turn with nothing
// run; a follow-up that changes one multiple carries the others from the
// sealed plan of the answer before it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { FinancialPlan } from "../../financial-core/src/index.ts";
import { inspectCommittedResult } from "../../financial-engine/src/inspection.ts";
import { IDS, NVDA, seedValuedIssuer } from "../../financial-engine/test/db-fixtures.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { proposedMetric, resolveResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, NO_ASKS, resolveMention } from "./financial-fixtures.ts";

const SCEN = {
  issuer: "4f000000-0000-4000-8000-0000000008a1", listing: "4f000000-0000-4000-8000-0000000008e1",
  tenK: "4f000000-0000-4000-8000-0000000008c1", tenQ: "4f000000-0000-4000-8000-0000000008c2",
  ticker: "SCEN", name: "Scenario Holdings Inc.", close: "100.00", eps: "4.00", shares: "1000000",
} as const;
const LOSS = {
  issuer: "4f000000-0000-4000-8000-0000000008a2", listing: "4f000000-0000-4000-8000-0000000008e2",
  tenK: "4f000000-0000-4000-8000-0000000008c3", tenQ: "4f000000-0000-4000-8000-0000000008c4",
  ticker: "LOSS", name: "Loss Making Corp.", close: "10.00", eps: "-1.00", shares: "1000000",
} as const;

const resolved = (subject: typeof SCEN | typeof LOSS) =>
  ({ status: "resolved", subject_ref: { kind: "issuer", id: subject.issuer }, display_label: subject.name, handoff: { display_labels: { ticker: subject.ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
const resolveScenarios = (mention: string): Promise<ChatSubjectPreResolution> =>
  mention === "SCEN" ? Promise.resolve(resolved(SCEN)) : mention === "LOSS" ? Promise.resolve(resolved(LOSS)) : resolveMention(mention);

// The model's reading of a P/E question: it names the P/E ratio, which current-price routing would answer.
const peReading = (names: string[]) => async (): Promise<ScopeProposal> =>
  ({ ...NO_ASKS, metrics: [proposedMetric("pe_ratio", null, null)!], companies: { kind: "as_named", names } });

const DECLINED = "I can value P/E scenarios when you state one company and a P/E for each of bear, base and bull, for example “AAPL bear 20x, base 25x, bull 30x”, using reported diluted EPS for a fiscal year (FY2024, fiscal year 2024, or latest). Nothing was calculated.";

type Block = { kind: string; text?: string; financial?: { run_id: string; presentation_version: string; presentations: Array<{ kind: string; rows?: Array<{ scenario: string; multiple_text: string; attribution_text: string }> }>; labels: Record<string, { text: string }>; results: Array<{ result_id: string; measure_label_id: string; period_label_id: string; disposition: string; presented: { kind: string; value?: string; text?: string; reason_code?: string } }> } };

test("P/E scenarios in chat", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat scenario coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-eps-scenarios");
  await seedValuedIssuer(db, SCEN);
  await seedValuedIssuer(db, LOSS);
  const runs = async () => Number((await db.query<{ n: string }>(`select count(*) as n from financial_runs`)).rows[0]!.n);
  const turn = async (userIntent: string, options: { thread?: string; names?: string[]; prior?: ChatResolvedSubjectPreResolution[]; scoped?: typeof SCEN | typeof LOSS } = {}) => {
    const harness = chatHarness(pool, {
      model: null,
      resolveMention: resolveScenarios,
      readQuestion: peReading(options.names ?? ["SCEN"]),
      clock: () => new Date(NVDA.cutoff),
      ...(options.prior ? { priorSubjects: async () => options.prior! } : {}),
      ...(options.scoped ? {
        researchScope: async (_context, read) => resolveResearchScope({
          companies: [{ issuer_id: options.scoped!.issuer, label: options.scoped!.ticker }], prior: null, asOf: NVDA.cutoff, proposal: await read,
        }),
      } : {}),
    });
    const { events, turnId } = await harness.run({ threadId: options.thread ?? threadId, userId: IDS.owner, userIntent });
    return { done: completed(events), turnId, persisted: harness.persisted };
  };
  const answer = async (userIntent: string, options: Parameters<typeof turn>[1] = {}) => {
    const { done, turnId } = await turn(userIntent, options);
    const read = await listChatMessagesForThread(pool, { thread_id: options.thread ?? threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === done.message_id);
    assert.ok(message, JSON.stringify(done));
    const [block, ...rest] = message.blocks as unknown as Block[];
    const { financial } = block!;
    assert.ok(financial, JSON.stringify(block));
    const plan = (await db.query<{ plan: FinancialPlan }>(`select p.plan from financial_runs r join financial_plans p on p.plan_id = r.plan_id where r.run_id = $1`, [financial.run_id])).rows[0]!.plan;
    return {
      turnId,
      snapshotId: message.snapshot_id,
      plan,
      financial,
      rows: financial.results.map((result) => [financial.labels[result.measure_label_id]!.text, financial.labels[result.period_label_id]!.text, result.disposition, result.presented.value ?? result.presented.reason_code]),
      note: rest.find((entry) => entry.kind === "rich_text" || entry.kind === "note") as unknown,
    };
  };
  // Each in a thread of its own, so no multiple is carried from an earlier answer.
  const newThread = async () => {
    const thread = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.owner]);
    return thread;
  };
  const declined = async (userIntent: string, options: Parameters<typeof turn>[1] = {}) => {
    const thread = await newThread();
    const before = await runs();
    const { done, persisted } = await turn(userIntent, { thread, ...options });
    assert.equal(await runs(), before, `${userIntent}: no run is created`);
    return { gap: done.financial_gap, text: JSON.stringify(persisted.at(-1)) };
  };

  let first: Awaited<ReturnType<typeof answer>>;
  await t.test("EPS of 4 at 20x, 25x, and 30x seals 80, 100, and 120 per share in one unit beside the EPS", async () => {
    first = await answer("SCEN bear 20x, base 25x, bull 30x");
    assert.deepEqual(first.rows, [
      ["EPS (diluted)", "FY2024 (ended 2024-01-28)", "verified", "4"],
      ["Bear scenario: diluted EPS × your 20x P/E", "FY2024 (ended 2024-01-28)", "verified", "80"],
      ["Base scenario: diluted EPS × your 25x P/E", "FY2024 (ended 2024-01-28)", "verified", "100"],
      ["Bull scenario: diluted EPS × your 30x P/E", "FY2024 (ended 2024-01-28)", "verified", "120"],
    ]);
    assert.equal(first.financial.presentation_version, "financial-presentation.v3");
    assert.deepEqual(first.financial.presentations.map((presentation) => [presentation.kind, presentation.rows?.map((row) => [row.scenario, row.multiple_text])]), [
      ["scenarios", [["bear", "20x"], ["base", "25x"], ["bull", "30x"]]],
    ]);
    assert.match(JSON.stringify(first.note), /The latest fiscal year's diluted EPS is used\./u);
    assert.doesNotMatch(JSON.stringify(first.note), /P\/E ratio/u, "the P/E the question names is the scenarios' own");
  });

  await t.test("a follow-up changing only base seals a new snapshot that carries bear and bull at the fiscal year turn 1 bound", async () => {
    const second = await answer("what if base were 22x?", { names: [], prior: [resolved(SCEN)] });
    assert.notEqual(second.snapshotId, first.snapshotId);
    assert.deepEqual(second.rows.map((row) => row[3]), ["4", "80", "88", "120"]);
    assert.deepEqual(second.plan.operations.find((node) => node.node_id === "eps")!.operation === "reported_metric" && (second.plan.operations.find((node) => node.node_id === "eps") as { period: unknown }).period,
      { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" });
    const firstRef = `chat:${threadId}:${first.turnId}`;
    assert.deepEqual(second.plan.assumptions!.map((assumption) => [assumption.scenario, assumption.value, assumption.attribution.ref]), [
      ["bear", "20", firstRef], ["base", "22", `chat:${threadId}:${second.turnId}`], ["bull", "30", firstRef],
    ]);
    assert.match(JSON.stringify(second.note), /Bear and bull P\/E are carried from the previous answer\./u);
    const rows = second.financial.presentations[0]!.rows!;
    assert.deepEqual(rows.map((row) => row.attribution_text.startsWith("Your assumption in an earlier request")), [true, false, true]);

    const original = await inspectCommittedResult(db, IDS.owner, first.financial.results[2]!.result_id);
    assert.ok(original?.availability === "available" && original.schema_version === "financial_result_inspection.v2");
    assert.deepEqual(original.assumptions.map((assumption) => [assumption.scenario, assumption.value]), [["base", "25"]], "turn 1's answer is still inspectable as it was");
  });

  await t.test("a bare one-label follow-up for the same company changes that scenario and carries the rest", async () => {
    const third = await answer("make bull 35", { names: [], prior: [resolved(SCEN)] });
    assert.deepEqual(third.rows.map((row) => row[3]), ["4", "80", "88", "140"]);
  });

  await t.test("a question about one scenario is ordinary, even right after a scenario answer", async () => {
    const after = await newThread();
    await answer("SCEN bear 20x, base 25x, bull 30x", { thread: after });
    const asks: Array<[string, Parameters<typeof turn>[1]]> = [["Is the bull 30x too aggressive?", { thread: after, names: [], prior: [resolved(SCEN)] }], ["Is a base 25x P/E too high for SCEN?", { thread: await newThread() }]];
    for (const [ask, options] of asks) {
      const read = await answer(ask, options);
      assert.deepEqual([read.plan.schema_version, read.rows[0]!.slice(0, 2)], ["financial_plan.v1", ["P/E ratio (share price / latest fiscal year diluted EPS)", "latest known at the cutoff"]], ask);
    }
  });

  await t.test("one stated label with no scenario before it for the company is declined, never the current P/E", async () => {
    const after = await newThread();
    await answer("SCEN bear 20x, base 25x, bull 30x", { thread: after });
    const asks: Array<[string, Parameters<typeof turn>[1]]> = [
      ["SCEN bull 35x", {}], ["SCEN bull case is 50x earnings", {}], ["what's the value if bull is 40x?", { names: [] }], ["LOSS bull 30x", { thread: after, names: ["LOSS"] }],
    ];
    for (const [ask, options] of asks) {
      const { gap, text } = await declined(ask, options);
      assert.deepEqual(gap, { reason_code: "unsupported" }, ask);
      assert.ok(text.includes(DECLINED), `${ask}: ${text}`);
    }
  });

  await t.test("an unlabelled list after an answer declines the turn instead of carrying the answer's multiples", async () => {
    const { gap, text } = await declined("SCEN P/E 21/26/31", { thread: threadId });
    assert.deepEqual(gap, { reason_code: "unsupported" });
    assert.ok(text.includes(DECLINED), text);
  });

  await t.test("a scenario follow-up whose company the scope drops is declined, never sent to the analyst", async () => {
    const thread = await newThread();
    await answer("SCEN bear 20x, base 25x, bull 30x", { thread });
    const { gap, text } = await declined("what if base were 22x?", { thread, names: [], prior: [resolved(SCEN)], scoped: LOSS });
    assert.deepEqual(gap, { reason_code: "unsupported" });
    assert.ok(text.includes(DECLINED), text);
  });

  await t.test("a missing, bad, or unlabelled multiple declines the turn with nothing run, and P/E never routes to the current price", async () => {
    for (const ask of ["SCEN bear 20x, base 25x", "SCEN bear 0x, base 25x, bull 30x", "SCEN bear -20x, base 25x, bull 30x", "SCEN P/E 20/25/30"]) {
      const { gap, text } = await declined(ask);
      assert.deepEqual(gap, { reason_code: "unsupported" }, ask);
      assert.ok(text.includes(DECLINED), `${ask}: ${text}`);
    }
  });

  await t.test("two companies, or none, are declined too", async () => {
    const two = await declined("SCEN and LOSS bear 20x, base 25x, bull 30x", { names: ["SCEN", "LOSS"] });
    assert.ok(two.text.includes(DECLINED), two.text);
    const none = await declined("bear 20x, base 25x, bull 30x", { names: [] });
    assert.ok(none.text.includes(DECLINED), none.text);
  });

  await t.test("zero or negative EPS is unsuitable for the P/E model, and a company with no EPS gets a named gap and no value", async () => {
    const loss = await answer("LOSS bear 20x, base 25x, bull 30x", { names: ["LOSS"] });
    assert.deepEqual(loss.rows.map((row) => [row[2], row[3]]), [["verified", "-1"], ["not_applicable", "non_positive_base"], ["not_applicable", "non_positive_base"], ["not_applicable", "non_positive_base"]]);
    const missing = await answer("AAA bear 20x, base 25x, bull 30x", { names: ["AAA"] });
    assert.deepEqual(missing.rows.map((row) => row[2]), ["missing", "blocked_dependency", "blocked_dependency", "blocked_dependency"]);
    assert.ok(missing.financial.results.every((result) => result.presented.value === undefined), "no value is shown");
  });

  await t.test("a scenario that asks for the latest fiscal year is not noted as naming none", async () => {
    const latest = await answer("SCEN latest EPS: bear 20x, base 25x, bull 30x", { thread: await newThread() });
    assert.deepEqual(latest.rows.map((row) => row[3]), ["4", "80", "100", "120"]);
    assert.match(JSON.stringify(latest.note), /The latest fiscal year's diluted EPS is used\./u);
    assert.doesNotMatch(JSON.stringify(latest.note), /No fiscal year was named/u);
  });
});
