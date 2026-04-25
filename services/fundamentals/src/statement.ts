import { assertIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFiniteNumber,
  assertFinitePositive,
  assertInteger,
  assertIso8601Utc,
  assertIsoDate,
  assertMetricKey,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type StatementFamily = "income" | "balance" | "cashflow";

export const STATEMENT_FAMILIES: ReadonlyArray<StatementFamily> = [
  "income",
  "balance",
  "cashflow",
];

// `as_reported` mirrors the values the issuer originally filed for a period;
// `as_restated` mirrors the values the issuer republished for that same
// period in a later filing. The two MUST stay distinguishable end-to-end so
// promotion to `Fact` doesn't merge supersession history.
export type StatementBasis = "as_reported" | "as_restated";

export const STATEMENT_BASES: ReadonlyArray<StatementBasis> = [
  "as_reported",
  "as_restated",
];

export type PeriodKind = "point" | "fiscal_q" | "fiscal_y" | "ttm";

export const PERIOD_KINDS: ReadonlyArray<PeriodKind> = [
  "point",
  "fiscal_q",
  "fiscal_y",
  "ttm",
];

// `fiscal_q` requires Q1..Q4; every other kind requires "FY".
const FY_PERIOD_KINDS: ReadonlySet<PeriodKind> = new Set(["fiscal_y", "point", "ttm"]);

export type FiscalPeriod = "FY" | "Q1" | "Q2" | "Q3" | "Q4";

export const FISCAL_PERIODS: ReadonlyArray<FiscalPeriod> = [
  "FY",
  "Q1",
  "Q2",
  "Q3",
  "Q4",
];

export type CoverageLevel = "full" | "partial" | "sparse" | "unavailable";

export const COVERAGE_LEVELS: ReadonlyArray<CoverageLevel> = [
  "full",
  "partial",
  "sparse",
  "unavailable",
];

const MIN_FISCAL_YEAR = 1900;
const MAX_FISCAL_YEAR = 2200;

// `value_num × scale` is the value expressed in `unit`. Splitting scale out
// of `value_num` lets the same row express "in millions" displays and
// native-precision computations from a single normalized payload.
export type StatementLine = {
  metric_key: string;
  value_num: number | null;
  value_text?: string;
  unit: string;
  currency?: string;
  scale: number;
  coverage_level: CoverageLevel;
};

export type NormalizedStatement = {
  subject: IssuerSubjectRef;
  family: StatementFamily;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  reporting_currency: string;
  as_of: string;
  reported_at: string | null;
  source_id: UUID;
  lines: ReadonlyArray<StatementLine>;
};

export type NormalizedStatementInput = Omit<NormalizedStatement, "reported_at" | "lines"> & {
  reported_at?: string | null;
  lines: ReadonlyArray<StatementLine>;
};

export function normalizedStatement(
  input: NormalizedStatementInput,
): NormalizedStatement {
  assertStatementContract(input);

  return Object.freeze({
    subject: Object.freeze({ kind: input.subject.kind, id: input.subject.id }),
    family: input.family,
    basis: input.basis,
    period_kind: input.period_kind,
    period_start: input.period_start,
    period_end: input.period_end,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    reporting_currency: input.reporting_currency,
    as_of: input.as_of,
    reported_at: input.reported_at ?? null,
    source_id: input.source_id,
    lines: freezeLines(input.lines),
  });
}

export function assertStatementContract(
  value: unknown,
): asserts value is NormalizedStatement {
  if (value === null || typeof value !== "object") {
    throw new Error("statement: must be an object");
  }
  const s = value as Record<string, unknown>;

  assertIssuerRef(s.subject, "statement.subject");
  assertOneOf(s.family, STATEMENT_FAMILIES, "statement.family");
  assertOneOf(s.basis, STATEMENT_BASES, "statement.basis");
  assertOneOf(s.period_kind, PERIOD_KINDS, "statement.period_kind");
  assertIsoDate(s.period_end, "statement.period_end");
  assertPeriodStart(s.period_start, s.period_end, s.period_kind, s.family);
  assertInteger(s.fiscal_year, "statement.fiscal_year");
  if (s.fiscal_year < MIN_FISCAL_YEAR || s.fiscal_year > MAX_FISCAL_YEAR) {
    throw new Error(
      `statement.fiscal_year: ${s.fiscal_year} is outside [${MIN_FISCAL_YEAR}, ${MAX_FISCAL_YEAR}]`,
    );
  }
  assertFiscalPeriod(s.fiscal_period, s.period_kind);
  assertCurrency(s.reporting_currency, "statement.reporting_currency");
  assertIso8601Utc(s.as_of, "statement.as_of");
  if (s.reported_at != null) {
    assertIso8601Utc(s.reported_at, "statement.reported_at");
  }
  assertUuid(s.source_id, "statement.source_id");
  assertLines(s.lines, s.reporting_currency, "statement.lines");
}

function assertLines(
  value: unknown,
  reportingCurrency: string,
  label: string,
): asserts value is ReadonlyArray<StatementLine> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    assertStatementLine(value[i], reportingCurrency, `${label}[${i}]`);
    const key = (value[i] as StatementLine).metric_key;
    if (seen.has(key)) {
      throw new Error(
        `${label}[${i}].metric_key: duplicate metric_key "${key}" within a normalized statement`,
      );
    }
    seen.add(key);
  }
}

