import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { SEC_NONCONTROLLING_INTEREST_CONCEPTS } from "../src/sec-edgar.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository, hydrateSecIssuerLatestYears } from "../src/sec-facts-repository.ts";

const ISSUER_ID = "34200000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "34200000-0000-4000-8000-000000000003";
const CHECKED = [...SEC_NONCONTROLLING_INTEREST_CONCEPTS, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "ProfitLoss"];

type Value = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };

// Each fiscal year's 10-K, filed the February after it ends.
const tenK = (fy: number) => ({ accn: `0000000342-${String(fy + 1).slice(2)}-000001`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-02-01` });
const year = (filing: number, of: number, val: number): Value => ({ start: `${of}-01-01`, end: `${of}-12-31`, val, ...tenK(filing) });
const yearEnd = (filing: number, of: number, val: number): Value => ({ end: `${of}-12-31`, val, ...tenK(filing) });

function companyFacts(byConcept: Record<string, Value[]>): string {
  return JSON.stringify({
    cik: 342,
    entityName: "Inference Corp",
    facts: { "us-gaap": Object.fromEntries(Object.entries(byConcept).map(([concept, values]) => [concept, { label: "", description: "", units: { USD: values } }])) },
  });
}

async function setUp(t: test.TestContext, name: string) {
  const { databaseUrl } = await bootstrapDatabase(t, name);
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Inference Corp', '342')`, [ISSUER_ID]);
  const download = { text: "" };
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async () => new Response(download.text, { status: 200 }),
    clock: () => new Date("2026-03-01T00:00:00.000Z"),
  });
  const options = { fetcher, sourceId: FALLBACK_SOURCE_ID, clock: () => new Date("2026-03-01T00:00:00.000Z"), logger: { warn: () => {} } } as const;
  const lookup = (fiscal_year: number) => createSecBackedStatementRepository(db, options)
    .find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year, fiscal_period: "FY" });
  const backfill = () => backfillSecCompanionStatements(db, { issuerId: ISSUER_ID, ...options });
  const netIncome = async () => (await db.query<{ fact_id: string; metric_key: string; fiscal_year: number; value: string; active: boolean; superseded_by: string | null; flags: unknown[]; proof: string | null }>(
    `select f.fact_id::text as fact_id, m.metric_key, f.fiscal_year, f.value_num::text as value, f.invalidated_at is null as active,
            f.superseded_by::text as superseded_by, f.quality_flags as flags,
            (select a.precision_class from current_fact_precision_attestations a where a.fact_id = f.fact_id) as proof
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key in ('net_income', 'net_income_consolidated')
      order by f.fiscal_year, m.metric_key, f.created_at`,
    [ISSUER_ID],
  )).rows;
  // A derived fact as analyze materializes one, naming the fact it was computed from.
  const deriveFrom = async (inputFactId: string) => (await db.query<{ fact_id: string }>(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period, value_num,
                        unit, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence, quality_flags)
     select f.subject_kind, f.subject_id, (select metric_id from metrics where metric_key = 'net_margin'), f.period_kind, f.period_start, f.period_end,
            f.fiscal_year, f.fiscal_period, 0.1, 'ratio', 1, f.as_of, f.observed_at, f.source_id, 'derived', 'authoritative', 'filing_time', 'full', 1,
            jsonb_build_array(jsonb_build_object('kind', 'derivation', 'metric', 'net_margin', 'input_fact_ids', jsonb_build_array(f.fact_id::text)))
       from facts f where f.fact_id = $1
     returning fact_id::text`,
    [inputFactId],
  )).rows[0]!.fact_id;
  const isActive = async (factId: string) => (await db.query<{ active: boolean }>(`select invalidated_at is null as active from facts where fact_id = $1`, [factId])).rows[0]?.active;
  return { db, download, fetcher, options, lookup, backfill, netIncome, deriveFrom, isActive };
}

const inferred = (concept: string) => [{ kind: "no_noncontrolling_interest", concept, checked: CHECKED }];

test("an inferred net income is stored with its basis, and a filing that reports noncontrolling interest for its period invalidates it (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { download, lookup, backfill, netIncome, deriveFrom, isActive } = await setUp(t, "fin-sec-ni-inference");
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 70), year(2024, 2024, 80)],
  });
  await lookup(2023);
  await lookup(2024);
  const summary = async () => (await netIncome()).map(({ metric_key, fiscal_year, value, active, flags, proof }) => [fiscal_year, metric_key, value, active, flags, proof]);
  assert.deepEqual(await summary(), [
    [2023, "net_income", "70", true, [], "source_token_preserved"],
    [2023, "net_income_consolidated", "70", true, inferred("NetIncomeLoss"), "source_token_preserved"],
    [2024, "net_income", "80", true, [], "source_token_preserved"],
    [2024, "net_income_consolidated", "80", true, inferred("NetIncomeLoss"), "source_token_preserved"],
  ]);
  const inferred2024 = (await netIncome()).find((row) => row.fiscal_year === 2024 && row.metric_key === "net_income_consolidated")!;
  const derived = await deriveFrom(inferred2024.fact_id);

  // The FY2025 10-K shows a noncontrolling interest in 2024 as well.
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600), year(2025, 2024, 600), year(2025, 2025, 700)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 70), year(2024, 2024, 80), year(2025, 2024, 80), year(2025, 2025, 90)],
    ProfitLoss: [year(2025, 2024, 85), year(2025, 2025, 96)],
    NetIncomeLossAttributableToNoncontrollingInterest: [year(2025, 2024, 5), year(2025, 2025, 6)],
  });
  await lookup(2025);
  const revised = [
    [2023, "net_income", "70", true, [], "source_token_preserved"],
    [2023, "net_income_consolidated", "70", true, inferred("NetIncomeLoss"), "source_token_preserved"],
    [2024, "net_income", "80", true, [], "source_token_preserved"],
    [2024, "net_income_consolidated", "80", false, inferred("NetIncomeLoss"), "source_token_preserved"],
    [2025, "net_income", "90", true, [], "source_token_preserved"],
    [2025, "net_income_consolidated", "96", true, [], "source_token_preserved"],
  ];
  assert.deepEqual(await summary(), revised, "a lookup of another year revises the inference");
  assert.equal(await isActive(derived), false, "a fact derived from the revised one goes with it");
  await backfill();
  await backfill();
  assert.deepEqual(await summary(), revised, "the 2024 10-K states no consolidated figure, so it stays a gap");
});

test("a legacy net income stored from ProfitLoss is replaced with its basis, or retired where the filer reports noncontrolling interest (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, fetcher, options, lookup, backfill, netIncome, deriveFrom, isActive } = await setUp(t, "fin-sec-ni-legacy");
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2024, 600)],
    ProfitLoss: [year(2023, 2023, 90), year(2024, 2024, 95)],
    MinorityInterest: [yearEnd(2024, 2024, 5)],
  });
  await lookup(2023);
  await lookup(2024);
  const inferredNetIncome = (await netIncome()).find((row) => row.metric_key === "net_income");
  assert.deepEqual(inferredNetIncome?.flags, inferred("ProfitLoss"));

  // What ingestion stored before #342: ProfitLoss as net income, with no
  // precision proof and no lineage, in both years.
  await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [inferredNetIncome!.fact_id]);
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period, value_num,
                        unit, currency, scale, as_of, reported_at, observed_at, source_id, method, definition_version,
                        verification_status, freshness_class, coverage_level, confidence, quality_flags)
     select f.subject_kind, f.subject_id, (select metric_id from metrics where metric_key = 'net_income'), f.period_kind, f.period_start,
            f.period_end, f.fiscal_year, f.fiscal_period, f.value_num, f.unit, f.currency, f.scale, f.as_of, f.reported_at, f.observed_at,
            f.source_id, f.method, f.definition_version, f.verification_status, f.freshness_class, f.coverage_level, f.confidence, '[]'::jsonb
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = 'net_income_consolidated'`,
    [ISSUER_ID],
  );
  const legacy = (await netIncome()).filter((row) => row.metric_key === "net_income" && row.active);
  assert.deepEqual(legacy.map((row) => [row.fiscal_year, row.value, row.proof]), [[2023, "90", null], [2024, "95", null]]);

  await hydrateSecIssuerLatestYears(db, { issuerId: ISSUER_ID, reads: new Map([["net_income", 2]]), ...options, fetcher });
  assert.deepEqual(
    (await netIncome()).filter((row) => legacy.some((old) => old.fact_id === row.fact_id)).map((row) => [row.active, row.proof]),
    [[true, null], [true, null]],
    "a lookup never proves a legacy row in place of an inferred one",
  );

  const derived = await Promise.all(legacy.map((row) => deriveFrom(row.fact_id)));
  await backfill();
  assert.deepEqual(await Promise.all(derived.map(isActive)), [false, false], "facts derived from a retired legacy row go with it");
  const repaired = (await netIncome()).filter((row) => row.metric_key === "net_income");
  const replacement = repaired.find((row) => row.active);
  assert.deepEqual(repaired.map(({ fiscal_year, value, active, flags, proof }) => [fiscal_year, value, active, flags, proof]), [
    [2023, "90", false, inferred("ProfitLoss"), "source_token_preserved"],
    [2023, "90", false, [], null],
    [2023, "90", true, inferred("ProfitLoss"), "source_token_preserved"],
    [2024, "95", false, [], null],
  ]);
  assert.equal(repaired[1]?.superseded_by, replacement?.fact_id, "the legacy 2023 row names its replacement");
  await backfill();
  assert.deepEqual((await netIncome()).filter((row) => row.metric_key === "net_income").map((row) => row.active), [false, false, true, false], "a rerun changes nothing");
});

