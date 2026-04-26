import type {
  MappedStatement,
  MappedStatementLine,
} from "./metric-mapper.ts";
import type {
  CoverageLevel,
  FiscalPeriod,
  PeriodKind,
  StatementBasis,
} from "./statement.ts";
import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFiniteNumber,
  assertIso8601Utc,
  assertUuid,
} from "./validators.ts";

export type KeyStatKey =
  | "gross_margin"
  | "operating_margin"
  | "net_margin"
  | "revenue_growth_yoy"
  | "pe_ratio";

export type KeyStatUnit = "ratio" | "multiple";
export type KeyStatFormatHint = "percent" | "multiple";
export type KeyStatComputationKind = "ratio" | "growth";

export type KeyStatWarningCode =
  | "missing_statement_line"
  | "missing_market_price"
  | "null_statement_value"
  | "zero_denominator"
  | "currency_mismatch"
  | "coverage_incomplete"
  | "input_mismatch"
  | "stale_input";

export type KeyStatWarning = {
  code: KeyStatWarningCode;
  message: string;
};

export type KeyStatComputation = {
  kind: KeyStatComputationKind;
  expression: string;
};

export type StatementLineInputRef = {
  kind: "statement_line";
  role: "numerator" | "denominator" | "current" | "prior";
  metric_key: string;
  metric_id: UUID;
  value_num: number | null;
  unit: string;
  currency?: string;
  coverage_level: CoverageLevel;
  source_id: UUID;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  as_of: string;
};

export type MarketFactInputRef = {
  kind: "market_fact";
  role: "numerator";
  metric_key: "price";
  subject: IssuerSubjectRef;
  fact_id: UUID;
  value_num: number;
  unit: "currency";
  currency: string;
  coverage_level: "full";
  source_id: UUID;
  as_of: string;
};

export type KeyStatInputRef = StatementLineInputRef | MarketFactInputRef;

export type KeyStat = {
  stat_key: KeyStatKey;
  value_num: number | null;
  unit: KeyStatUnit;
  format_hint: KeyStatFormatHint;
  coverage_level: CoverageLevel;
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  as_of: string;
  computation: KeyStatComputation;
  inputs: ReadonlyArray<KeyStatInputRef>;
  warnings: ReadonlyArray<KeyStatWarning>;
};

export type KeyStatsEnvelope = {
  subject: IssuerSubjectRef;
  family: "key_stats";
  basis: StatementBasis;
  period_kind: PeriodKind;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  reporting_currency: string;
  as_of: string;
  stats: ReadonlyArray<KeyStat>;
};

export type MarketPriceInput = {
  subject: IssuerSubjectRef;
  fact_id: UUID;
  value_num: number;
  currency: string;
  as_of: string;
  source_id: UUID;
};

export type KeyStatsFreshnessPolicy = {
  as_of: string;
  max_market_price_age_ms?: number;
  max_prior_statement_age_ms?: number;
};

export type BuildKeyStatsInput = {
  statement: MappedStatement;
  prior_statement?: MappedStatement;
  price?: MarketPriceInput;
  freshness_policy?: KeyStatsFreshnessPolicy;
};

type RatioSpec = {
  stat_key: Extract<KeyStatKey, "gross_margin" | "operating_margin" | "net_margin">;
  numerator_key: string;
  expression: string;
};

const COVERAGE_ORDER: Readonly<Record<CoverageLevel, number>> = {
  full: 0,
  partial: 1,
  sparse: 2,
  unavailable: 3,
};

const MARGIN_SPECS: ReadonlyArray<RatioSpec> = [
  {
    stat_key: "gross_margin",
    numerator_key: "gross_profit",
    expression: "gross_profit / revenue",
  },
  {
    stat_key: "operating_margin",
    numerator_key: "operating_income",
    expression: "operating_income / revenue",
  },
  {
    stat_key: "net_margin",
    numerator_key: "net_income",
    expression: "net_income / revenue",
  },
];

const REVENUE_KEYS = Object.freeze(["revenue", "net_sales.total"]);
const EPS_DILUTED_KEYS = Object.freeze(["eps_diluted", "eps.diluted"]);

