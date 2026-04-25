// Statement normalization (spec §6.3.1, beads fra-cw0.3.1).
//
// Turns filing-backed or vendor-backed statement inputs into a canonical
// frozen value object keyed by metric definitions. The shape encodes the
// invariants the spec calls out:
//
// * One of three statement families: `income`, `balance`, `cashflow`.
// * Statement basis is explicit (`as_reported` | `as_restated`); restatements
//   land as separate normalized statements rather than silently merged.
// * Period selection, fiscal labels, scale, and unit are part of the contract:
//   the caller cannot defer them to UI code or screener-side cleanup.
// * `metric_key` lives on each line. Mapping `metric_key` to
//   `metrics.metric_id` belongs to fra-cw0.3.3 (MetricMapper); fiscal-calendar
//   derivation belongs to fra-cw0.3.2 (FiscalCalendar). This module validates
//   the inputs those siblings produce, but it does not re-derive them.
// * Coverage is preserved per line so partial filings round-trip without
//   silently dropping rows.

import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
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

// `as_reported` mirrors the values the issuer originally filed for a period.
// `as_restated` mirrors the values the issuer republished for that same
// period in a later filing (e.g. a subsequent 10-K that restates a prior
// year's numbers). The two MUST stay distinguishable end-to-end so callers
// can promote either basis to `Fact` without merging supersession history.
export type StatementBasis = "as_reported" | "as_restated";

export const STATEMENT_BASES: ReadonlyArray<StatementBasis> = [
  "as_reported",
  "as_restated",
];

// Mirrors `facts.period_kind` in the schema so values normalized here can
// promote into `Fact` rows without translation. `point` is balance-sheet
// shape (a single date); `fiscal_q`/`fiscal_y` and `ttm` are durational.
export type PeriodKind = "point" | "fiscal_q" | "fiscal_y" | "ttm";

export const PERIOD_KINDS: ReadonlyArray<PeriodKind> = [
  "point",
  "fiscal_q",
  "fiscal_y",
  "ttm",
];

export type CoverageLevel = "full" | "partial" | "sparse" | "unavailable";

export const COVERAGE_LEVELS: ReadonlyArray<CoverageLevel> = [
  "full",
  "partial",
  "sparse",
  "unavailable",
];

// `value_num × scale` is the value expressed in the line's `unit`. Splitting
// scale out of `value_num` lets the same row express "in millions" displays
// and native-precision computations from a single normalized payload.
export type StatementLine = {
  metric_key: string;
  value_num: number | null;
  value_text?: string;
  unit: string;
  currency?: string;
  scale: number;
  coverage_level: CoverageLevel;
};

export type StatementLineInput = StatementLine;

export type NormalizedStatement = {
  subject: IssuerSubjectRef;
  family: StatementFamily;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: string;
  reporting_currency: string;
  as_of: string;
  reported_at: string | null;
  source_id: UUID;
  lines: ReadonlyArray<StatementLine>;
};

export type NormalizedStatementInput = {
  subject: IssuerSubjectRef;
  family: StatementFamily;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: string;
  reporting_currency: string;
  as_of: string;
  reported_at?: string | null;
  source_id: UUID;
  lines: ReadonlyArray<StatementLineInput>;
};

const FISCAL_PERIOD_PATTERN = /^(FY|Q[1-4])$/;

export function normalizedStatement(
  input: NormalizedStatementInput,
): NormalizedStatement {
  const subject = freezeIssuerRef(input.subject, "normalizedStatement.subject");
  assertOneOf(input.family, STATEMENT_FAMILIES, "normalizedStatement.family");
  assertOneOf(input.basis, STATEMENT_BASES, "normalizedStatement.basis");
  assertOneOf(input.period_kind, PERIOD_KINDS, "normalizedStatement.period_kind");
  assertIsoDate(input.period_end, "normalizedStatement.period_end");
  assertPeriodStart(
    input.period_start,
    input.period_end,
    input.period_kind,
    input.family,
  );
  assertInteger(input.fiscal_year, "normalizedStatement.fiscal_year");
  if (input.fiscal_year < 1900 || input.fiscal_year > 2200) {
    throw new Error(
      `normalizedStatement.fiscal_year: ${input.fiscal_year} is outside the supported range`,
    );
  }
  assertFiscalPeriodForKind(input.fiscal_period, input.period_kind);
  assertCurrency(input.reporting_currency, "normalizedStatement.reporting_currency");
  assertIso8601Utc(input.as_of, "normalizedStatement.as_of");
  if (input.reported_at != null) {
    assertIso8601Utc(input.reported_at, "normalizedStatement.reported_at");
  }
  assertUuid(input.source_id, "normalizedStatement.source_id");

  const lines = freezeLines(
    input.lines,
    input.reporting_currency,
    "normalizedStatement.lines",
  );

  return Object.freeze({
    subject,
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
    lines,
  });
}

