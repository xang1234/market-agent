import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const HASH = "a".repeat(64);
const POLYGON = "00000000-0000-4000-a000-000000000009";
const LISTING = "0f000000-0000-4000-8000-0000000000e1";
const PLAN = "0f000000-0000-4000-8000-0000000000e2";

type Observation = { price: string; observed_at?: string; known_at?: string | null; fetched_at?: string; kind?: string; basis?: string };

function insertObservation(db: Client, observation: Observation) {
  const row = { observed_at: "2024-06-07T20:00:00Z", known_at: "2024-06-07T20:15:00Z", fetched_at: "2024-06-07T20:15:00Z", kind: "session_close", basis: "unadjusted", ...observation };
  return db.query<{ observation_id: string }>(
    `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256, adjustment_basis)
     values ($1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9) returning observation_id::text`,
    [LISTING, POLYGON, row.kind, row.price, row.observed_at, row.known_at, row.fetched_at, HASH, row.basis],
  );
}

async function insertRun(db: Client): Promise<string> {
  await db.query(
    `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
     values ($1, $2, 'chat_request', 'chat:turn:1', 'catalog.v1', $3::jsonb, $4, $4)`,
    [PLAN, IDS.owner, JSON.stringify({ plan_id: PLAN, schema_version: "financial_plan.v1" }), HASH],
  );
  return (await db.query<{ run_id: string }>(
    `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies, allowed_source_classes)
     values ($1, 'chat_thread', $2, '1', 'turn-1', $3, $2, 'shadow', '2024-06-11T20:30:00Z', '{"reporting_basis":"as_reported"}', '{market_data,sec_filing}') returning run_id::text`,
    [IDS.owner, PLAN, HASH],
  )).rows[0]!.run_id;
}

function bindPrice(db: Client, runId: string, slot: string, observationId: string, factId: string | null = null) {
  return db.query(
    `insert into financial_run_inputs (run_id, input_slot, binding_status, fact_id, price_observation_id, bound_payload, payload_hash,
                                       selection_policy_version, candidate_set_digest, candidate_count)
     values ($1, $2, 'bound', $3, $4, '{"input_slot":"px"}', $5, 'price-at-cutoff-selection.v1', $5, 1)`,
    [runId, slot, factId, observationId, HASH],
  );
}

