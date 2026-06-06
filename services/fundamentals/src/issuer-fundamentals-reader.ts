import type { QueryExecutor } from "../../evidence/src/types.ts";
import { DISPLAYABLE_VERIFICATION_STATUSES } from "../../evidence/src/promotion-rules.ts";
import type { FactEntitlementChannel } from "../../evidence/src/fact-repo.ts";
import type { IssuerSubjectRef } from "./subject-ref.ts";

// Canonical "recent fundamentals for an issuer" reader. Owns the single
// definition of which facts may ground a user-facing answer: reported, active,
// entitled for the egress channel, and display-verified. Chat reads through
// this; the screener follow-up (fra-savt sibling) will reuse it.
export type IssuerFundamentalFact = {
  metric_key: string;
  display_name: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: string;
  source_id: string;
};

export type LoadRecentIssuerFundamentalsOptions = {
  // Egress channel the facts must be entitled to. Defaults to "app" — the
  // channel chat answers render on.
  channel?: FactEntitlementChannel;
  limit: number;
};

type FactRow = {
  metric_key: string;
  display_name: string | null;
  value_num: number | string | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: Date | string;
  source_id: string;
};

export async function loadRecentIssuerFundamentals(
  db: QueryExecutor,
  issuer: IssuerSubjectRef,
  options: LoadRecentIssuerFundamentalsOptions,
): Promise<IssuerFundamentalFact[]> {
  const channel = options.channel ?? "app";
  const { rows } = await db.query<FactRow>(
    // Eligibility filter — the one place chat + screener share. method='reported'
    // keeps derived/estimated out; entitlement_channels and verification_status
    // give parity with the egress guard (fact-repo.listFactsForEgress) and the
    // promotion rules (only promoted facts ground answers).
    `select m.metric_key,
            m.display_name,
            f.value_num,
            f.value_text,
            f.unit,
            f.currency,
            f.fiscal_year,
            f.fiscal_period,
            f.as_of,
            f.source_id::text as source_id
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1::uuid
        and f.method = 'reported'
        and f.superseded_by is null
        and f.invalidated_at is null
        and f.entitlement_channels ? $2
        and f.verification_status = any($3::verification_status[])
      order by f.fiscal_year desc nulls last,
               f.as_of desc,
               m.metric_key
      limit $4`,
    [issuer.id, channel, [...DISPLAYABLE_VERIFICATION_STATUSES], options.limit],
  );
  return rows.map(factFromRow);
}

function factFromRow(row: FactRow): IssuerFundamentalFact {
  return Object.freeze({
    metric_key: row.metric_key,
    display_name: row.display_name,
    value_num: numericOrNull(row.value_num),
    value_text: row.value_text,
    unit: row.unit,
    currency: row.currency,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    as_of: isoString(row.as_of),
    source_id: row.source_id,
  });
}

function numericOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
