// A P/E scenario answer compared with a stored close in chat (#224): the
// follow-up seals one source-linked comparison block of the answer before it,
// a retry returns that block, and every other ask is declined or a named gap.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS, NVDA, seedValuedIssuer } from "../../financial-engine/test/db-fixtures.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { loadPriorSubjects } from "../src/thread-context.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { priorScenario } from "../src/eps-scenarios.ts";
import { COMPARISON_DECLINES, publishScenarioPriceComparison } from "../src/scenario-price-comparison.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, NO_ASKS, resolveMention } from "./financial-fixtures.ts";
import { readMessage } from "./read-message-fixture.ts";

const PXC = {
  issuer: "4f000000-0000-4000-8000-000000000aa1", listing: "4f000000-0000-4000-8000-000000000ae1",
  tenK: "4f000000-0000-4000-8000-000000000ac1", tenQ: "4f000000-0000-4000-8000-000000000ac2",
  ticker: "PXC", name: "Price Compare Corp.", close: "100.00", eps: "4.00", shares: "1000000",
} as const;

const resolvePxc = (mention: string): Promise<ChatSubjectPreResolution> =>
  mention === "PXC"
    ? Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id: PXC.issuer }, display_label: PXC.name, handoff: { display_labels: { ticker: PXC.ticker } } } as unknown as ChatResolvedSubjectPreResolution)
    : resolveMention(mention);

type ComparisonBlock = { id: string; kind: string; snapshot_id: string; comparison: { outcome: { kind: string; reason?: string; price?: { heading: string }; rows?: Array<{ scenario: string; percent: { text: string } }> } } };

