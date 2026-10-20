import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, IDS, ORIGINAL_REVENUE } from "../../financial-engine/test/db-fixtures.ts";
import type { ChatAnalystToolRuntime } from "../src/coordinator.ts";
import { createChatFinancialRuntime, isFinancialRequest, SCOPE_METRICS } from "../src/financial-runtime.ts";
import { METRIC_CATALOG_V1, OPERATION_REGISTRY } from "../../financial-core/src/index.ts";
import { proposedMetric } from "../src/research-scope.ts";
import { parseProposal } from "../src/scope-proposal.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { chatDatabase, chatHarness, completed, INSTRUMENT_A, LISTING_A, resolveMention, revenueModel } from "./financial-fixtures.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";

test("financial intent is recognized from the definition catalog", () => {
  for (const text of ["Compare revenue for AAA and BBB", "What was AAA's gross margin?", "EPS for AAA", "net income trend"]) assert.ok(isFinancialRequest(text), text);
  for (const text of ["tell me about AAA", "what is the latest news", "who is the CEO"]) assert.ok(!isFinancialRequest(text), text);
});

test("an unready engine stops the server instead of leaving metric questions on legacy numbers", async () => {
  // A database missing every financial table: every readiness check reports absent.
  const unready = { query: async () => ({ rows: [{ kind: "relation", name: "financial_runs", present: false }] }), connect: async () => assert.fail("no turn runs") } as unknown as FinancialPool;
  const lane = createChatFinancialRuntime({ pool: unready, planningModel: null, resolveMention: async () => assert.fail("no turn runs"), evidence: createEvidenceFinancialPort });
  await assert.rejects(() => lane.assertReady(), /verified finance is not ready for chat: schema: relation financial_runs is missing/u);
});

