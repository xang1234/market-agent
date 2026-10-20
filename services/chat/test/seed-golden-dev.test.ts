import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { assertNoGoldenDataset, seedGoldenDevDatabase } from "../scripts/seed-golden-dev.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import { AMD_Q2_2025_RELEASE, GOLDEN_AS_OF, GOLDEN_COMPANIES, GOLDEN_SOURCE_ID, goldenFixtureVersion } from "./golden/dataset.ts";

test("seedGoldenDevDatabase seeds the frozen dataset once and is a no-op on rerun", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-seed");
  const client = await connectedClient(t, databaseUrl);

  assert.equal(await seedGoldenDevDatabase(databaseUrl), "seeded");
  const factsAfterFirst = (await client.query<{ n: number }>(`select count(*)::int as n from facts`)).rows[0]!.n;
  assert.ok(factsAfterFirst > 0);

  // dev-shell reruns this on every `up`.
  assert.equal(await seedGoldenDevDatabase(databaseUrl), "already-seeded");
  const factsAfterSecond = (await client.query<{ n: number }>(`select count(*)::int as n from facts`)).rows[0]!.n;
  assert.equal(factsAfterSecond, factsAfterFirst);

  const tickers = (await client.query<{ ticker: string }>(`select ticker from listings order by ticker`)).rows.map((r) => r.ticker);
  assert.deepEqual(tickers, GOLDEN_COMPANIES.map((c) => c.ticker).sort());
});

test("assertNoGoldenDataset passes on a live database and rejects one holding the frozen dataset", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-assert-absent");
  await assertNoGoldenDataset(databaseUrl);
  await seedGoldenDevDatabase(databaseUrl);
  await assert.rejects(() => assertNoGoldenDataset(databaseUrl), /frozen golden dataset.*down -v/s);
});

test("seedGoldenDevDatabase leaves nothing half-seeded when a golden ticker is already taken", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-seed-conflict");
  const client = await connectedClient(t, databaseUrl);
  // A provider-hydrated AAPL (different ids) already holds XNAS:AAPL.
  const issuer = await client.query<{ id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as id`,
  );
  const instrument = await client.query<{ id: string }>(
    `insert into instruments (issuer_id, asset_type) values ($1::uuid, 'common_stock') returning instrument_id::text as id`,
    [issuer.rows[0]!.id],
  );
  await client.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1::uuid, 'XNAS', 'AAPL', 'USD', 'America/New_York')`,
    [instrument.rows[0]!.id],
  );

  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), /golden dataset.*fresh database/i);
  const facts = (await client.query<{ n: number }>(`select count(*)::int as n from facts`)).rows[0]!.n;
  assert.equal(facts, 0, "the failed seed rolled back entirely");
});

test("a database seeded before #282 gets the filed claim on the next run, once (#291 review)", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-backfill");
  const client = await connectedClient(t, databaseUrl);
  const filed = async () => (await client.query<{ n: number }>(
    `select count(*)::int as n from claims where text_canonical = $1`, [AMD_Q2_2025_RELEASE.text],
  )).rows[0]!.n;

  assert.equal(await seedGoldenDevDatabase(databaseUrl), "seeded");
  assert.equal(await filed(), 1);
  // As a pre-#282 database: the golden companies, but no filed claim.
  await client.query(`delete from documents where source_id in (select source_id from sources where canonical_url = $1)`, [AMD_Q2_2025_RELEASE.url]);
  await client.query(`delete from sources where canonical_url = $1`, [AMD_Q2_2025_RELEASE.url]);
  assert.equal(await filed(), 0);

  assert.equal(await seedGoldenDevDatabase(databaseUrl), "already-seeded");
  assert.equal(await filed(), 1, "the filed claim is backfilled");
  await seedGoldenDevDatabase(databaseUrl);
  assert.equal(await filed(), 1, "and never duplicated");
});

