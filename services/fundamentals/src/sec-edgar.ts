// SEC EDGAR primary-source anchor (spec §6.3.1).
//
// Models data.sec.gov's per-issuer XBRL `companyfacts` payload, builds a
// `Source` row pointing at a specific filing accession, and extracts a
// `NormalizedStatementInput` from the payload for a (fiscal_year,
// fiscal_period, family) target. US-GAAP concept names map to canonical
// `metric_key`s aligned with `db/seed/metrics.sql`, so values extracted
// here resolve through the metric-mapper to the same `metric_id`s a
// hand-seeded registry uses.

import type {
  FiscalPeriod,
  NormalizedStatementInput,
  StatementFamily,
  StatementLine,
} from "./statement.ts";
import type { IssuerSubjectRef, UUID } from "./subject-ref.ts";
import {
  assertIso8601Utc,
  assertPositiveInteger,
  assertUuid,
} from "./validators.ts";

// --- Companyfacts schema ---------------------------------------------------

export type SecConceptValue = {
  end: string;
  start?: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
};

export type SecConcept = {
  label: string;
  description: string;
  units: Record<string, ReadonlyArray<SecConceptValue>>;
};

export type SecCompanyFacts = {
  cik: number;
  entityName: string;
  facts: {
    "us-gaap"?: Record<string, SecConcept>;
    dei?: Record<string, SecConcept>;
  };
};

// --- Fetcher abstraction ---------------------------------------------------

export type SecEdgarFetcher = (path: string) => Promise<unknown>;

export class SecEdgarFetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SecEdgarFetchError";
    this.status = status;
  }
}

export function companyFactsPath(cik: number): string {
  assertPositiveInteger(cik, "companyFactsPath.cik");
  return `/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}

export async function fetchCompanyFacts(
  fetcher: SecEdgarFetcher,
  cik: number,
): Promise<SecCompanyFacts> {
  const raw = await fetcher(companyFactsPath(cik));
  assertCompanyFacts(raw, "fetchCompanyFacts.response");
  return raw;
}

// Top-level shape only — concept and unit walking is defended structurally
// in extractStatement. A deep XBRL validator is out of scope.
export function assertCompanyFacts(
  value: unknown,
  label: string,
): asserts value is SecCompanyFacts {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const v = value as Record<string, unknown>;
  assertPositiveInteger(v.cik, `${label}.cik`);
  if (typeof v.entityName !== "string" || v.entityName.length === 0) {
    throw new Error(`${label}.entityName: must be a non-empty string`);
  }
  if (!v.facts || typeof v.facts !== "object") {
    throw new Error(`${label}.facts: must be an object`);
  }
}

// --- Source row ------------------------------------------------------------

// `provider` and `license_class` match db/seed/sources.sql so dedup against
// the seeded base row works on (provider, kind) rather than on string
// drift between value-object and seed.
export type SecSource = {
  source_id: UUID;
  provider: "sec_edgar";
  kind: "filing";
  canonical_url: string;
  trust_tier: "primary";
  license_class: "public";
  retrieved_at: string;
  content_hash: string;
};

export type BuildSecSourceInput = {
  source_id: UUID;
  cik: number;
  accession_number: string;
  retrieved_at: string;
  content_hash: string;
};

export function buildSecSource(input: BuildSecSourceInput): SecSource {
  assertUuid(input.source_id, "buildSecSource.source_id");
  assertPositiveInteger(input.cik, "buildSecSource.cik");
  if (!ACCESSION_PATTERN.test(input.accession_number)) {
    throw new Error(
      `buildSecSource.accession_number: must match NNNNNNNNNN-NN-NNNNNN; received "${input.accession_number}"`,
    );
  }
  assertIso8601Utc(input.retrieved_at, "buildSecSource.retrieved_at");
  if (typeof input.content_hash !== "string" || input.content_hash.length === 0) {
    throw new Error(`buildSecSource.content_hash: must be a non-empty string`);
  }
  return Object.freeze({
    source_id: input.source_id,
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: edgarFilingUrl(input.cik, input.accession_number),
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: input.retrieved_at,
    content_hash: input.content_hash,
  });
}

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

function edgarFilingUrl(cik: number, accession_number: string): string {
  // EDGAR archive URL: cik unpadded, accession-no-dashes in path, with-dashes in filename.
  const accnNoDashes = accession_number.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accnNoDashes}/${accession_number}-index.htm`;
}

// --- US-GAAP concept → metric_key mapping ----------------------------------

// Order matters: extractStatement walks this map in declared order so
// concept-name aliases collapse deterministically. Modern (post-ASC 606)
// names appear before legacy aliases so transition-year filings — where
// both `RevenueFromContractWithCustomerExcludingAssessedTax` and
// `Revenues` are present — pick the modern tag.
export const US_GAAP_TO_METRIC_KEY: Readonly<Record<string, string>> = {
  // Revenue (modern → legacy)
  RevenueFromContractWithCustomerExcludingAssessedTax: "revenue",
  SalesRevenueNet: "revenue",
  Revenues: "revenue",

  // Costs and gross profit
  CostOfGoodsAndServicesSold: "cost_of_revenue",
  CostOfRevenue: "cost_of_revenue",
  GrossProfit: "gross_profit",

  // Operating
  OperatingExpenses: "operating_expenses",
  OperatingIncomeLoss: "operating_income",

  // Net income
  NetIncomeLoss: "net_income",
  ProfitLoss: "net_income",

  // EPS
  EarningsPerShareBasic: "eps_basic",
  EarningsPerShareDiluted: "eps_diluted",

  // Shares
  WeightedAverageNumberOfSharesOutstandingBasic: "shares_outstanding_basic",
  WeightedAverageNumberOfDilutedSharesOutstanding: "shares_outstanding_diluted",
};

