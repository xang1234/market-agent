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
import type { DerivationProofV1 } from "../../financial-core/src/contracts.ts";
import {
  assertIso8601Utc,
  assertPositiveInteger,
  assertUuid,
} from "./validators.ts";
import { boundedInteger, isSourceNumber } from "./lossless-financial-json.ts";

// --- Companyfacts schema ---------------------------------------------------

export type SecConceptValue = {
  end: string;
  start?: string;
  /** Legacy JavaScript number; strict financial paths use val_token instead. */
  val: number;
  /** Exact source token when the response was parsed losslessly. */
  val_token?: string;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
  /** A value computed from others (a discrete quarter): the filed values it came from. */
  derived_from?: Readonly<{ minuend: SecConceptValue; subtrahends: ReadonlyArray<SecConceptValue> }>;
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

/** What one SEC fetch proves: which URL returned these bytes, and when the body was fully read. */
export type SecFetchEvidence = Readonly<{
  url: string;
  body_sha256: string;
  completed_at: string;
}>;

export type SecFetchResult = SecFetchEvidence & Readonly<{ json: unknown }>;

export type SecEdgarFetcher = (path: string) => Promise<SecFetchResult>;

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

export type SecCompanyFactsFetch = Readonly<{ facts: SecCompanyFacts; evidence: SecFetchEvidence }>;

export async function fetchCompanyFacts(
  fetcher: SecEdgarFetcher,
  cik: number,
): Promise<SecCompanyFactsFetch> {
  const { json, ...evidence } = await fetcher(companyFactsPath(cik));
  const raw = fromLosslessCompanyFacts(json);
  assertCompanyFacts(raw, "fetchCompanyFacts.response");
  return { facts: raw, evidence };
}

// A lossless response carries SourceNumber tokens where the companyfacts
// schema has numbers: the top-level cik, and each concept value's val and fy.
// This walks exactly that structure. cik and fy become bounded integers; val
// keeps its exact token in val_token beside the number the legacy statement
// reader uses. A token anywhere else is a schema change and is rejected, never
// silently rounded. Plain-number fixtures pass through unchanged.
function fromLosslessCompanyFacts(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const { cik, facts, ...rest } = raw;
  rejectStrayNumbers(rest, "companyfacts");
  return {
    ...rest,
    cik: isSourceNumber(cik) ? boundedInteger(cik, "cik", { min: 1, max: 9_999_999_999 }) : cik,
    facts: mapRecord(facts, (taxonomy) => mapRecord(taxonomy, losslessConcept)),
  };
}

function losslessConcept(concept: unknown): unknown {
  if (!isRecord(concept)) return concept;
  const { units, ...rest } = concept;
  rejectStrayNumbers(rest, "companyfacts concept");
  return { ...rest, units: mapRecord(units, (values) => (Array.isArray(values) ? values.map(losslessConceptValue) : values)) };
}

function losslessConceptValue(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  const { val, fy, ...rest } = entry;
  rejectStrayNumbers(rest, "companyfacts value");
  const year = isSourceNumber(fy) ? boundedInteger(fy, "fy", { min: 1900, max: 2200 }) : fy;
  return isSourceNumber(val) ? { ...rest, fy: year, val: Number(val.token), val_token: val.token } : { ...rest, fy: year, val };
}

function rejectStrayNumbers(fields: Record<string, unknown>, label: string): void {
  const stray = Object.keys(fields).find((key) => isSourceNumber(fields[key]));
  if (stray !== undefined) throw new Error(`${label}.${stray}: unexpected numeric field`);
}

function mapRecord(value: unknown, map: (child: unknown) => unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, map(child)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isSourceNumber(value);
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
  WeightedAverageNumberOfSharesOutstandingBasic: "weighted_average_basic_shares",
  WeightedAverageNumberOfDilutedSharesOutstanding: "weighted_average_diluted_shares",

  // Cash flow (a 10-Q reports these year to date)
  NetCashProvidedByUsedInOperatingActivities: "operating_cash_flow",
  NetCashProvidedByUsedInOperatingActivitiesContinuingOperations: "operating_cash_flow",
  // A payment, reported as a positive outflow. Some filers (NVDA) tag only the
  // broader productive-assets line, which adds purchased intangibles.
  PaymentsToAcquirePropertyPlantAndEquipment: "capex",
  PaymentsToAcquireProductiveAssets: "capex",

  // Balance sheet (instants at the period end)
  Assets: "total_assets",
  Liabilities: "total_liabilities",
  StockholdersEquity: "total_equity",
  CashAndCashEquivalentsAtCarryingValue: "cash_and_equivalents",
  // ponytail: no total_debt. Filers split debt across LongTermDebt, its current and
  // noncurrent parts, and commercial paper; summing tags is a definition, not a
  // reported figure. Add it with a reviewed debt definition.
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
  accession_number?: string;
  source_id: UUID;
  as_of: string;
  reported_at?: string | null;
};

/** Exact source token for an extracted line, with the locator that proves it. */
export type SecSourceToken = Readonly<{
  token: string;
  concept: string;
  unit: string;
  accn: string;
  /** The filing's form: the value's own, never an amendment (selection takes only 10-K and 10-Q). */
  form: string;
  /** The filing's date as SEC lists it with the value. */
  filed: string;
  start: string | null;
  end: string;
}>;

export const SEC_COVER_COUNT_CONCEPT = "EntityCommonStockSharesOutstanding";

/**
 * The cover-page counts of the registrant's common shares outstanding that an
 * accession's 10-K or 10-Q lists (dei), each as of its own date. Companyfacts
 * carries undimensioned values only, so a registrant that tags one count per
 * share class lists none of them.
 */
export function secCoverCountValues(facts: SecCompanyFacts, accessionNumber: string): SecConceptValue[] {
  return (facts.facts.dei?.[SEC_COVER_COUNT_CONCEPT]?.units?.shares ?? [])
    .filter((value) => value.accn === accessionNumber && (value.form === "10-K" || value.form === "10-Q"));
}

export function extractStatement(input: ExtractStatementInput): NormalizedStatementInput {
  return extractStatementWithTokens(input).statement;
}

/**
 * One selection pass that yields the legacy statement plus, for each line
 * taken verbatim from a losslessly parsed value, its exact source token.
 */
export function extractStatementWithTokens(input: ExtractStatementInput): {
  statement: NormalizedStatementInput;
  tokens: ReadonlyMap<string, SecSourceToken>;
  // For each derived line, the filed values it was computed from (their
  // filings may differ from the statement's own).
  derivations: ReadonlyMap<string, SecDerivation>;
} {
  const familyKeys = FAMILY_KEYS[input.family];
  const select = FAMILY_SELECTORS[input.family];
  const usGaap = input.facts.facts["us-gaap"];
  if (!usGaap) {
    throw new Error(
      `extractStatement: companyfacts has no "us-gaap" taxonomy for ${input.facts.entityName}`,
    );
  }
  const selection: SecStatementValueSelection = {
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    accession_number: input.accession_number,
    fiscal_window: secFiscalYearWindow(input.facts, input.fiscal_year),
  };

  const selectionDescription = statementSelectionDescription(input.fiscal_period);
  const lines: StatementLine[] = [];
  const tokens = new Map<string, SecSourceToken>();
  const derivations = new Map<string, SecDerivation>();
  const seenKeys = new Set<string>();
  const observedCurrencies = new Set<string>();
  let resolvedPeriodStart: string | null = null;
  let resolvedPeriodEnd: string | null = null;

  // Walk the MAPPING in declared order (not the response): this fixes the
  // collision policy at code-defined priority. First-mapped concept that
  // has a matching value wins.
  for (const [conceptName, metricKey] of Object.entries(US_GAAP_TO_METRIC_KEY)) {
    if (!familyKeys.has(metricKey)) continue;
    if (seenKeys.has(metricKey)) continue;
    const concept = usGaap[conceptName];
    if (!concept || !concept.units || typeof concept.units !== "object") continue;

    for (const [unitCode, values] of Object.entries(concept.units)) {
      const lineUnit = UNIT_TO_LINE_UNIT[unitCode];
      if (!lineUnit) continue;

      const match = select(values, selection, unitCode);
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
      if (match.val_token !== undefined) {
        tokens.set(metricKey, {
          token: match.val_token,
          concept: conceptName,
          unit: unitCode,
          accn: match.accn,
          form: match.form,
          filed: match.filed,
          start: match.start ?? null,
          end: match.end,
        });
      }
      if (match.derived_from !== undefined) {
        derivations.set(metricKey, {
          concept: conceptName,
          unit: unitCode,
          inputs: [
            { value: match.derived_from.minuend, sign: "+" as const },
            ...match.derived_from.subtrahends.map((value) => ({ value, sign: "-" as const })),
          ].map(({ value, sign }) => ({
            sign,
            accn: value.accn,
            start: value.start ?? null,
            end: value.end,
            value: value.val_token ?? String(value.val),
            token: value.val_token ?? null,
            form: value.form,
            filed: value.filed,
            fiscal_year: value.fy,
            fiscal_period: value.fp,
            span: value.fp === "FY" ? "fiscal_year" : isDiscreteQuarterDuration(value) ? "quarter" : "year_to_date",
          })),
        });
      }
      seenKeys.add(metricKey);
      break; // one unit per concept per period
    }
  }

  if (resolvedPeriodEnd === null) {
    throw new Error(
      `extractStatement: no us-gaap values for fiscal_year=${input.fiscal_year} fiscal_period="${input.fiscal_period}" ${selectionDescription}`,
    );
  }
  if (observedCurrencies.size > 1) {
    throw new Error(
      `extractStatement: matched values use multiple currencies (${[...observedCurrencies].join(", ")}); single-currency reporting is required`,
    );
  }
  if (observedCurrencies.size === 0) {
    throw new Error(
      `extractStatement: no monetary lines extracted; cannot derive reporting_currency`,
    );
  }
  const reportingCurrency = observedCurrencies.values().next().value as string;

  // A balance sheet is a point at its period end. The statement contract labels
  // every point "FY" of its fiscal year; its date is the period end.
  const point = input.family === "balance";
  const statement: NormalizedStatementInput = {
    subject: input.subject,
    family: input.family,
    basis: "as_reported",
    period_kind: point ? "point" : input.fiscal_period === "FY" ? "fiscal_y" : "fiscal_q",
    period_start: point ? null : resolvedPeriodStart,
    period_end: resolvedPeriodEnd,
    fiscal_year: input.fiscal_year,
    fiscal_period: point ? "FY" : input.fiscal_period,
    reporting_currency: reportingCurrency,
    as_of: input.as_of,
    reported_at: input.reported_at ?? null,
    source_id: input.source_id,
    lines,
  };
  return { statement, tokens, derivations };
}

/** A derived line's inputs: each filed value, by its filing (accession) and period. */
export type SecDerivation = Readonly<{
  concept: string;
  unit: string;
  inputs: ReadonlyArray<Readonly<{
    sign: "+" | "-";
    accn: string;
    start: string | null;
    end: string;
    value: string;
    token: string | null;
    form: string;
    filed: string;
    fiscal_year: number;
    fiscal_period: string;
    span: DerivationProofV1["terms"][number]["span"];
  }>>;
}>;

export type SecStatementValueSelection = Pick<
  ExtractStatementInput,
  "fiscal_year" | "fiscal_period" | "accession_number"
> & {
  // The dates the fiscal year covers (secFiscalYearWindow); a value ending
  // outside them is another year's, whatever its fy says. Omitted: no bound.
  fiscal_window?: SecFiscalWindow | null;
};

export type SecFiscalWindow = { start: string; end: string };

export function selectSecConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  input: SecStatementValueSelection,
  unitCode: string,
): SecConceptValue | undefined {
  if (input.fiscal_period === "Q4") {
    return deriveFourthQuarterConceptValue(values, input, unitCode);
  }
  if (input.fiscal_period === "FY") {
    return selectAnnualConceptValue(values, input);
  }
  return values
    .filter(
      (v) =>
        v.fy === input.fiscal_year &&
        v.fp === input.fiscal_period &&
        v.form === "10-Q" &&
        inFiscalWindow(v, input.fiscal_window) &&
        (input.accession_number === undefined || v.accn === input.accession_number),
    )
    .filter(isDiscreteQuarterDuration)
    .sort(compareQuarterFactQuality)[0];
}

