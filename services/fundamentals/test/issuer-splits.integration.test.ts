import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { findIssuerSplits, ISSUER_KEYED_ROWS, repairIssuerSplits } from "../src/issuer-splits.ts";

const id = (n: number) => `39000000-0000-4000-8000-0000000011${String(n).padStart(2, "0")}`;
const quiet = { log: () => {} };

async function insertListedIssuer(db: Pool, issuerId: string, name: string, cik: string | null, ticker: string): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, name, cik]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuerId]);
  await db.query(`insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1, 'XNAS', $2, 'USD', 'America/New_York')`, [issuerId, ticker]);
}

async function insertSource(db: Pool, provider: string): Promise<string> {
  const { rows: [source] } = await db.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'filing', 'primary', 'public', now()) returning source_id::text as source_id`,
    [provider],
  );
  return source!.source_id;
}

async function insertDocument(db: Pool, sourceId: string, kind = "article"): Promise<string> {
  const { rows: [document] } = await db.query<{ document_id: string }>(
    `insert into documents (source_id, kind, content_hash, raw_blob_id) values ($1, $2, gen_random_uuid()::text, 'blob') returning document_id::text as document_id`,
    [sourceId, kind],
  );
  return document!.document_id;
}

async function insertFact(db: Pool | PoolClient, issuerId: string, sourceId: string): Promise<void> {
  await db.query(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap') on conflict (metric_key) do nothing`,
  );
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
     select 'issuer', $1, metric_id, 'fiscal_y', '2025-12-31', 2025, 'FY', 1, 'currency', 'USD', 1, now(), now(), $2, 'reported', 'authoritative', 'filing_time', 'full', 1
       from metrics where metric_key = 'revenue'`,
    [issuerId, sourceId],
  );
}

async function withoutForeignKeys(db: Pool, sql: string, params: unknown[]): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(sql, params);
    await client.query("commit");
  } finally {
    client.release();
  }
}

// Returns once n sessions wait on an advisory lock, or once work settles without waiting.
async function lockWaiters(db: Pool, n: number, work: Promise<unknown>): Promise<void> {
  let settled = false;
  work.then(() => (settled = true), () => (settled = true));
  const waiting = async () => (await db.query<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`)).rows[0]!.n;
  while (!settled && (await waiting()) < n) await sleep(20);
}

