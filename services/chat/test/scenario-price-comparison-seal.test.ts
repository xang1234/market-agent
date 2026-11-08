// A scenario price comparison's seal (#224): the seal generates the block
// again from the sealed #201 scenario and the stored close, so a block that
// differs in any field, or a stored row that changes what would be chosen,
// fails it; a reload is source-linked only while the scenario's certificate
// and the price's public source stand.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS, NVDA, seedValuedIssuer } from "../../financial-engine/test/db-fixtures.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { generateScenarioPriceComparison, recordScenarioPriceComparison, scenarioPriceComparisonBlock, type ComparisonBlock, type ComparisonRequest } from "../../snapshot/src/scenario-price-comparison.ts";
import { buildScenarioPriceComparisonSealInput } from "../../snapshot/src/seal-input.ts";
import { sealSnapshotInTransaction, snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, NO_ASKS, resolveMention } from "./financial-fixtures.ts";

const CMPR = {
  issuer: "4f000000-0000-4000-8000-0000000009a1", listing: "4f000000-0000-4000-8000-0000000009e1",
  tenK: "4f000000-0000-4000-8000-0000000009c1", tenQ: "4f000000-0000-4000-8000-0000000009c2",
  ticker: "CMPR", name: "Compare Holdings Inc.", close: "100.00", eps: "4.00", shares: "1000000",
} as const;

const resolveCompare = (mention: string): Promise<ChatSubjectPreResolution> =>
  mention === "CMPR"
    ? Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id: CMPR.issuer }, display_label: CMPR.name, handoff: { display_labels: { ticker: CMPR.ticker } } } as unknown as ChatResolvedSubjectPreResolution)
    : resolveMention(mention);

type Mutable = { -readonly [K in keyof ComparisonBlock]: ComparisonBlock[K] } & { comparison: any };

