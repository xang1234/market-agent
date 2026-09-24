// Explicit financial context for a fact: dimensions, period type, reporting /
// adjustment / share basis, fiscal calendar version, and whether the fact is
// an original disclosure, an economic restatement, or an extraction
// correction. Contexts are append-only; a changed context means a new fact.

import {
  ADJUSTMENT_BASES,
  DIMENSION_SCOPES,
  DISCLOSURE_RELATIONS,
  PERIOD_TYPES,
  SHARE_BASES,
  type AdjustmentBasis,
  type DimensionScope,
  type DisclosureRelation,
  type PeriodType,
  type ShareBasis,
} from "../../financial-core/src/evidence-vocabulary.ts";
import type { RowQueryExecutor } from "./types.ts";
import { assertNonEmptyString, assertOneOf, assertUuidV4 } from "./validators.ts";

export { DISCLOSURE_RELATIONS };

const REPORTING_BASES = ["as_reported", "as_restated"] as const;

export type FactFinancialContext = Readonly<{
  fact_id: string;
  context_version: string;
  period_type: PeriodType;
  dimension_scope: DimensionScope;
  dimension_members: ReadonlyArray<Readonly<{ axis: string; member: string }>>;
  reporting_basis: (typeof REPORTING_BASES)[number];
  adjustment_basis: AdjustmentBasis;
  share_basis: ShareBasis;
  fiscal_calendar_version: string;
  disclosure_relation: DisclosureRelation;
  source_context_ref: string | null;
}>;

export async function recordFactFinancialContext(db: RowQueryExecutor, context: FactFinancialContext): Promise<FactFinancialContext> {
  assertUuidV4(context.fact_id, "fact_id");
  assertNonEmptyString(context.context_version, "context_version");
  assertOneOf(context.period_type, PERIOD_TYPES, "period_type");
  assertOneOf(context.dimension_scope, DIMENSION_SCOPES, "dimension_scope");
  assertOneOf(context.reporting_basis, REPORTING_BASES, "reporting_basis");
  assertOneOf(context.adjustment_basis, ADJUSTMENT_BASES, "adjustment_basis");
  assertOneOf(context.share_basis, SHARE_BASES, "share_basis");
  assertOneOf(context.disclosure_relation, DISCLOSURE_RELATIONS, "disclosure_relation");
  assertNonEmptyString(context.fiscal_calendar_version, "fiscal_calendar_version");
  for (const member of context.dimension_members) {
    assertNonEmptyString(member.axis, "dimension_members.axis");
    assertNonEmptyString(member.member, "dimension_members.member");
  }
  await db.query(
    `insert into fact_financial_contexts
       (fact_id, context_version, period_type, dimension_scope, dimension_members, reporting_basis, adjustment_basis,
        share_basis, fiscal_calendar_version, disclosure_relation, source_context_ref)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
    [
      context.fact_id,
      context.context_version,
      context.period_type,
      context.dimension_scope,
      JSON.stringify(context.dimension_members),
      context.reporting_basis,
      context.adjustment_basis,
      context.share_basis,
      context.fiscal_calendar_version,
      context.disclosure_relation,
      context.source_context_ref,
    ],
  );
  return context;
}