// A filing repeats prior periods' values under its own fy, fp and accession;
// its own period is the one ending last.
function ownPeriodFirst(a: SecConceptValue, b: SecConceptValue): number {
  return b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed);
}

// A filer's fy can be wrong: NVDA tagged its FY2021 Q1 and Q2 10-Qs fy=2020, so
// fy=2020 Q1 also holds the next year's quarter, and it ends last. The year's
// dates bound its periods: the 10-K's own year, or before that 10-K is filed,
// up to 53 weeks after the previous one. Null when neither is reported.
export function secFiscalYearWindow(facts: SecCompanyFacts, fiscalYear: number): SecFiscalWindow | null {
  const own = annualPeriod(facts, fiscalYear);
  if (own) return own;
  const prior = annualPeriod(facts, fiscalYear - 1);
  const start = prior && nextIsoDate(prior.end);
  const end = prior && addDays(prior.end, 371);
  return start && end ? { start, end } : null;
}

// The fiscal year's own full-year period in its 10-K. Only the primary
// statement concepts mapped here date it: a 10-K can also carry a footnote's
// annual context outside the reporting year (a next-year commitment).
function annualPeriod(facts: SecCompanyFacts, fiscalYear: number): SecFiscalWindow | null {
  const usGaap = facts.facts["us-gaap"] ?? {};
  let best: SecConceptValue | undefined;
  for (const conceptName of Object.keys(US_GAAP_TO_METRIC_KEY)) {
    for (const values of Object.values(usGaap[conceptName]?.units ?? {})) {
      if (!Array.isArray(values)) continue;
      for (const v of values) {
        if (v.fy !== fiscalYear || v.fp !== "FY" || v.form !== "10-K" || !isAnnualDuration(v)) continue;
        if (!best || ownPeriodFirst(v, best) < 0) best = v;
      }
    }
  }
  return best?.start ? { start: best.start, end: best.end } : null;
}

