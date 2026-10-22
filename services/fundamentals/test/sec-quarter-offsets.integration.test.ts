import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority, type ReportedMetricNode } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { InputCandidate } from "../../financial-engine/src/ports.ts";
import { selectInput, sharedLatestPeriods, type SelectionPolicy } from "../../financial-engine/src/select-inputs.ts";
import { createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";

const ISSUER = "46900000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "46900000-0000-4000-8000-000000000009";
const OWNER = "46900000-0000-4000-8000-000000000011";

type Filing = { accn: string; fy: number; fp: string; form: string; filed: string };
type Period = "Q1" | "Q2" | "Q3" | "FY";

const filing = (fy: number, fp: Period, filed: string): Filing =>
  ({ accn: `0001234567-${String(fy).slice(2)}-00000${fp === "FY" ? "4" : fp[1]}`, fy, fp, form: fp === "FY" ? "10-K" : "10-Q", filed });

const FILINGS: ReadonlyArray<readonly [Filing, start: string, end: string]> = [
  [filing(2023, "Q1", "2023-05-01"), "2023-01-01", "2023-03-31"],
  [filing(2023, "Q2", "2023-08-01"), "2023-04-01", "2023-06-30"],
  [filing(2023, "Q3", "2023-11-01"), "2023-07-01", "2023-09-30"],
  [filing(2023, "FY", "2024-02-15"), "2023-01-01", "2023-12-31"],
  [filing(2024, "Q1", "2024-05-01"), "2024-01-01", "2024-03-31"],
  [filing(2024, "Q2", "2024-08-01"), "2024-04-01", "2024-06-30"],
  [filing(2024, "Q3", "2024-11-01"), "2024-07-01", "2024-09-30"],
  [filing(2024, "FY", "2025-02-15"), "2024-01-01", "2024-12-31"],
  [filing(2025, "Q1", "2025-05-01"), "2025-01-01", "2025-03-31"],
];

function companyFacts(filed: ReadonlyArray<string>) {
  const concept = (tokens: ReadonlyArray<string>) => ({
    label: "",
    description: "",
    units: {
      USD: FILINGS.flatMap(([filing, start, end], index) =>
        filed.includes(filing.accn) ? [{ start, end, val: Number(tokens[index]), val_token: tokens[index], ...filing }] : []),
    },
  });
  return {
    cik: 1234567,
    entityName: "ACME CORP",
    facts: {
      "us-gaap": {
        Revenues: concept(["100", "110", "120", "460", "140", "150", "160", "620", "180"]),
        NetIncomeLoss: concept(["10", "11", "12", "46", "14", "15", "16", "62", "18"]),
      },
    },
  };
}

const latestQuarter = (metric: string, offset: number): ReportedMetricNode => ({
  node_id: `${metric}_${offset}`,
  operation: "reported_metric",
  operation_version: "reported_metric.v1",
  subject_slot: "a",
  metric_key: metric,
  period: { kind: "latest", period_type: "quarterly", offset },
});

const POLICY: SelectionPolicy = { knowledge_cutoff: "2026-10-02T00:00:00.000Z", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] };

function landed(result: ReturnType<typeof selectInput>): string {
  if (result.status === "gap") return `gap ${result.reason_code}`;
  const { fiscal_period, fiscal_year } = result.input.candidate.period;
  return `${fiscal_period} FY${fiscal_year} ${result.input.numeric.native_value}`;
}

test("latest quarterly offsets on SEC-ingested statements", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC quarter offset coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-quarter-offsets");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'ACME CORP', '1234567')`, [ISSUER]);
  const filed: string[] = [];
  const fetcher = secCompanyFetcher(() => companyFacts(filed), { completed_at: "2026-10-01T15:00:00.000Z" });
  const repository = createSecBackedStatementRepository(db, { fetcher, sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } });
  const ingest = async (fiscalYear: number, periods: ReadonlyArray<Period | "Q4">) => {
    filed.push(...FILINGS.filter(([filing]) => filing.fy === fiscalYear && (periods as ReadonlyArray<string>).includes(filing.fp)).map(([filing]) => filing.accn));
    for (const fiscalPeriod of periods) {
      assert.ok(await repository.find({ issuer_id: ISSUER, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod }), `${fiscalPeriod} FY${fiscalYear}`);
    }
  };
  const candidates = async (metric: string): Promise<ReadonlyArray<InputCandidate>> => {
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
      metric_key: metric,
      fiscal_year: null,
      fiscal_period: null,
      limit: 100,
    });
    assert.ok(page.status === "ok" && !page.truncated);
    return page.status === "ok" ? page.candidates : [];
  };

  await t.test("offsets 0 to 7 land on consecutive fiscal quarters, and each derived Q4 is a gap", async () => {
    await ingest(2023, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    await ingest(2024, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    const revenue = await candidates("revenue");
    assert.deepEqual(revenue.filter((candidate) => candidate.period.fiscal_period === "Q4").map((candidate) => [candidate.value_text, candidate.precision]), [
      ["130", null],
      ["170", null],
    ], "SEC ingestion stored each derived Q4 without a precision proof");
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((offset) => landed(selectInput(latestQuarter("revenue", offset), revenue, POLICY))), [
      "gap precision_unverified",
      "Q3 FY2024 160",
      "Q2 FY2024 150",
      "Q1 FY2024 140",
      "gap precision_unverified",
      "Q3 FY2023 120",
      "Q2 FY2023 110",
      "Q1 FY2023 100",
    ]);
  });

  await t.test("after the next Q1, one quarter back is the prior year's Q4 and four back is the prior Q1", async () => {
    await ingest(2025, ["Q1"]);
    const revenue = await candidates("revenue");
    assert.deepEqual([0, 1, 4].map((offset) => landed(selectInput(latestQuarter("revenue", offset), revenue, POLICY))), [
      "Q1 FY2025 180",
      "gap precision_unverified",
      "Q1 FY2024 140",
    ]);
  });

  await t.test("a margin's numerator and denominator share the latest quarter", async () => {
    const slots = [
      { node: latestQuarter("net_income", 1), candidates: await candidates("net_income") },
      { node: latestQuarter("revenue", 1), candidates: await candidates("revenue") },
      { node: latestQuarter("net_income", 0), candidates: await candidates("net_income") },
      { node: latestQuarter("revenue", 0), candidates: await candidates("revenue") },
    ];
    const periods = sharedLatestPeriods(slots, POLICY);
    assert.deepEqual(slots.map(({ node, candidates }) => landed(selectInput(node, candidates, POLICY, { truncated: false }, periods.get(node.node_id)!))), [
      "gap precision_unverified",
      "gap precision_unverified",
      "Q1 FY2025 18",
      "Q1 FY2025 180",
    ]);
  });
});
