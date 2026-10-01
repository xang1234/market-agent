import type { FactEntitlementChannel } from "../../evidence/src/fact-repo.ts";
import type { PeriodKind } from "./statement.ts";
import type { IssuerSubjectRef } from "./subject-ref.ts";
import { loadUsableFacts } from "./usable-facts.ts";

// The reader only reads `.rows`. A pg.Pool/Client and the screener's narrower
// ScreenerCandidateQueryExecutor both satisfy this minimal shape, so callers
// don't have to produce a full pg.QueryResult.
type IssuerFundamentalsQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

// Canonical "recent fundamentals for an issuer" reader, used by chat and the
// screener. Which facts may ground an answer is decided by loadUsableFacts
// (usable-facts.ts): eligibility, dated, currency, canonical, and the optional
// snapshot cutoff.
export type IssuerFundamentalFact = {
  fact_id: string;
  metric_key: string;
  display_name: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  // Multiplier to native units (value_num * scale); 1 for most SEC facts.
  scale: number;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: string;
  source_id: string;
};

export type LoadRecentIssuerFundamentalsOptions = {
  // Egress channel the facts must be entitled to. Defaults to "app" — the
  // channel chat answers render on.
  channel?: FactEntitlementChannel;
  // Restrict to a single period kind (e.g. "fiscal_y" for annual). Omit ⇒ all kinds.
  periodKind?: PeriodKind;
  // Restrict to a metric-key set. Omit ⇒ all metrics.
  metricKeys?: ReadonlyArray<string>;
  // Row cap. Omit ⇒ no LIMIT clause (the caller bounds the query another way,
  // e.g. the screener's periodKind + metricKeys filters).
  limit?: number;
  // Snapshot cutoff: only facts known by then (see loadUsableFacts). Omit ⇒ now.
  cutoff?: string;
};

export async function loadRecentIssuerFundamentals(
  db: IssuerFundamentalsQueryExecutor,
  issuer: IssuerSubjectRef,
  options: LoadRecentIssuerFundamentalsOptions,
): Promise<IssuerFundamentalFact[]> {
  // The rules live in loadUsableFacts (#159); this keeps the issuer-shaped API.
  // Text-only facts stay in (numericOnly: false) for callers like model context.
  const facts = await loadUsableFacts(db, {
    subjectKind: "issuer",
    subjectIds: [issuer.id],
    channel: options.channel ?? "app",
    numericOnly: false,
    ...(options.cutoff === undefined ? {} : { cutoff: options.cutoff }),
    ...(options.periodKind === undefined ? {} : { periodKind: options.periodKind }),
    ...(options.metricKeys === undefined ? {} : { metricKeys: options.metricKeys }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return facts.map((fact) => Object.freeze({
    fact_id: fact.fact_id,
    metric_key: fact.metric_key,
    display_name: fact.display_name,
    value_num: fact.value_num,
    value_text: fact.value_text,
    unit: fact.unit,
    currency: fact.currency,
    scale: fact.scale,
    fiscal_year: fact.fiscal_year,
    fiscal_period: fact.fiscal_period,
    as_of: fact.as_of,
    source_id: fact.source_id,
  }));
}