export function buildKeyStats(input: BuildKeyStatsInput): KeyStatsEnvelope {
  assertIncomeStatement(input.statement, "buildKeyStats.statement");
  if (input.prior_statement) {
    assertIncomeStatement(input.prior_statement, "buildKeyStats.prior_statement");
  }
  if (input.price) {
    assertMarketPriceInput(input.price, "buildKeyStats.price");
  }
  if (input.freshness_policy) {
    assertFreshnessPolicy(input.freshness_policy, "buildKeyStats.freshness_policy");
  }

  const stats = [
    ...MARGIN_SPECS.map((spec) => buildMarginStat(input.statement, spec)),
    buildRevenueGrowthStat(
      input.statement,
      input.prior_statement,
      input.freshness_policy,
    ),
    buildPeRatioStat(input.statement, input.price, input.freshness_policy),
  ];

  return Object.freeze({
    subject: freezeIssuerRef(input.statement.subject, "keyStats.subject"),
    family: "key_stats",
    basis: input.statement.basis,
    period_kind: input.statement.period_kind,
    period_start: input.statement.period_start,
    period_end: input.statement.period_end,
    fiscal_year: input.statement.fiscal_year,
    fiscal_period: input.statement.fiscal_period,
    reporting_currency: input.statement.reporting_currency,
    as_of: input.statement.as_of,
    stats: Object.freeze(stats),
  });
}

function buildMarginStat(
  statement: MappedStatement,
  spec: RatioSpec,
): KeyStat {
  const numerator = findLine(statement, spec.numerator_key);
  const denominator = findLineByKey(statement, REVENUE_KEYS);
  const inputs = inputRefs(statement, [
    ["numerator", numerator],
    ["denominator", denominator],
  ]);
  const warnings = missingLineWarnings(spec.stat_key, [
    ["numerator", spec.numerator_key, numerator],
    ["denominator", "revenue", denominator],
  ]);
  const value = computeRatio(
    spec.stat_key,
    numerator,
    denominator,
    warnings,
  );

  return freezeStat({
    ...baseStat(statement, spec.stat_key, "ratio", "percent", {
      kind: "ratio",
      expression: spec.expression,
    }),
    value_num: value,
    coverage_level: value === null ? "unavailable" : worstCoverage(inputs),
    inputs,
    warnings,
  });
}

function buildRevenueGrowthStat(
  statement: MappedStatement,
  priorStatement: MappedStatement | undefined,
  freshnessPolicy: KeyStatsFreshnessPolicy | undefined,
): KeyStat {
  const current = findLineByKey(statement, REVENUE_KEYS);
  const prior = priorStatement ? findLineByKey(priorStatement, REVENUE_KEYS) : undefined;
  const inputs = [
    ...inputRefs(statement, [["current", current]]),
    ...(priorStatement ? inputRefs(priorStatement, [["prior", prior]]) : []),
  ];
  const warnings: KeyStatWarning[] = [];
  if (!priorStatement) {
    warnings.push({
      code: "missing_statement_line",
      message: "revenue_growth_yoy requires a prior statement.",
    });
  }
  warnings.push(
    ...missingLineWarnings(
      "revenue_growth_yoy",
      priorStatement
        ? [
            ["current", "revenue", current],
            ["prior", "revenue", prior],
          ]
        : [["current", "revenue", current]],
    ),
  );
  if (priorStatement) {
    warnings.push(...priorConsistencyWarnings(statement, priorStatement));
  }
  if (
    priorStatement &&
    statement.reporting_currency !== priorStatement.reporting_currency
  ) {
    warnings.push({
      code: "currency_mismatch",
      message: `revenue_growth_yoy current currency ${statement.reporting_currency} does not match prior currency ${priorStatement.reporting_currency}.`,
    });
  }
  if (priorStatement && freshnessPolicy?.max_prior_statement_age_ms !== undefined) {
    const stale = staleInputWarning(
      "revenue_growth_yoy prior statement",
      priorStatement.as_of,
      freshnessPolicy.as_of,
      freshnessPolicy.max_prior_statement_age_ms,
    );
    if (stale) warnings.push(stale);
  }

  const value =
    hasBlockingWarnings(warnings) ||
    priorStatement === undefined
      ? null
      : computeGrowth(current, prior, warnings);

  return freezeStat({
    ...baseStat(statement, "revenue_growth_yoy", "ratio", "percent", {
      kind: "growth",
      expression: "(revenue - prior.revenue) / prior.revenue",
    }),
    value_num: value,
    coverage_level: value === null ? "unavailable" : worstCoverage(inputs),
    as_of: priorStatement
      ? maxIsoTimestamp(statement.as_of, priorStatement.as_of)
      : statement.as_of,
    inputs,
    warnings,
  });
}

