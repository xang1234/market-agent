import type { FinancialProvider, FinancialReadResult, PacketFact } from "../ports.ts";
import type { CompanyIdentity } from "../types.ts";

export const SUPPORTED_FINANCIAL_METRIC_KEYS = Object.freeze([
  "revenue", "gross_profit", "operating_income", "net_income", "eps_diluted", "free_cash_flow",
] as const);

export type FinancialReader = {
  readCached(input: { identity: CompanyIdentity; as_of: string }): Promise<FinancialReadResult>;
};

export function createFinancialProvider(options: { reader: FinancialReader }): FinancialProvider {
  return Object.freeze({
    // The established high-level reader can issue several SEC calls. This adapter
    // is intentionally cache-only until each underlying hydration request has an
    // independently metered operation boundary.
    async read(input) {
      return options.reader.readCached({ identity: input.identity, as_of: input.as_of });
    },
  });
}

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

type FactRow = Omit<PacketFact, "value_num" | "scale" | "currency" | "period_start"> & {
  value_num: number | string;
  scale: number | string;
  currency: string | null;
  period_start: Date | string | null;
};

export function createCachedFinancialReader(options: {
  db: QueryExecutor;
  user_id: string;
  metric_keys?: readonly string[];
}): FinancialReader {
  const metricKeys = Object.freeze([...(options.metric_keys ?? SUPPORTED_FINANCIAL_METRIC_KEYS)]);
  return Object.freeze({
    async readCached(input): Promise<FinancialReadResult> {
      const { rows } = await options.db.query<FactRow>(
        `select f.fact_id::text as fact_id,
                m.metric_key,
                f.value_num,
                f.scale,
                f.unit,
                f.currency,
                f.period_kind,
                f.period_start,
                f.period_end,
                f.as_of,
                f.source_id::text as source_id,
                f.fiscal_year,
                f.fiscal_period
           from facts f
           join metrics m on m.metric_id = f.metric_id
           join sources s on s.source_id = f.source_id
          where f.subject_kind = 'issuer'
            and f.subject_id = $1::uuid
            and f.method = 'reported'
            and f.superseded_by is null
            and f.invalidated_at is null
            and f.value_num is not null
            and f.entitlement_channels ? 'app'
            and f.verification_status in ('verified', 'approved')
            and (s.user_id is null or s.user_id = $2::uuid)
            and m.metric_key = any($3::text[])
          order by f.fiscal_year desc nulls last, f.as_of desc, m.metric_key`,
        [input.identity.issuer_id, options.user_id, metricKeys],
      );
      const facts = rows.map(packetFactFromRow);
      const present = new Set(facts.map((fact) => fact.metric_key));
      const missing_fields = metricKeys.filter((metricKey) => !present.has(metricKey));
      const currencies = new Set(facts.map((fact) => fact.currency).filter((currency): currency is string => currency !== null));
      return {
        facts,
        missing_fields,
        coverage_gaps: [
          "financial_hydration_cache_only",
          ...(currencies.size > 1 ? ["cross_currency_aggregation_not_performed"] : []),
        ],
      };
    },
  });
}

function packetFactFromRow(row: FactRow): PacketFact {
  return Object.freeze({
    fact_id: row.fact_id,
    metric_key: row.metric_key,
    value_num: Number(row.value_num),
    scale: Number(row.scale),
    unit: row.unit,
    currency: row.currency,
    period_kind: row.period_kind,
    period_start: row.period_start === null ? null : iso(row.period_start),
    period_end: row.period_end,
    as_of: row.as_of,
    source_id: row.source_id,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
  });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