test("a later 10-K's restatement of an inferred figure keeps its basis and is revised with it (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, lookup } = await setUp(t, "fin-sec-ni-restated");
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 72), year(2024, 2024, 80)],
  });
  await lookup(2023);
  await lookup(2024);
  const consolidated2023 = async () => (await db.query<{ method: string; value: string; active: boolean; concept: string | null }>(
    `select f.method::text as method, f.value_num::text as value, f.invalidated_at is null as active,
            jsonb_path_query_first(f.quality_flags, '$[*] ? (@.kind == "no_noncontrolling_interest")') ->> 'concept' as concept
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = 'net_income_consolidated' and f.fiscal_year = 2023
      order by f.created_at`,
    [ISSUER_ID],
  )).rows.map(({ method, value, active, concept }) => [method, value, active, concept]);
  assert.deepEqual(await consolidated2023(), [["reported", "70", true, "NetIncomeLoss"], ["restated", "72", true, "NetIncomeLoss"]]);

  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600), year(2025, 2023, 500), year(2025, 2024, 600), year(2025, 2025, 700)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 72), year(2024, 2024, 80), year(2025, 2023, 72), year(2025, 2024, 80), year(2025, 2025, 90)],
    NetIncomeLossAttributableToNoncontrollingInterest: [year(2025, 2023, 2)],
  });
  await lookup(2025);
  assert.deepEqual(await consolidated2023(), [["reported", "70", false, "NetIncomeLoss"], ["restated", "72", false, "NetIncomeLoss"]]);
});