function buildPeRatioStat(
  statement: MappedStatement,
  price: MarketPriceInput | undefined,
  freshnessPolicy: KeyStatsFreshnessPolicy | undefined,
): KeyStat {
  const eps = findLineByKey(statement, EPS_DILUTED_KEYS);
  const inputs: KeyStatInputRef[] = [
    ...(price ? [marketPriceRef(price)] : []),
    ...inputRefs(statement, [["denominator", eps]]),
  ];
  const warnings = missingLineWarnings("pe_ratio", [
    ["denominator", "eps_diluted", eps],
  ]);
  if (!price) {
    warnings.unshift({
      code: "missing_market_price",
      message: "pe_ratio requires a market price input.",
    });
  }
  if (price && !sameIssuerRef(price.subject, statement.subject)) {
    warnings.push({
      code: "input_mismatch",
      message: `pe_ratio price subject ${price.subject.id} does not match statement subject ${statement.subject.id}.`,
    });
  }
  if (price && eps?.currency && price.currency !== eps.currency) {
    warnings.push({
      code: "currency_mismatch",
      message: `pe_ratio price currency ${price.currency} does not match eps_diluted currency ${eps.currency}.`,
    });
  }
  if (price && freshnessPolicy?.max_market_price_age_ms !== undefined) {
    const stale = staleInputWarning(
      "pe_ratio price",
      price.as_of,
      freshnessPolicy.as_of,
      freshnessPolicy.max_market_price_age_ms,
    );
    if (stale) warnings.push(stale);
  }

  const value =
    price && !hasBlockingWarnings(warnings)
      ? computeRatio("pe_ratio", marketPriceLine(price), eps, warnings)
      : null;

  return freezeStat({
    ...baseStat(statement, "pe_ratio", "multiple", "multiple", {
      kind: "ratio",
      expression: "price / eps_diluted",
    }),
    value_num: value,
    coverage_level: value === null ? "unavailable" : worstCoverage(inputs),
    as_of: price ? maxIsoTimestamp(statement.as_of, price.as_of) : statement.as_of,
    inputs,
    warnings,
  });
}

function baseStat(
  statement: MappedStatement,
  statKey: KeyStatKey,
  unit: KeyStatUnit,
  formatHint: KeyStatFormatHint,
  computation: KeyStatComputation,
): Omit<KeyStat, "value_num" | "coverage_level" | "inputs" | "warnings"> {
  return {
    stat_key: statKey,
    unit,
    format_hint: formatHint,
    basis: statement.basis,
    period_kind: statement.period_kind,
    period_start: statement.period_start,
    period_end: statement.period_end,
    fiscal_year: statement.fiscal_year,
    fiscal_period: statement.fiscal_period,
    as_of: statement.as_of,
    computation,
  };
}

function computeRatio(
  statKey: KeyStatKey,
  numerator: ValueCarrier | undefined,
  denominator: ValueCarrier | undefined,
  warnings: KeyStatWarning[],
): number | null {
  const numeratorValue = nativeValue(numerator, `${statKey} numerator`, warnings);
  const denominatorValue = nativeValue(denominator, `${statKey} denominator`, warnings);
  if (numeratorValue === null || denominatorValue === null) return null;
  if (denominatorValue === 0) {
    warnings.push({
      code: "zero_denominator",
      message: `${statKey} denominator is zero.`,
    });
    return null;
  }
  return numeratorValue / denominatorValue;
}

function nativeValue(
  line: ValueCarrier | undefined,
  label: string,
  warnings: KeyStatWarning[],
): number | null {
  if (!line) return null;
  if (line.value_num === null) {
    warnings.push({
      code: "null_statement_value",
      message: `${label} has null value_num.`,
    });
    return null;
  }
  if (line.coverage_level !== "full") {
    warnings.push({
      code: "coverage_incomplete",
      message: `${label} coverage is ${line.coverage_level}.`,
    });
  }
  return line.value_num * line.scale;
}