const UNIT_TO_LINE_UNIT: Readonly<Record<string, { unit: string; currency?: string }>> = {
  USD: { unit: "currency", currency: "USD" },
  "USD/shares": { unit: "currency_per_share", currency: "USD" },
  shares: { unit: "shares" },
  pure: { unit: "pure" },
};

// --- Statement extraction --------------------------------------------------

export type ExtractStatementInput = {
  subject: IssuerSubjectRef;
  facts: SecCompanyFacts;
  family: StatementFamily;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  source_id: UUID;
  as_of: string;
  reported_at?: string | null;
};

export function extractStatement(
  input: ExtractStatementInput,
): NormalizedStatementInput {
  if (input.family !== "income") {
    throw new Error(
      `extractStatement: family="${input.family}" not yet supported (income-only in this bead)`,
    );
  }
  const usGaap = input.facts.facts["us-gaap"];
  if (!usGaap) {
    throw new Error(
      `extractStatement: companyfacts has no "us-gaap" taxonomy for ${input.facts.entityName}`,
    );
  }

  const expectedForm = input.fiscal_period === "FY" ? "10-K" : "10-Q";
  const lines: StatementLine[] = [];
  const seenKeys = new Set<string>();
  const observedCurrencies = new Set<string>();
  let resolvedPeriodStart: string | null = null;
  let resolvedPeriodEnd: string | null = null;

  // Walk the MAPPING in declared order (not the response): this fixes the
  // collision policy at code-defined priority. First-mapped concept that
  // has a matching value wins.
  for (const [conceptName, metricKey] of Object.entries(US_GAAP_TO_METRIC_KEY)) {
    if (!INCOME_KEYS.has(metricKey)) continue;
    if (seenKeys.has(metricKey)) continue;
    const concept = usGaap[conceptName];
    if (!concept || !concept.units || typeof concept.units !== "object") continue;

    for (const [unitCode, values] of Object.entries(concept.units)) {
      const lineUnit = UNIT_TO_LINE_UNIT[unitCode];
      if (!lineUnit) continue;

      const match = values.find(
        (v) =>
          v.fy === input.fiscal_year &&
          v.fp === input.fiscal_period &&
          v.form === expectedForm,
      );
      if (!match) continue;

      // Period agreement: every matched value must share the same
      // (start, end). XBRL typos and restatements should fail loudly here
      // rather than silently picking last-iteration.
      if (resolvedPeriodEnd === null) {
        resolvedPeriodStart = match.start ?? null;
        resolvedPeriodEnd = match.end;
      } else if (
        match.end !== resolvedPeriodEnd ||
        (match.start ?? null) !== resolvedPeriodStart
      ) {
        throw new Error(
          `extractStatement: concept "${conceptName}" period (${match.start ?? "—"}..${match.end}) disagrees with prior matches (${resolvedPeriodStart ?? "—"}..${resolvedPeriodEnd})`,
        );
      }

      const line: StatementLine = {
        metric_key: metricKey,
        value_num: match.val,
        unit: lineUnit.unit,
        scale: 1,
        coverage_level: "full",
      };
      if (lineUnit.currency !== undefined) {
        line.currency = lineUnit.currency;
        observedCurrencies.add(lineUnit.currency);
      }
      lines.push(line);
      seenKeys.add(metricKey);
      break; // one unit per concept per period
    }
  }

  if (resolvedPeriodEnd === null) {
    throw new Error(
      `extractStatement: no us-gaap values for fiscal_year=${input.fiscal_year} fiscal_period="${input.fiscal_period}" form="${expectedForm}"`,
    );
  }
  if (observedCurrencies.size > 1) {
    throw new Error(
      `extractStatement: matched values use multiple currencies (${[...observedCurrencies].join(", ")}); single-currency reporting is required`,
    );
  }
  const reportingCurrency =
    observedCurrencies.size === 1 ? [...observedCurrencies][0] : "USD";

  return {
    subject: input.subject,
    family: input.family,
    basis: "as_reported",
    period_kind: input.fiscal_period === "FY" ? "fiscal_y" : "fiscal_q",
    period_start: resolvedPeriodStart,
    period_end: resolvedPeriodEnd,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    reporting_currency: reportingCurrency,
    as_of: input.as_of,
    reported_at: input.reported_at ?? null,
    source_id: input.source_id,
    lines,
  };
}

// metric_keys this module emits for income-family extraction. Used by
// downstream coverage tooling to know what registry entries to expect.
const INCOME_KEYS: ReadonlySet<string> = new Set([
  "revenue",
  "cost_of_revenue",
  "gross_profit",
  "operating_expenses",
  "operating_income",
  "net_income",
  "eps_basic",
  "eps_diluted",
  "shares_outstanding_basic",
  "shares_outstanding_diluted",
]);

export const SEC_INCOME_METRIC_KEYS: ReadonlyArray<string> = Object.freeze(
  Array.from(INCOME_KEYS),
);