// Two issuers of one CIK, the older first, so the newer merges into it.
async function insertCikPair(db: Pool): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name, cik, created_at) values ($1, 'Apple Inc.', '320193', '2020-01-01')`, [id(1)]);
  await insertListedIssuer(db, id(2), "Apple Inc", "0000320193", "AAPL");
}

const identity = (db: Pool) =>
  db.query(
    `select coalesce(l.ticker, '-') as ticker, iss.issuer_id::text as issuer_id, iss.legal_name, iss.former_names, iss.cik
       from issuers iss
       left join instruments i on i.issuer_id = iss.issuer_id
       left join listings l on l.instrument_id = i.instrument_id
      order by 1, 2`,
  ).then(({ rows }) => rows);

test("each split pair merges onto the issuer with the SEC identity, and a rerun changes nothing (#597)", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-splits");
  const db = await connectedPool(t, databaseUrl);
  const golden = await insertSource(db, "golden_fixture");
  const sec = await insertSource(db, "sec_edgar");
  // The golden issuers hold facts and no listing. Golden AAPL keeps its CIK, padded as the seed once wrote it, beside the import's AAPL issuer with none.
  // The CIK fill moved golden NVDA's CIK to the provider's NVDA issuer, which already holds a real filing's figure for the golden one's period.
  // Golden AMD's CIK, padded, is also the provider's AMD issuer's without its zeros.
  await db.query(
    `insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '0000320193'), ($2, 'NVIDIA Corporation', null), ($3, 'Advanced Micro Devices, Inc.', '0000002488')`,
    [GOLDEN_ISSUER_IDS.AAPL, GOLDEN_ISSUER_IDS.NVDA, GOLDEN_ISSUER_IDS.AMD],
  );
  for (const issuerId of Object.values(GOLDEN_ISSUER_IDS)) await insertFact(db, issuerId, golden);
  await insertListedIssuer(db, id(1), "Apple Inc", null, "AAPL");
  await insertListedIssuer(db, id(2), "Nvidia Corp", "1045810", "NVDA");
  await insertFact(db, id(2), sec);
  await insertListedIssuer(db, id(10), "Advanced Micro Devices", "2488", "AMD");
  // Alphabet's share classes. The fill gave the CIK to GOOGL's issuer, so GOOG's has none.
  await insertListedIssuer(db, id(3), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(4), "Alphabet Inc", null, "GOOG");
  // A plain name the kept name does not start with is another spelling of it, not its name without the share class.
  await insertListedIssuer(db, id(11), "Meta Platforms, Inc. Class A Common Stock", "1326801", "META");
  await insertListedIssuer(db, id(12), "Meta Platforms Corp.", null, "FB");
  // AMJB is an ETN JPMorgan files under its own CIK, another security and not the bank.
  await insertListedIssuer(db, id(5), "JPMorgan Chase & Co", "19617", "JPM");
  await insertListedIssuer(db, id(6), "JPMorgan Chase Financial Company LLC Alerian MLP Index ETNs", null, "AMJB");
  // Even where SEC files its ticker under Apple's CIK, "Apple Holdings" names another company than Apple Inc.
  await insertListedIssuer(db, id(7), "Apple Holdings", null, "APLH");
  // A CIK of zeros names no filer.
  await insertListedIssuer(db, id(8), "Zero One", "0", "ZRO1");
  await insertListedIssuer(db, id(9), "Zero Two", "00", "ZRO2");
  const ciks = new Map([
    ["AAPL", "320193"], ["NVDA", "1045810"], ["AMD", "2488"], ["GOOGL", "1652044"], ["GOOG", "1652044"], ["META", "1326801"], ["FB", "1326801"],
    ["JPM", "19617"], ["AMJB", "19617"], ["APLH", "320193"],
  ]);

  // AMD's pair also holds one CIK, and still merges once, onto the issuer listing AMD.
  assert.deepEqual(
    (await findIssuerSplits(db, ciks)).map(({ keep, drop, basis }) => ({ keep, drop, basis })),
    [
      { keep: id(10), drop: GOLDEN_ISSUER_IDS.AMD, basis: "golden issuer of AMD" },
      { keep: id(1), drop: GOLDEN_ISSUER_IDS.AAPL, basis: "golden issuer of AAPL" },
      { keep: id(2), drop: GOLDEN_ISSUER_IDS.NVDA, basis: "golden issuer of NVDA" },
      { keep: id(3), drop: id(4), basis: "GOOG files under CIK 1652044" },
      { keep: id(11), drop: id(12), basis: "FB files under CIK 1326801" },
    ],
  );

  const lines: string[] = [];
  assert.equal((await repairIssuerSplits(db, ciks, { log: (line: string) => lines.push(line) })).merged.length, 5);
  assert.deepEqual(lines, [
    `merged issuer ${GOLDEN_ISSUER_IDS.AMD} (Advanced Micro Devices, Inc.) into ${id(10)} (Advanced Micro Devices): golden issuer of AMD`,
    `merged issuer ${GOLDEN_ISSUER_IDS.AAPL} (Apple Inc.) into ${id(1)} (Apple Inc): golden issuer of AAPL`,
    `merged issuer ${GOLDEN_ISSUER_IDS.NVDA} (NVIDIA Corporation) into ${id(2)} (Nvidia Corp): golden issuer of NVDA`,
    `merged issuer ${id(4)} (Alphabet Inc) into ${id(3)} (Alphabet Inc. Class A Common Stock): GOOG files under CIK 1652044`,
    `merged issuer ${id(12)} (Meta Platforms Corp.) into ${id(11)} (Meta Platforms, Inc. Class A Common Stock): FB files under CIK 1326801`,
    `stored CIK 0000320193 of issuer ${id(1)} (Apple Inc) as 320193`,
  ]);
  const merged = await identity(db);
  // GOOGL's issuer takes GOOG's plain name, "Apple Inc." adds nothing to "Apple Inc", and each other merged name stays a name the issuer goes by.
  assert.deepEqual(merged, [
    { ticker: "AAPL", issuer_id: id(1), legal_name: "Apple Inc", former_names: [], cik: "320193" },
    { ticker: "AMD", issuer_id: id(10), legal_name: "Advanced Micro Devices", former_names: ["Advanced Micro Devices, Inc."], cik: "2488" },
    { ticker: "AMJB", issuer_id: id(6), legal_name: "JPMorgan Chase Financial Company LLC Alerian MLP Index ETNs", former_names: [], cik: null },
    { ticker: "APLH", issuer_id: id(7), legal_name: "Apple Holdings", former_names: [], cik: null },
    { ticker: "FB", issuer_id: id(11), legal_name: "Meta Platforms, Inc. Class A Common Stock", former_names: ["Meta Platforms Corp."], cik: "1326801" },
    { ticker: "GOOG", issuer_id: id(3), legal_name: "Alphabet Inc", former_names: ["Alphabet Inc. Class A Common Stock"], cik: "1652044" },
    { ticker: "GOOGL", issuer_id: id(3), legal_name: "Alphabet Inc", former_names: ["Alphabet Inc. Class A Common Stock"], cik: "1652044" },
    { ticker: "JPM", issuer_id: id(5), legal_name: "JPMorgan Chase & Co", former_names: [], cik: "19617" },
    { ticker: "META", issuer_id: id(11), legal_name: "Meta Platforms, Inc. Class A Common Stock", former_names: ["Meta Platforms Corp."], cik: "1326801" },
    { ticker: "NVDA", issuer_id: id(2), legal_name: "Nvidia Corp", former_names: ["NVIDIA Corporation"], cik: "1045810" },
    { ticker: "ZRO1", issuer_id: id(8), legal_name: "Zero One", former_names: [], cik: "0" },
    { ticker: "ZRO2", issuer_id: id(9), legal_name: "Zero Two", former_names: [], cik: "00" },
  ]);
  // The golden figures go with their issuers. The filing's figure retires NVIDIA's golden one for its period, as a filing ingested later would.
  const { rows: facts } = await db.query(
    `select s.provider, f.subject_id::text as issuer_id, f.invalidated_at is null as active, r.provider as superseded_by
       from facts f join sources s using (source_id) left join facts n on n.fact_id = f.superseded_by left join sources r on r.source_id = n.source_id
      order by f.subject_id, s.provider`,
  );
  assert.deepEqual(facts, [
    { provider: "golden_fixture", issuer_id: id(1), active: true, superseded_by: null },
    { provider: "golden_fixture", issuer_id: id(2), active: false, superseded_by: "sec_edgar" },
    { provider: "sec_edgar", issuer_id: id(2), active: true, superseded_by: null },
    { provider: "golden_fixture", issuer_id: id(10), active: true, superseded_by: null },
  ]);

  assert.deepEqual(await findIssuerSplits(db, ciks), []);
  const rerun: string[] = [];
  assert.deepEqual(await repairIssuerSplits(db, ciks, { log: (line: string) => rerun.push(line) }), { merged: [], skipped: [] }, "a rerun merges nothing");
  assert.deepEqual(rerun, []);
  assert.deepEqual(await identity(db), merged);
});

test("a merge moves every row keyed by the merged issuer, the kept issuer's own row wins a clash, and the newest download date is kept", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-rows");
  const db = await connectedPool(t, databaseUrl);
  await insertListedIssuer(db, id(1), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(2), "Alphabet Inc", null, "GOOG");
  await db.query(`update issuers set former_names = '["Alphabet Inc. Class A Capital Stock"]' where issuer_id = $1`, [id(1)]);
  await db.query(`update issuers set sector = 'Communication Services', former_names = '["Google Inc."]' where issuer_id = $1`, [id(2)]);
  const vendor = await insertSource(db, "xang1234_stock_screener");
  await insertFact(db, id(2), vendor);
  // Each issuer holds its own reading of one profile field from one source, its own companyfacts download, and its own certified P/E.
  await db.query(
    `insert into issuer_profile_enrichments (issuer_id, field_name, field_value, source_id, provider, retrieved_at)
     values ($1, 'industry', 'Internet Content & Information', $3, 'vendor', now()), ($2, 'industry', 'Interactive Media', $3, 'vendor', now())`,
    [id(1), id(2), vendor],
  );
  // The dropped issuer's download is the newer one: its date is the watermark that keeps an older download from re-inferring (#342).
  await db.query(`insert into sec_issuer_downloads (issuer_id, newest_filed) values ($1, '2026-07-24'), ($2, '2026-10-29')`, [id(1), id(2)]);
  // A certified valuation's snapshot and run play no part in a merge.
  await withoutForeignKeys(
    db,
    `insert into screener_certified_valuations (issuer_id, valuation, knowledge_cutoff, session_date, value, snapshot_id, financial_run_id, financial_unit_id)
     values ($1, 'pe_ratio', now(), '2026-11-06', 25, gen_random_uuid(), gen_random_uuid(), 'pe'), ($2, 'pe_ratio', now(), '2026-11-06', 24, gen_random_uuid(), gen_random_uuid(), 'pe')`,
    [id(1), id(2)],
  );
  const { rows: [user] } = await db.query<{ user_id: string }>(`insert into users (email) values ('owner@example.com') returning user_id::text as user_id`);
  const { rows: lists } = await db.query<{ watchlist_id: string }>(
    `insert into watchlists (user_id, name, mode) values ($1, 'Both', 'manual'), ($1, 'GOOG only', 'manual') returning watchlist_id::text as watchlist_id`,
    [user!.user_id],
  );
  await db.query(
    `insert into watchlist_members (watchlist_id, subject_kind, subject_id) values ($1, 'issuer', $3), ($1, 'issuer', $4), ($2, 'issuer', $4)`,
    [lists[0]!.watchlist_id, lists[1]!.watchlist_id, id(1), id(2)],
  );
  // GOOG's instrument shares its issuer's id here. A thread on the instrument stays on it.
  await db.query(
    `insert into chat_threads (user_id, primary_subject_kind, primary_subject_id, title) values ($1, 'issuer', $2, 'GOOG'), ($1, 'instrument', $2, 'GOOG shares')`,
    [user!.user_id, id(2)],
  );
  await db.query(`insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) values ($1, 'issuer', $2, 'headline', 1)`, [
    await insertDocument(db, vendor),
    id(2),
  ]);
  // A filing claim names its filer twice, as the claim's attribution and as its subject argument (sec-10k-claims.ts).
  await db.query(
    `with claim as (
       insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status)
       values ($1, 'risk_factor', 'Alphabet faces competition.', 'negative', 'asserted', $2, 'issuer', $3::text, 1, 'extracted') returning claim_id)
     insert into claim_arguments (claim_id, subject_kind, subject_id, role) select claim_id, 'issuer', $3::uuid, 'subject' from claim`,
    [await insertDocument(db, vendor, "filing"), vendor, id(2)],
  );
  // Consensus rows are append-only. Both classes captured 2026-11-09; only GOOG captured 2026-11-10.
  await db.query(
    `insert into consensus_captures (issuer_id, listing_id, source_id, captured_on, retrieved_at, field_key, raw_label, raw_value, value, unit)
     select i.issuer_id, l.listing_id, $1::uuid, day, now(), 'target_price', 'Target Price', l.ticker, 1, 'usd'
       from listings l join instruments i using (instrument_id), unnest($2::date[]) as day
      where l.ticker = 'GOOGL' and day = '2026-11-09' or l.ticker = 'GOOG'`,
    [vendor, ["2026-11-09", "2026-11-10"]],
  );

  await repairIssuerSplits(db, new Map([["GOOGL", "1652044"], ["GOOG", "1652044"]]), quiet);

  const { rows: issuers } = await db.query(`select issuer_id::text as issuer_id, legal_name, former_names, cik, sector from issuers`);
  assert.deepEqual(issuers, [
    {
      issuer_id: id(1),
      legal_name: "Alphabet Inc",
      former_names: ["Alphabet Inc. Class A Capital Stock", "Alphabet Inc. Class A Common Stock", "Google Inc."],
      cik: "1652044",
      sector: "Communication Services",
    },
  ]);
  const { rows: aliases } = await db.query(`select normalized_name from issuer_aliases where issuer_id = $1 order by 1`, [id(1)]);
  assert.deepEqual(aliases.map((alias) => alias.normalized_name), ["alphabet inc", "alphabet inc class a capital stock", "alphabet inc class a common stock", "google inc"]);
  const { rows: kept } = await db.query(
    `select 'certified P/E' as row, issuer_id::text as issuer_id, value::text as value from screener_certified_valuations
     union all select 'download', issuer_id::text, newest_filed::text from sec_issuer_downloads
     union all select 'industry', issuer_id::text, field_value from issuer_profile_enrichments
     order by 1`,
  );
  assert.deepEqual(kept, [
    { row: "certified P/E", issuer_id: id(1), value: "25" },
    { row: "download", issuer_id: id(1), value: "2026-10-29" },
    { row: "industry", issuer_id: id(1), value: "Internet Content & Information" },
  ]);
  const { rows: members } = await db.query(`select w.name, m.subject_id::text as subject_id from watchlist_members m join watchlists w using (watchlist_id) order by w.name`);
  assert.deepEqual(members, [{ name: "Both", subject_id: id(1) }, { name: "GOOG only", subject_id: id(1) }]);
  const { rows: captures } = await db.query(`select issuer_id::text as issuer_id, captured_on::text as captured_on, raw_value from consensus_captures order by captured_on`);
  assert.deepEqual(captures, [
    { issuer_id: id(1), captured_on: "2026-11-09", raw_value: "GOOGL" },
    { issuer_id: id(1), captured_on: "2026-11-10", raw_value: "GOOG" },
  ]);
  const { rows: subjects } = await db.query(
    `select 'fact' as row, subject_id::text as subject_id from facts
     union all select 'mention', subject_id::text from mentions
     union all select 'thread on ' || primary_subject_kind, primary_subject_id::text from chat_threads
     union all select 'claim argument', subject_id::text from claim_arguments
     union all select 'claim attribution', attributed_to_id from claims
     order by 1`,
  );
  assert.deepEqual(subjects, [
    { row: "claim argument", subject_id: id(1) },
    { row: "claim attribution", subject_id: id(1) },
    { row: "fact", subject_id: id(1) },
    { row: "mention", subject_id: id(1) },
    { row: "thread on instrument", subject_id: id(2) },
    { row: "thread on issuer", subject_id: id(1) },
  ]);
});

test("a clash adds up both issuers' positions and mention counts and keeps their rationales and IR source links", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-clash");
  const db = await connectedPool(t, databaseUrl);
  await insertListedIssuer(db, id(1), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(2), "Alphabet Inc", null, "GOOG");
  const sec = await insertSource(db, "sec_edgar");
  // One 13F lists both classes. While they were two issuers, the resolver stored each class's position on its own.
  await db.query(
    `insert into institutional_holdings (filer_cik, filer_name, issuer_id, cusip, shares, value_usd, filing_period, filing_date, source_id, accession)
     values ('1067983', 'Berkshire Hathaway Inc', $1, '02079K305', 100, 20000, '2026-06-30', '2026-08-14', $3, '0000950123-26-000001'),
            ('1067983', 'Berkshire Hathaway Inc', $2, '02079K107', 50, 10000, '2026-06-30', '2026-08-14', $3, '0000950123-26-000001')`,
    [id(1), id(2), sec],
  );
  // One article names each class in its body.
  const article = await insertDocument(db, sec);
  await db.query(
    `insert into mentions (document_id, subject_kind, subject_id, prominence, mention_count, confidence)
     values ($1, 'issuer', $2, 'body', 2, 0.6), ($1, 'issuer', $3, 'body', 3, 0.9)`,
    [article, id(1), id(2)],
  );
  const { rows: [theme] } = await db.query<{ theme_id: string }>(`insert into themes (name, membership_mode) values ('AI', 'manual') returning theme_id::text as theme_id`);
  const [claimA, claimB] = ["39000000-0000-4000-8000-00000000a001", "39000000-0000-4000-8000-00000000a002"];
  await db.query(
    `insert into theme_memberships (theme_id, subject_kind, subject_id, rationale_claim_ids)
     values ($1, 'issuer', $2, jsonb_build_array($4::text)), ($1, 'issuer', $3, jsonb_build_array($5::text, $4::text))`,
    [theme!.theme_id, id(1), id(2), claimA, claimB],
  );
  // Both issuers registered Alphabet's IR feed. Each took in the Q1 release, and only GOOG's took in Q2.
  const { rows: feeds } = await db.query<{ ir_source_id: string }>(
    `insert into ir_source_registry (issuer_id, source_type, url) values ($1, 'rss', 'https://abc.xyz/investor/rss'), ($2, 'rss', 'https://abc.xyz/investor/rss')
     returning ir_source_id::text as ir_source_id`,
    [id(1), id(2)],
  );
  const releases = [await insertDocument(db, sec, "press_release"), await insertDocument(db, sec, "press_release"), await insertDocument(db, sec, "press_release")];
  await db.query(
    `insert into ir_document_assets (ir_source_id, issuer_id, document_id, source_id, asset_kind, canonical_url, discovered_at, fetched_at)
     values ($1, $3, $5, $8, 'press_release', 'https://abc.xyz/investor/2026-q1.pdf', now(), now()),
            ($2, $4, $6, $8, 'press_release', 'https://abc.xyz/investor/2026-q1.pdf', now(), now()),
            ($2, $4, $7, $8, 'press_release', 'https://abc.xyz/investor/2026-q2.pdf', now(), now())`,
    [feeds[0]!.ir_source_id, feeds[1]!.ir_source_id, id(1), id(2), ...releases, sec],
  );

  await repairIssuerSplits(db, new Map([["GOOGL", "1652044"], ["GOOG", "1652044"]]), quiet);

  const { rows: holdings } = await db.query(`select issuer_id::text as issuer_id, cusip, shares::int as shares, value_usd::int as value_usd from institutional_holdings`);
  assert.deepEqual(holdings, [{ issuer_id: id(1), cusip: "02079K305", shares: 150, value_usd: 30000 }]);
  const { rows: mentions } = await db.query(`select subject_id::text as subject_id, mention_count, confidence::float8 as confidence from mentions`);
  assert.deepEqual(mentions, [{ subject_id: id(1), mention_count: 5, confidence: 0.9 }]);
  const { rows: memberships } = await db.query(
    `select subject_id::text as subject_id, (select array_agg(e order by e) from jsonb_array_elements_text(rationale_claim_ids) e) as rationale from theme_memberships`,
  );
  assert.deepEqual(memberships, [{ subject_id: id(1), rationale: [claimA, claimB] }]);
  const { rows: assets } = await db.query(
    `select issuer_id::text as issuer_id, ir_source_id::text as ir_source_id, document_id::text as document_id from ir_document_assets order by canonical_url`,
  );
  assert.deepEqual(assets, [
    { issuer_id: id(1), ir_source_id: feeds[0]!.ir_source_id, document_id: releases[0] },
    { issuer_id: id(1), ir_source_id: feeds[0]!.ir_source_id, document_id: releases[2] },
  ]);
});

test("a pair holding rows the merge cannot combine stays apart and is reported, and the other pairs still merge", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-skip");
  const db = await connectedPool(t, databaseUrl);
  const vendor = await insertSource(db, "xang1234_stock_screener");
  await db.query(
    `insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '320193'), ($2, 'NVIDIA Corporation', '0001045810'), ($3, 'Advanced Micro Devices, Inc.', '0000002488')`,
    [GOLDEN_ISSUER_IDS.AAPL, GOLDEN_ISSUER_IDS.NVDA, GOLDEN_ISSUER_IDS.AMD],
  );
  // A ticker can pass to another company. This one lists AAPL under its own CIK.
  await insertListedIssuer(db, id(1), "Other Co", "999999", "AAPL");
  // A provider row moved NVDA's listing to a second holder of its CIK, and both defined one segment.
  await insertListedIssuer(db, id(2), "Nvidia Corp", "1045810", "NVDA");
  await db.query(
    `insert into segments (issuer_id, axis, name, definition_as_of) values ($1, 'business', 'Data Center', '2025-01-26'), ($2, 'business', 'Data Center', '2025-01-26')`,
    [GOLDEN_ISSUER_IDS.NVDA, id(2)],
  );
  // Both of Alphabet's issuers hold the vendor's revenue for one fiscal year.
  await insertListedIssuer(db, id(3), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(4), "Alphabet Inc", null, "GOOG");
  await insertFact(db, id(3), vendor);
  await insertFact(db, id(4), vendor);
  // One discovery run found both of Berkshire's classes. Its campaign and run play no part in a merge.
  await insertListedIssuer(db, id(5), "Berkshire Hathaway Inc", "1067983", "BRK.A");
  await insertListedIssuer(db, id(6), "Berkshire Hathaway Inc. Class B", null, "BRK.B");
  await withoutForeignKeys(
    db,
    `insert into discovery_candidates (candidate_id, run_id, lead_key, issuer_id, listing_id, origins, mechanism_ids, lead_hit_ids, reason_codes, first_seen, seed, primary_domain_lead, name, state)
     select gen_random_uuid(), $1, l.ticker, i.issuer_id, l.listing_id, '[]', '[]', '[]', '[]', '[1, 2]', false, false, l.ticker, 'discovered'
       from instruments i join listings l using (instrument_id) where i.issuer_id = any($2::uuid[])`,
    ["39000000-0000-4000-8000-00000000b001", [id(5), id(6)]],
  );
  // A second holder of AMD's CIK, older than the golden one and listing nothing, with nothing that clashes. It holds a filing's
  // figure for a period golden AMD holds its own for.
  await db.query(`insert into issuers (issuer_id, legal_name, cik, created_at) values ($1, 'Advanced Micro Devices, Incorporated', '2488', '2020-01-01')`, [id(7)]);
  await insertFact(db, GOLDEN_ISSUER_IDS.AMD, await insertSource(db, "golden_fixture"));
  await insertFact(db, id(7), await insertSource(db, "sec_edgar"));
  // A CIK of zeros names no filer, so it has no form without them.
  await insertListedIssuer(db, id(8), "Zero Co", "000", "ZRO");
  const ciks = new Map([["AAPL", "320193"], ["NVDA", "1045810"], ["GOOGL", "1652044"], ["GOOG", "1652044"], ["BRK.A", "1067983"], ["BRK.B", "1067983"]]);

  const skipped = [
    `skipped issuer ${GOLDEN_ISSUER_IDS.NVDA} (NVIDIA Corporation) into ${id(2)} (Nvidia Corp): golden issuer of NVDA; both hold a row under segments_issuer_id_axis_name_definition_as_of_key`,
    `skipped issuer ${id(4)} (Alphabet Inc) into ${id(3)} (Alphabet Inc. Class A Common Stock): GOOG files under CIK 1652044; both hold a row under facts_active_reported_identity_idx`,
    `skipped issuer ${id(6)} (Berkshire Hathaway Inc. Class B) into ${id(5)} (Berkshire Hathaway Inc): BRK.B files under CIK 1067983; both hold a row under discovery_candidate_issuer`,
  ];
  const lines: string[] = [];
  await repairIssuerSplits(db, ciks, { log: (line: string) => lines.push(line) });
  assert.deepEqual(lines, [
    `merged issuer ${id(7)} (Advanced Micro Devices, Incorporated) into ${GOLDEN_ISSUER_IDS.AMD} (Advanced Micro Devices, Inc.): holds CIK 2488`,
    ...skipped,
    `stored CIK 0000002488 of issuer ${GOLDEN_ISSUER_IDS.AMD} (Advanced Micro Devices, Inc.) as 2488`,
  ]);
  // NVIDIA's golden CIK keeps its zeros while Nvidia Corp holds the same CIK without them.
  const repaired = await identity(db);
  assert.deepEqual(
    repaired.map(({ ticker, issuer_id, cik }) => ({ ticker, issuer_id, cik })),
    [
      { ticker: "-", issuer_id: GOLDEN_ISSUER_IDS.NVDA, cik: "0001045810" },
      { ticker: "-", issuer_id: GOLDEN_ISSUER_IDS.AMD, cik: "2488" },
      { ticker: "-", issuer_id: GOLDEN_ISSUER_IDS.AAPL, cik: "320193" },
      { ticker: "AAPL", issuer_id: id(1), cik: "999999" },
      { ticker: "BRK.A", issuer_id: id(5), cik: "1067983" },
      { ticker: "BRK.B", issuer_id: id(6), cik: null },
      { ticker: "GOOG", issuer_id: id(4), cik: null },
      { ticker: "GOOGL", issuer_id: id(3), cik: "1652044" },
      { ticker: "NVDA", issuer_id: id(2), cik: "1045810" },
      { ticker: "ZRO", issuer_id: id(8), cik: "000" },
    ],
  );
  const { rows: held } = await db.query(
    `select 'fact ' || s.provider as row, subject_id::text as issuer_id from facts join sources s using (source_id) where invalidated_at is null
     union all select 'segment', issuer_id::text from segments
     union all select 'candidate', issuer_id::text from discovery_candidates
     order by 1, 2`,
  );
  assert.deepEqual(held, [
    { row: "candidate", issuer_id: id(5) },
    { row: "candidate", issuer_id: id(6) },
    // A frozen golden issuer keeps its own figures beside the merged issuer's.
    { row: "fact golden_fixture", issuer_id: GOLDEN_ISSUER_IDS.AMD },
    { row: "fact sec_edgar", issuer_id: GOLDEN_ISSUER_IDS.AMD },
    { row: "fact xang1234_stock_screener", issuer_id: id(3) },
    { row: "fact xang1234_stock_screener", issuer_id: id(4) },
    { row: "segment", issuer_id: id(2) },
    { row: "segment", issuer_id: GOLDEN_ISSUER_IDS.NVDA },
  ]);

  const rerun: string[] = [];
  await repairIssuerSplits(db, ciks, { log: (line: string) => rerun.push(line) });
  assert.deepEqual(rerun, skipped, "a rerun reports the same pairs and merges nothing");
  assert.deepEqual(await identity(db), repaired);
});

test("an error other than a clash aborts the run, and no merge before it stays", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-abort");
  const db = await connectedPool(t, databaseUrl);
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '320193')`, [GOLDEN_ISSUER_IDS.AAPL]);
  await insertListedIssuer(db, id(1), "Apple Inc", null, "AAPL");
  await insertListedIssuer(db, id(2), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(3), "Alphabet Inc", null, "GOOG");
  // AAPL's pair merges first. GOOGL's issuer then takes the plain name, which this check refuses.
  await db.query(`alter table issuers add constraint plain_alphabet_files_nothing check (legal_name <> 'Alphabet Inc' or cik is null)`);
  const before = await identity(db);

  await assert.rejects(
    repairIssuerSplits(db, new Map([["AAPL", "320193"], ["GOOGL", "1652044"], ["GOOG", "1652044"]]), quiet),
    { code: "23514", constraint: "plain_alphabet_files_nothing" },
  );
  assert.deepEqual(await identity(db), before);
});