test("a database seeded before the golden source moves its facts there and proves them, once", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-proofs");
  const client = await connectedClient(t, databaseUrl);
  const issuerIds = GOLDEN_COMPANIES.map((company) => company.issuer_id);
  const counts = async () => (await client.query(
    `select (select count(*)::int from facts where source_id = $1::uuid) as golden_facts,
            (select count(*)::int from facts
              where source_id = $2::uuid
                and ((subject_kind = 'issuer' and subject_id = any($3::uuid[]))
                     or (subject_kind = 'segment' and subject_id in (select segment_id from segments where issuer_id = any($3::uuid[]))))) as sec_facts,
            (select count(*)::int from current_fact_precision_attestations where precision_class = 'source_token_preserved') as precision_proofs,
            (select count(*)::int from fact_financial_contexts) as contexts,
            (select count(*)::int from source_publication_attestations where proof_method = 'fixture_declaration') as fixture_proofs`,
    [GOLDEN_SOURCE_ID, SEC_EDGAR_FILING_SOURCE_ID, issuerIds],
  )).rows[0];
  const proven = { golden_facts: 125, sec_facts: 0, precision_proofs: 120, contexts: 120, fixture_proofs: 1 };

  assert.equal(await seedGoldenDevDatabase(databaseUrl), "seeded");
  assert.deepEqual(await counts(), proven, "a fresh seed proves the golden facts");
  await client.query(`delete from source_publication_attestations where source_id = $1::uuid`, [GOLDEN_SOURCE_ID]);
  await client.query(`delete from fact_precision_attestations where source_id = $1::uuid`, [GOLDEN_SOURCE_ID]);
  await client.query(`delete from fact_financial_contexts where fact_id in (select fact_id from facts where source_id = $1::uuid)`, [GOLDEN_SOURCE_ID]);
  await client.query(`update facts set source_id = $2::uuid where source_id = $1::uuid`, [GOLDEN_SOURCE_ID, SEC_EDGAR_FILING_SOURCE_ID]);
  await client.query(`delete from sources where source_id = $1::uuid`, [GOLDEN_SOURCE_ID]);
  const legacy = { golden_facts: 0, sec_facts: 125, precision_proofs: 0, contexts: 0, fixture_proofs: 0 };
  assert.deepEqual(await counts(), legacy, "as a database seeded before the golden source");

  const editRevenue = (delta: number) => client.query(
    `update facts f set value_num = f.value_num + $2 from metrics m
      where m.metric_id = f.metric_id and m.metric_key = 'revenue' and f.subject_id = $1::uuid and f.fiscal_year = 2026 and f.fiscal_period = 'FY'`,
    [GOLDEN_COMPANIES[0]!.issuer_id, delta],
  );
  await editRevenue(1);
  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), (error: Error) => {
    assert.match(error.message, /facts differ from the dataset \(golden dataset: expected one stored fact for NVDA\.2026\.FY\.revenue, found 0\).*down -v/s);
    assert.equal((error.cause as Error).name, "GoldenFactMismatchError");
    return true;
  });
  assert.deepEqual(await counts(), legacy, "a database whose facts differ is left as it was");
  await editRevenue(-1);

  const setRevenueScale = (scale: number) => client.query(
    `update facts f set scale = $2 from metrics m
      where m.metric_id = f.metric_id and m.metric_key = 'revenue' and f.subject_id = $1::uuid and f.fiscal_year = 2026 and f.fiscal_period = 'FY'`,
    [GOLDEN_COMPANIES[0]!.issuer_id, scale],
  );
  await setRevenueScale(1000);
  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), /facts differ from the dataset \(golden dataset: expected one stored fact for NVDA\.2026\.FY\.revenue, found 0\)/);
  assert.deepEqual(await counts(), legacy, "a fact with the dataset's value but another scale is not proven");
  await setRevenueScale(1);

  await client.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1::uuid, 'sec_edgar', 'filing', 'primary', 'public', now())`,
    [GOLDEN_SOURCE_ID],
  );
  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), (error: Error) => {
    assert.match(error.message, /source_version_hash does not identify the stored source version/);
    assert.doesNotMatch(error.message, /down -v/, "an error that is not a fact mismatch is not relabelled as one");
    return true;
  });
  assert.deepEqual(await counts(), legacy, "and the database is left as it was");
  await client.query(`delete from sources where source_id = $1::uuid`, [GOLDEN_SOURCE_ID]);

  const { rows: [undeclared] } = await client.query<{ fact_id: string }>(
    `with segment as (
       insert into segments (issuer_id, axis, name, definition_as_of) values ($1::uuid, 'business', 'Undeclared Segment', $2::timestamptz)
       returning segment_id)
     insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence)
     select 'segment', segment.segment_id, m.metric_id, 'fiscal_q', '2025-10-27', '2026-01-25', 2026, 'Q4', 1000000000, 'currency', 'USD', 1,
            $2::timestamptz, $2::timestamptz, $2::timestamptz, $3::uuid, 'reported', 'authoritative', 'filing_time', 'full', 1
       from segment, metrics m where m.metric_key = 'revenue'
     returning fact_id::text`,
    [GOLDEN_COMPANIES[0]!.issuer_id, GOLDEN_AS_OF, SEC_EDGAR_FILING_SOURCE_ID],
  );
  const declaredOnly = { ...proven, sec_facts: 1 };

  assert.equal(await seedGoldenDevDatabase(databaseUrl), "already-seeded");
  assert.deepEqual(await counts(), declaredOnly, "the declared facts are moved and proven");
  const { rows: [kept] } = await client.query<{ source_id: string }>(`select source_id::text from facts where fact_id = $1::uuid`, [undeclared!.fact_id]);
  assert.equal(kept!.source_id, SEC_EDGAR_FILING_SOURCE_ID, "a segment fact the dataset does not declare stays on its own source");
  assert.equal(await seedGoldenDevDatabase(databaseUrl), "already-seeded");
  assert.deepEqual(await counts(), declaredOnly, "and never proven twice");
});

test("a database proven for an earlier version of the dataset is told to reset, not reported seeded", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-version");
  const client = await connectedClient(t, databaseUrl);
  assert.equal(await seedGoldenDevDatabase(databaseUrl), "seeded");
  const earlier = "0".repeat(64);
  await client.query(`delete from source_publication_attestations where source_id = $1::uuid`, [GOLDEN_SOURCE_ID]);
  await client.query(`update sources set content_hash = $2 where source_id = $1::uuid`, [GOLDEN_SOURCE_ID, `sha256:${earlier}`]);
  await client.query(
    `insert into source_publication_attestations
       (source_id, source_version_hash, available_no_later_than, timing_precision, source_timezone, proof_method, proof_ref, proof_hash, mapping_version)
     values ($1::uuid, $2, $3::timestamptz, 'instant', 'UTC', 'fixture_declaration', 'golden_fixture:dataset.ts', $2, 'golden-fixture-declaration.v1')`,
    [GOLDEN_SOURCE_ID, earlier, GOLDEN_AS_OF],
  );

  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), /holds an earlier version of the dataset.*down -v/s);
});

test("moving only the cutoff makes a dev database proven at the earlier cutoff get the reset hint", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-cutoff");
  const client = await connectedClient(t, databaseUrl);
  assert.equal(await seedGoldenDevDatabase(databaseUrl), "seeded");
  const earlierCutoff = "2026-08-01T00:00:00.000Z";
  const stamped = goldenFixtureVersion(earlierCutoff);
  await client.query(`delete from source_publication_attestations where source_id = $1::uuid`, [GOLDEN_SOURCE_ID]);
  await client.query(`update sources set content_hash = $2 where source_id = $1::uuid`, [GOLDEN_SOURCE_ID, `sha256:${stamped}`]);
  await client.query(
    `insert into source_publication_attestations
       (source_id, source_version_hash, available_no_later_than, timing_precision, source_timezone, proof_method, proof_ref, proof_hash, mapping_version)
     values ($1::uuid, $2, $3::timestamptz, 'instant', 'UTC', 'fixture_declaration', 'golden_fixture:dataset.ts', $2, 'golden-fixture-declaration.v1')`,
    [GOLDEN_SOURCE_ID, stamped, earlierCutoff],
  );

  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), /holds an earlier version of the dataset.*down -v/s);
});
