// Public-information selection of an issuer's fiscal-year figure, through the
// Evidence port and the engine's selector exactly as a financial run reads it.

import assert from "node:assert/strict";
import { createRuntimeAuthority } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { selectInput, type SlotSelection } from "../../financial-engine/src/select-inputs.ts";
import type { FundamentalsQueryExecutor } from "../src/sec-facts-repository.ts";

const OWNER = "34000000-0000-4000-8000-0000000000aa";

export async function selectRevenue(
  db: FundamentalsQueryExecutor,
  issuerId: string,
  cutoff: string,
  basis: "as_reported" | "as_restated" = "as_reported",
): Promise<SlotSelection> {
  return selectFiscalYear(db, { issuerId, metricKey: "revenue", fiscalYear: 2023 }, cutoff, basis);
}

export async function selectFiscalYear(
  db: FundamentalsQueryExecutor,
  slot: { issuerId: string; metricKey: string; fiscalYear: number },
  cutoff: string,
  basis: "as_reported" | "as_restated" = "as_reported",
): Promise<SlotSelection> {
  const page = await createEvidenceFinancialPort(db).listInputCandidates({
    authority: authority(),
    subject: { kind: "issuer", id: slot.issuerId },
    metric_key: slot.metricKey,
    fiscal_year: slot.fiscalYear,
    fiscal_period: "FY",
    limit: 100,
  });
  assert.equal(page.status, "ok");
  const node = {
    node_id: "slot",
    operation: "reported_metric" as const,
    operation_version: "reported_metric.v1",
    subject_slot: "a",
    metric_key: slot.metricKey,
    period: { kind: "fiscal_period" as const, fiscal_year: slot.fiscalYear, fiscal_period: "FY" as const },
  };
  return selectInput(node, page.status === "ok" ? page.candidates : [], { knowledge_cutoff: cutoff, reporting_basis: basis, max_age_days: null, allowed_source_classes: ["sec_filing"] });
}

export function originalContext(factId: string, relation: "original" | "economic_restatement" = "original") {
  return {
    fact_id: factId,
    context_version: "context.v1",
    period_type: "duration" as const,
    dimension_scope: "consolidated" as const,
    dimension_members: [],
    reporting_basis: relation === "original" ? ("as_reported" as const) : ("as_restated" as const),
    adjustment_basis: "unadjusted" as const,
    share_basis: "not_applicable" as const,
    fiscal_calendar_version: "fiscal-calendar.v1",
    disclosure_relation: relation,
    source_context_ref: null,
  };
}

function authority() {
  return createRuntimeAuthority({
    owner_user_id: OWNER,
    egress_channel: "chat",
    parent: { kind: "chat_thread", id: "34000000-0000-4000-8000-0000000000f1", version: "1" },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}
