import assert from "node:assert/strict";
import test from "node:test";

import { listHomeFindingCards } from "../src/finding-feed-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

type QueryCall = {
  text: string;
  values?: unknown[];
};

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const CLUSTER_ID = "11111111-1111-4111-a111-111111111111";

function findingRow(overrides: Record<string, unknown>) {
  return {
    finding_id: "22222222-2222-4222-a222-222222222222",
    agent_id: "33333333-3333-4333-a333-333333333333",
    snapshot_id: "44444444-4444-4444-a444-444444444444",
    subject_refs: [{ kind: "instrument", id: "55555555-5555-4555-a555-555555555555" }],
    claim_cluster_ids: [CLUSTER_ID],
    severity: "medium",
    headline: "Demand improved",
    summary_blocks: [
      {
        id: "finding-card-22222222-2222-4222-a222-222222222222",
        kind: "finding_card",
        snapshot_id: "44444444-4444-4444-a444-444444444444",
        data_ref: { kind: "finding_card", id: "22222222-2222-4222-a222-222222222222" },
        source_refs: ["66666666-6666-4666-a666-666666666666"],
        as_of: "2026-05-05T00:00:00.000Z",
        finding_id: "22222222-2222-4222-a222-222222222222",
        headline: "Demand improved",
        severity: "medium",
      },
    ],
    created_at: "2026-05-05T00:00:00.000Z",
    cluster_support_count: 3,
    ...overrides,
  };
}

function fakeDb(rows: ReadonlyArray<Record<string, unknown>>) {
  const calls: QueryCall[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return {
        rows: rows as R[],
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, calls };
}

function scopedFakeDb(rows: ReadonlyArray<Record<string, unknown>>) {
  const calls: QueryCall[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      assert.match(text, /join agents a/i);
      assert.match(text, /a\.user_id = \$1::uuid/i);
      assert.match(text, /a\.enabled = true/i);
      const userId = String(values?.[0]);
      const candidateLimit = Number(values?.[1]);
      const filtered = rows
        .filter((row) => row.agent_user_id === userId && row.agent_enabled === true)
        .slice(0, candidateLimit);
      return {
        rows: filtered as R[],
        command: "SELECT",
        rowCount: filtered.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, calls };
}

test("listHomeFindingCards collapses three findings sharing a cluster into one card", async () => {
  const { db } = fakeDb([
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222221",
      agent_id: "33333333-3333-4333-a333-333333333331",
      severity: "low",
      headline: "First outlet reports demand improvement",
      created_at: "2026-05-05T00:00:00.000Z",
    }),
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222222",
      agent_id: "33333333-3333-4333-a333-333333333332",
      severity: "high",
      headline: "Second outlet confirms demand improvement",
      created_at: "2026-05-05T01:00:00.000Z",
    }),
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222223",
      agent_id: "33333333-3333-4333-a333-333333333333",
      severity: "medium",
      headline: "Third outlet adds corroboration",
      created_at: "2026-05-05T02:00:00.000Z",
    }),
  ]);

  const cards = await listHomeFindingCards(db, { user_id: USER_ID });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].dedupe_key, `claim_cluster:${CLUSTER_ID}`);
  assert.equal(cards[0].support_count, 3);
  assert.equal(cards[0].contributing_finding_count, 3);
  assert.equal(cards[0].primary_finding.finding_id, "22222222-2222-4222-a222-222222222222");
  assert.equal(cards[0].headline, "Second outlet confirms demand improvement");
  assert.deepEqual(cards[0].finding_ids, [
    "22222222-2222-4222-a222-222222222221",
    "22222222-2222-4222-a222-222222222222",
    "22222222-2222-4222-a222-222222222223",
  ]);
  assert.deepEqual(cards[0].agent_ids, [
    "33333333-3333-4333-a333-333333333331",
    "33333333-3333-4333-a333-333333333332",
    "33333333-3333-4333-a333-333333333333",
  ]);
});

test("listHomeFindingCards scopes SQL to enabled agents for one user", async () => {
  const { db, calls } = fakeDb([]);

  await listHomeFindingCards(db, { user_id: USER_ID, limit: 25 });

  assert.match(calls[0].text, /join agents a/i);
  assert.match(calls[0].text, /a\.user_id = \$1::uuid/i);
  assert.match(calls[0].text, /a\.enabled = true/i);
  assert.deepEqual(calls[0].values, [USER_ID, 500]);
});

test("listHomeFindingCards filters other-user and disabled-agent rows through the query contract", async () => {
  const { db } = scopedFakeDb([
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222241",
      agent_user_id: OTHER_USER_ID,
      agent_enabled: true,
    }),
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222242",
      agent_user_id: USER_ID,
      agent_enabled: false,
    }),
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222243",
      agent_user_id: USER_ID,
      agent_enabled: true,
    }),
  ]);

  const cards = await listHomeFindingCards(db, { user_id: USER_ID });

  assert.deepEqual(cards.flatMap((card) => card.finding_ids), [
    "22222222-2222-4222-a222-222222222243",
  ]);
});

test("listHomeFindingCards keeps unclustered findings as singleton cards", async () => {
  const { db } = fakeDb([
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222299",
      claim_cluster_ids: [],
      cluster_support_count: null,
    }),
  ]);

  const cards = await listHomeFindingCards(db, { user_id: USER_ID });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].dedupe_key, "finding:22222222-2222-4222-a222-222222222299");
  assert.equal(cards[0].support_count, 1);
  assert.equal(cards[0].contributing_finding_count, 1);
});

test("listHomeFindingCards rejects malformed JSON row values loudly", async () => {
  const { db } = fakeDb([
    findingRow({
      subject_refs: { kind: "instrument", id: "bad" },
    }),
  ]);

  await assert.rejects(
    () => listHomeFindingCards(db, { user_id: USER_ID }),
    /subject_refs must be an array/,
  );
});

test("listHomeFindingCards separates candidate limit from final card limit", async () => {
  const { db, calls } = fakeDb([
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222251",
      claim_cluster_ids: [],
      cluster_support_count: null,
      created_at: "2026-05-05T03:00:00.000Z",
    }),
    findingRow({
      finding_id: "22222222-2222-4222-a222-222222222252",
      claim_cluster_ids: [],
      cluster_support_count: null,
      created_at: "2026-05-05T02:00:00.000Z",
    }),
  ]);

  const cards = await listHomeFindingCards(db, { user_id: USER_ID, limit: 1, candidate_limit: 20 });

  assert.equal(cards.length, 1);
  assert.deepEqual(calls[0].values, [USER_ID, 20]);
});

test("listHomeFindingCards rejects invalid subject kinds and malformed summary blocks", async () => {
  await assert.rejects(
    () => listHomeFindingCards(
      fakeDb([
        findingRow({
          subject_refs: [{ kind: "not_a_subject", id: "55555555-5555-4555-a555-555555555555" }],
        }),
      ]).db,
      { user_id: USER_ID },
    ),
    /subject_refs\[0\]\.kind must be a supported subject kind/,
  );

  await assert.rejects(
    () => listHomeFindingCards(
      fakeDb([
        findingRow({
          summary_blocks: [null],
        }),
      ]).db,
      { user_id: USER_ID },
    ),
    /summary_blocks\[0\] must be an object/,
  );
});

test("listHomeFindingCards rejects clustered findings missing their cluster aggregate row", async () => {
  const { db } = fakeDb([
    findingRow({
      cluster_support_count: null,
    }),
  ]);

  await assert.rejects(
    () => listHomeFindingCards(db, { user_id: USER_ID }),
    /missing claim cluster aggregate/,
  );
});