test("scenario price comparisons in chat", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat comparison coverage");
    return;
  }
  const { db, pool } = await chatDatabase(t, "chat-price-comparison");
  await seedValuedIssuer(db, PXC);
  const harness = chatHarness(pool, {
    model: null,
    resolveMention: resolvePxc,
    readQuestion: async () => ({ ...NO_ASKS, companies: { kind: "as_named", names: [] } }),
    clock: () => new Date(NVDA.cutoff),
    // The thread's own companies, as a deployment reads them.
    priorSubjects: (threadId) => loadPriorSubjects(pool, { threadId }),
    // A decline or gap is a message of the thread, as a deployment saves it.
    persistAssistantMessage: async (message) => {
      const messageId = message.message_id ?? randomUUID();
      const snapshotId = (message.blocks as Array<{ snapshot_id: string }>)[0]!.snapshot_id;
      await pool.query(
        `insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms) values ($1, '[]', now(), 'unadjusted', 'raw', '{}')`,
        [snapshotId],
      );
      await pool.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1, $2, 'assistant', $3, $4::jsonb, $5) on conflict (message_id) do nothing`,
        [messageId, message.threadId, snapshotId, JSON.stringify(message.blocks), message.content_hash],
      );
      return readMessage({ snapshot_id: snapshotId, message_id: messageId, thread_id: message.threadId });
    },
  });
  const newThread = async () => {
    const thread = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, IDS.owner]);
    return thread;
  };
  const say = async (threadId: string, userIntent: string, turnId?: string) => {
    const { events, turnId: id } = await harness.run({ threadId, userId: IDS.owner, userIntent, ...(turnId ? { turnId } : {}) });
    return { done: completed(events), turnId: id };
  };
  const read = async (threadId: string, messageId: unknown) =>
    (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages.find((message) => message.message_id === messageId)!;
  const afterScenario = async (ask: string) => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const turn = await say(thread, ask);
    return { thread, ...turn };
  };
  const snapshots = async () => Number((await db.query<{ n: string }>(`select count(*) as n from snapshots`)).rows[0]!.n);

  await t.test("“compare with the price” after a scenario seals -20.00%, 0.00% and +20.00% against the latest stored close, labelled source-linked", async () => {
    const { thread, done } = await afterScenario("compare with the price");
    const message = await read(thread, done.message_id);
    const [block] = message.blocks as unknown as ComparisonBlock[];
    assert.equal(block!.kind, "scenario_price_comparison");
    assert.equal(block!.comparison.outcome.price!.heading, "Latest stored completed close: 2024-06-07");
    assert.deepEqual(block!.comparison.outcome.rows!.map((row) => [row.scenario, row.percent.text]), [["bear", "-20.00%"], ["base", "0.00%"], ["bull", "+20.00%"]]);
    assert.deepEqual(message.block_proofs[block!.id], { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown", scenario_calculation: "verified" });
    assert.equal(done.financial, undefined, "no financial run answers it");
  });

  await t.test("a comparison asked right after a comparison compares the same sealed scenario", async () => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const first = await say(thread, "compare with the price");
    const second = await say(thread, "compare with the price as of 2024-06-07");
    const [one, two] = [await read(thread, first.done.message_id), await read(thread, second.done.message_id)];
    const scenarioOf = (message: typeof one) => (message.blocks as unknown as Array<{ comparison: { scenario: { snapshot_id: string } } }>)[0]!.comparison.scenario.snapshot_id;
    assert.equal(scenarioOf(two), scenarioOf(one));
    assert.equal((two.blocks as unknown as ComparisonBlock[])[0]!.comparison.outcome.price!.heading, "Stored completed close: 2024-06-07");
  });

  await t.test("the ask a decline suggests works right after that decline", async () => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const declined = await say(thread, "compare with the price target");
    assert.deepEqual(declined.done.financial_gap, { reason_code: "unsupported" });
    const { done } = await say(thread, "compare with the price");
    const [block] = (await read(thread, done.message_id)).blocks as unknown as ComparisonBlock[];
    assert.deepEqual(block!.comparison.outcome.rows!.map((row) => row.percent.text), ["-20.00%", "0.00%", "+20.00%"]);
  });

  await t.test("“make bull 35” right after a comparison carries bear and base from the scenario it compared", async () => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    await say(thread, "compare with the price");
    const { done } = await say(thread, "make bull 35");
    const [block] = (await read(thread, done.message_id)).blocks as unknown as Array<{ kind: string; financial?: { results: Array<{ presented: { value?: string } }> } }>;
    assert.equal(block!.kind, "financial_answer", JSON.stringify(block));
    assert.deepEqual(block!.financial!.results.map((result) => result.presented.value), ["4", "80", "100", "140"]);
  });

  await t.test("any other message after the scenario answer, one with no text segment first included, leaves no scenario to continue", async () => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    assert.notEqual(await priorScenario(pool, thread, IDS.owner), null);
    const snapshotId = randomUUID();
    await db.query(`insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms) values ($1, '[]', now(), 'unadjusted', 'raw', '{}')`, [snapshotId]);
    await db.query(
      `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash) values ($1, 'assistant', $2, $3::jsonb, $4)`,
      [thread, snapshotId, JSON.stringify([{ id: "b", kind: "rich_text", snapshot_id: snapshotId, segments: [] }]), "0".repeat(64)],
    );
    assert.equal(await priorScenario(pool, thread, IDS.owner), null);
  });

  await t.test("a retry of the comparison turn returns the message it saved, sealing nothing new", async () => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const first = await say(thread, "compare with the price");
    const before = await snapshots();
    const again = await say(thread, "compare with the price", first.turnId);
    assert.equal(again.done.message_id, first.done.message_id);
    assert.equal(await snapshots(), before);
    assert.equal((await read(thread, again.done.message_id)).snapshot_id, (await read(thread, first.done.message_id)).snapshot_id);
  });

  await t.test("an explicit date compares that session's close; one before the EPS was public, or after the question, is a named gap", async () => {
    const dated = await afterScenario("compare with the price as of 2024-06-07");
    assert.equal(((await read(dated.thread, dated.done.message_id)).blocks as unknown as ComparisonBlock[])[0]!.comparison.outcome.price!.heading, "Stored completed close: 2024-06-07");
    for (const [ask, reason] of [
      ["compare with the price as of 2024-02-20", "scenario_not_public_at_cutoff"],
      ["compare with the price as of 2024-06-11", "requested_time_after_question"],
      ["compare with the price as of 2024-06-07T15:00:00-04:00", "price_coverage_missing"],
    ] as const) {
      const { thread, done } = await afterScenario(ask);
      const message = await read(thread, done.message_id);
      const [block] = message.blocks as unknown as ComparisonBlock[];
      assert.deepEqual([block!.kind, block!.comparison.outcome.kind, block!.comparison.outcome.reason], ["scenario_price_comparison", "gap", reason], ask);
      assert.equal(message.block_proofs[block!.id]!.evidence, "unknown", `${ask}: a gap claims nothing`);
    }
  });

  await t.test("a question that compares prices but does not start as the sentence does is routed as any other after a scenario answer", async () => {
    for (const ask of ["How did NVDA's price compare with AMD's this year?", "compare NVDA vs AMD price performance", "AAPL vs MSFT price since January"]) {
      const thread = await newThread();
      await say(thread, "PXC bear 20x, base 25x, bull 30x");
      // With no model the ordinary route has nothing to answer with; all that matters is that this one never takes it.
      const saved = harness.persisted.length;
      const { events } = await harness.run({ threadId: thread, userId: IDS.owner, userIntent: ask });
      const shown = JSON.stringify([events, harness.persisted.slice(saved)]);
      assert.ok(!shown.includes("comparison_gap") && !shown.includes("scenario_price_comparison"), `${ask}: ${shown.slice(0, 2000)}`);
      assert.equal(events.at(-1)!.type === "turn.completed" ? events.at(-1)!.financial_gap : undefined, undefined, ask);
    }
  });

  // What is left of a comparison: its message, its snapshot, and its binding.
  const comparisonLeft = async (messageId: unknown, snapshotId: string | null) => (await db.query(
    `select 'message' from chat_messages where message_id = $1 union all select 'snapshot' from snapshots where snapshot_id = $2
     union all select 'binding' from scenario_price_comparisons where snapshot_id = $2`,
    [messageId, snapshotId],
  )).rows;

  await t.test("the owner's erasure of the scenario's run or of their account, or deleting the thread, erases its comparisons, their snapshots and bindings", async () => {
    for (const erase of ["run", "thread", "user"] as const) {
      const user = erase === "user" ? randomUUID() : IDS.owner;
      if (erase === "user") await db.query(`insert into users (user_id, email) values ($1, $2)`, [user, `${user}@example.test`]);
      const thread = randomUUID();
      await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [thread, user]);
      const scenario = completed((await harness.run({ threadId: thread, userId: user, userIntent: "PXC bear 20x, base 25x, bull 30x" })).events);
      const done = completed((await harness.run({ threadId: thread, userId: user, userIntent: "compare with the price" })).events);
      const messages = (await listChatMessagesForThread(pool, { thread_id: thread, user_id: user }))!.messages;
      const comparison = messages.find((message) => message.message_id === done.message_id)!;
      assert.equal((comparison.blocks as unknown as ComparisonBlock[])[0]!.comparison.outcome.kind, "comparison", erase);
      const runId = (messages.find((message) => message.message_id === scenario.message_id)!.blocks as unknown as Array<{ financial: { run_id: string } }>)[0]!.financial.run_id;
      if (erase === "run") await db.query(`delete from financial_runs where run_id = $1`, [runId]);
      else if (erase === "thread") await db.query(`delete from chat_threads where thread_id = $1`, [thread]);
      else await db.query(`delete from users where user_id = $1`, [user]);
      assert.deepEqual(await comparisonLeft(done.message_id, comparison.snapshot_id), [], erase);
    }
  });

  const lastSaved = () => (harness.persisted.at(-1)!.blocks as unknown as Array<{ kind: string; comparison_gap?: string; segments: Array<{ text: string }> }>)[0]!;

  await t.test("an ask outside the sentence after a scenario, or the sentence with no scenario before it, is declined for its reason, marked a comparison decline, with nothing sealed", async () => {
    const comparisons = async () => Number((await db.query<{ n: string }>(`select count(*) as n from scenario_price_comparisons`)).rows[0]!.n);
    const before = await comparisons();
    for (const [ask, reason] of [
      ["compare with the price target", "advice"],
      ["compare with the price in EUR", "currency"],
      ["compare with the price as of 2024-06-07T16:00:00", "form"],
      ["compare them to the current price", "form"],
    ] as const) {
      const { done } = await afterScenario(ask);
      assert.deepEqual(done.financial_gap, { reason_code: "unsupported" }, ask);
      assert.deepEqual([lastSaved().comparison_gap, lastSaved().segments[0]!.text], ["declined", COMPARISON_DECLINES[reason]], ask);
    }
    const { done } = await say(await newThread(), "compare with the price");
    assert.deepEqual(done.financial_gap, { reason_code: "unsupported" });
    assert.deepEqual([lastSaved().comparison_gap, lastSaved().segments[0]!.text], ["declined", COMPARISON_DECLINES.no_scenario]);
    assert.equal(await comparisons(), before, "a decline seals no comparison");
  });

  await t.test("a stored comparison decline is looked past by its mark, whatever its words", async () => {
    const thread = await newThread();
    await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const snapshotId = randomUUID();
    await db.query(`insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms) values ($1, '[]', now(), 'unadjusted', 'raw', '{}')`, [snapshotId]);
    await db.query(
      `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash) values ($1, 'assistant', $2, $3::jsonb, $4)`,
      [thread, snapshotId, JSON.stringify([{ id: "b", kind: "rich_text", snapshot_id: snapshotId, comparison_gap: "declined", segments: [{ type: "text", text: "Worded as an older release worded it." }] }]), "0".repeat(64)],
    );
    assert.notEqual(await priorScenario(pool, thread, IDS.owner), null);
  });

  // A pool whose clients run `before` ahead of each statement: what another connection commits meanwhile.
  const racing = (before: (text: string) => Promise<void>) => ({
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          await before(text);
          return client.query(text, values);
        },
        release: (error?: Error) => client.release(error),
        on: client.on.bind(client),
        off: client.off.bind(client),
      };
    },
  }) as unknown as FinancialPool;
  const comparisonTurn = async () => {
    const thread = await newThread();
    const scenario = await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const scenarioSnapshot = (await read(thread, scenario.done.message_id)).snapshot_id!;
    return {
      thread, scenarioSnapshot,
      turn: { thread_id: thread, user_id: IDS.owner, message_id: randomUUID(), scenario_snapshot_id: scenarioSnapshot, requested: { kind: "latest" } as const, received_at: NVDA.cutoff },
    };
  };
  const savedComparisons = async (thread: string, scenarioSnapshot: string) => (await db.query<{ messages: string[]; bindings: number }>(
    `select array(select message_id::text from chat_messages where thread_id = $1 and blocks->0->>'kind' = 'scenario_price_comparison') as messages,
            (select count(*)::int from scenario_price_comparisons where scenario_snapshot_id = $2) as bindings`,
    [thread, scenarioSnapshot],
  )).rows[0]!;

  await t.test("a close committed between the comparison's generation and its seal's regeneration changes neither: both read one snapshot", async () => {
    const { turn } = await comparisonTurn();
    let certificateReads = 0;
    try {
      const outcome = await publishScenarioPriceComparison(racing(async (text) => {
        // The seal's regeneration starts with this read, once generation is done.
        if (text.includes("c.result_ids, p.plan") && ++certificateReads === 2) {
          await db.query(
            `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
             values ($1, $2, 'session_close', '150.00', 'USD', '2024-06-07T20:30:00Z', '2024-06-07T20:40:00Z', '2024-06-07T20:40:00Z', $3)`,
            [PXC.listing, POLYGON_MARKET_SOURCE_ID, "c".repeat(64)],
          );
        }
      }), turn);
      assert.equal(certificateReads, 2, "generated, then generated again by the seal");
      assert.deepEqual(outcome.kind, "saved");
    } finally {
      // Price rows are append-only; the test's own close goes, so no later comparison of PXC reads it.
      await db.query("begin");
      await db.query("set local session_replication_role = replica");
      await db.query(`delete from price_observations where listing_id = $1 and price_text = '150.00'`, [PXC.listing]);
      await db.query("commit");
    }
  });

  await t.test("a thread update committed after the comparison's transaction began fails that attempt, and the retry saves the one message", async () => {
    const { thread, scenarioSnapshot, turn } = await comparisonTurn();
    const warned = t.mock.method(console, "warn", () => {});
    let renamed = false;
    const outcome = await publishScenarioPriceComparison(racing(async (text) => {
      if (!renamed && text.includes("update chat_threads set latest_snapshot_id")) {
        renamed = true;
        await db.query(`update chat_threads set title = 'Renamed meanwhile' where thread_id = $1`, [thread]);
      }
    }), turn);
    assert.ok(renamed);
    assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [["[chat] price comparison publish attempt 1 of 3 failed with SQLSTATE 40001; retrying"]]);
    assert.deepEqual(outcome, { kind: "saved", message_id: turn.message_id });
    assert.deepEqual(await savedComparisons(thread, scenarioSnapshot), { messages: [turn.message_id], bindings: 1 });
  });

  await t.test("another attempt of the turn that saves its message first leaves this one saved, with one message", async () => {
    const { thread, scenarioSnapshot, turn } = await comparisonTurn();
    let concurrent: Awaited<ReturnType<typeof publishScenarioPriceComparison>> | null = null;
    const outcome = await publishScenarioPriceComparison(racing(async (text) => {
      if (concurrent === null && text.includes("insert into chat_messages")) concurrent = await publishScenarioPriceComparison(pool, turn);
    }), turn);
    assert.deepEqual(concurrent, { kind: "saved", message_id: turn.message_id });
    assert.deepEqual(outcome, { kind: "saved", message_id: turn.message_id });
    assert.deepEqual(await savedComparisons(thread, scenarioSnapshot), { messages: [turn.message_id], bindings: 1 });
  });

  await t.test("erasing the scenario while its comparison's transaction is open waits for it, then erases the comparison it committed", async () => {
    const { thread, scenarioSnapshot, turn } = await comparisonTurn();
    const runId = (await db.query<{ run_id: string }>(`select run_id::text as run_id from snapshot_financial_runs where snapshot_id = $1`, [scenarioSnapshot])).rows[0]!.run_id;
    // Otherwise the erasure waits first on the thread row this transaction updates, not on the certificate.
    await db.query(`update chat_threads set latest_snapshot_id = null where thread_id = $1`, [thread]);
    let erasure: Promise<unknown> | null = null;
    const outcome = await publishScenarioPriceComparison(racing(async (text) => {
      if (erasure !== null || text !== "commit") return;
      erasure = pool.query(`delete from financial_runs where run_id = $1`, [runId]);
      erasure.catch(() => {});
      // Postgres locks the certificate row before its delete triggers run, so they run after this commit.
      for (let tries = 0; tries < 250; tries += 1) {
        const { rows } = await db.query<{ waiting: boolean }>(
          `select exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like 'delete from financial_runs%') as waiting`,
        );
        if (rows[0]!.waiting) return;
        await delay(20);
      }
      assert.fail("the erasure never waited on the comparison's transaction");
    }), turn);
    assert.equal(outcome.kind, "saved");
    await erasure;
    const snapshot = (await db.query<{ snapshot_id: string }>(`select snapshot_id::text as snapshot_id from snapshots where snapshot_id in (select snapshot_id from chat_messages where message_id = $1)`, [turn.message_id])).rows[0]?.snapshot_id ?? null;
    assert.deepEqual(await comparisonLeft(turn.message_id, snapshot), []);
    assert.equal((await db.query(`select 1 from scenario_price_comparisons where scenario_snapshot_id = $1`, [scenarioSnapshot])).rows.length, 0);
  });

  await t.test("a certificate deleted with no erasure trigger still takes its comparisons' bindings", async () => {
    const { scenarioSnapshot, turn } = await comparisonTurn();
    assert.equal((await publishScenarioPriceComparison(pool, turn)).kind, "saved");
    await db.query("begin");
    try {
      await db.query("alter table snapshot_financial_runs disable trigger snapshot_financial_runs_erase_price_comparisons");
      await db.query(`delete from snapshot_financial_runs where snapshot_id = $1`, [scenarioSnapshot]);
      assert.equal((await db.query(`select 1 from scenario_price_comparisons where scenario_snapshot_id = $1`, [scenarioSnapshot])).rows.length, 0);
    } finally {
      await db.query("rollback");
    }
  });

  // Last: the attestation is PXC's EPS source's, which every scenario of PXC binds.
  await t.test("deleting the EPS source's publication attestation erases the comparison, its snapshot and its binding", async () => {
    const thread = await newThread();
    const scenario = await say(thread, "PXC bear 20x, base 25x, bull 30x");
    const { done } = await say(thread, "compare with the price");
    const comparison = await read(thread, done.message_id);
    const runId = ((await read(thread, scenario.done.message_id)).blocks as unknown as Array<{ financial: { run_id: string } }>)[0]!.financial.run_id;
    const deleted = await db.query(
      `delete from source_publication_attestations where attestation_id in (select publication_attestation_id from financial_run_inputs where run_id = $1)`,
      [runId],
    );
    assert.ok(deleted.rowCount! > 0);
    assert.deepEqual(await comparisonLeft(done.message_id, comparison.snapshot_id), []);
  });
});