test("chat financial lane", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-financial");
  const base = { threadId, userId: IDS.owner };

  await t.test("a comparison names in its answer a company that matches none, and calculates the rest, as the analyst path does", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]) }).run({ ...base, userIntent: "Compare revenue for AAA, BBB and ZZZ" });
    const [block, note] = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].blocks;
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
    assert.deepEqual(note.segments, [{ type: "text", text: "No company matched ZZZ." }]);
  });

  await t.test("a company without eligible data stays in the answer as an explicit gap", async () => {
    const model = revenueModel(["AAA", "BBB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
    const done = completed(events);
    assert.deepEqual(events.map((event) => event.type), ["turn.started", "snapshot.sealed", "block.began", "block.completed", "turn.completed"], "nothing but the start is streamed before commit");
    assert.equal(events[0]!.bundle_id, "financial_answer");
    const message = (await db.query(`select blocks, snapshot_id::text from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    const [block] = message.blocks;
    assert.equal(block.kind, "financial_answer");
    assert.equal(block.snapshot_id, message.snapshot_id);
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
    assert.equal(block.financial.coverage.state, "partial", "two companies were asked about; the answer covers both");
  });

  await t.test("a published answer saves its scope over the companies the plan requests; one that cannot be resolved saves none (#206)", async () => {
    // This lane runs before the analyst path resolves the turn's companies, so
    // the scope callback must be given the ones the message names.
    const seen: string[][] = [];
    const scopeOf = async (context: { subjectPreResolutions?: ReadonlyArray<{ subject_ref: { id: string } }> }) => {
      const ids = (context.subjectPreResolutions ?? []).map((subject) => subject.subject_ref.id);
      seen.push(ids);
      return {
        route: "comparison" as const,
        reads: "comparison" as const,
        companies: ids.map((issuer_id) => ({ issuer_id })),
        peers: false,
        segments: false,
        margin_trend: false,
        margins: false,
        metrics: [],
        fiscal_year: 2024,
        price_window: null,
        inherited: [],
      };
    };
    const savedScope = async (researchScope: NonNullable<Parameters<typeof chatHarness>[1]["researchScope"]>) => {
      const { events } = await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), researchScope }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
      return (await db.query(`select research_scope from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].research_scope;
    };
    const saved = await savedScope(scopeOf as never);
    assert.deepEqual(seen, [[IDS.issuerA, IDS.issuerB]]);
    assert.deepEqual(saved.companies, [{ issuer_id: IDS.issuerA }, { issuer_id: IDS.issuerB }]);
    // The scope only informs follow-ups; failing to resolve it never fails the answer.
    assert.equal(await savedScope(async () => { throw new Error("prior scope unavailable"); }), null);
  });

  await t.test("the answer names, beside its figures, what the reading of the question asks for and the plan does not compute", async () => {
    const readQuestion = async () => parseProposal(JSON.stringify({
      metrics: [{ metric: "ebitda" }, { metric: "income_statement" }],
      asks: ["benchmark"],
      turns_off: { facets: [], metrics: [] },
      income_items: ["revenue"],
    }));
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA", "BBB"]), readQuestion }).run({ ...base, userIntent: "Compare revenue and EBITDA for AAA and BBB against the S&P 500" });
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0];
    assert.deepEqual(message.blocks.map((block: { kind: string }) => block.kind), ["financial_answer", "rich_text"]);
    assert.deepEqual(message.blocks[1].segments, [{ type: "text", text: "Not covered by this answer: EBITDA; a comparison with a benchmark index." }]);
    assert.equal(message.blocks[1].snapshot_id, message.blocks[0].snapshot_id, "the note shares the answer's snapshot");
    assert.deepEqual(events.filter((event) => event.type === "block.completed").map((event) => event.block_id), message.blocks.map((block: { id: string }) => block.id));
  });

  await t.test("a metric question picks its companies as the analyst path does, and names the ones it carries", async () => {
    const carried = async (ticker: string) => ({ ...(await resolveMention(ticker)), handoff: { display_labels: { ticker } } }) as unknown as ChatResolvedSubjectPreResolution;
    const aaa = await carried("AAA");
    const bbb = await carried("BBB");
    const answer = async (userIntent: string, tickers: string[], prior = [aaa]) => {
      const { events } = await chatHarness(pool, { model: revenueModel(tickers), priorSubjects: async () => prior }).run({ ...base, userIntent });
      const [block, ...notes] = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(events).message_id])).rows[0].blocks;
      return {
        companies: Object.values(block.financial.labels as Record<string, { kind: string; text: string }>).filter((label) => label.kind === "subject").map((label) => label.text),
        notes: notes.map((note: { segments: Array<{ text: string }> }) => note.segments.map((segment) => segment.text).join("")),
      };
    };
    // An uppercase metric acronym is not a company.
    assert.deepEqual(await answer("What about its EBIT revenue?", ["AAA"]), { companies: ["Alpha Industries Inc."], notes: ["AAA is carried from the previous answer."] });
    assert.deepEqual(await answer("Compare its revenue with BBB", ["AAA", "BBB"]), { companies: ["Alpha Industries Inc.", "Beta Holdings Corp."], notes: ["AAA is carried from the previous answer."] });
    assert.deepEqual(await answer("Compare AAA and BBB revenue again", ["AAA", "BBB"]), { companies: ["Alpha Industries Inc.", "Beta Holdings Corp."], notes: [] }, "a company the question names is not carried");
    assert.deepEqual(await answer("Add BBB's revenue", ["AAA", "BBB"]), { companies: ["Alpha Industries Inc.", "Beta Holdings Corp."], notes: ["AAA is carried from the previous answer."] });
    assert.deepEqual(await answer("Drop BBB and show revenue", ["AAA"], [aaa, bbb]), { companies: ["Alpha Industries Inc."], notes: ["AAA is carried from the previous answer."] });
    const unclear = completed((await chatHarness(pool, { model: revenueModel([]), priorSubjects: async () => [aaa, bbb] }).run({ ...base, userIntent: "What about CCC's revenue?" })).events);
    assert.equal(unclear.clarification, true);
    assert.equal((unclear.financial_clarification as { question: string }).question, 'Add CCC to the AAA and BBB comparison, or look at CCC alone? Say "add CCC" or "just CCC".');
    const model = revenueModel([]);
    const none = completed((await chatHarness(pool, { model, priorSubjects: async () => [] }).run({ ...base, userIntent: "And what about its revenue?" })).events);
    assert.deepEqual(none.financial_gap, { reason_code: "no_company" });
    assert.equal(model.calls, 0, "nothing is planned for no company");
  });

  await t.test("a resolver that fails fails the turn, with nothing planned", async () => {
    const model = revenueModel(["AAA"]);
    const { events } = await chatHarness(pool, { model, resolveMention: async () => { throw new Error("resolver unavailable"); } }).run({ ...base, userIntent: "Revenue for AAA" });
    assert.deepEqual([events.at(-1)!.type, events.at(-1)!.error_code], ["turn.error", "financial_answer_failed"]);
    assert.equal(model.calls, 0);
  });

  await t.test("with one connection, the scope's reads never wait on the client the publication holds", { timeout: 60_000 }, async (st) => {
    const single = await connectedPool(st, databaseUrl(db), { max: 1 });
    const researchScope = async () => {
      await single.query("select 1");
      return null as never;
    };
    const { events } = await chatHarness(single, { model: revenueModel(["AAA"]), researchScope }).run({ ...base, userIntent: "Revenue for AAA" });
    assert.ok(completed(events).message_id);
  });

  await t.test("an explicit subject is planned first, alongside the companies the message names (#138)", async () => {
    const model = revenueModel(["AAA", "BBB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, subjectText: "AAA", userIntent: "Compare revenue with BBB" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    const [block] = message.blocks;
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
  });

  await t.test("an explicit subject with a non-comparative message plans that subject only", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA"]) }).run({ ...base, subjectText: "AAA", userIntent: "Revenue for BBB" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    assert.deepEqual(message.blocks[0].financial.results.map((result: { disposition: string }) => result.disposition), ["verified"]);
  });

  await t.test("an explicit subject and a mention of the same company are planned once", async () => {
    const model = revenueModel(["ALPHA", "BBB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, subjectText: "ALPHA", userIntent: "Compare revenue for AAA and BBB" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    assert.deepEqual(message.blocks[0].financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
  });

  await t.test("a ticker the resolver names as a listing is planned on its issuer's facts", async () => {
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock')`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York')`,
      [LISTING_A, INSTRUMENT_A],
    );
    const asListing = async (mention: string) => mention === "ALPX"
      ? { status: "resolved", subject_ref: { kind: "listing", id: LISTING_A }, display_label: "Alpha Industries Inc. (XNAS)" } as unknown as ChatSubjectPreResolution
      : resolveMention(mention);
    const { events } = await chatHarness(pool, { model: revenueModel(["ALPX"]), resolveMention: asListing }).run({ ...base, userIntent: "Revenue for ALPX" });
    const done = completed(events);
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    assert.deepEqual(
      message.blocks[0].financial.results.map((result: { disposition: string; presented: { value?: string } }) => [result.disposition, result.presented.value]),
      [["verified", ORIGINAL_REVENUE]],
    );

    const sameCompany = await chatHarness(pool, { model: revenueModel(["ALPHA"]), resolveMention: asListing }).run({ ...base, subjectText: "ALPHA", userIntent: "Compare revenue with ALPX" });
    const once = (await db.query(`select blocks from chat_messages where message_id = $1`, [completed(sameCompany.events).message_id])).rows[0];
    assert.ok(once, `expected a published answer; got ${JSON.stringify(completed(sameCompany.events))}`);
    assert.deepEqual(once.blocks[0].financial.results.map((result: { disposition: string }) => result.disposition), ["verified"], "the explicit issuer and its listing are planned once");
  });

  await t.test("a listing that no longer exists is asked about, not answered as a gap", async () => {
    const listing = { status: "resolved", subject_ref: { kind: "listing", id: randomUUID() }, display_label: "GONE (XNAS)", handoff: { display_labels: { ticker: "GONE" } } } as unknown as ChatSubjectPreResolution;
    const gone = async (mention: string) => mention === "GONE" ? listing : resolveMention(mention);
    const model = revenueModel(["GONE"]);
    const { events } = await chatHarness(pool, { model, resolveMention: gone }).run({ ...base, userIntent: "Revenue for GONE" });
    const done = completed(events);
    assert.equal(done.clarification, true);
    assert.match((done.financial_clarification as { question: string }).question, /"GONE" did not match a known company/u);
    assert.equal(model.calls, 0);
  });

  await t.test("a missing or failing planning model yields a gap, never the narrative composer", async () => {
    for (const model of [null, (async () => { throw new Error("provider down"); }) as PlanningModel]) {
      const { events } = await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
      assert.deepEqual(completed(events).financial_gap, { reason_code: "planning_unavailable" });
    }
  });

  await t.test("a calculation that fails verification is a gap, never the narrative composer", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["CCC"]) }).run({ ...base, userIntent: "Revenue for CCC" });
    assert.deepEqual(completed(events).financial_gap, { reason_code: "verification_failed" });
  });

  await t.test("narrative turns keep the analyst path", async () => {
    let analystCalls = 0;
    const analyst: ChatAnalystToolRuntime = () => {
      analystCalls += 1;
      return { snapshot_id: randomUUID(), blocks: [], verification: { ok: true } };
    };
    await chatHarness(pool, { model: revenueModel([]), analyst }).run({ ...base, userIntent: "tell me about AAA" });
    assert.equal(analystCalls, 1);
    const { events } = await chatHarness(pool, { model: revenueModel(["AAA"]), analyst }).run({ ...base, userIntent: "Revenue for AAA" });
    assert.equal(completed(events).bundle_id, "financial_answer");
    assert.equal(analystCalls, 1, "a metric question always reaches the engine, never the analyst");
  });

  await t.test("a retried turn settles the reading of its question while it holds the run's lease, never inside the publication", async () => {
    const thread = randomUUID();
    const turnId = randomUUID();
    // The thread is another user's, so the first attempt reserves the run and cannot publish.
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.other]);
    const input = { threadId: thread, userId: IDS.owner, turnId, userIntent: "Revenue for AAA" };
    await chatHarness(pool, { model: revenueModel(["AAA"]) }).run(input);
    const { rows: [reserved] } = await db.query<{ run_id: string }>(`select run_id::text as run_id from financial_runs where parent_id = $1`, [thread]);
    assert.ok(reserved, "the first attempt reserved a run");
    await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [thread, IDS.owner]);

    let release!: (reading: null) => void;
    let read = false;
    const retry = chatHarness(pool, {
      model: revenueModel(["AAA"]),
      readQuestion: () => {
        read = true;
        return new Promise<null>((resolve) => { release = resolve; });
      },
    }).run(input);
    // The retry holds the lease while the reading is out: it is past every
    // step but the drive.
    const leased = async () => (await db.query(
      `select 1 from financial_runs where run_id = $1::uuid and lease_owner is not null and lease_expires_at > now()`, [reserved.run_id],
    )).rows.length > 0;
    for (let waited = 0; !(read && await leased()); waited += 20) {
      assert.ok(waited < 30_000, "the retry never took the lease");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const probe = await pool.connect();
    try {
      await probe.query("begin");
      await probe.query(`select 1 from financial_runs where run_id = $1::uuid for update nowait`, [reserved.run_id]);
      await probe.query("rollback");
    } finally {
      probe.release();
      release(null);
    }
    assert.ok(completed((await retry).events).message_id, "the retry publishes once the reading settles");
  });

  await t.test("a retried turn resumes its reserved run and publishes one message", async () => {
    const turnId = randomUUID();
    const first = revenueModel(["AAA"]);
    const answered = completed((await chatHarness(pool, { model: first }).run({ ...base, turnId, userIntent: "Revenue for AAA" })).events);
    const second = revenueModel(["AAA"]);
    // A new coordinator stands in for a restarted process that never saw the first commit.
    const retried = completed((await chatHarness(pool, { model: second }).run({ ...base, turnId, userIntent: "Revenue for AAA" })).events);
    assert.equal(retried.message_id, answered.message_id);
    assert.equal(second.calls, 0, "the retry does not plan again");
    assert.equal((await db.query(`select count(*)::int as n from chat_messages where message_id = $1`, [answered.message_id])).rows[0].n, 1);
  });
});

test("every figure the engine names maps to the chat metric a follow-up reads, or none (#381)", () => {
  // These operations are of the figures they read; every other one is a figure.
  const ofFigures = new Set(["reported_metric", "absolute_change", "percent_change_positive_base", "ratio", "trailing_sum", "threshold", "peer_compare"]);
  const named = Object.keys(OPERATION_REGISTRY).filter((operation) => !ofFigures.has(operation));
  const engine = [...METRIC_CATALOG_V1.keys(), ...named].sort();
  assert.deepEqual(Object.keys(SCOPE_METRICS).sort(), engine);
  const unread = Object.values(SCOPE_METRICS).filter((key) => key !== null && proposedMetric(key, null, null)?.available !== true);
  assert.deepEqual(unread, []);
});
