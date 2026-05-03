import test from "node:test";
import assert from "node:assert/strict";

import type { Client } from "pg";

import {
  applyInferredThemeMembership,
  computeInferredThemeCandidates,
} from "../src/inferred-membership.ts";
import type { ThemeRow } from "../src/theme-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

// Hex-sortable UUIDs so order-by assertions are deterministic regardless
// of insertion order. The compute query orders by subject_id asc within a
// claim-count tie, so X < Y < Z must hold lexicographically.
const ISSUER_X = "10000000-0000-4000-8000-000000000001";
const ISSUER_Y = "20000000-0000-4000-8000-000000000002";
const ISSUER_Z = "30000000-0000-4000-8000-000000000003";
const ISSUER_W = "40000000-0000-4000-8000-000000000004";

type SeededFixture = {
  themeRow: ThemeRow;
  clusterId: string;
  claimSupportA: string;
  claimSupportB: string;
  claimSupportC: string;
  claimContradicting: string;
};

// Seeds the minimal fixture exercised by the inferred-membership query:
//   1 source → 1 document → 4 claims (3 support + 1 contradicting)
//   3 claim_arguments rows linking issuer_X (×2), issuer_Y (×1)
//   3 entity_impacts rows linking issuer_X (positive), issuer_Z (negative),
//                              issuer_W (positive — but on the contradicting claim)
//   1 cluster with 3 'support' members and 1 'contradict' member
//   1 theme with membership_mode='inferred', cluster_ids=[clusterId]
//
// Expected compute output (support-only, no min_confidence, no direction
// filter), ordered by distinct claim count desc, then subject_kind/id asc:
//   issuer_X — claims [A, B] (count=2, args=2, impacts=1)
//   issuer_Y — claims [C]    (count=1, args=1, impacts=0)
//   issuer_Z — claims [B]    (count=1, args=0, impacts=1)
//   issuer_W — EXCLUDED (only present via the contradicting claim)
async function seedFixture(client: Client, options: { confidence?: number } = {}): Promise<SeededFixture> {
  const confidence = options.confidence ?? 0.9;
  const sourceId = (
    await client.query<{ source_id: string }>(
      `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
       values ('test', 'article', 'secondary', 'test', now())
       returning source_id::text as source_id`,
    )
  ).rows[0].source_id;

  const documentId = (
    await client.query<{ document_id: string }>(
      `insert into documents (source_id, kind, content_hash, raw_blob_id)
       values ($1::uuid, 'article', 'test-content-hash', 'test-blob')
       returning document_id::text as document_id`,
      [sourceId],
    )
  ).rows[0].document_id;

  const insertClaim = async () =>
    (
      await client.query<{ claim_id: string }>(
        `insert into claims (document_id, predicate, text_canonical, polarity, modality,
                             reported_by_source_id, confidence, status)
         values ($1::uuid, 'is_about', 'canonical', 'neutral', 'asserted', $2::uuid, $3, 'extracted')
         returning claim_id::text as claim_id`,
        [documentId, sourceId, confidence],
      )
    ).rows[0].claim_id;

  const claimSupportA = await insertClaim();
  const claimSupportB = await insertClaim();
  const claimSupportC = await insertClaim();
  const claimContradicting = await insertClaim();

  const insertArg = async (claimId: string, subjectId: string) =>
    client.query(
      `insert into claim_arguments (claim_id, subject_kind, subject_id, role)
       values ($1::uuid, 'issuer', $2::uuid, 'subject')`,
      [claimId, subjectId],
    );
  await insertArg(claimSupportA, ISSUER_X);
  await insertArg(claimSupportB, ISSUER_X);
  await insertArg(claimSupportC, ISSUER_Y);

  const insertImpact = async (claimId: string, subjectId: string, direction: string) =>
    client.query(
      `insert into entity_impacts (claim_id, subject_kind, subject_id, direction, channel, horizon, confidence)
       values ($1::uuid, 'issuer', $2::uuid, $3::impact_direction, 'balance_sheet', 'near_term', $4)`,
      [claimId, subjectId, direction, confidence],
    );
  await insertImpact(claimSupportA, ISSUER_X, "positive");
  await insertImpact(claimSupportB, ISSUER_Z, "negative");
  // Trap row: issuer_W gets a positive impact, but only via the contradicting
  // claim. The support-only filter must exclude it; if the SQL ever drops
  // `relation = 'support'`, issuer_W appears and the happy-path test fails.
  await insertImpact(claimContradicting, ISSUER_W, "positive");

  const clusterId = (
    await client.query<{ cluster_id: string }>(
      `insert into claim_clusters (canonical_signature, first_seen_at, last_seen_at)
       values ('test-signature', now(), now())
       returning cluster_id::text as cluster_id`,
    )
  ).rows[0].cluster_id;

  const insertMember = async (claimId: string, relation: string) =>
    client.query(
      `insert into claim_cluster_members (cluster_id, claim_id, relation)
       values ($1::uuid, $2::uuid, $3)`,
      [clusterId, claimId, relation],
    );
  await insertMember(claimSupportA, "support");
  await insertMember(claimSupportB, "support");
  await insertMember(claimSupportC, "support");
  await insertMember(claimContradicting, "contradict");

  const themeRow = (
    await client.query<{
      theme_id: string;
      name: string;
      description: string | null;
      membership_mode: "manual" | "rule_based" | "inferred";
      membership_spec: unknown;
      active_from: string | null;
      active_to: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `insert into themes (name, description, membership_mode, membership_spec)
       values ('Test theme', null, 'inferred', $1::jsonb)
       returning theme_id::text as theme_id, name, description, membership_mode,
                 membership_spec, active_from, active_to, created_at, updated_at`,
      [JSON.stringify({ cluster_ids: [clusterId] })],
    )
  ).rows[0];

  return {
    themeRow: themeRow as unknown as ThemeRow,
    clusterId,
    claimSupportA,
    claimSupportB,
    claimSupportC,
    claimContradicting,
  };
}

