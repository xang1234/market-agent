// A filing's cover-page count of its common shares (dei
// EntityCommonStockSharesOutstanding) is the engine's shares_outstanding
// (#444): a point at the count's own date S, as filed on S, published by its
// filing on D.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { selectInput } from "../../financial-engine/src/select-inputs.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";

const ISSUER = "37000000-0000-4000-8000-0000000003a1";
const FALLBACK_SOURCE_ID = "37000000-0000-4000-8000-0000000003a9";
const OWNER = "37000000-0000-4000-8000-0000000003b1";

type Filing = { accn: string; fy: number; fp: string; form: string; filed: string };
const value = (filing: Filing, start: string | null, end: string, token: string) =>
  ({ ...(start === null ? {} : { start }), end, val: Number(token), val_token: token, ...filing });

// NVDA's filings and their cover counts as companyfacts lists them: the FY2024
// 10-K's count as of 2024-02-16, the Q1 FY2025 10-Q's as of 2024-05-24 (before
// the 2024-06-10 split), and the FY2025 10-K's. The Q2 FY2025 10-Q's second
// count is made up: no filing on file lists two.
const K24: Filing = { accn: "0001045810-24-000029", fy: 2024, fp: "FY", form: "10-K", filed: "2024-02-21" };
const Q1: Filing = { accn: "0001045810-24-000124", fy: 2025, fp: "Q1", form: "10-Q", filed: "2024-05-29" };
const Q2: Filing = { accn: "0001045810-24-000264", fy: 2025, fp: "Q2", form: "10-Q", filed: "2024-08-28" };
const K25: Filing = { accn: "0001045810-25-000023", fy: 2025, fp: "FY", form: "10-K", filed: "2025-02-26" };

function nvdaFacts() {
  const income = (unit: string, k24: string, q1: string, q2: string, k25: string) => ({
    label: "",
    description: "",
    units: {
      [unit]: [
        value(K24, "2023-01-30", "2024-01-28", k24),
        value(Q1, "2024-01-29", "2024-04-28", q1),
        value(Q2, "2024-04-29", "2024-07-28", q2),
        value(K25, "2024-01-29", "2025-01-26", k25),
      ],
    },
  });
  return {
    cik: 1045810,
    entityName: "NVIDIA CORP",
    facts: {
      "us-gaap": {
        Revenues: income("USD", "60922000000", "26044000000", "30040000000", "130497000000"),
        NetIncomeLoss: income("USD", "29760000000", "14881000000", "16599000000", "72880000000"),
      },
      dei: {
        EntityCommonStockSharesOutstanding: {
          label: "",
          description: "",
          units: {
            shares: [
              value(K24, null, "2024-02-16", "2500000000"),
              value(Q1, null, "2024-05-24", "2460000000"),
              value(Q2, null, "2024-08-23", "24530000000"),
              value(Q2, null, "2024-08-16", "2453000000"),
              value(K25, null, "2025-02-21", "24400000000"),
            ],
          },
        },
      },
    },
  };
}