export function assertStatementContract(
  value: unknown,
): asserts value is NormalizedStatement {
  if (value === null || typeof value !== "object") {
    throw new Error("statement: must be an object");
  }
  const s = value as Record<string, unknown>;
  if (!s.subject || typeof s.subject !== "object") {
    throw new Error("statement.subject: must be an issuer SubjectRef");
  }
  freezeIssuerRef(s.subject as IssuerSubjectRef, "statement.subject");
  assertOneOf(s.family, STATEMENT_FAMILIES, "statement.family");
  assertOneOf(s.basis, STATEMENT_BASES, "statement.basis");
  assertOneOf(s.period_kind, PERIOD_KINDS, "statement.period_kind");
  assertIsoDate(s.period_end, "statement.period_end");
  assertPeriodStart(
    s.period_start as string | null,
    s.period_end as string,
    s.period_kind as PeriodKind,
    s.family as StatementFamily,
  );
  assertInteger(s.fiscal_year, "statement.fiscal_year");
  assertFiscalPeriodForKind(s.fiscal_period, s.period_kind as PeriodKind);
  assertCurrency(s.reporting_currency, "statement.reporting_currency");
  assertIso8601Utc(s.as_of, "statement.as_of");
  if (s.reported_at != null) {
    assertIso8601Utc(s.reported_at, "statement.reported_at");
  }
  assertUuid(s.source_id, "statement.source_id");
  if (!Array.isArray(s.lines)) {
    throw new Error("statement.lines: must be an array");
  }
  for (let i = 0; i < s.lines.length; i++) {
    assertStatementLine(
      s.lines[i],
      s.reporting_currency as string,
      `statement.lines[${i}]`,
    );
  }
}

function freezeLines(
  lines: ReadonlyArray<StatementLineInput>,
  reportingCurrency: string,
  label: string,
): ReadonlyArray<StatementLine> {
  if (!Array.isArray(lines)) {
    throw new Error(`${label}: must be an array`);
  }
  const seen = new Set<string>();
  const frozen: StatementLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    assertStatementLine(line, reportingCurrency, `${label}[${i}]`);
    if (seen.has(line.metric_key)) {
      // A normalized statement is keyed by metric definitions: collapsing
      // would let two contradictory rows for the same metric coexist
      // silently. Callers that need both must record them as separate
      // normalized statements (basis split) or via segment axis at P1.2b.
      throw new Error(
        `${label}[${i}].metric_key: duplicate metric_key "${line.metric_key}" within a normalized statement`,
      );
    }
    seen.add(line.metric_key);

    const out: StatementLine = {
      metric_key: line.metric_key,
      value_num: line.value_num,
      unit: line.unit,
      scale: line.scale,
      coverage_level: line.coverage_level,
    };
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

  // Currency must be present whenever the line's value is denominated in
  // money (raw money or per-share money), and absent for unitless or
  // share-count rows. Mismatches against the statement's reporting currency
  // would silently break aggregations downstream.
  const unit = l.unit;
  if (isMonetaryUnit(unit)) {
    assertCurrency(l.currency, `${label}.currency`);
    if (l.currency !== reportingCurrency) {
      throw new Error(
        `${label}.currency: ${String(l.currency)} disagrees with statement.reporting_currency ${reportingCurrency}`,
      );
    }
  } else if (l.currency !== undefined) {
    throw new Error(
      `${label}.currency: must be omitted for non-monetary unit ${JSON.stringify(unit)}`,
    );
  }

  // A null value_num MUST come with a non-`full` coverage level; otherwise
  // the row asserts a known full value but provides nothing to display.
  if (l.value_num === null && l.coverage_level === "full") {
    throw new Error(
      `${label}: value_num=null requires coverage_level != "full" (got "full")`,
    );
  }
}

function assertPeriodStart(
  start: string | null | undefined,
  end: string,
  kind: PeriodKind,
  family: StatementFamily,
): void {
  // Balance sheets are point-in-time, so `period_start` must be omitted.
  // Income and cash-flow statements are durational, so it must be present
  // and strictly before `period_end`.
  if (kind === "point") {
    if (family !== "balance") {
      throw new Error(
        `normalizedStatement: period_kind="point" only valid for family="balance"; got "${family}"`,
      );
    }
    if (start != null) {
      throw new Error(
        "normalizedStatement.period_start: must be null for period_kind=point",
      );
    }
    return;
  }
  if (family === "balance") {
    throw new Error(
      `normalizedStatement: family="balance" requires period_kind="point"; got "${kind}"`,
    );
  }
  if (start == null) {
    throw new Error(
      `normalizedStatement.period_start: required for period_kind="${kind}"`,
    );
  }
  assertIsoDate(start, "normalizedStatement.period_start");
  if (Date.parse(`${start}T00:00:00Z`) >= Date.parse(`${end}T00:00:00Z`)) {
    throw new Error(
      `normalizedStatement.period_start: ${start} must be strictly before period_end ${end}`,
    );
  }
}

function assertFiscalPeriodForKind(value: unknown, kind: PeriodKind): void {
  if (typeof value !== "string" || !FISCAL_PERIOD_PATTERN.test(value)) {
    throw new Error(
      `normalizedStatement.fiscal_period: must match /^FY$|^Q[1-4]$/; received ${String(value)}`,
    );
  }
  // `fiscal_y`/`point`/`ttm` map to the full fiscal year ('FY'); `fiscal_q`
  // maps to a specific quarter. Mismatches indicate a calendar-derivation
  // bug from the upstream fiscal calendar (fra-cw0.3.2), so fail loudly.
  if (kind === "fiscal_q" && value === "FY") {
    throw new Error(
      `normalizedStatement.fiscal_period: period_kind="fiscal_q" requires Q1..Q4; received "FY"`,
    );
  }
  if ((kind === "fiscal_y" || kind === "point" || kind === "ttm") && value !== "FY") {
    throw new Error(
      `normalizedStatement.fiscal_period: period_kind="${kind}" requires "FY"; received "${value}"`,
    );
  }
}

function isMonetaryUnit(unit: string): boolean {
  // `currency` = raw money; `currency_per_<denom>` = money per non-money unit
  // (e.g. `currency_per_share`). Anything else (`shares`, `ratio`, `pure`,
  // `count`) is unitless from a currency POV.
  return unit === "currency" || unit.startsWith("currency_per_");
}