test(
  "computeInferredThemeCandidates: support+args+impacts merge into one row per subject; contradictions excluded",
  { timeout: 120000 },
  async (t) => {
    if (!dockerAvailable()) {
      t.skip("Docker is required for inferred-membership SQL integration coverage");
      return;
    }
    const { databaseUrl } = await bootstrapDatabase(t, "fra-fp7-happy-path");
    const client = await connectedClient(t, databaseUrl);

    const fixture = await seedFixture(client);
    const candidates = await computeInferredThemeCandidates(client, fixture.themeRow);

    // Three subjects expected; issuer_W excluded because its only link is
    // through the contradicting claim. Ordered by distinct_claim_count desc,
    // then subject_kind asc, then subject_id asc.
    assert.equal(candidates.length, 3, "expected 3 candidate subjects (issuer_W excluded)");
    const [first, second, third] = candidates;

    // issuer_X: most claims (A and B), via 2 arg rows + 1 impact row.
    // Order-sensitive comparison: the SQL produces rationale_claim_ids via
    // `array_agg(distinct claim_id::text order by claim_id::text)`, so a
    // regression that drops the `order by` would silently break the
    // documented ascending-id contract.
    assert.deepEqual(first.subject_ref, { kind: "issuer", id: ISSUER_X });
    assert.equal(first.score, 2);
    assert.deepEqual(
      [...first.rationale_claim_ids],
      [fixture.claimSupportA, fixture.claimSupportB].sort(),
    );
    assert.equal(first.signals.claim_arguments, 2);
    assert.equal(first.signals.entity_impacts, 1);

    // issuer_Y: 1 claim via 1 arg row, 0 impacts.
    assert.deepEqual(second.subject_ref, { kind: "issuer", id: ISSUER_Y });
    assert.equal(second.score, 1);
    assert.deepEqual([...second.rationale_claim_ids], [fixture.claimSupportC]);
    assert.equal(second.signals.claim_arguments, 1);
    assert.equal(second.signals.entity_impacts, 0);

    // issuer_Z: 1 claim via 1 impact row, 0 args.
    assert.deepEqual(third.subject_ref, { kind: "issuer", id: ISSUER_Z });
    assert.equal(third.score, 1);
    assert.deepEqual([...third.rationale_claim_ids], [fixture.claimSupportB]);
    assert.equal(third.signals.claim_arguments, 0);
    assert.equal(third.signals.entity_impacts, 1);

    // issuer_W's contradicting claim must NEVER pull it in.
    const subjectIds = candidates.map((c) => c.subject_ref.id);
    assert.equal(subjectIds.includes(ISSUER_W), false, "issuer_W must be excluded — its only link is via contradiction");
  },
);

