// SEC EDGAR primary-source anchor (spec §6.3.1).
//
// data.sec.gov publishes per-issuer "companyfacts" JSON aggregating the
// XBRL-tagged values from filed 10-K / 10-Q forms. This module:
//
// - Models the companyfacts response schema as TypeScript value objects.
// - Fetches via an injected fetcher (mirrors `services/market` adapter
//   pattern; tests use a fake fetcher returning canned payloads, prod
//   sets the SEC-required User-Agent header).
// - Builds a `Source` row pointing at a specific filing accession so every
//   downstream `Fact` carries a primary-source provenance link.
// - Maps US-GAAP concept names to canonical `metric_key`s aligned with
//   `db/seed/metrics.sql`, so values extracted here resolve through the
//   `metric-mapper` to the same `metric_id`s a hand-seeded registry uses.

import type {
  FiscalPeriod,
  NormalizedStatementInput,
  StatementFamily,
  StatementLine,
} from "./statement.ts";
import type { IssuerSubjectRef, UUID } from "./subject-ref.ts";
import {
  assertInteger,
  assertIso8601Utc,
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
  if (!Number.isInteger(cik) || cik < 1) {
    throw new Error(
      `companyFactsPath.cik: must be a positive integer; received ${cik}`,
    );
  }
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

export function assertCompanyFacts(
  value: unknown,
  label: string,
): asserts value is SecCompanyFacts {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const v = value as Record<string, unknown>;
  if (!Number.isInteger(v.cik) || (v.cik as number) < 1) {
    throw new Error(`${label}.cik: must be a positive integer`);
  }
  if (typeof v.entityName !== "string" || v.entityName.length === 0) {
    throw new Error(`${label}.entityName: must be a non-empty string`);
  }
  if (!v.facts || typeof v.facts !== "object") {
    throw new Error(`${label}.facts: must be an object`);
  }
}

// --- Source row ------------------------------------------------------------

export type SecSource = {
  source_id: UUID;
  provider: "sec.gov";
  kind: "filing";
  canonical_url: string;
  trust_tier: "primary";
  license_class: "public_domain";
  retrieved_at: string;
  content_hash: string;
  accession_number: string;
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
  assertInteger(input.cik, "buildSecSource.cik");
  if (input.cik < 1) {
    throw new Error(
      `buildSecSource.cik: must be positive; received ${input.cik}`,
    );
  }
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
    provider: "sec.gov",
    kind: "filing",
    canonical_url: edgarFilingUrl(input.cik, input.accession_number),
    trust_tier: "primary",
    license_class: "public_domain",
    retrieved_at: input.retrieved_at,
    content_hash: input.content_hash,
    accession_number: input.accession_number,
  });
}

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

function edgarFilingUrl(cik: number, accession_number: string): string {
  // EDGAR archive URL: cik unpadded, accession-no-dashes in path, with-dashes in filename.
  const accnNoDashes = accession_number.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accnNoDashes}/${accession_number}-index.htm`;
}

// --- US-GAAP concept → metric_key mapping ----------------------------------

// Aligned with db/seed/metrics.sql. The mapping is many-to-one because
// US-GAAP concept naming evolved (e.g., the ASC 606 update introduced
// `RevenueFromContractWithCustomerExcludingAssessedTax` alongside legacy
// `Revenues`/`SalesRevenueNet`). Multiple aliases collapse to the same
// canonical metric so a 20-year history reads as one series.
export const US_GAAP_TO_METRIC_KEY: Readonly<Record<string, string>> = {
  // Revenue
  Revenues: "revenue",
  SalesRevenueNet: "revenue",
  RevenueFromContractWithCustomerExcludingAssessedTax: "revenue",

  // Costs and gross profit
  CostOfRevenue: "cost_of_revenue",
  CostOfGoodsAndServicesSold: "cost_of_revenue",
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
  const usGaap = input.facts.facts["us-gaap"];
  if (!usGaap) {
    throw new Error(
      `extractStatement: companyfacts has no "us-gaap" taxonomy for ${input.facts.entityName}`,
    );
  }

  // Walk every us-gaap concept that maps to a known metric_key. For each,
  // pick the value matching (fy, fp, form) and translate to a StatementLine.
  // Collisions on metric_key (multiple concepts mapping to the same key, e.g.
  // both `Revenues` and `RevenueFromContractWithCustomerExcludingAssessedTax`
  // present) keep the first value; later matches throw the same
  // duplicate-key error that NormalizedStatement enforces.
  const expectedForm = input.fiscal_period === "FY" ? "10-K" : "10-Q";
  const lines: StatementLine[] = [];
  const seenKeys = new Set<string>();
  let resolvedPeriodStart: string | null = null;
  let resolvedPeriodEnd: string | null = null;

  for (const [conceptName, concept] of Object.entries(usGaap)) {
    const metricKey = US_GAAP_TO_METRIC_KEY[conceptName];
    if (!metricKey) continue;
    if (!relevantToFamily(metricKey, input.family)) continue;

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

      if (seenKeys.has(metricKey)) continue;
      seenKeys.add(metricKey);

      const line: StatementLine = {
        metric_key: metricKey,
        value_num: match.val,
        unit: lineUnit.unit,
        scale: 1,
        coverage_level: "full",
      };
      if (lineUnit.currency !== undefined) line.currency = lineUnit.currency;
      lines.push(line);

      if (match.start !== undefined) resolvedPeriodStart = match.start;
      resolvedPeriodEnd = match.end;
    }
  }

  if (resolvedPeriodEnd === null) {
    throw new Error(
      `extractStatement: no us-gaap values for fiscal_year=${input.fiscal_year} fiscal_period="${input.fiscal_period}" form="${expectedForm}"`,
    );
  }

  return {
    subject: input.subject,
    family: input.family,
    basis: "as_reported",
    period_kind: input.family === "balance" ? "point" : input.fiscal_period === "FY" ? "fiscal_y" : "fiscal_q",
    period_start: input.family === "balance" ? null : resolvedPeriodStart,
    period_end: resolvedPeriodEnd,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    reporting_currency: "USD",
    as_of: input.as_of,
    reported_at: input.reported_at ?? null,
    source_id: input.source_id,
    lines,
  };
}

// Income vs balance vs cashflow categorization. Keeps the per-call extract
// scoped to one statement family so a caller asking for "income" doesn't
// accidentally pull in balance-sheet line items that share a metric.
const INCOME_KEYS = new Set([
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

function relevantToFamily(
  metricKey: string,
  family: StatementFamily,
): boolean {
  if (family === "income") return INCOME_KEYS.has(metricKey);
  // Balance-sheet and cashflow concept maps land in later beads.
  return false;
}

export const SEC_INCOME_METRIC_KEYS: ReadonlyArray<string> = Object.freeze(
  Array.from(INCOME_KEYS),
);
