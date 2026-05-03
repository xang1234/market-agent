import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_CLUSTER_MEMBER_RELATIONS,
  addClaimClusterMember,
  buildClaimCanonicalSignature,
  getClaimClusterBySignature,
  upsertClaimCluster,
} from "../src/claim-cluster-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const CLUSTER_ID = "11111111-1111-4111-a111-111111111111";
const CLAIM_ID = "22222222-2222-4222-a222-222222222222";
const CLAIM_ID_2 = "33333333-3333-4333-a333-333333333333";
const CLAIM_CLUSTER_MEMBER_ID = "44444444-4444-4444-a444-444444444444";

function clusterRow(overrides: Record<string, unknown> = {}) {
  return {
    cluster_id: CLUSTER_ID,
    canonical_signature: "claim:v1:abc123",
    first_seen_at: new Date("2026-05-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-05-03T00:00:00.000Z"),
    support_count: 3,
    contradiction_count: 1,
    aggregate_confidence: "0.82",
    created_at: new Date("2026-05-01T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    claim_cluster_member_id: CLAIM_CLUSTER_MEMBER_ID,
    cluster_id: CLUSTER_ID,
    claim_id: CLAIM_ID,
    relation: "support",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows: Record<string, unknown>[][] = [[clusterRow()]]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let call = 0;
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      const queryRows = rows[Math.min(call, rows.length - 1)] ?? [];
      call += 1;
      return {
        rows: queryRows as R[],
        command: text.trimStart().startsWith("select") ? "SELECT" : "INSERT",
        rowCount: queryRows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("buildClaimCanonicalSignature is deterministic and insensitive to subject order", () => {
  const input = {
    predicate: "supplier_disruption",
    text_canonical: "Supplier disruption constrains manufacturer margins",
    event_type: "lawsuit",
    effective_time: "2026-05-03T00:00:00.000Z",
    subjects: [
      { kind: "issuer" as const, id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" },
      { kind: "issuer" as const, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" },
    ],
  };

  const first = buildClaimCanonicalSignature(input);
  const second = buildClaimCanonicalSignature({
    ...input,
    subjects: [...input.subjects].reverse(),
  });

  assert.equal(first, second);
  assert.match(first, /^claim:v1:[0-9a-f]{64}$/);
});

test("buildClaimCanonicalSignature treats subjects as a set and normalizes timestamp offsets", () => {
  const subjects = [
    { kind: "issuer" as const, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" },
  ];

  const first = buildClaimCanonicalSignature({
    predicate: "supplier_disruption",
    text_canonical: "Supplier disruption constrains manufacturer margins",
    event_type: "lawsuit",
    effective_time: "2026-05-03T00:00:00.000Z",
    subjects,
  });
  const second = buildClaimCanonicalSignature({
    predicate: "supplier_disruption",
    text_canonical: "Supplier disruption constrains manufacturer margins",
    event_type: "lawsuit",
    effective_time: "2026-05-03T08:00:00.000+08:00",
    subjects: [...subjects, ...subjects],
  });

  assert.equal(first, second);
});

test("buildClaimCanonicalSignature accepts a missing effective time as a stable sentinel", () => {
  const signature = buildClaimCanonicalSignature({
    predicate: "supplier_disruption",
    text_canonical: "Supplier disruption constrains manufacturer margins",
    event_type: "lawsuit",
    effective_time: null,
    subjects: [
      { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" },
    ],
  });

  assert.match(signature, /^claim:v1:[0-9a-f]{64}$/);
});

test("upsertClaimCluster creates or updates a cluster by canonical signature", async () => {
  const { db, queries } = recordingDb([[clusterRow({ canonical_signature: "claim:v1:abc123" })]]);

  const cluster = await upsertClaimCluster(db, {
    canonical_signature: "claim:v1:abc123",
    seen_at: "2026-05-03T00:00:00.000Z",
  });

  assert.equal(cluster.cluster_id, CLUSTER_ID);
  assert.equal(cluster.canonical_signature, "claim:v1:abc123");
  assert.equal(cluster.support_count, 3);
  assert.equal(cluster.contradiction_count, 1);
  assert.equal(cluster.aggregate_confidence, 0.82);
  assert.match(queries[0]!.text, /insert into claim_clusters/);
  assert.match(queries[0]!.text, /on conflict \(canonical_signature\)/);
  assert.match(queries[0]!.text, /first_seen_at = least/);
  assert.match(queries[0]!.text, /last_seen_at = greatest/);
  assert.deepEqual(queries[0]!.values, ["claim:v1:abc123", "2026-05-03T00:00:00.000Z"]);
});

test("getClaimClusterBySignature returns null for a missing cluster", async () => {
  const { db, queries } = recordingDb([[]]);

  const cluster = await getClaimClusterBySignature(db, "claim:v1:missing");

  assert.equal(cluster, null);
  assert.match(queries[0]!.text, /where canonical_signature = \$1/);
  assert.deepEqual(queries[0]!.values, ["claim:v1:missing"]);
});

test("addClaimClusterMember inserts a member and refreshes cluster aggregates", async () => {
  const { db, queries } = recordingDb([
    [{
      claim_cluster_member_id: CLAIM_CLUSTER_MEMBER_ID,
      member_cluster_id: CLUSTER_ID,
      member_claim_id: CLAIM_ID,
      relation: "support",
      member_created_at: new Date("2026-05-03T00:00:00.000Z"),
      ...clusterRow({ support_count: 2, contradiction_count: 0, aggregate_confidence: "0.7" }),
    }],
  ]);

  const result = await addClaimClusterMember(db, {
    cluster_id: CLUSTER_ID,
    claim_id: CLAIM_ID,
    relation: "support",
  });

  assert.equal(result.member.claim_cluster_member_id, CLAIM_CLUSTER_MEMBER_ID);
  assert.equal(result.member.relation, "support");
  assert.equal(result.cluster.support_count, 2);
  assert.equal(result.cluster.aggregate_confidence, 0.7);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.text, /with locked_cluster as/);
  assert.match(queries[0]!.text, /for update/);
  assert.match(queries[0]!.text, /existing_member as/);
  assert.match(queries[0]!.text, /with upserted_member as|upserted_member as/);
  assert.match(queries[0]!.text, /insert into claim_cluster_members/);
  assert.match(queries[0]!.text, /on conflict \(cluster_id, claim_id\) do update/);
  assert.match(queries[0]!.text, /update claim_clusters/);
  assert.match(queries[0]!.text, /support_count = cc.support_count \+ d.support_delta/);
  assert.match(queries[0]!.text, /aggregate_confidence = case/);
  assert.deepEqual(queries[0]!.values, [CLUSTER_ID, CLAIM_ID, "support"]);
});

test("addClaimClusterMember accepts contradicting members", async () => {
  const { db } = recordingDb([
    [{
      claim_cluster_member_id: CLAIM_CLUSTER_MEMBER_ID,
      member_cluster_id: CLUSTER_ID,
      member_claim_id: CLAIM_ID_2,
      relation: "contradict",
      member_created_at: new Date("2026-05-03T00:00:00.000Z"),
      ...clusterRow({ support_count: 1, contradiction_count: 1 }),
    }],
  ]);

  const result = await addClaimClusterMember(db, {
    cluster_id: CLUSTER_ID,
    claim_id: CLAIM_ID_2,
    relation: "contradict",
  });

  assert.equal(result.member.relation, "contradict");
  assert.equal(result.cluster.contradiction_count, 1);
});

test("claim cluster operations reject invalid inputs before querying", async () => {
  const { db, queries } = recordingDb();

  await assert.rejects(
    () => upsertClaimCluster(db, { canonical_signature: " ", seen_at: "2026-05-03T00:00:00.000Z" }),
    /canonical_signature/,
  );
  await assert.rejects(
    () => upsertClaimCluster(db, { canonical_signature: "claim:v1:abc123", seen_at: "2026-05-03" }),
    /seen_at/,
  );
  await assert.rejects(() => getClaimClusterBySignature(db, " "), /canonical_signature/);
  await assert.rejects(
    () => addClaimClusterMember(db, { cluster_id: "not-a-uuid", claim_id: CLAIM_ID, relation: "support" }),
    /cluster_id/,
  );
  await assert.rejects(
    () => addClaimClusterMember(db, { cluster_id: CLUSTER_ID, claim_id: "not-a-uuid", relation: "support" }),
    /claim_id/,
  );
  await assert.rejects(
    () => addClaimClusterMember(db, { cluster_id: CLUSTER_ID, claim_id: CLAIM_ID, relation: "related" as never }),
    /relation/,
  );
  assert.throws(
    () => buildClaimCanonicalSignature({
      predicate: " ",
      text_canonical: "Supplier disruption constrains manufacturer margins",
      event_type: "lawsuit",
      effective_time: null,
      subjects: [{ kind: "issuer", id: CLAIM_ID }],
    }),
    /predicate/,
  );

  assert.equal(queries.length, 0);
});

test("CLAIM_CLUSTER_MEMBER_RELATIONS pins the relation contract", () => {
  assert.deepEqual(CLAIM_CLUSTER_MEMBER_RELATIONS, ["support", "contradict"]);
  assert.equal(Object.isFrozen(CLAIM_CLUSTER_MEMBER_RELATIONS), true);
});