test("scenario price comparison seal", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for comparison seal coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-comparison-seal");
  await seedValuedIssuer(db, CMPR);
  const harness = chatHarness(pool, {
    model: null,
    resolveMention: resolveCompare,
    readQuestion: async () => ({ ...NO_ASKS, companies: { kind: "as_named", names: ["CMPR"] } }),
    clock: () => new Date(NVDA.cutoff),
  });
  const { events } = await harness.run({ threadId, userId: IDS.owner, userIntent: "CMPR bear 20x, base 25x, bull 30x" });
  const parent = (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages.find((message) => message.message_id === completed(events).message_id)!;
  const request: ComparisonRequest = { thread_id: threadId, scenario_snapshot_id: parent.snapshot_id!, requested: { kind: "latest" }, received_at: NVDA.cutoff };

  // Each seal runs in a transaction that is rolled back, so each tamper is isolated.
  const inTransaction = async <T>(action: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      return await action(client);
    } finally {
      await client.query("rollback");
      client.release();
    }
  };
  const sealOf = async (client: PoolClient, block: ComparisonBlock) =>
    sealSnapshotInTransaction(snapshotTransactionClient(client), buildScenarioPriceComparisonSealInput({ block, thread_id: threadId }));
  const generatedBlock = async (client: PoolClient, change: Partial<ComparisonRequest> = {}) => {
    const generated = await generateScenarioPriceComparison(client, { ...request, ...change });
    assert.ok(generated);
    return scenarioPriceComparisonBlock(randomUUID(), randomUUID(), generated);
  };
  const failures = (sealed: Awaited<ReturnType<typeof sealOf>>) =>
    sealed.verification.failures.map((failure) => `${failure.reason_code}:${String(failure.details.reason ?? "")}`);

  await t.test("the sealed scenario's 80, 100 and 120 against the stored 100.00 close seal as -20.00%, 0.00% and +20.00%", async () => {
    await inTransaction(async (client) => {
      const block = await generatedBlock(client);
      assert.equal(block.comparison.outcome.kind, "comparison");
      if (block.comparison.outcome.kind !== "comparison") return;
      assert.deepEqual(block.comparison.outcome.rows.map((row) => [row.scenario_value.text, row.percent.text]), [
        ["USD 80.00 per share", "-20.00%"], ["USD 100.00 per share", "0.00%"], ["USD 120.00 per share", "+20.00%"],
      ]);
      assert.equal(block.comparison.outcome.price.heading, "Latest stored completed close: 2024-06-07");
      assert.equal(block.comparison.scenario.presentation_hash, (parent.blocks as Array<{ presentation_hash: string }>)[0]!.presentation_hash);
      assert.deepEqual(block.source_refs, [CMPR.tenK, POLYGON_MARKET_SOURCE_ID]);
      const sealed = await sealOf(client, block);
      assert.ok(sealed.ok, JSON.stringify(sealed.verification.failures));
    });
  });

  await t.test("a block that differs from what the records generate in any field fails its seal", async () => {
    const other = "4f000000-0000-4000-8000-0000000009ff";
    const mutations: Array<[string, (block: Mutable) => void, string]> = [
      ["price", (block) => { block.comparison.outcome.price.price.value = "101"; }, "content"],
      ["source", (block) => { block.comparison.outcome.price.source_id = other; }, "content"],
      ["source version", (block) => { block.comparison.outcome.price.body_sha256 = "e".repeat(64); }, "content"],
      ["fetched_at", (block) => { block.comparison.outcome.price.fetched_at = "2024-06-07T20:15:01.000Z"; }, "content"],
      ["stored basis", (block) => { block.comparison.outcome.price.adjustment_basis = "split_adjusted"; }, "content"],
      ["comparison basis", (block) => { block.comparison.outcome.basis.split_factor = "10"; }, "content"],
      ["kind", (block) => { block.comparison.outcome.price.kind = "last_trade"; }, "content"],
      ["scenario certificate", (block) => { block.comparison.scenario.presentation_hash = "f".repeat(64); }, "content"],
      ["scenario snapshot", (block) => { block.comparison.scenario.snapshot_id = other; }, "scenario"],
      ["scenario input", (block) => { block.comparison.outcome.rows[0].multiple_text = "21x"; }, "content"],
      ["result", (block) => { block.comparison.outcome.rows[2].scenario_value.value = "121"; }, "content"],
      ["result id", (block) => { block.comparison.outcome.rows[1].result_id = other; }, "content"],
      ["cutoff", (block) => { block.comparison.cutoff.at = "2024-06-10T13:00:00.000Z"; }, "content"],
      ["requested time", (block) => { block.comparison.requested = { kind: "session_date", date: "2024-06-07" }; }, "content"],
      ["rendered cell", (block) => { block.comparison.outcome.rows[1].percent.text = "+0.01%"; }, "content"],
      ["rendered difference", (block) => { block.comparison.outcome.rows[0].difference.text = "USD -2.00 per share"; }, "content"],
      ["cited sources", (block) => { block.source_refs = [CMPR.tenK]; }, "sources"],
      ["subject", (block) => { block.subject_refs = [{ kind: "listing", id: other }]; }, "subject"],
      ["malformed request", (block) => { block.comparison.received_at = "yesterday"; }, "request"],
      ["as_of", (block) => { block.as_of = "2024-06-10T13:00:00.000Z"; }, "block"],
      ["data_ref", (block) => { block.data_ref = { kind: "scenario_price_comparison", id: "another" }; }, "block"],
    ];
    for (const [label, mutate, reason] of mutations) {
      await inTransaction(async (client) => {
        const block = structuredClone(await generatedBlock(client)) as Mutable;
        mutate(block);
        const sealed = await sealOf(client, block);
        assert.deepEqual(failures(sealed), [`scenario_comparison_mismatch:${reason}`], label);
      });
    }
  });

  await t.test("a close hand-inserted after the block was drawn, stamped before its session's close, fails the seal and is never a close", async () => {
    await inTransaction(async (client) => {
      const block = await generatedBlock(client);
      await client.query(
        `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
         values ($1, $2, 'session_close', '150.00', 'USD', '2024-06-07T20:30:00Z', '2024-06-07T20:40:00Z', '2024-06-07T20:40:00Z', $3)`,
        [CMPR.listing, POLYGON_MARKET_SOURCE_ID, "c".repeat(64)],
      );
      assert.deepEqual(failures(await sealOf(client, block)), ["scenario_comparison_mismatch:content"]);
      assert.deepEqual((await generatedBlock(client)).comparison.outcome, { kind: "gap", reason: "session_incomplete", text: "The latest stored price is not stamped at its session's regular close, so it is not a completed close." });
    });
  });

  await t.test("a close stamped a microsecond after its session's close is no completed close", async () => {
    await inTransaction(async (client) => {
      await client.query(
        `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
         values ($1, $2, 'session_close', '150.00', 'USD', '2024-06-07T20:00:00.000001Z', '2024-06-07T20:40:00Z', '2024-06-07T20:40:00Z', $3)`,
        [CMPR.listing, POLYGON_MARKET_SOURCE_ID, "c".repeat(64)],
      );
      assert.equal(((await generatedBlock(client)).comparison.outcome as { reason?: string }).reason, "session_incomplete");
    });
  });

  await t.test("a newer last trade changes nothing: the sealed close still stands", async () => {
    await inTransaction(async (client) => {
      const block = await generatedBlock(client);
      await client.query(
        `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
         values ($1, $2, 'last_trade', '130.00', 'USD', '2024-06-10T13:59:00Z', '2024-06-10T13:59:30Z', '2024-06-10T13:59:30Z', $3)`,
        [CMPR.listing, POLYGON_MARKET_SOURCE_ID, "c".repeat(64)],
      );
      const sealed = await sealOf(client, block);
      assert.ok(sealed.ok, JSON.stringify(sealed.verification.failures));
    });
  });

  await t.test("another thread's comparison of this scenario has none to compare", async () => {
    assert.equal(await generateScenarioPriceComparison(pool, { ...request, thread_id: randomUUID() }), null);
  });

  // A sealed comparison saved as chat saves it: the seal, its binding, and the message, in one transaction.
  const saveSealed = async (change: (block: Mutable) => void = () => {}) => {
    const messageId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const block = await generatedBlock(client);
      const sealed = await sealOf(client, block);
      assert.ok(sealed.ok, JSON.stringify(sealed.verification.failures));
      await recordScenarioPriceComparison(client, block);
      const shown = structuredClone(block) as Mutable;
      change(shown);
      await client.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1, $2, 'assistant', $3, $4::jsonb, $5)`,
        [messageId, threadId, block.snapshot_id, JSON.stringify([shown]), "0".repeat(64)],
      );
      await client.query("commit");
      return { messageId, block };
    } finally {
      client.release();
    }
  };
  const messages = async () => (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))!.messages;
  const proofOf = async (messageId: string, blockId: string) => (await messages()).find((message) => message.message_id === messageId)?.block_proofs[blockId];

  const UNPROVEN_COMPARISON = { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown", scenario_calculation: "not_verified" };
  const LINKED = { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown", scenario_calculation: "verified" };

  await t.test("a comparison whose stored content is not what its seal generated, or that no seal bound, claims nothing", async () => {
    const forged = await saveSealed((block) => {
      block.comparison.outcome.rows[2].scenario_value.value = "150";
      block.comparison.outcome.rows[2].percent.text = "+50.00%";
    });
    assert.deepEqual(await proofOf(forged.messageId, forged.block.id), UNPROVEN_COMPARISON, "forged values under a sealed comparison's snapshot");

    // An unbound comparison: sealed like one, under a snapshot no comparison seal bound.
    const messageId = randomUUID();
    const client = await pool.connect();
    let block: ComparisonBlock;
    try {
      await client.query("begin");
      block = await generatedBlock(client);
      assert.ok((await sealOf(client, block)).ok);
      await client.query(
        `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1, $2, 'assistant', $3, $4::jsonb, $5)`,
        [messageId, threadId, block.snapshot_id, JSON.stringify([block]), "0".repeat(64)],
      );
      await client.query("commit");
    } finally {
      client.release();
    }
    assert.deepEqual(await proofOf(messageId, block!.id), UNPROVEN_COMPARISON, "no binding");
  });

  await t.test("a bound comparison whose stored block differs outside its content, or that sits in another message, claims nothing", async () => {
    const restamped = await saveSealed((block) => { block.as_of = "2024-06-10T13:00:00.000Z"; });
    assert.deepEqual(await proofOf(restamped.messageId, restamped.block.id), UNPROVEN_COMPARISON, "as_of changed after its seal");
    const relabelled = await saveSealed((block) => { block.subject_refs = []; });
    assert.deepEqual(await proofOf(relabelled.messageId, relabelled.block.id), UNPROVEN_COMPARISON, "subject changed after its seal");

    const original = await saveSealed();
    const copySnapshot = randomUUID();
    const copyMessage = randomUUID();
    await db.query(`insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms) values ($1, '[]', now(), 'unadjusted', 'raw', '{}')`, [copySnapshot]);
    await db.query(
      `insert into chat_messages (message_id, thread_id, role, snapshot_id, blocks, content_hash) values ($1, $2, 'assistant', $3, $4::jsonb, $5)`,
      [copyMessage, threadId, copySnapshot, JSON.stringify([original.block]), "0".repeat(64)],
    );
    assert.deepEqual(await proofOf(original.messageId, original.block.id), LINKED, "the message its seal saved it in");
    assert.deepEqual(await proofOf(copyMessage, original.block.id), UNPROVEN_COMPARISON, "a copy under another message's snapshot");
  });

  await t.test("a reload is source-linked while the certificate and both public sources stand; revoking either source unproves it but keeps the scenario's certificate, and erasing the EPS erases it", async () => {
    const { messageId, block } = await saveSealed();
    const proof = () => proofOf(messageId, block.id);
    assert.deepEqual(await proof(), LINKED);

    for (const [source, label] of [[POLYGON_MARKET_SOURCE_ID, "the price's source"], [CMPR.tenK, "the EPS's source"]] as const) {
      await db.query(`update sources set user_id = $2 where source_id = $1`, [source, IDS.owner]);
      assert.deepEqual(await proof(), { ...UNPROVEN_COMPARISON, scenario_calculation: "verified" }, `${label} is no longer public`);
      await db.query(`update sources set user_id = null where source_id = $1`, [source]);
      assert.deepEqual(await proof(), LINKED, `${label} is public again`);
    }

    // Erasing the EPS fact erases the scenario's run, its certificate and answer, and every comparison of it.
    await db.query(`delete from facts where source_id = $1`, [CMPR.tenK]);
    const left = await messages();
    assert.equal(left.some((message) => message.message_id === parent.message_id), false, "the scenario answer is erased");
    assert.equal(left.some((message) => message.message_id === messageId), false, "the comparison message is erased");
    const kept = await db.query(`select 1 from snapshots where snapshot_id = $1 union all select 1 from scenario_price_comparisons where snapshot_id = $1`, [block.snapshot_id]);
    assert.equal(kept.rows.length, 0, "the comparison's snapshot and binding are erased");
  });
});