function freezeLines(
  lines: ReadonlyArray<StatementLine>,
): ReadonlyArray<StatementLine> {
  const frozen: StatementLine[] = [];
  for (const line of lines) {
    const out: StatementLine = {
      metric_key: line.metric_key,
      value_num: line.value_num,
      unit: line.unit,
      scale: line.scale,
      coverage_level: line.coverage_level,
    };
    // Avoid materializing explicit-undefined fields on the frozen output.
    if (line.value_text !== undefined) out.value_text = line.value_text;
    if (line.currency !== undefined) out.currency = line.currency;
    frozen.push(Object.freeze(out));
  }
  return Object.freeze(frozen);
}

function assertStatementLine(
  value: unknown,
  reportingCurrency: string,
  label: string,
): asserts value is StatementLine {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const l = value as Record<string, unknown>;
  assertMetricKey(l.metric_key, `${label}.metric_key`);
  if (l.value_num !== null) {
    assertFiniteNumber(l.value_num, `${label}.value_num`);
  }
  if (l.value_text !== undefined && typeof l.value_text !== "string") {
    throw new Error(`${label}.value_text: must be a string when present`);
  }
  if (typeof l.unit !== "string" || l.unit.length === 0) {
    throw new Error(`${label}.unit: must be a non-empty string`);
  }
  assertFinitePositive(l.scale, `${label}.scale`);
  assertOneOf(l.coverage_level, COVERAGE_LEVELS, `${label}.coverage_level`);

  if (isMonetaryUnit(l.unit)) {
    assertCurrency(l.currency, `${label}.currency`);
    if (l.currency !== reportingCurrency) {
      throw new Error(
        `${label}.currency: ${String(l.currency)} disagrees with statement.reporting_currency ${reportingCurrency}`,
      );
    }
  } else if (l.currency !== undefined) {
    throw new Error(
      `${label}.currency: must be omitted for non-monetary unit ${JSON.stringify(l.unit)}`,
    );
  }

  if (l.value_num === null && l.coverage_level === "full") {
    throw new Error(
      `${label}: value_num=null requires coverage_level != "full" (got "full")`,
    );
  }
}

function assertPeriodStart(
  start: unknown,
  end: unknown,
  kind: unknown,
  family: unknown,
): void {
  if (kind === "point") {
    if (family !== "balance") {
      throw new Error(
        `statement: period_kind="point" only valid for family="balance"; got "${String(family)}"`,
      );
    }
    if (start != null) {
      throw new Error(
        "statement.period_start: must be null for period_kind=point",
      );
    }
    return;
  }
  if (family === "balance") {
    throw new Error(
      `statement: family="balance" requires period_kind="point"; got "${String(kind)}"`,
    );
  }
  if (start == null) {
    throw new Error(
      `statement.period_start: required for period_kind="${String(kind)}"`,
    );
  }
  assertIsoDate(start, "statement.period_start");
  // Zero-padded ISO dates compare lexicographically the same as chronologically.
  if ((start as string) >= (end as string)) {
    throw new Error(
      `statement.period_start: ${start} must be strictly before period_end ${String(end)}`,
    );
  }
}

function assertFiscalPeriod(value: unknown, kind: unknown): void {
  assertOneOf(value, FISCAL_PERIODS, "statement.fiscal_period");
  if (kind === "fiscal_q" && value === "FY") {
    throw new Error(
      `statement.fiscal_period: period_kind="fiscal_q" requires Q1..Q4; received "FY"`,
    );
  }
  if (FY_PERIOD_KINDS.has(kind as PeriodKind) && value !== "FY") {
    throw new Error(
      `statement.fiscal_period: period_kind="${String(kind)}" requires "FY"; received "${String(value)}"`,
    );
  }
}

function isMonetaryUnit(unit: string): boolean {
  // `currency` = raw money; `currency_per_<denom>` = money per non-money unit
  // (e.g. `currency_per_share`). Anything else (`shares`, `ratio`, `pure`,
  // `count`) is non-monetary.
  return unit === "currency" || unit.startsWith("currency_per_");
}