test("0069 price observations", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "price-observations-0069");
  const db = await createDatabase(t, server, "price_observations_0069");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  await db.query(`
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
      values ('${POLYGON}', 'polygon_market', 'market_data', 'primary', 'licensed', now());
    insert into issuers (issuer_id, legal_name) values ('${IDS.issuer}', 'Price Corp');
    insert into instruments (instrument_id, issuer_id, asset_type) values ('0f000000-0000-4000-8000-0000000000b9', '${IDS.issuer}', 'common_stock');
    insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
      values ('${LISTING}', '0f000000-0000-4000-8000-0000000000b9', 'XNAS', 'PRCE', 'USD', 'America/New_York');
  `);

  await t.test("down then up rebuilds exactly what the canonical schema defines", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0069", "down");
    assert.equal((await db.query(`select to_regclass('price_observations')::text as t`)).rows[0].t, null);
    await applyMigration(db, "0069", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });

  let observationId = "";
  await t.test("the exact token is stored; the same statement again is the same row, a revised price a new one", async () => {
    observationId = (await insertObservation(db, { price: "142.0700" })).rows[0]!.observation_id;
    const long = "123456789.123456789123456789123456789";
    await insertObservation(db, { price: long, observed_at: "2024-06-06T20:00:00Z", known_at: null, fetched_at: "2024-06-06T20:00:00Z" });
    assert.deepEqual((await db.query(`select price_text from price_observations order by observed_at`)).rows.map((row) => row.price_text), [long, "142.0700"]);
    await expectRejected(db, `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, fetched_at, body_sha256)
                              values ('${LISTING}', '${POLYGON}', 'session_close', '142.0700', 'USD', '2024-06-07T20:00:00Z', '2024-06-08T00:00:00Z', '${"b".repeat(64)}')`,
      /price_observations_identity/);
    assert.equal((await insertObservation(db, { price: "142.08", known_at: "2024-06-07T21:00:00Z", fetched_at: "2024-06-07T21:00:00Z" })).rowCount, 1);
  });

  await t.test("an observation is never updated or deleted", async () => {
    await expectRejected(db, `update price_observations set price_text = '1' where observation_id = $1`, /append-only/, [observationId]);
    await expectRejected(db, `delete from price_observations where observation_id = $1`, /append-only/, [observationId]);
  });

  await t.test("a price is a positive number token on an unadjusted basis, known between its trade and its fetch", async () => {
    assert.equal((await insertObservation(db, { price: "1.5e+02", observed_at: "2024-06-05T20:00:00Z" })).rowCount, 1);
    for (const price of ["0", "0.00", "-1", "01", "1.", "abc"]) {
      await expectRejected(db, `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, fetched_at, body_sha256)
                                values ('${LISTING}', '${POLYGON}', 'last_trade', '${price}', 'USD', now(), now(), '${HASH}')`, /price_observations_price_text_check/);
    }
    await expectRejected(db, `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, fetched_at, body_sha256, adjustment_basis)
                              values ('${LISTING}', '${POLYGON}', 'last_trade', '1', 'USD', now(), now(), '${HASH}', 'split_adjusted')`, /price_observations_adjustment_basis_check/);
    await expectRejected(db, `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
                              values ('${LISTING}', '${POLYGON}', 'last_trade', '1', 'USD', '2024-06-07T20:00:00Z', '2024-06-07T19:59:59Z', '2024-06-07T21:00:00Z', '${HASH}')`,
      /price_observations_known_at/);
    await expectRejected(db, `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
                              values ('${LISTING}', '${POLYGON}', 'last_trade', '1', 'USD', '2024-06-07T20:00:00Z', '2024-06-07T21:00:01Z', '2024-06-07T21:00:00Z', '${HASH}')`,
      /price_observations_known_at/);
  });

  await t.test("a bound input is a price observation or a fact with its proofs, never both", async () => {
    const runId = await insertRun(db);
    await bindPrice(db, runId, "px", observationId);
    assert.deepEqual((await db.query(`select price_observation_id::text, fact_id from financial_run_inputs where input_slot = 'px'`)).rows, [{ price_observation_id: observationId, fact_id: null }]);
    await expectRejected(db, `insert into financial_run_inputs (run_id, input_slot, binding_status, fact_id, price_observation_id, bound_payload, payload_hash,
                                                                selection_policy_version, candidate_set_digest, candidate_count)
                              values ($1, 'py', 'bound', $2, $3, '{}', $4, 's.v1', $4, 1)`, /financial_run_inputs_binding/, [runId, IDS.originalFact, observationId, HASH]);
    await expectRejected(db, `insert into financial_run_inputs (run_id, input_slot, binding_status, bound_payload, payload_hash, selection_policy_version, candidate_set_digest, candidate_count)
                              values ($1, 'pz', 'bound', '{}', $2, 's.v1', $2, 1)`, /financial_run_inputs_binding/, [runId, HASH]);
  });

  await t.test("down refuses while a run bound a price", async () => {
    await assert.rejects(() => applyMigration(db, "0069", "down"), /reverting 0069 would drop certified inputs/);
    await db.query(`delete from financial_runs`);
    await db.query(`truncate price_observations cascade`);
    await applyMigration(db, "0069", "down");
    assert.deepEqual((await db.query(`select to_regclass('price_observations')::text as t,
                                             exists (select 1 from information_schema.columns where table_name = 'financial_run_inputs' and column_name = 'price_observation_id') as c`)).rows,
      [{ t: null, c: false }]);
    await applyMigration(db, "0069", "up");
  });
});