test(
  "computeInferredThemeCandidates: min_confidence filters the underlying claims",
  { timeout: 120000 },
  async (t) => {
    if (!dockerAvailable()) {
      t.skip("Docker is required for inferred-membership SQL integration coverage");
      return;
    }
    const { databaseUrl } = await bootstrapDatabase(t, "fra-fp7-min-confidence");
    const client = await connectedClient(t, databaseUrl);

    const fixture = await seedFixture(client, { confidence: 0.4 });
    const themeWithFloor = {
      ...fixture.themeRow,
      membership_spec: { cluster_ids: [fixture.clusterId], min_confidence: 0.7 },
    } as ThemeRow;

    const candidates = await computeInferredThemeCandidates(client, themeWithFloor);
    assert.equal(candidates.length, 0, "all claims have confidence below the floor → no candidates");
  },
);

test(
  "computeInferredThemeCandidates: impact_directions filters entity_impacts but leaves claim_arguments untouched",
  { timeout: 120000 },
  async (t) => {
    if (!dockerAvailable()) {
      t.skip("Docker is required for inferred-membership SQL integration coverage");
      return;
    }
    const { databaseUrl } = await bootstrapDatabase(t, "fra-fp7-direction-filter");
    const client = await connectedClient(t, databaseUrl);

    const fixture = await seedFixture(client);
    const themeFilteredToPositive = {
      ...fixture.themeRow,
      membership_spec: { cluster_ids: [fixture.clusterId], impact_directions: ["positive"] },
    } as ThemeRow;

    const candidates = await computeInferredThemeCandidates(client, themeFilteredToPositive);
    // issuer_X stays (positive impact + claim_arguments).
    // issuer_Y stays (claim_arguments only — direction filter doesn't apply).
    // issuer_Z drops (only link was a 'negative' impact).
    const ids = candidates.map((c) => c.subject_ref.id).sort();
    assert.deepEqual(ids, [ISSUER_X, ISSUER_Y].sort());
    const xCandidate = candidates.find((c) => c.subject_ref.id === ISSUER_X)!;
    assert.equal(xCandidate.signals.entity_impacts, 1, "issuer_X's positive impact still counts");
  },
);

test(
  "applyInferredThemeMembership persists rationale_claim_ids verbatim — explainability survives the round-trip",
  { timeout: 120000 },
  async (t) => {
    if (!dockerAvailable()) {
      t.skip("Docker is required for inferred-membership SQL integration coverage");
      return;
    }
    const { databaseUrl } = await bootstrapDatabase(t, "fra-fp7-apply-roundtrip");
    const client = await connectedClient(t, databaseUrl);

    const fixture = await seedFixture(client);
    const result = await applyInferredThemeMembership(client, fixture.themeRow);
    assert.equal(result.added, 3);
    assert.equal(result.alreadyPresent, 0);

    // Re-running is safe — every candidate is already present, no new rows.
    const replay = await applyInferredThemeMembership(client, fixture.themeRow);
    assert.equal(replay.added, 0);
    assert.equal(replay.alreadyPresent, 3);

    // Verify the rationale chain made it to theme_memberships intact.
    const persisted = await client.query<{ subject_id: string; rationale_claim_ids: string[]; score: string | number }>(
      `select subject_id::text as subject_id,
              rationale_claim_ids,
              score
         from theme_memberships
        where theme_id = $1::uuid
        order by subject_id asc`,
      [fixture.themeRow.theme_id],
    );
    assert.equal(persisted.rows.length, 3);
    const xRow = persisted.rows.find((r) => r.subject_id === ISSUER_X)!;
    // Order-sensitive: the candidate's rationale_claim_ids was sorted ascending
    // by the compute SQL and must round-trip through theme_memberships unchanged.
    assert.deepEqual(
      [...xRow.rationale_claim_ids],
      [fixture.claimSupportA, fixture.claimSupportB].sort(),
      "issuer_X's persisted rationale must point back to the supporting claims",
    );
    assert.equal(Number(xRow.score), 2, "issuer_X's persisted score must equal distinct claim count");

    const yRow = persisted.rows.find((r) => r.subject_id === ISSUER_Y)!;
    assert.deepEqual([...yRow.rationale_claim_ids], [fixture.claimSupportC]);
    assert.equal(Number(yRow.score), 1);
  },
);