function inFiscalWindow(value: SecConceptValue, window: SecFiscalWindow | null | undefined): boolean {
  return !window || (value.end >= window.start && value.end <= window.end);
}

// A full fiscal year, 52 or 53 weeks. A pre-2021 10-K also tags its fourth
// quarter alone as fp=FY, ending the same day.
function isAnnualDuration(value: SecConceptValue): boolean {
  if (value.start === undefined) return false;
  const days = inclusiveDurationDays(value.start, value.end);
  return days >= 350 && days <= 380;
}

function deriveFourthQuarterConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  input: SecStatementValueSelection,
  unitCode: string,
): SecConceptValue | undefined {
  if (unitCode !== "USD") return undefined;

  const annual = selectAnnualConceptValue(values, input);
  if (!annual?.start) return undefined;

  const q1 = selectDiscreteQuarterConceptValue(values, input.fiscal_year, "Q1", input.fiscal_window);
  const q2 = selectDiscreteQuarterConceptValue(values, input.fiscal_year, "Q2", input.fiscal_window);
  const q3 = selectDiscreteQuarterConceptValue(values, input.fiscal_year, "Q3", input.fiscal_window);
  if (!q1?.start || !q2?.start || !q3?.start) return undefined;

  const q2ExpectedStart = nextIsoDate(q1.end);
  const q3ExpectedStart = nextIsoDate(q2.end);
  const q4Start = nextIsoDate(q3.end);
  if (
    q2ExpectedStart === null ||
    q3ExpectedStart === null ||
    q4Start === null ||
    q1.start !== annual.start ||
    q2.start !== q2ExpectedStart ||
    q3.start !== q3ExpectedStart ||
    inclusiveDurationDays(q4Start, annual.end) < 60 ||
    inclusiveDurationDays(q4Start, annual.end) > 125
  ) {
    return undefined;
  }

  const { val_token: _annualToken, ...annualWithoutToken } = annual;
  return {
    ...annualWithoutToken,
    val: annual.val - q1.val - q2.val - q3.val,
    fp: "Q4",
    form: annual.form,
    start: q4Start,
    end: annual.end,
    derived_from: { minuend: annual, subtrahends: [q1, q2, q3] },
  };
}

function selectAnnualConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  input: SecStatementValueSelection,
): SecConceptValue | undefined {
  return values
    .filter(
      (v) =>
        v.fy === input.fiscal_year &&
        v.fp === "FY" &&
        v.form === "10-K" &&
        isAnnualDuration(v) &&
        inFiscalWindow(v, input.fiscal_window) &&
        (input.accession_number === undefined || v.accn === input.accession_number),
    )
    .sort((a, b) => ownPeriodFirst(a, b) || a.start!.localeCompare(b.start!))[0];
}

function selectDiscreteQuarterConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  fiscalYear: number,
  fiscalPeriod: "Q1" | "Q2" | "Q3",
  window: SecFiscalWindow | null | undefined,
): SecConceptValue | undefined {
  return values
    .filter(
      (v) =>
        v.fy === fiscalYear &&
        v.fp === fiscalPeriod &&
        v.form === "10-Q" &&
        inFiscalWindow(v, window),
    )
    .filter(isDiscreteQuarterDuration)
    .sort(compareQuarterFactQuality)[0];
}

function statementSelectionDescription(fiscalPeriod: FiscalPeriod): string {
  if (fiscalPeriod === "FY") return 'form="10-K"';
  if (fiscalPeriod === "Q4") {
    return 'derived from form="10-K" FY and Q1-Q3 form="10-Q"';
  }
  return 'form="10-Q"';
}

