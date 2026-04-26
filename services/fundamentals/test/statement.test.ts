import test from "node:test";
import assert from "node:assert/strict";
import {
  assertStatementContract,
  normalizedStatement,
  type NormalizedStatement,
  type NormalizedStatementInput,
  type StatementLine,
} from "../src/statement.ts";
import {
  AAPL_FY2024_KNOWN_VALUES,
  aaplFy2024IncomeStatementInput,
  aaplIssuer,
  SEC_EDGAR_SOURCE_ID,
} from "./fixtures.ts";

function lineByKey(s: NormalizedStatement, key: string): StatementLine {
  const line = s.lines.find((l) => l.metric_key === key);
  if (!line) throw new Error(`missing line: ${key}`);
  return line;
}

function nativeOf(s: NormalizedStatement, key: string): number {
  const line = lineByKey(s, key);
  if (line.value_num === null) {
    throw new Error(`line ${key} has null value_num`);
  }
  return line.value_num * line.scale;
}

test("AAPL FY2024 income statement normalizes against the 10-K filed 2024-11-01", () => {
  const s = normalizedStatement(aaplFy2024IncomeStatementInput());

  assert.equal(s.family, "income");
  assert.equal(s.basis, "as_reported");
  assert.equal(s.period_kind, "fiscal_y");
  assert.equal(s.fiscal_year, 2024);
  assert.equal(s.fiscal_period, "FY");
  assert.equal(s.period_start, "2023-10-01");
  assert.equal(s.period_end, "2024-09-28");
  assert.equal(s.reporting_currency, "USD");
  assert.equal(s.source_id, SEC_EDGAR_SOURCE_ID);
});

test("AAPL FY2024 normalized values resolve to the native USD amounts in the filing", () => {
  const s = normalizedStatement(aaplFy2024IncomeStatementInput());

  assert.equal(nativeOf(s, "net_sales.total"), AAPL_FY2024_KNOWN_VALUES.net_sales_total);
  assert.equal(nativeOf(s, "cost_of_sales.total"), AAPL_FY2024_KNOWN_VALUES.cost_of_sales_total);
  assert.equal(nativeOf(s, "gross_profit"), AAPL_FY2024_KNOWN_VALUES.gross_profit);
  assert.equal(nativeOf(s, "operating_income"), AAPL_FY2024_KNOWN_VALUES.operating_income);
  assert.equal(nativeOf(s, "net_income"), AAPL_FY2024_KNOWN_VALUES.net_income);

  // EPS keeps scale=1 so the millions multiplier doesn't propagate per-share.
  assert.equal(lineByKey(s, "eps.basic").value_num, AAPL_FY2024_KNOWN_VALUES.eps_basic);
  assert.equal(lineByKey(s, "eps.basic").scale, 1);
  assert.equal(lineByKey(s, "eps.basic").unit, "currency_per_share");
  assert.equal(lineByKey(s, "eps.diluted").value_num, AAPL_FY2024_KNOWN_VALUES.eps_diluted);
});

test("AAPL FY2024 normalized values respect the issuer's reported accounting identities", () => {
  const s = normalizedStatement(aaplFy2024IncomeStatementInput());

  const netSales = nativeOf(s, "net_sales.total");
  const cogs = nativeOf(s, "cost_of_sales.total");
  const gross = nativeOf(s, "gross_profit");
  const opex = nativeOf(s, "operating_expenses.total");
  const opIncome = nativeOf(s, "operating_income");
  const otherIncome = nativeOf(s, "other_income_net");
  const preTax = nativeOf(s, "income_before_taxes");
  const tax = nativeOf(s, "income_tax_expense");
  const net = nativeOf(s, "net_income");

  assert.equal(netSales - cogs, gross, "net_sales - cogs == gross_profit");
  assert.equal(gross - opex, opIncome, "gross_profit - opex == operating_income");
  assert.equal(opIncome + otherIncome, preTax, "op_income + other == pre_tax");
  assert.equal(preTax - tax, net, "pre_tax - tax == net_income");
});

test("normalizedStatement returns a frozen value object so callers can't post-hoc mutate", () => {
  const s = normalizedStatement(aaplFy2024IncomeStatementInput());
  assert.equal(Object.isFrozen(s), true);
  assert.equal(Object.isFrozen(s.subject), true);
  assert.equal(Object.isFrozen(s.lines), true);
  for (const line of s.lines) {
    assert.equal(Object.isFrozen(line), true);
  }
});

test("normalizedStatement clones lines so input array mutation can't leak through", () => {
  const input = aaplFy2024IncomeStatementInput();
  const s = normalizedStatement(input);

  (input.lines as StatementLine[]).push({
    metric_key: "tampered",
    value_num: 999,
    unit: "currency",
    currency: "USD",
    scale: 1,
    coverage_level: "full",
  });

  assert.equal(s.lines.length, input.lines.length - 1);
  assert.equal(s.lines.find((l) => l.metric_key === "tampered"), undefined);
});

