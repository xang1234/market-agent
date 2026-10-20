// Public-information selection of an issuer's FY2023 revenue, through the
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
  const page = await createEvidenceFinancialPort(db).listInputCandidates({
    authority: authority(),
    subject: { kind: "issuer", id: issuerId },
    metric_key: "revenue",
    fiscal_year: 2023,
    fiscal_period: "FY",
    limit: 100,
  });
  assert.equal(page.status, "ok");
  return selectInput(FY2023_REVENUE, page.status === "ok" ? page.candidates : [], { knowledge_cutoff: cutoff, reporting_basis: basis, max_age_days: null });
}

const FY2023_REVENUE = {
  node_id: "rev",
  operation: "reported_metric" as const,
  operation_version: "reported_metric.v1",
  subject_slot: "a",
  metric_key: "revenue",
  period: { kind: "fiscal_period" as const, fiscal_year: 2023, fiscal_period: "FY" as const },
};

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