test("the backfill re-certifies a period whose only income fact 0076 invalidated (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, lookup, backfill, netIncome, isActive } = await setUp(t, "fin-sec-ni-stranded");
  download.text = companyFacts({ Revenues: [year(2023, 2023, 500)], ProfitLoss: [year(2023, 2023, 90)] });
  await lookup(2023);
  const consolidated = (await netIncome()).find((row) => row.metric_key === "net_income_consolidated")!;

  // What ingestion stored before #342, alone: ProfitLoss as net income, proven, with no basis.
  await db.query(`update facts set invalidated_at = now() where subject_id = $1`, [ISSUER_ID]);
  const legacyId = (await db.query<{ fact_id: string }>(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period, value_num,
                        unit, currency, scale, as_of, reported_at, observed_at, source_id, method, definition_version,
                        verification_status, freshness_class, coverage_level, confidence, quality_flags)
     select subject_kind, subject_id, (select metric_id from metrics where metric_key = 'net_income'), period_kind, period_start,
            period_end, fiscal_year, fiscal_period, value_num, unit, currency, scale, as_of, reported_at, observed_at,
            source_id, method, definition_version, verification_status, freshness_class, coverage_level, confidence, '[]'::jsonb
       from facts where fact_id = $1
     returning fact_id::text`,
    [consolidated.fact_id],
  )).rows[0]!.fact_id;
  await db.query(
    `insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text,
                                             source_locator, validation_method)
     select $2, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text, source_locator, validation_method
       from fact_precision_attestations where fact_id = $1`,
    [consolidated.fact_id, legacyId],
  );
  await db.query(await readFile(join(workspaceRoot, "db", "migrations", "0076_net_income_profit_loss.up.sql"), "utf8"));
  assert.equal(await isActive(legacyId), false);

  assert.deepEqual(await backfill(), { periods: 1 });
  assert.deepEqual((await netIncome()).filter((row) => row.active).map(({ metric_key, value, flags, proof }) => [metric_key, value, flags, proof]), [
    ["net_income", "90", inferred("ProfitLoss"), "source_token_preserved"],
    ["net_income_consolidated", "90", [], "source_token_preserved"],
  ]);
});

test("a later 10-K whose ProfitLoss differs from NetIncomeLoss for a stored period revises its inferred figure (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { download, lookup, netIncome } = await setUp(t, "fin-sec-ni-profit-loss-differs");
  download.text = companyFacts({ Revenues: [year(2023, 2023, 500)], NetIncomeLoss: [year(2023, 2023, 70)] });
  await lookup(2023);
  const consolidated2023 = async () => (await netIncome())
    .filter((row) => row.fiscal_year === 2023 && row.metric_key === "net_income_consolidated")
    .map(({ value, active, flags }) => [value, active, flags]);
  assert.deepEqual(await consolidated2023(), [["70", true, inferred("NetIncomeLoss")]]);

  // The FY2024 10-K's 2023 comparative: its NCI line is an extension concept companyfacts does not carry.
  download.text = companyFacts({
    Revenues: [year(2023, 2023, 500), year(2024, 2023, 500), year(2024, 2024, 600)],
    NetIncomeLoss: [year(2023, 2023, 70), year(2024, 2023, 70), year(2024, 2024, 80)],
    ProfitLoss: [year(2024, 2023, 75), year(2024, 2024, 86)],
  });
  await lookup(2024);
  assert.deepEqual(await consolidated2023(), [["70", false, inferred("NetIncomeLoss")]]);
});

test("an ingest waits for another ingest of the same issuer to commit (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  // Each checks inferences against its own snapshot, so one could re-store a figure the other just refuted.
  const { db, download, lookup, netIncome } = await setUp(t, "fin-sec-ni-serialized");
  download.text = companyFacts({ Revenues: [year(2023, 2023, 500)], NetIncomeLoss: [year(2023, 2023, 70)] });
  const holder = await db.connect();
  try {
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [ISSUER_ID]);
    let done = false;
    const ingest = lookup(2023).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(done, false, "the ingest waited for the issuer's lock");
    assert.deepEqual(await netIncome(), []);
    await holder.query("commit");
    await ingest;
    assert.equal((await netIncome()).length, 2);
  } finally {
    holder.release();
  }
});

test("an unproven net income is retired only when it is the download's ProfitLoss for its period (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, lookup, backfill, netIncome } = await setUp(t, "fin-sec-ni-unproven-kept");
  download.text = companyFacts({ Revenues: [year(2024, 2024, 600)], ProfitLoss: [year(2024, 2024, 95)], MinorityInterest: [yearEnd(2024, 2024, 5)] });
  await lookup(2024);
  // An older ingest's NetIncomeLoss, stored before precision proofs: 95 less the noncontrolling interest's 5.
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period, value_num,
                        unit, currency, scale, as_of, reported_at, observed_at, source_id, method, definition_version,
                        verification_status, freshness_class, coverage_level, confidence, quality_flags)
     select f.subject_kind, f.subject_id, (select metric_id from metrics where metric_key = 'net_income'), f.period_kind, f.period_start,
            f.period_end, f.fiscal_year, f.fiscal_period, 90, f.unit, f.currency, f.scale, f.as_of, f.reported_at, f.observed_at,
            f.source_id, f.method, f.definition_version, f.verification_status, f.freshness_class, f.coverage_level, f.confidence, '[]'::jsonb
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = 'net_income_consolidated'`,
    [ISSUER_ID],
  );
  await backfill();
  assert.deepEqual((await netIncome()).map(({ metric_key, value, active, proof }) => [metric_key, value, active, proof]), [
    ["net_income", "90", true, null],
    ["net_income_consolidated", "95", true, "source_token_preserved"],
  ]);
});