function computeGrowth(
  current: MappedStatementLine | undefined,
  prior: MappedStatementLine | undefined,
  warnings: KeyStatWarning[],
): number | null {
  const currentValue = nativeValue(current, "revenue_growth_yoy current", warnings);
  const priorValue = nativeValue(prior, "revenue_growth_yoy prior", warnings);
  if (currentValue === null || priorValue === null) {
    return null;
  }
  if (priorValue === 0) {
    warnings.push({
      code: "zero_denominator",
      message: "revenue_growth_yoy denominator is zero.",
    });
    return null;
  }
  return (currentValue - priorValue) / priorValue;
}

type ValueCarrier = {
  value_num: number | null;
  scale: number;
  coverage_level: CoverageLevel;
};

function marketPriceLine(price: MarketPriceInput): ValueCarrier {
  return {
    value_num: price.value_num,
    scale: 1,
    coverage_level: "full",
  };
}

function marketPriceRef(price: MarketPriceInput): MarketFactInputRef {
  return Object.freeze({
    kind: "market_fact",
    role: "numerator",
    metric_key: "price",
    subject: freezeIssuerRef(price.subject, "marketPrice.subject"),
    fact_id: price.fact_id,
    value_num: price.value_num,
    unit: "currency",
    currency: price.currency,
    coverage_level: "full",
    source_id: price.source_id,
    as_of: price.as_of,
  });
}

function inputRefs(
  statement: Pick<
    MappedStatement,
    | "source_id"
    | "basis"
    | "period_kind"
    | "period_start"
    | "period_end"
    | "fiscal_year"
    | "fiscal_period"
    | "as_of"
  >,
  pairs: ReadonlyArray<
    readonly [
      StatementLineInputRef["role"],
      MappedStatementLine | undefined,
    ]
  >,
): ReadonlyArray<StatementLineInputRef> {
  return Object.freeze(
    pairs
      .filter((pair): pair is readonly [StatementLineInputRef["role"], MappedStatementLine] => pair[1] !== undefined)
      .map(([role, line]) => {
        const out: StatementLineInputRef = {
          kind: "statement_line",
          role,
          metric_key: line.metric_key,
          metric_id: line.metric_id,
          value_num: line.value_num === null ? null : line.value_num * line.scale,
          unit: line.unit,
          coverage_level: line.coverage_level,
          source_id: statement.source_id,
          basis: statement.basis,
          period_kind: statement.period_kind,
          period_start: statement.period_start,
          period_end: statement.period_end,
          fiscal_year: statement.fiscal_year,
          fiscal_period: statement.fiscal_period,
          as_of: statement.as_of,
        };
        if (line.currency !== undefined) out.currency = line.currency;
        return Object.freeze(out);
      }),
  );
}

function missingLineWarnings(
  statKey: KeyStatKey,
  specs: ReadonlyArray<
    readonly [
      StatementLineInputRef["role"],
      string,
      MappedStatementLine | undefined,
    ]
  >,
): KeyStatWarning[] {
  const warnings: KeyStatWarning[] = [];
  for (const [role, metricKey, line] of specs) {
    if (!line) {
      warnings.push({
        code: "missing_statement_line",
        message: `${statKey} requires ${role} line ${metricKey}.`,
      });
    }
  }
  return warnings;
}

function findLine(
  statement: MappedStatement,
  metricKey: string,
): MappedStatementLine | undefined {
  return statement.lines.find((line) => line.metric_key === metricKey);
}

function findLineByKey(
  statement: MappedStatement,
  metricKeys: ReadonlyArray<string>,
): MappedStatementLine | undefined {
  for (const metricKey of metricKeys) {
    const line = findLine(statement, metricKey);
    if (line) return line;
  }
  return undefined;
}

function worstCoverage(inputs: ReadonlyArray<{ coverage_level: CoverageLevel }>): CoverageLevel {
  let worst: CoverageLevel = "full";
  for (const input of inputs) {
    if (COVERAGE_ORDER[input.coverage_level] > COVERAGE_ORDER[worst]) {
      worst = input.coverage_level;
    }
  }
  return worst;
}