test("a filing stored while the repair moves golden figures onto its issuer retires them", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-filing");
  const db = await connectedPool(t, databaseUrl);
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '320193')`, [GOLDEN_ISSUER_IDS.AAPL]);
  await insertFact(db, GOLDEN_ISSUER_IDS.AAPL, await insertSource(db, "golden_fixture"));
  await insertListedIssuer(db, id(1), "Apple Inc", null, "AAPL");
  const sec = await insertSource(db, "sec_edgar");
  // A filing for the golden figure's period is being stored for the live issuer, under storeFiling's lock.
  const writer = await db.connect();
  let repair: Promise<unknown>;
  try {
    await writer.query("begin");
    await writer.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [id(1)]);
    await writer.query(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
       select 'issuer', $1, metric_id, 'fiscal_y', '2025-12-31', 2025, 'FY', 2, 'currency', 'USD', 1, now(), now(), $2, 'reported', 'authoritative', 'filing_time', 'full', 1
         from metrics where metric_key = 'revenue'`,
      [id(1), sec],
    );
    let settled = false;
    repair = repairIssuerSplits(db, new Map([["AAPL", "320193"]]), quiet).finally(() => {
      settled = true;
    });
    while (!settled && (await db.query(`select 1 from pg_locks where locktype = 'advisory' and not granted`)).rowCount === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await writer.query("commit");
  } finally {
    writer.release();
  }
  await repair;

  const { rows } = await db.query(
    `select s.provider, f.subject_id::text as issuer_id, f.invalidated_at is null as active from facts f join sources s using (source_id) order by 1`,
  );
  assert.deepEqual(rows, [
    { provider: "golden_fixture", issuer_id: id(1), active: false },
    { provider: "sec_edgar", issuer_id: id(1), active: true },
  ]);
});