test("a stored inference checked against an older concept list stands while its kind and concept match (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, lookup, backfill, netIncome } = await setUp(t, "fin-sec-ni-older-checked");
  download.text = companyFacts({ Revenues: [year(2023, 2023, 500)], NetIncomeLoss: [year(2023, 2023, 70)] });
  await lookup(2023);
  const older = [{ kind: "no_noncontrolling_interest", concept: "NetIncomeLoss", checked: ["MinorityInterest"] }];
  await db.query(
    `update facts set quality_flags = $2::jsonb
      where subject_id = $1 and metric_id = (select metric_id from metrics where metric_key = 'net_income_consolidated')`,
    [ISSUER_ID, JSON.stringify(older)],
  );
  await backfill();
  assert.deepEqual((await netIncome()).map(({ metric_key, active, flags }) => [metric_key, active, flags]), [
    ["net_income", true, []],
    ["net_income_consolidated", true, older],
  ]);
});

test("an ingest of an older download writes no inference after a newer one refuted it, and a newer download still infers (#342)", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC ingestion coverage");
    return;
  }
  const { db, download, options, lookup, netIncome } = await setUp(t, "fin-sec-ni-older-download");
  const older = { Revenues: [year(2023, 2023, 500)], NetIncomeLoss: [year(2023, 2023, 70)] };
  download.text = companyFacts(older);
  await lookup(2023);
  let reached!: () => void;
  const atCheckout = new Promise<void>((resolve) => (reached = resolve));
  let resume!: () => void;
  const resumed = new Promise<void>((resolve) => (resume = resolve));
  const paused = { query: db.query.bind(db), connect: async () => (reached(), await resumed, db.connect()) };
  const olderBackfill = backfillSecCompanionStatements(paused as unknown as typeof db, { issuerId: ISSUER_ID, ...options });
  await atCheckout;
  const newer = {
    Revenues: [...older.Revenues, year(2024, 2023, 500), year(2024, 2024, 600)],
    NetIncomeLoss: [...older.NetIncomeLoss, year(2024, 2023, 70), year(2024, 2024, 80)],
    NetIncomeLossAttributableToNoncontrollingInterest: [year(2024, 2023, 5)],
  };
  download.text = companyFacts(newer);
  await lookup(2024);
  resume();
  await olderBackfill;
  const consolidated = async (fiscalYear: number) => (await netIncome())
    .filter((row) => row.metric_key === "net_income_consolidated" && row.fiscal_year === fiscalYear)
    .map(({ value, active }) => [value, active]);
  assert.deepEqual(await consolidated(2023), [["70", false]], "the older download does not restore the refuted inference");
  assert.deepEqual(await consolidated(2024), [["80", true]]);
  download.text = companyFacts({
    ...newer,
    Revenues: [...newer.Revenues, year(2025, 2025, 700)],
    NetIncomeLoss: [...newer.NetIncomeLoss, year(2025, 2025, 90)],
  });
  await lookup(2025);
  assert.deepEqual(await consolidated(2025), [["90", true]], "a newer download with no noncontrolling interest still infers");
});
