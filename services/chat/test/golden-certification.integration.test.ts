import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createFact } from "../../evidence/src/fact-repo.ts";
import { createRuntimeAuthority, type ReportedMetricNode } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { selectInput } from "../../financial-engine/src/select-inputs.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, seedGoldenDataset } from "./golden/dataset.ts";

const NVDA = GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!;

const authority = createRuntimeAuthority({
  owner_user_id: "00000000-0000-4000-8000-000000000001",
  egress_channel: "chat",
  parent: { kind: "chat_thread", id: "65000000-0000-4000-8000-0000000000c1", version: "turn:golden-certification" },
  allowed_source_classes: ["sec_filing"],
  feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
  approval_state: "not_required",
  lease: null,
});

function revenueNode(fiscalYear: number): ReportedMetricNode {
  return {
    node_id: "rev",
    operation: "reported_metric",
    operation_version: "reported_metric.v1",
    subject_slot: "a",
    metric_key: "revenue",
    period: { kind: "fiscal_period", fiscal_year: fiscalYear, fiscal_period: "FY" },
  };
}

test("golden facts certify at the golden cutoff and an undeclared fact does not", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for golden certification coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-certification");
  const client = await connectedClient(t, databaseUrl);
  await seedGoldenDataset(client);
  const port = createEvidenceFinancialPort(client);
  const select = async (fiscalYear: number, cutoff: string) => {
    const page = await port.listInputCandidates({
      authority,
      subject: { kind: "issuer", id: NVDA.issuer_id },
      metric_key: "revenue",
      fiscal_year: fiscalYear,
      fiscal_period: "FY",
      limit: 100,
    });
    assert(page.status === "ok", `candidates unreadable: ${JSON.stringify(page)}`);
    return selectInput(revenueNode(fiscalYear), page.candidates, { knowledge_cutoff: cutoff, reporting_basis: "as_reported", max_age_days: null }, page);
  };

  const atCutoff = await select(2026, GOLDEN_AS_OF);
  assert(atCutoff.status === "selected", `NVDA FY2026 revenue certifies at the golden cutoff, got ${atCutoff.status === "gap" ? atCutoff.reason_code : ""}`);
  assert.equal(atCutoff.input.numeric.native_value, "209911000000");
  assert.equal(atCutoff.input.publication.available_no_later_than, GOLDEN_AS_OF);

  const justBefore = new Date(Date.parse(GOLDEN_AS_OF) - 1).toISOString();
  assert.deepEqual(await select(2026, justBefore), { status: "gap", reason_code: "missing_input" }, "not yet public a millisecond before the cutoff");

  const { rows: [{ metric_id: revenueMetricId }] } = await client.query<{ metric_id: string }>(
    `select metric_id::text as metric_id from metrics where metric_key = 'revenue'`,
  );
  await createFact(client, {
    subject_kind: "issuer",
    subject_id: NVDA.issuer_id,
    metric_id: revenueMetricId!,
    period_kind: "fiscal_y",
    period_start: "2026-01-26",
    period_end: "2027-01-31",
    fiscal_year: 2027,
    fiscal_period: "FY",
    value_num: 250_000e6,
    unit: "currency",
    currency: "USD",
    as_of: GOLDEN_AS_OF,
    reported_at: GOLDEN_AS_OF,
    observed_at: GOLDEN_AS_OF,
    source_id: SEC_EDGAR_FILING_SOURCE_ID,
    method: "reported",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    entitlement_channels: ["app"],
    confidence: 1,
  });
  const nextDay = new Date(Date.parse(GOLDEN_AS_OF) + 86_400_000).toISOString();
  assert.deepEqual(await select(2027, nextDay), { status: "gap", reason_code: "publication_time_unknown" }, "an undeclared SEC-source fact has no publication proof");
});