test("a filing's cover count is stored as filed on its own date", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for cover count coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-cover-count");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'NVIDIA CORP', '1045810')`, [ISSUER]);
  const fetcher = secCompanyFetcher(nvdaFacts, { completed_at: "2026-10-01T15:00:00.000Z" });
  const ingest = (fiscalYear: number, fiscalPeriod: "FY" | "Q1" | "Q2") =>
    createSecBackedStatementRepository(db, { fetcher, sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } })
      .find({ issuer_id: ISSUER, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod });
  const counts = async () => (await db.query(
    `select f.period_kind::text as period_kind, f.period_start::text as period_start, f.period_end::text as period_end,
            f.fiscal_year, f.fiscal_period::text as fiscal_period, f.method::text as method, f.value_num::text as value,
            f.coverage_level::text as coverage_level,
            to_char(f.reported_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as reported_at, s.canonical_url,
            a.precision_class, a.raw_token, a.source_locator,
            c.period_type, c.dimension_scope, c.reporting_basis, c.adjustment_basis, c.as_filed_on::text as as_filed_on,
            c.share_basis, c.disclosure_relation,
            exists (select 1 from current_source_publication_attestations p where p.source_id = f.source_id) as published
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join sources s on s.source_id = f.source_id
       left join current_fact_precision_attestations a on a.fact_id = f.fact_id
       left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 and m.metric_key = 'shares_outstanding' and f.invalidated_at is null
      order by f.period_end, f.method`,
    [ISSUER],
  )).rows;
  const certified = (period: Filing, end: string, token: string) => ({
    period_kind: "point",
    period_start: null,
    period_end: end,
    fiscal_year: period.fy,
    fiscal_period: period.fp,
    method: "reported",
    value: token,
    coverage_level: "full",
    reported_at: `${period.filed}T00:00:00Z`,
    canonical_url: `https://www.sec.gov/Archives/edgar/data/1045810/${period.accn.replace(/-/g, "")}/${period.accn}-index.htm`,
    precision_class: "source_token_preserved",
    raw_token: token,
    source_locator: `sec_edgar:companyfacts:CIK0001045810#EntityCommonStockSharesOutstanding|shares|${period.accn}|..${end}`,
    period_type: "instant",
    dimension_scope: "consolidated",
    reporting_basis: "as_reported",
    adjustment_basis: "as_filed",
    as_filed_on: end,
    share_basis: "not_applicable",
    disclosure_relation: "original",
    published: true,
  });

  await t.test("the 10-K's cover count is a point at its date S, as filed on S and filed on D", async () => {
    assert.ok(await ingest(2024, "FY"));
    assert.deepEqual(await counts(), [certified(K24, "2024-02-16", "2500000000")]);
  });

  await t.test("a 10-Q's cover count keeps the 10-Q's own fiscal period", async () => {
    assert.ok(await ingest(2025, "Q1"));
    assert.deepEqual((await counts()).map((row) => [row.fiscal_period, row.period_end, row.value, row.as_filed_on, row.reported_at]), [
      ["FY", "2024-02-16", "2500000000", "2024-02-16", "2024-02-21T00:00:00Z"],
      ["Q1", "2024-05-24", "2460000000", "2024-05-24", "2024-05-29T00:00:00Z"],
    ]);
  });

  await t.test("a filing listing two counts stores one with its token as partial coverage, and binding gaps on its scope", async () => {
    assert.ok(await ingest(2025, "Q2"));
    const q2 = (await counts()).filter((row) => row.fiscal_period === "Q2");
    assert.deepEqual(q2.map((row) => [row.value, row.coverage_level, row.precision_class, row.raw_token, row.adjustment_basis]), [
      ["24530000000", "partial", "source_token_preserved", "24530000000", null],
    ]);
    const page = await createEvidenceFinancialPort(db).listInputCandidates({
      authority: createRuntimeAuthority({
        owner_user_id: OWNER,
        egress_channel: "chat",
        parent: { kind: "chat_thread", id: OWNER, version: "1" },
        allowed_source_classes: ["sec_filing"],
        feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
        approval_state: "not_required",
        lease: null,
      }),
      subject: { kind: "issuer", id: ISSUER },
      metric_key: "shares_outstanding",
      fiscal_year: null,
      fiscal_period: null,
      limit: 100,
    });
    assert.equal(page.status, "ok");
    const latest = { node_id: "shares", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "shares_outstanding", period: { kind: "latest", period_type: "quarterly", offset: 0 } } as const;
    // After the download that stored it: the Q2 10-Q is the latest filing, and the Q1 10-Q's count is superseded.
    assert.deepEqual(
      selectInput(latest, page.status === "ok" ? page.candidates : [], { knowledge_cutoff: "2026-10-02T00:00:00.000Z", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] }),
      { status: "gap", reason_code: "incompatible_scope" },
    );
  });

  await t.test("a later 10-K adds its own count and restates none, and a rerun changes nothing", async () => {
    assert.ok(await ingest(2025, "FY"));
    const stored = await counts();
    assert.deepEqual(stored.map((row) => [row.fiscal_year, row.fiscal_period, row.method, row.value]), [
      [2024, "FY", "reported", "2500000000"],
      [2025, "Q1", "reported", "2460000000"],
      [2025, "Q2", "reported", "24530000000"],
      [2025, "FY", "reported", "24400000000"],
    ]);
    assert.deepEqual(stored[3], certified(K25, "2025-02-21", "24400000000"));
    const proofs = async () => (await db.query(
      `select count(*)::int as facts,
              (select count(*)::int from fact_precision_attestations a join facts g on g.fact_id = a.fact_id where g.subject_id = $1) as precision,
              (select count(*)::int from fact_financial_contexts c join facts g on g.fact_id = c.fact_id where g.subject_id = $1) as contexts
         from facts f where f.subject_id = $1`,
      [ISSUER],
    )).rows[0];
    const before = await proofs();
    assert.ok(await ingest(2024, "FY"));
    assert.deepEqual(await backfillSecCompanionStatements(db, { issuerId: ISSUER, fetcher, sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } }), { periods: 4 });
    assert.deepEqual(await counts(), stored);
    assert.deepEqual(await proofs(), before);
  });
});