test("the merge names every column that names an issuer", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-schema");
  const db = await connectedPool(t, databaseUrl);
  // A column can name an issuer by a foreign key, by an id or text column with `issuer` in its name,
  // or as one kind of row beside a column saying which kind (`subject_kind`, `attributed_to_type`).
  // Primary key columns name their own row.
  const { rows } = await db.query<{ key: string }>(
    `with columns as (
       select c.table_name, c.column_name, c.udt_name
         from information_schema.columns c join information_schema.tables using (table_schema, table_name)
        where c.table_schema = 'public' and table_type = 'BASE TABLE'
          and not exists (
            select 1 from pg_constraint p join pg_attribute a on a.attrelid = p.conrelid and a.attnum = any(p.conkey)
             where p.contype = 'p' and p.conrelid = quote_ident(c.table_name)::regclass and a.attname = c.column_name)
     )
     select c.conrelid::regclass::text || '.' || a.attname as key
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'issuers'::regclass
     union
     select table_name || '.' || column_name from columns where udt_name = 'subject_kind' or column_name like '%issuer%' and udt_name in ('uuid', 'text')
     union
     select kind.table_name || '.' || kind.column_name
       from columns ref join columns kind using (table_name)
      where ref.column_name like '%\\_id' and kind.column_name in (left(ref.column_name, -3) || '_kind', left(ref.column_name, -3) || '_type')
     order by 1`,
  );
  const leftAlone = [
    // Derived from the issuer's own names by a trigger.
    "issuer_aliases.issuer_id",
    // Cites facts, claims, events, documents, series, results and sources (blockSchema.json's ref_kind).
    "citation_logs.ref_kind",
    // Its check constraint names only threads and runs.
    "financial_runs.parent_kind",
  ];
  const named = ISSUER_KEYED_ROWS.map((row) => `${row.table}.${row.kind ?? row.id}`).concat(leftAlone);
  assert.deepEqual(rows.map((row) => row.key), named.sort());
});