function freezeStat(stat: KeyStat): KeyStat {
  return Object.freeze({
    ...stat,
    computation: Object.freeze({ ...stat.computation }),
    inputs: Object.freeze(stat.inputs),
    warnings: Object.freeze(stat.warnings.map((w) => Object.freeze({ ...w }))),
  });
}

function maxIsoTimestamp(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function assertIncomeStatement(statement: MappedStatement, label: string): void {
  if (statement.family !== "income") {
    throw new Error(`${label}: key stats currently require an income statement`);
  }
}

function assertMarketPriceInput(price: MarketPriceInput, label: string): void {
  freezeIssuerRef(price.subject, `${label}.subject`);
  assertUuid(price.fact_id, `${label}.fact_id`);
  assertFiniteNumber(price.value_num, `${label}.value_num`);
  if (price.value_num <= 0) {
    throw new Error(`${label}.value_num: must be positive; received ${price.value_num}`);
  }
  assertCurrency(price.currency, `${label}.currency`);
  assertIso8601Utc(price.as_of, `${label}.as_of`);
  assertUuid(price.source_id, `${label}.source_id`);
}

function assertFreshnessPolicy(
  policy: KeyStatsFreshnessPolicy,
  label: string,
): void {
  assertIso8601Utc(policy.as_of, `${label}.as_of`);
  if (policy.max_market_price_age_ms !== undefined) {
    assertPositiveAge(policy.max_market_price_age_ms, `${label}.max_market_price_age_ms`);
  }
  if (policy.max_prior_statement_age_ms !== undefined) {
    assertPositiveAge(policy.max_prior_statement_age_ms, `${label}.max_prior_statement_age_ms`);
  }
}

function assertPositiveAge(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new Error(`${label}: must be positive; received ${String(value)}`);
  }
}

function priorConsistencyWarnings(
  current: MappedStatement,
  prior: MappedStatement,
): KeyStatWarning[] {
  const warnings: KeyStatWarning[] = [];
  if (!sameIssuerRef(current.subject, prior.subject)) {
    warnings.push({
      code: "input_mismatch",
      message: `revenue_growth_yoy prior statement subject ${prior.subject.id} does not match current subject ${current.subject.id}.`,
    });
  }
  if (prior.basis !== current.basis) {
    warnings.push({
      code: "input_mismatch",
      message: `revenue_growth_yoy prior basis ${prior.basis} does not match current basis ${current.basis}.`,
    });
  }
  if (prior.period_kind !== current.period_kind) {
    warnings.push({
      code: "input_mismatch",
      message: `revenue_growth_yoy prior period_kind ${prior.period_kind} does not match current period_kind ${current.period_kind}.`,
    });
  }
  if (prior.fiscal_period !== current.fiscal_period) {
    warnings.push({
      code: "input_mismatch",
      message: `revenue_growth_yoy prior fiscal_period ${prior.fiscal_period} does not match current fiscal_period ${current.fiscal_period}.`,
    });
  }
  if (prior.fiscal_year !== current.fiscal_year - 1) {
    warnings.push({
      code: "input_mismatch",
      message: `revenue_growth_yoy prior fiscal_year ${prior.fiscal_year} must be current fiscal_year - 1 (${current.fiscal_year - 1}).`,
    });
  }
  return warnings;
}

function staleInputWarning(
  label: string,
  inputAsOf: string,
  policyAsOf: string,
  maxAgeMs: number,
): KeyStatWarning | null {
  const ageMs = Date.parse(policyAsOf) - Date.parse(inputAsOf);
  if (ageMs <= maxAgeMs) return null;
  return {
    code: "stale_input",
    message: `${label} as_of ${inputAsOf} is older than freshness policy by ${ageMs}ms.`,
  };
}

function hasBlockingWarnings(warnings: ReadonlyArray<KeyStatWarning>): boolean {
  return warnings.some((w) =>
    w.code === "currency_mismatch" ||
    w.code === "input_mismatch" ||
    w.code === "missing_statement_line" ||
    w.code === "missing_market_price" ||
    w.code === "stale_input",
  );
}

function sameIssuerRef(left: IssuerSubjectRef, right: IssuerSubjectRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}