test("normalizedStatement rejects non-issuer SubjectRefs (listing, instrument, ticker)", () => {
  for (const badKind of ["listing", "instrument", "ticker"]) {
    assert.throws(
      () =>
        normalizedStatement({
          ...aaplFy2024IncomeStatementInput(),
          subject: { kind: badKind, id: aaplIssuer.id } as never,
        }),
      /subject/,
      `expected kind=${badKind} to be rejected`,
    );
  }
});

test("normalizedStatement rejects issuer SubjectRefs with non-UUID ids", () => {
  const input = aaplFy2024IncomeStatementInput();
  for (const bad of [
    "not-a-uuid",
    "22222222-2222-2222-2222-222222222222", // version digit is 2, not 4
    "",
  ]) {
    assert.throws(
      () =>
        normalizedStatement({
          ...input,
          subject: { kind: "issuer", id: bad } as never,
        }),
      /statement\.subject\.id.*UUID v4/,
      `expected subject.id=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("normalizedStatement rejects unknown family / basis / period_kind", () => {
  const valid = aaplFy2024IncomeStatementInput();
  assert.throws(
    () => normalizedStatement({ ...valid, family: "ratios" as never }),
    /family/,
  );
  assert.throws(
    () => normalizedStatement({ ...valid, basis: "merged" as never }),
    /basis/,
  );
  assert.throws(
    () => normalizedStatement({ ...valid, period_kind: "weekly" as never }),
    /period_kind/,
  );
});

test("balance-sheet family requires period_kind=point and forbids period_start", () => {
  const balance: NormalizedStatementInput = {
    ...aaplFy2024IncomeStatementInput(),
    family: "balance",
    period_kind: "point",
    period_start: null,
    period_end: "2024-09-28",
    fiscal_period: "FY",
  };
  const s = normalizedStatement(balance);
  assert.equal(s.period_start, null);

  assert.throws(
    () =>
      normalizedStatement({
        ...balance,
        period_kind: "fiscal_y",
        period_start: "2023-10-01",
      }),
    /family="balance" requires period_kind="point"/,
  );

  assert.throws(
    () =>
      normalizedStatement({
        ...balance,
        period_start: "2023-10-01",
      }),
    /period_start: must be null for period_kind=point/,
  );
});

test("income/cashflow families forbid period_kind=point and require period_start before period_end", () => {
  const valid = aaplFy2024IncomeStatementInput();

  assert.throws(
    () =>
      normalizedStatement({
        ...valid,
        period_kind: "point",
        period_start: null,
      }),
    /period_kind="point" only valid for family="balance"/,
  );

  assert.throws(
    () =>
      normalizedStatement({
        ...valid,
        period_start: null,
      }),
    /period_start: required for period_kind="fiscal_y"/,
  );

  assert.throws(
    () =>
      normalizedStatement({
        ...valid,
        period_start: "2024-09-28",
        period_end: "2024-09-28",
      }),
    /must be strictly before/,
  );
});

test("normalizedStatement requires fiscal_period to align with period_kind", () => {
  const valid = aaplFy2024IncomeStatementInput();

  assert.throws(
    () =>
      normalizedStatement({
        ...valid,
        period_kind: "fiscal_q",
        period_start: "2024-06-30",
        period_end: "2024-09-28",
        fiscal_period: "FY",
      }),
    /period_kind="fiscal_q" requires Q1\.\.Q4/,
  );

  assert.throws(
    () =>
      normalizedStatement({
        ...valid,
        fiscal_period: "Q4",
      }),
    /period_kind="fiscal_y" requires "FY"/,
  );

  assert.throws(
    () => normalizedStatement({ ...valid, fiscal_period: "H1" }),
    /fiscal_period/,
  );
});

test("normalizedStatement rejects calendar-impossible dates", () => {
  const valid = aaplFy2024IncomeStatementInput();
  assert.throws(
    () => normalizedStatement({ ...valid, period_end: "2024-02-30" }),
    /valid calendar date/,
  );
  assert.throws(
    () => normalizedStatement({ ...valid, period_start: "2023-13-01" }),
    /valid calendar date/,
  );
});

test("normalizedStatement rejects monetary lines whose currency disagrees with reporting_currency", () => {
  const input = aaplFy2024IncomeStatementInput();
  input.lines = input.lines.map((l, i) =>
    i === 0 ? { ...l, currency: "EUR" } : l,
  );
  assert.throws(
    () => normalizedStatement(input),
    /disagrees with statement\.reporting_currency/,
  );
});

test("normalizedStatement rejects monetary lines missing currency", () => {
  const input = aaplFy2024IncomeStatementInput();
  input.lines = input.lines.map((l, i) => {
    if (i !== 0) return l;
    const { currency: _drop, ...rest } = l;
    return rest as StatementLine;
  });
  assert.throws(
    () => normalizedStatement(input),
    /currency.*ISO 4217/,
  );
});

test("normalizedStatement rejects currency on non-monetary lines (shares, ratio)", () => {
  const input = aaplFy2024IncomeStatementInput();
  input.lines = [
    ...input.lines,
    {
      metric_key: "share_count_with_bogus_currency",
      value_num: 1_000,
      unit: "shares",
      currency: "USD",
      scale: 1_000,
      coverage_level: "full",
    },
  ];
  assert.throws(
    () => normalizedStatement(input),
    /must be omitted for non-monetary unit/,
  );
});

test("normalizedStatement rejects duplicate metric_keys within a single statement", () => {
  const input = aaplFy2024IncomeStatementInput();
  input.lines = [
    ...input.lines,
    {
      metric_key: "net_income",
      value_num: 0,
      unit: "currency",
      currency: "USD",
      scale: 1_000_000,
      coverage_level: "full",
    },
  ];
  assert.throws(
    () => normalizedStatement(input),
    /duplicate metric_key "net_income"/,
  );
});

test("normalizedStatement rejects metric_keys outside the canonical dotted-lowercase shape", () => {
  const input = aaplFy2024IncomeStatementInput();
  for (const bad of ["NetIncome", "net income", "net.income.", ".net_income", ""]) {
    const tampered: NormalizedStatementInput = {
      ...input,
      lines: [
        {
          metric_key: bad,
          value_num: 1,
          unit: "currency",
          currency: "USD",
          scale: 1,
          coverage_level: "full",
        },
      ],
    };
    assert.throws(
      () => normalizedStatement(tampered),
      /metric_key/,
      `expected metric_key=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("normalizedStatement rejects non-positive scale (zero, negative, NaN, infinity)", () => {
  const input = aaplFy2024IncomeStatementInput();
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const tampered: NormalizedStatementInput = {
      ...input,
      lines: [
        {
          metric_key: "net_income",
          value_num: 1,
          unit: "currency",
          currency: "USD",
          scale: bad,
          coverage_level: "full",
        },
      ],
    };
    assert.throws(
      () => normalizedStatement(tampered),
      /scale.*finite positive/,
      `expected scale=${bad} to be rejected`,
    );
  }
});

test("normalizedStatement requires non-full coverage when value_num is null", () => {
  const input = aaplFy2024IncomeStatementInput();
  input.lines = [
    {
      metric_key: "net_income",
      value_num: null,
      unit: "currency",
      currency: "USD",
      scale: 1_000_000,
      coverage_level: "full",
    },
  ];
  assert.throws(
    () => normalizedStatement(input),
    /value_num=null requires coverage_level != "full"/,
  );

  input.lines = [
    {
      metric_key: "net_income",
      value_num: null,
      unit: "currency",
      currency: "USD",
      scale: 1_000_000,
      coverage_level: "unavailable",
    },
  ];
  const s = normalizedStatement(input);
  assert.equal(s.lines[0].value_num, null);
  assert.equal(s.lines[0].coverage_level, "unavailable");
});

test("normalizedStatement rejects ISO timestamps without explicit Z or offset", () => {
  const input = aaplFy2024IncomeStatementInput();
  assert.throws(
    () => normalizedStatement({ ...input, as_of: "2024-11-01T20:30:00" }),
    /as_of.*ISO-8601/,
  );
});

test("normalizedStatement rejects non-UUID source_id", () => {
  const input = aaplFy2024IncomeStatementInput();
  for (const bad of [
    "not-a-uuid",
    "11111111-1111-1111-1111-111111111111", // version digit is 1, not 4
    "",
  ]) {
    assert.throws(
      () => normalizedStatement({ ...input, source_id: bad }),
      /source_id.*UUID v4/,
      `expected source_id=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("normalizedStatement rejects unknown reporting_currency", () => {
  const input = aaplFy2024IncomeStatementInput();
  for (const bad of ["usd", "US$", "DOLLARS", "12345", ""]) {
    assert.throws(
      () => normalizedStatement({ ...input, reporting_currency: bad }),
      /reporting_currency.*ISO 4217/,
      `expected reporting_currency=${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("assertStatementContract accepts a statement built via the smart constructor", () => {
  const s = normalizedStatement(aaplFy2024IncomeStatementInput());
  assert.doesNotThrow(() => assertStatementContract(s));
});

test("assertStatementContract rejects a statement missing required fields", () => {
  for (
    const drop of [
      "subject",
      "family",
      "basis",
      "period_kind",
      "period_end",
      "fiscal_year",
      "fiscal_period",
      "reporting_currency",
      "as_of",
      "source_id",
      "lines",
    ] as const
  ) {
    const s = normalizedStatement(aaplFy2024IncomeStatementInput());
    const tampered: Record<string, unknown> = { ...s };
    delete tampered[drop];
    assert.throws(
      () => assertStatementContract(tampered),
      undefined,
      `expected missing ${drop} to be rejected`,
    );
  }
});

test("assertStatementContract rejects a basis value the spec forbids (silent merge)", () => {
  const s = normalizedStatement(aaplFy2024IncomeStatementInput());
  const tampered = { ...s, basis: "merged" };
  assert.throws(() => assertStatementContract(tampered), /basis/);
});