test("a fresh frozen stack's golden issuers, each listing its own ticker, merge nothing", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-frozen");
  const db = await connectedPool(t, databaseUrl);
  await insertListedIssuer(db, GOLDEN_ISSUER_IDS.NVDA, "NVIDIA Corporation", "1045810", "NVDA");
  await insertListedIssuer(db, GOLDEN_ISSUER_IDS.AMD, "Advanced Micro Devices, Inc.", "2488", "AMD");
  await insertListedIssuer(db, GOLDEN_ISSUER_IDS.AAPL, "Apple Inc.", "320193", "AAPL");
  const ciks = new Map([["NVDA", "1045810"], ["AMD", "2488"], ["AAPL", "320193"]]);
  const before = await identity(db);

  assert.deepEqual(await findIssuerSplits(db, ciks), []);
  assert.deepEqual(await repairIssuerSplits(db, ciks, quiet), { merged: [], skipped: [] });
  assert.deepEqual(await identity(db), before);
});

test("a filing stored for the merged issuer while the repair runs moves with it", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-filing-drop");
  const db = await connectedPool(t, databaseUrl);
  await insertCikPair(db);
  const sec = await insertSource(db, "sec_edgar");
  const writer = await db.connect();
  let repair: Promise<unknown>;
  try {
    await writer.query("begin");
    await writer.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [id(2)]);
    await insertFact(writer, id(2), sec);
    repair = repairIssuerSplits(db, new Map([["AAPL", "320193"]]), quiet);
    await lockWaiters(db, 1, repair);
    await writer.query("commit");
  } finally {
    writer.release();
  }
  await repair;

  assert.deepEqual((await db.query(`select subject_id::text as issuer_id from facts`)).rows, [{ issuer_id: id(1) }]);
  assert.deepEqual((await db.query(`select issuer_id::text as issuer_id from issuers`)).rows, [{ issuer_id: id(1) }]);
});

test("a repair that waited while another merged its pair skips the pair", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-twice");
  const db = await connectedPool(t, databaseUrl);
  await insertCikPair(db);
  const ciks = new Map([["AAPL", "320193"]]);
  const writer = await db.connect();
  let repairs: Promise<Array<{ merged: unknown[] }>>;
  try {
    await writer.query("begin");
    await writer.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [id(1)]);
    const first = repairIssuerSplits(db, ciks, quiet);
    await lockWaiters(db, 1, first);
    const second = repairIssuerSplits(db, ciks, quiet);
    repairs = Promise.all([first, second]);
    await lockWaiters(db, 2, repairs);
    await writer.query("commit");
  } finally {
    writer.release();
  }

  assert.deepEqual((await repairs).map(({ merged }) => merged.length).sort(), [0, 1]);
  assert.deepEqual((await db.query(`select issuer_id::text as issuer_id from issuers`)).rows, [{ issuer_id: id(1) }]);
});
