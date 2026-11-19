import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
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

async function insertFact(db: Pool, issuerId: string, sourceId: string): Promise<void> {
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

const identity = (db: Pool) =>
  db.query(
    `select coalesce(l.ticker, '-') as ticker, iss.issuer_id::text as issuer_id, iss.legal_name, iss.cik
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
  // The frozen golden issuers hold the CIK and facts, with no listing.
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '0000320193'), ($2, 'NVIDIA Corporation', '0001045810')`, [
    GOLDEN_ISSUER_IDS.AAPL,
    GOLDEN_ISSUER_IDS.NVDA,
  ]);
  await insertFact(db, GOLDEN_ISSUER_IDS.AAPL, golden);
  await insertFact(db, GOLDEN_ISSUER_IDS.NVDA, golden);
  // The import's AAPL issuer has no CIK. A provider row took NVDA's listing to a second issuer holding the CIK without its zeros.
  await insertListedIssuer(db, id(1), "Apple Inc", null, "AAPL");
  await insertListedIssuer(db, id(2), "Nvidia Corp", "1045810", "NVDA");
  // Alphabet's share classes. The fill gave the CIK to GOOGL's issuer, so GOOG's has none.
  await insertListedIssuer(db, id(3), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(4), "Alphabet Inc", null, "GOOG");
  // AMJB is an ETN JPMorgan files under its own CIK, another security and not the bank.
  await insertListedIssuer(db, id(5), "JPMorgan Chase & Co", "19617", "JPM");
  await insertListedIssuer(db, id(6), "JPMorgan Chase Financial Company LLC Alerian MLP Index ETNs", null, "AMJB");
  // Golden AMD is whole, but holds its CIK with the zeros no lookup writes.
  await insertListedIssuer(db, GOLDEN_ISSUER_IDS.AMD, "Advanced Micro Devices, Inc.", "0000002488", "AMD");
  const ciks = new Map([["AAPL", "320193"], ["NVDA", "1045810"], ["GOOGL", "1652044"], ["GOOG", "1652044"], ["JPM", "19617"], ["AMJB", "19617"]]);

  assert.deepEqual(
    (await findIssuerSplits(db, ciks)).map(({ keep, drop, basis }) => ({ keep, drop, basis })),
    [
      { keep: GOLDEN_ISSUER_IDS.AAPL, drop: id(1), basis: "lists golden AAPL" },
      { keep: GOLDEN_ISSUER_IDS.NVDA, drop: id(2), basis: "lists golden NVDA" },
      { keep: id(3), drop: id(4), basis: "GOOG files under CIK 1652044" },
    ],
  );

  const lines: string[] = [];
  assert.equal((await repairIssuerSplits(db, ciks, { log: (line: string) => lines.push(line) })).length, 3);
  assert.deepEqual(lines, [
    `merged issuer ${id(1)} (Apple Inc) into ${GOLDEN_ISSUER_IDS.AAPL} (Apple Inc.): lists golden AAPL`,
    `merged issuer ${id(2)} (Nvidia Corp) into ${GOLDEN_ISSUER_IDS.NVDA} (NVIDIA Corporation): lists golden NVDA`,
    `merged issuer ${id(4)} (Alphabet Inc) into ${id(3)} (Alphabet Inc. Class A Common Stock): GOOG files under CIK 1652044`,
    `stored CIK 0000002488 of issuer ${GOLDEN_ISSUER_IDS.AMD} (Advanced Micro Devices, Inc.) as 2488`,
    `stored CIK 0000320193 of issuer ${GOLDEN_ISSUER_IDS.AAPL} (Apple Inc.) as 320193`,
    `stored CIK 0001045810 of issuer ${GOLDEN_ISSUER_IDS.NVDA} (NVIDIA Corporation) as 1045810`,
  ]);
  const merged = await identity(db);
  assert.deepEqual(merged, [
    { ticker: "AAPL", issuer_id: GOLDEN_ISSUER_IDS.AAPL, legal_name: "Apple Inc.", cik: "320193" },
    { ticker: "AMD", issuer_id: GOLDEN_ISSUER_IDS.AMD, legal_name: "Advanced Micro Devices, Inc.", cik: "2488" },
    { ticker: "AMJB", issuer_id: id(6), legal_name: "JPMorgan Chase Financial Company LLC Alerian MLP Index ETNs", cik: null },
    { ticker: "GOOG", issuer_id: id(3), legal_name: "Alphabet Inc. Class A Common Stock", cik: "1652044" },
    { ticker: "GOOGL", issuer_id: id(3), legal_name: "Alphabet Inc. Class A Common Stock", cik: "1652044" },
    { ticker: "JPM", issuer_id: id(5), legal_name: "JPMorgan Chase & Co", cik: "19617" },
    { ticker: "NVDA", issuer_id: GOLDEN_ISSUER_IDS.NVDA, legal_name: "NVIDIA Corporation", cik: "1045810" },
  ]);

  assert.deepEqual(await findIssuerSplits(db, ciks), []);
  const rerun: string[] = [];
  assert.deepEqual(await repairIssuerSplits(db, ciks, { log: (line: string) => rerun.push(line) }), [], "a rerun merges nothing");
  assert.deepEqual(rerun, []);
  assert.deepEqual(await identity(db), merged);
});