function isDiscreteQuarterDuration(value: SecConceptValue): boolean {
  if (value.start === undefined) return false;
  const days = inclusiveDurationDays(value.start, value.end);
  return days >= 60 && days <= 125;
}

function compareQuarterFactQuality(
  a: SecConceptValue,
  b: SecConceptValue,
): number {
  const ownPeriod = b.end.localeCompare(a.end);
  if (ownPeriod !== 0) return ownPeriod;
  const scoreDiff = quarterFactScore(b) - quarterFactScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  return b.filed.localeCompare(a.filed);
}

function quarterFactScore(value: SecConceptValue): number {
  let score = 0;
  if (/^CY\d{4}Q[1-4]$/.test(value.frame ?? "")) score += 2;
  if (value.start !== undefined && inclusiveDurationDays(value.start, value.end) >= 80) {
    score += 1;
  }
  return score;
}

function inclusiveDurationDays(start: string, end: string): number {
  const startMs = parseSecDateMs(start);
  const endMs = parseSecDateMs(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function parseSecDateMs(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return Number.NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return Number.NaN;
  }
  return ms;
}

function nextIsoDate(value: string): string | null {
  return addDays(value, 1);
}

function addDays(value: string, days: number): string | null {
  const ms = parseSecDateMs(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
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
  "weighted_average_basic_shares",
  "weighted_average_diluted_shares",
]);

export const SEC_INCOME_METRIC_KEYS: ReadonlyArray<string> = Object.freeze(
  Array.from(INCOME_KEYS),
);

const CASHFLOW_KEYS: ReadonlySet<string> = new Set(["operating_cash_flow", "capex"]);
const BALANCE_KEYS: ReadonlySet<string> = new Set([
  "total_assets",
  "total_liabilities",
  "total_equity",
  "cash_and_equivalents",
]);

const FAMILY_KEYS: Readonly<Record<StatementFamily, ReadonlySet<string>>> = {
  income: INCOME_KEYS,
  cashflow: CASHFLOW_KEYS,
  balance: BALANCE_KEYS,
};

export const SEC_METRIC_KEYS_BY_FAMILY: Readonly<Record<StatementFamily, ReadonlyArray<string>>> = Object.freeze({
  income: SEC_INCOME_METRIC_KEYS,
  cashflow: Object.freeze(Array.from(CASHFLOW_KEYS)),
  balance: Object.freeze(Array.from(BALANCE_KEYS)),
});

type ConceptValueSelector = (
  values: ReadonlyArray<SecConceptValue>,
  input: SecStatementValueSelection,
  unitCode: string,
) => SecConceptValue | undefined;

const FAMILY_SELECTORS: Readonly<Record<StatementFamily, ConceptValueSelector>> = {
  income: selectSecConceptValue,
  cashflow: selectCashFlowConceptValue,
  balance: selectBalanceConceptValue,
};

// A 10-Q states cash flows year to date (Q2 covers six months, Q3 nine), so a
// quarter is its year-to-date value less the previous one, and Q4 is the year
// less nine months. Q1's year to date is the quarter itself.
function selectCashFlowConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  input: SecStatementValueSelection,
  unitCode: string,
): SecConceptValue | undefined {
  if (input.fiscal_period === "FY" || input.fiscal_period === "Q1") {
    return selectSecConceptValue(values, input, unitCode);
  }
  if (unitCode !== "USD") return undefined;
  const ytd = input.fiscal_period === "Q4"
    ? selectAnnualConceptValue(values, input)
    : selectYearToDateConceptValue(values, input.fiscal_year, input.fiscal_period, input.fiscal_window, input.accession_number);
  const before = PREVIOUS_QUARTER[input.fiscal_period];
  const prior = selectYearToDateConceptValue(values, input.fiscal_year, before, input.fiscal_window);
  if (!ytd?.start || !prior?.start || prior.start !== ytd.start) return undefined;
  const start = nextIsoDate(prior.end);
  if (start === null) return undefined;
  const days = inclusiveDurationDays(start, ytd.end);
  if (days < 60 || days > 125) return undefined;
  const { val_token: _token, ...rest } = ytd;
  return { ...rest, val: ytd.val - prior.val, fp: input.fiscal_period, start, end: ytd.end, derived_from: { minuend: ytd, subtrahends: [prior] } };
}

const PREVIOUS_QUARTER = { Q2: "Q1", Q3: "Q2", Q4: "Q3" } as const;

// The filing's own year-to-date value: its latest period end, from the start
// of the fiscal year (the longest duration ending then).
function selectYearToDateConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  fiscalYear: number,
  fiscalPeriod: "Q1" | "Q2" | "Q3",
  window: SecFiscalWindow | null | undefined,
  accessionNumber?: string,
): SecConceptValue | undefined {
  return values
    .filter(
      (v) =>
        v.fy === fiscalYear &&
        v.fp === fiscalPeriod &&
        v.form === "10-Q" &&
        v.start !== undefined &&
        inFiscalWindow(v, window) &&
        (accessionNumber === undefined || v.accn === accessionNumber),
    )
    .sort((a, b) => ownPeriodFirst(a, b) || a.start!.localeCompare(b.start!))[0];
}

// A balance is an instant (no start) at the filing's own period end. A fourth
// quarter ends with the year, so it reads the annual report's balance.
function selectBalanceConceptValue(
  values: ReadonlyArray<SecConceptValue>,
  input: SecStatementValueSelection,
): SecConceptValue | undefined {
  const annual = input.fiscal_period === "FY" || input.fiscal_period === "Q4";
  return values
    .filter(
      (v) =>
        v.start === undefined &&
        v.fy === input.fiscal_year &&
        v.fp === (annual ? "FY" : input.fiscal_period) &&
        v.form === (annual ? "10-K" : "10-Q") &&
        inFiscalWindow(v, input.fiscal_window) &&
        (input.accession_number === undefined || v.accn === input.accession_number),
    )
    .sort(ownPeriodFirst)[0];
}