test("a merge moves every row keyed by the merged issuer, and the kept issuer's own row wins a clash", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-rows");
  const db = await connectedPool(t, databaseUrl);
  await insertListedIssuer(db, id(1), "Alphabet Inc. Class A Common Stock", "1652044", "GOOGL");
  await insertListedIssuer(db, id(2), "Alphabet Inc", null, "GOOG");
  await db.query(`update issuers set sector = 'Communication Services' where issuer_id = $1`, [id(2)]);
  const vendor = await insertSource(db, "xang1234_stock_screener");
  await insertFact(db, id(2), vendor);
  const { rows: [user] } = await db.query<{ user_id: string }>(`insert into users (email) values ('owner@example.com') returning user_id::text as user_id`);
  const { rows: lists } = await db.query<{ watchlist_id: string }>(
    `insert into watchlists (user_id, name, mode) values ($1, 'Both', 'manual'), ($1, 'GOOG only', 'manual') returning watchlist_id::text as watchlist_id`,
    [user!.user_id],
  );
  await db.query(
    `insert into watchlist_members (watchlist_id, subject_kind, subject_id) values ($1, 'issuer', $3), ($1, 'issuer', $4), ($2, 'issuer', $4)`,
    [lists[0]!.watchlist_id, lists[1]!.watchlist_id, id(1), id(2)],
  );
  await db.query(`insert into chat_threads (user_id, primary_subject_kind, primary_subject_id, title) values ($1, 'issuer', $2, 'GOOG')`, [user!.user_id, id(2)]);
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

  const { rows: issuers } = await db.query(`select issuer_id::text as issuer_id, cik, sector from issuers`);
  assert.deepEqual(issuers, [{ issuer_id: id(1), cik: "1652044", sector: "Communication Services" }]);
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
     union all select 'thread', primary_subject_id::text from chat_threads
     union all select 'claim argument', subject_id::text from claim_arguments
     union all select 'claim attribution', attributed_to_id from claims
     order by 1`,
  );
  assert.deepEqual(subjects, [
    { row: "claim argument", subject_id: id(1) },
    { row: "claim attribution", subject_id: id(1) },
    { row: "fact", subject_id: id(1) },
    { row: "mention", subject_id: id(1) },
    { row: "thread", subject_id: id(1) },
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
  // Both issuers registered Alphabet's IR feed; a release came in through GOOG's registration.
  const { rows: feeds } = await db.query<{ ir_source_id: string }>(
    `insert into ir_source_registry (issuer_id, source_type, url) values ($1, 'rss', 'https://abc.xyz/investor/rss'), ($2, 'rss', 'https://abc.xyz/investor/rss')
     returning ir_source_id::text as ir_source_id`,
    [id(1), id(2)],
  );
  await db.query(
    `insert into ir_document_assets (ir_source_id, issuer_id, document_id, source_id, asset_kind, canonical_url, discovered_at, fetched_at)
     values ($1, $2, $3, $4, 'press_release', 'https://abc.xyz/investor/2026-q2.pdf', now(), now())`,
    [feeds[1]!.ir_source_id, id(2), await insertDocument(db, sec, "press_release"), sec],
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
  const { rows: assets } = await db.query(`select issuer_id::text as issuer_id, ir_source_id::text as ir_source_id from ir_document_assets`);
  assert.deepEqual(assets, [{ issuer_id: id(1), ir_source_id: feeds[0]!.ir_source_id }]);
});

test("the merge names every column that names an issuer", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for issuer split coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-issuer-merge-schema");
  const db = await connectedPool(t, databaseUrl);
  // A column can name an issuer by a foreign key, by a column named for one, or as one kind of row
  // beside a column saying which kind (`subject_kind`, `attributed_to_type`). Primary key columns
  // name their own row.
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
     select table_name || '.' || column_name from columns where udt_name = 'subject_kind' or column_name like '%issuer%id'
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
