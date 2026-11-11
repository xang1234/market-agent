// A point-in-time backtest of the Call's required growth (ADR 0006, #610). For
// each issuer and each FY 10-K from 2016 to 2021 it reads the Call's inputs as
// of the filing date + 1 day, solves the growth the close that day required at
// that day's multiple, and sets beside it what followed: the FY free cash flow
// five 10-Ks later, the share count's change over those years, and the price
// five years later against the owner's 10% hurdle. Offline and dev only: nothing here is written.
//
// Required growth g is the growth of total free cash flow, net of the share
// change d that stock-based compensation implies (ADR 0006: buybacks are paid
// out of the free cash flow already valued). So realized growth is total free
// cash flow too, and the realized share change, buybacks included, is its own
// figure beside d.
//
// The engine selects the inputs at each cutoff (selectPlanInputs), with one
// substitution. A fetch proves a filing public only from the fetch itself
// (sec-publication-proof.ts), so at a 2017 cutoff the engine has no input at
// all. This backtest adds, beside each SEC fact's own proofs, a date-precision
// bound at the end of its filing's SEC filing date in New York. A statement
// fact stores no filing date, so it is the one its filing's cover count was
// stored with (`filed`); a filing with none is not public at any cutoff here.
// That bound is never stored and never certifies anything.
//
// The closes are yfinance's split-adjusted daily_close_captures: dev only and
// never certified. The model's price is the close restated to the split basis
// of its day, so it matches the cover count; the price return reads the
// adjusted closes as they are, which include no dividends.
//
// Runbook on a dev DB, once the owner approves SEC fetches (#597 keeps the
// listings' issuers apart from the SEC issuers, so each sample issuer needs
// its CIK first, and the split history the engine's share count requires):
//
//   cd services/fundamentals
//   export DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:54329/market_agent
//   export SEC_EDGAR_USER_AGENT="<name> <email>"
//   TICKERS=$(tr '\n' , < <ticker list> | sed 's/,$//')
//   curl -s -A "$SEC_EDGAR_USER_AGENT" https://www.sec.gov/files/company_tickers.json > ../../.dev/company_tickers.json
//   node --experimental-strip-types src/fcf-backtest.ts --tickers "$TICKERS" --attach-ciks ../../.dev/company_tickers.json
//   LISTINGS=$(node --experimental-strip-types src/fcf-backtest.ts --tickers "$TICKERS" --listing-ids) &&
//     (cd ../market && POLYGON_API_KEY=... npm run sync:splits -- $LISTINGS)
//   ISSUERS=$(node --experimental-strip-types src/fcf-backtest.ts --tickers "$TICKERS" --issuer-ids) &&
//     npm run backfill:sec-statements -- --annual-history-years 11 $ISSUERS
//   npm run --silent backtest:fcf -- --tickers "$TICKERS" --notes <notes.md> > ../../docs/eval-runs/fcf-backtest/$(date -u +%F).md
//
// --issuer-ids and --listing-ids exit nonzero, naming them, when any ticker
// does not resolve: an empty id list backfills every issuer with SEC facts.
// A failed $(...) inside a command still runs it, so the ids are assigned first.
// --notes is the run's hand-written how-it-ran and caveats, set in the doc
// after the summary; everything else in the doc is this script's output.
//
// The closes are captured already (npm run capture:closes in services/market).

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "pg";

import {
  callInputOperations,
  canonicalDecimalString,
  createRuntimeAuthority,
  DEFAULT_CALL_SETTINGS,
  divideRationals,
  endOfLocalDay,
  evaluateBoundPlan,
  multiplyRationals,
  parseFinancialDecimal,
  rationalFromDecimal,
  requiredGrowth,
  roundRational,
  todaysMultiple,
  type ExactRational,
  type FinancialPlan,
  type FinancialRuntimeAuthority,
  type IsoDate,
  type ValuationInputs,
  type ValuationOutcomeResult,
} from "../../financial-core/src/index.ts";
import { selectPlanInputs } from "../../financial-engine/src/bind-inputs.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, InputCandidate, SplitHistory, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { normalizeCik } from "../../shared/src/identifiers.ts";
import { logPoolErrors, withPoolClient } from "../../shared/src/pool-client.ts";

export const BACKTEST_YEARS = { first: 2016, last: 2021 } as const;
const HORIZON_YEARS = 5;
const ZONE = "America/New_York";
const MAX_CLOSE_AGE_DAYS = 7;
const HURDLE = Number(DEFAULT_CALL_SETTINGS.required_return);
// The backtest's own reader: public SEC facts carry no user, so this id only satisfies the candidate query's signature.
const READER = "00000000-0000-4000-8000-000000000610";
const SLOT = "a";
// The Call's input nodes without its price: the close comes from daily_close_captures, not price_observations.
const OPERATIONS = callInputOperations(SLOT).filter((node) => node.node_id !== "market_cap_px" && node.node_id !== "market_cap");
const INPUT_NODES = { free_cash_flow: "free_cash_flow", net_cash: "net_cash", stock_based_compensation: "stock_based_compensation", shares_outstanding: "market_cap_shares" } as const;
export type InputId = keyof typeof INPUT_NODES;

export type Figure =
  | Readonly<{ kind: "value"; value: number; text: string }>
  | Readonly<{ kind: "outcome"; outcome: string; text: string; input?: string }>;

/** Why a figure has no value. */
export type Absent = Extract<Figure, { kind: "outcome" }>;

/** One bound input: what it is, the period it is for and when the filing that states it was public. */
export type BoundInput = Readonly<{ slot: string; fiscal_year: number; period_end: string; public_by: string; locator: string | null }>;

/** The Call's inputs as the engine selects them at the end of one as-of day. */
export type AsOfInputs = Readonly<{
  as_of: IsoDate;
  figures: Readonly<Record<InputId, Figure>>;
  exact: Readonly<Partial<Record<InputId, ExactRational>>>;
  currency: string | null;
  fiscal_year_end: IsoDate | null;
  bound: ReadonlyArray<BoundInput>;
}>;

export type Close = Readonly<{ trade_date: IsoDate; close_text: string }>;
export type CloseSeries = Readonly<{ kind: "closes"; captured_on: IsoDate; currency: string; closes: ReadonlyArray<Close> }>;

export type ReadRow = Readonly<{
  kind: "read";
  ticker: string;
  fiscal_year: number;
  filed: IsoDate;
  inputs: AsOfInputs;
  /** period_mismatch when the bound statements are another fiscal year's; such a row is left out of the summary statistics. */
  period: Absent | null;
  price: Figure;
  todays_multiple: Figure;
  /** d: last FY's stock-based compensation over the market cap at the close. */
  share_change: Figure;
  required_growth: Figure;
  realized_fcf_cagr: Figure;
  realized_share_change: Figure;
  price_return: Figure;
}>;

/** A fiscal year with no as-of date to read it at. */
export type UnreadRow = Readonly<{ kind: "unread"; ticker: string; fiscal_year: number; outcome: Absent }>;

export type BacktestRow = ReadRow | UnreadRow;

/** One FY's statements on file: the end of its period and the date of the earliest filing that states it, if any does. */
export type AnnualFiling = Readonly<{ fiscal_year: number; period_end: IsoDate; filed: IsoDate | null }>;

/** An issuer with no row to show, and why. */
export type IssuerOutcome = Readonly<{ ticker: string; outcome: string; text: string }>;

export type BacktestRun = Readonly<{ rows: ReadonlyArray<BacktestRow>; issuers: ReadonlyArray<IssuerOutcome> }>;

const outcome = (name: string, text: string): Absent => ({ kind: "outcome", outcome: name, text });
const percentText = (value: number): string => `${(value * 100).toFixed(2)}%`;
const percent = (value: number): Figure => ({ kind: "value", value, text: percentText(value) });

/**
 * The evidence port with each SEC fact also public by the end of its filing's
 * date in New York, from `filedBySource`. Every other proof is kept, so the
 * engine still takes the earliest bound.
 */
export function filingDatePort(base: FinancialEvidencePort, filedBySource: ReadonlyMap<string, IsoDate>): FinancialEvidencePort {
  const withFilingDate = (candidate: InputCandidate): InputCandidate => {
    const filed = filedBySource.get(candidate.source_id);
    if (candidate.source_class !== "sec_filing" || filed === undefined) return candidate;
    return {
      ...candidate,
      publication: [...candidate.publication, {
        attestation_id: randomUUID(),
        timing: { available_not_before: null, available_no_later_than: endOfLocalDay(filed, ZONE), timing_precision: "date", source_timezone: ZONE },
      }],
    };
  };
  return {
    ...base,
    async listInputCandidates(request) {
      const page = await base.listInputCandidates(request);
      return page.status === "ok" ? { ...page, candidates: page.candidates.map(withFilingDate) } : page;
    },
  };
}

// Each SEC filing of an issuer and its SEC filing date, as its facts that keep one (its cover count, a restatement) state it.
const FILED_BY_SOURCE = `
  select f.source_id, (min(f.reported_at) at time zone 'UTC')::date as filed
    from facts f join sources s on s.source_id = f.source_id
   where f.subject_kind = 'issuer' and f.subject_id = $1::uuid and s.provider = 'sec_edgar' and f.reported_at is not null
   group by f.source_id`;

async function filedBySource(db: SqlExecutor, issuerId: string): Promise<Map<string, IsoDate>> {
  const { rows } = await db.query<{ source_id: string; filed: string }>(`select source_id::text as source_id, filed::text as filed from (${FILED_BY_SOURCE}) filings`, [issuerId]);
  return new Map(rows.map((row) => [row.source_id, row.filed]));
}

function readerAuthority(): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: READER,
    egress_channel: "api",
    parent: { kind: "chat_thread", id: READER, version: "1" },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "fcf-backtest", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}

/** The Call's inputs for an issuer at the end of `asOf` in New York, selected by the engine in one read-only transaction. */
export async function inputsAsOf(client: SqlExecutor, issuerId: string, asOf: IsoDate): Promise<AsOfInputs> {
  const authority = readerAuthority();
  const planned = buildDeterministicPlan({
    plan_id: randomUUID(),
    origin: { kind: "api_request", ref: `fcf-backtest:${issuerId}:${asOf}` },
    knowledge_cutoff: endOfLocalDay(asOf, ZONE),
    cutoff_timezone: ZONE,
    reporting_basis: "as_restated",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: [{ mention: SLOT, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: issuerId }, label: issuerId } }],
    publication_unit_kind: "chat_section",
  }, {
    subjects: [{ slot_id: SLOT, mention: SLOT }],
    operations: OPERATIONS,
    outputs: Object.values(INPUT_NODES).map((node) => ({ output_id: `out_${node}`, node_id: node })),
    thresholds: [],
  });
  if (planned.outcome !== "ready") throw new Error(`the backtest plan did not validate: ${planned.outcome}`);
  const plan: FinancialPlan = planned.plan;
  const filed = await filedBySource(client, issuerId);
  await client.query("begin isolation level repeatable read read only");
  let selected;
  try {
    selected = await selectPlanInputs({
      client,
      plan,
      authority,
      evidence: filingDatePort(createEvidenceFinancialPort(client), filed),
      allowed_source_classes: authority.allowed_source_classes,
    });
  } finally {
    await client.query("rollback");
  }
  const bindings = new Map(selected.map(({ binding }) => [binding.slot, binding]));
  const evaluation = evaluateBoundPlan(plan, bindings);
  const figures = {} as Record<InputId, Figure>;
  const exact: Partial<Record<InputId, ExactRational>> = {};
  let currency: string | null = null;
  for (const [id, node] of Object.entries(INPUT_NODES) as Array<[InputId, string]>) {
    const state = evaluation.nodes.get(node);
    if (state?.status === "computed" && state.payload.kind === "value") {
      const value = rationalFromDecimal(decimal(state.payload.value))!;
      exact[id] = value;
      figures[id] = { kind: "value", value: Number(state.payload.value), text: state.payload.value };
      if (id === "free_cash_flow" && state.payload.unit.kind === "currency") currency = state.payload.unit.currency;
    } else if (state?.status === "gap") {
      // A computed figure blocked by its inputs names each input's own gap.
      const operands = Object.values(OPERATIONS.find((operation) => operation.node_id === node)!);
      const blocked = [...bindings.values()].flatMap((binding) => binding.status === "gap" && operands.includes(binding.slot) ? [`${binding.slot} ${binding.reason_code}`] : []);
      figures[id] = outcome(state.reason_code, `${state.disposition}: ${state.explanation}${blocked.length > 0 ? ` (${blocked.join(", ")})` : ""}`);
    } else {
      throw new Error(`${node} at ${asOf}: ${state === undefined ? "not evaluated" : state.status}`);
    }
  }
  const bound = [...bindings.values()].flatMap((binding): BoundInput[] => binding.status === "bound" && "fact_id" in binding.input
    ? [{
      slot: binding.slot,
      fiscal_year: binding.input.period.fiscal_year,
      period_end: binding.input.period.end,
      public_by: binding.input.publication.available_no_later_than,
      locator: binding.input.source.locator,
    }]
    : []);
  const operating = bound.find((input) => input.slot === "operating_cash_flow");
  return { as_of: asOf, figures, exact, currency, fiscal_year_end: operating?.period_end ?? null, bound };
}

/**
 * One issuer-year: the growth the as-of close required at that day's
 * multiple, the FY free cash flow CAGR and the annual share change to the
 * 10-K five fiscal years later, and the annualized price return over five
 * years.
 */
export function backtestRow(input: Readonly<{
  ticker: string;
  fiscal_year: number;
  filed: IsoDate;
  /** The issuer's fiscal year label less its period's end year (labelOffset). */
  label_offset: number;
  base: AsOfInputs;
  later: AsOfInputs | Absent;
  closes: CloseSeries | Absent;
  splits: SplitHistory;
}>): ReadRow {
  const { base, closes, splits } = input;
  const laterYear = input.fiscal_year + HORIZON_YEARS;
  const laterPeriod = "kind" in input.later ? null : periodCheck(input.later, laterYear, input.label_offset);
  const close = closes.kind === "outcome" ? closes : closeOnOrBefore(closes, base.as_of);
  const price = close.kind === "outcome" || closes.kind === "outcome" ? close : splitBasis(close, closes, splits);
  const { multiple, share_change, growth } = solve(base, price, closes);
  const realized = laterPeriod !== null
    ? { fcf: named(`FY+${HORIZON_YEARS}`, laterPeriod), shares: named(`FY+${HORIZON_YEARS}`, laterPeriod) }
    : realizedGrowth(base, input.later, splits);
  return {
    kind: "read",
    ticker: input.ticker,
    fiscal_year: input.fiscal_year,
    filed: input.filed,
    inputs: base,
    period: periodCheck(base, input.fiscal_year, input.label_offset),
    price: price.kind === "outcome" ? price : "trade_date" in price ? { kind: "value", value: Number(price.text), text: `${price.text} (${price.trade_date}, dev close, never certified)` } : price,
    todays_multiple: multiple,
    share_change,
    required_growth: growth,
    realized_fcf_cagr: realized.fcf,
    realized_share_change: realized.shares,
    price_return: priceReturn(base.as_of, closes),
  };
}

type Restated = Readonly<{ kind: "value"; value: ExactRational; text: string; trade_date: IsoDate }>;

function solve(base: AsOfInputs, price: Restated | Figure, closes: CloseSeries | Absent): Readonly<{ multiple: Figure; share_change: Figure; growth: Figure }> {
  const missing = (Object.keys(INPUT_NODES) as InputId[]).find((id) => base.figures[id].kind === "outcome");
  const cause = missing !== undefined ? named(missing, base.figures[missing]) : price.kind === "outcome" ? named("price", price as Figure) : null;
  if (cause !== null) return { multiple: cause, share_change: cause, growth: cause };
  const { free_cash_flow, net_cash, stock_based_compensation, shares_outstanding } = base.exact as Required<AsOfInputs["exact"]>;
  const close = price as Restated;
  const inputs: ValuationInputs = {
    call_date: base.as_of,
    free_cash_flow,
    period_end: base.fiscal_year_end!,
    shares: shares_outstanding,
    net_cash,
    price: close.value,
    price_date: close.trade_date,
    currency: { reporting: base.currency ?? "", price: (closes as CloseSeries).currency },
    required_return: rationalFromDecimal(decimal(DEFAULT_CALL_SETTINGS.required_return))!,
  };
  const today = todaysMultiple(inputs);
  if (today.kind === "outcome") return { multiple: modelOutcome(today), share_change: modelOutcome(today), growth: modelOutcome(today) };
  const multiple: Figure = { kind: "value", value: toNumber(today.value), text: today.text };
  // d, ADR 0006's default: last fiscal year's stock-based compensation over the market cap at the as-of date.
  const shareChange = divideRationals(stock_based_compensation, multiplyRationals(close.value, shares_outstanding)!);
  if (shareChange === null) {
    const limit = outcome("numeric_limit_exceeded", "share change");
    return { multiple, share_change: limit, growth: limit };
  }
  const solved = requiredGrowth(inputs, { share_change: shareChange, exit_multiple: today.value });
  return {
    multiple,
    share_change: percent(toNumber(shareChange)),
    growth: solved.kind === "value" ? { kind: "value", value: toNumber(solved.growth), text: solved.text } : modelOutcome(solved),
  };
}

// The annual growth of total free cash flow and the annual change in the share count, from the base 10-K to the one five years later.
function realizedGrowth(base: AsOfInputs, later: AsOfInputs | Absent, splits: SplitHistory): Readonly<{ fcf: Figure; shares: Figure }> {
  const annual = (from: number, to: number) => percent((to / from) ** (1 / HORIZON_YEARS) - 1);
  const missing = (id: InputId): Figure | null => {
    if ("kind" in later) return later;
    for (const [label, inputs] of [["base", base], ["later", later]] as const) {
      if (inputs.figures[id].kind === "outcome") return named(`${label === "later" ? `FY+${HORIZON_YEARS} ` : ""}${id}`, inputs.figures[id]);
    }
    return null;
  };
  const amount = (inputs: AsOfInputs, id: InputId) => (inputs.figures[id] as Extract<Figure, { kind: "value" }>).value;
  const fcf = (): Figure => {
    const [f0, f5] = [amount(base, "free_cash_flow"), amount(later as AsOfInputs, "free_cash_flow")];
    return f0 <= 0 || f5 <= 0 ? outcome("non_positive_base", "Free cash flow at one end is zero or negative, so it has no growth rate.") : annual(f0, f5);
  };
  const shares = (): Figure => {
    if (splits.status === "gap") return outcome(splits.reason_code, "No split history to put both share counts on one basis.");
    // The engine states each count on its own as-of day's basis; the splits between them restate the earlier one.
    const restatedS0 = amount(base, "shares_outstanding") * toNumber(splitFactor(splits, base.as_of, (later as AsOfInputs).as_of));
    return annual(restatedS0, amount(later as AsOfInputs, "shares_outstanding"));
  };
  return { fcf: missing("free_cash_flow") ?? fcf(), shares: missing("shares_outstanding") ?? shares() };
}

function priceReturn(asOf: IsoDate, closes: CloseSeries | Absent): Figure {
  if (closes.kind === "outcome") return named("price", closes);
  const start = closeOnOrBefore(closes, asOf);
  const end = closeOnOrBefore(closes, yearsAfter(asOf, HORIZON_YEARS));
  if (start.kind === "outcome") return named("price", start);
  if (end.kind === "outcome") return outcome(end.outcome, `${HORIZON_YEARS} years on: ${end.text}`);
  const annual = (toNumber(end.value) / toNumber(start.value)) ** (1 / HORIZON_YEARS) - 1;
  const verdict = annual >= HURDLE ? "at or above" : "below";
  return { kind: "value", value: annual, text: `${percentText(annual)}, ${verdict}` };
}

// The year a period ends in, a week early, so a 52/53-week year that ends in January's first days counts as the year before.
const endYear = (end: IsoDate): number => Number(addDays(end, -7).slice(0, 4));

/** The offset most of an issuer's FY labels show from their period's end year: 0 for most filers, -1 for a retailer whose year ends in late January. */
export function labelOffset(filings: ReadonlyArray<AnnualFiling>): number {
  const counts = new Map<number, number>();
  for (const filing of filings) {
    const offset = filing.fiscal_year - endYear(filing.period_end);
    counts.set(offset, (counts.get(offset) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

// A filer's companyfacts `fy` can mislabel a 10-K (HON tagged its FY2021 10-K fiscal 2020), so the label alone can't vouch for the statements bound.
function periodCheck(inputs: AsOfInputs, fiscalYear: number, offset: number): Absent | null {
  const end = inputs.bound.filter((input) => input.slot !== INPUT_NODES.shares_outstanding).map((input) => input.period_end).sort().at(-1);
  if (end === undefined) return null;
  const year = endYear(end) + offset;
  return year === fiscalYear ? null : outcome("period_mismatch", `The bound base period ends ${end}, which is FY${year}, not FY${fiscalYear}.`);
}

const named = (input: string, figure: Figure): Figure => figure.kind === "outcome" ? { ...figure, input: figure.input ?? input } : figure;
const modelOutcome = (result: ValuationOutcomeResult): Figure => outcome(result.outcome, result.text);

/** The adjusted close on or before `date`, at most MAX_CLOSE_AGE_DAYS older. */
function closeOnOrBefore(series: CloseSeries, date: IsoDate): Restated | Absent {
  const close = series.closes.findLast((entry) => entry.trade_date <= date);
  if (close === undefined) return { kind: "outcome", outcome: "price_missing", text: `No captured close on or before ${date}; captures start ${series.closes[0]?.trade_date ?? "nowhere"}.` };
  if (daysBetween(close.trade_date, date) > MAX_CLOSE_AGE_DAYS) {
    return { kind: "outcome", outcome: "stale_price", text: `The latest captured close on or before ${date} is ${close.trade_date}.` };
  }
  return { kind: "value", value: rationalFromDecimal(decimal(close.close_text))!, text: close.close_text, trade_date: close.trade_date };
}

// A split-adjusted close restated to its own day's basis: times every split after that day and on or before the capture.
function splitBasis(close: Restated, series: CloseSeries, splits: SplitHistory): Restated | Figure {
  if (splits.status === "gap") return outcome(splits.reason_code, "No split history to restate the adjusted close to its own day.");
  const value = multiplyRationals(close.value, splitFactor(splits, close.trade_date, series.captured_on))!;
  return { ...close, value, text: decimalText(value) };
}

function splitFactor(splits: Extract<SplitHistory, { status: "ok" }>, after: IsoDate, through: IsoDate): ExactRational {
  return splits.splits
    .filter((split) => split.execution_date > after && split.execution_date <= through)
    .reduce((factor, split) => multiplyRationals(factor, divideRationals(rational(split.split_to), rational(split.split_from))!)!, rational("1"));
}

/** The closes of the issuer's one common-stock listing from its newest capture, whichever source took it: one split basis, one close a day. */
export async function closeSeries(db: SqlExecutor, issuerId: string): Promise<CloseSeries | Absent> {
  const { rows } = await db.query<{ listing_id: string; captured_on: string; currency: string; trade_date: string; close_text: string }>(
    `with newest as (
       select distinct on (d.listing_id) d.listing_id, d.source_id, d.captured_on
         from daily_close_captures d
         join listings l on l.listing_id = d.listing_id
         join instruments i on i.instrument_id = l.instrument_id
        where i.issuer_id = $1::uuid and i.asset_type = 'common_stock'
        order by d.listing_id, d.captured_on desc, d.retrieved_at desc, d.source_id)
     select d.listing_id::text as listing_id, d.captured_on::text as captured_on, d.currency, d.trade_date::text as trade_date, d.close_text
       from daily_close_captures d join newest using (listing_id, source_id, captured_on)
      order by d.trade_date`,
    [issuerId],
  );
  const listings = new Set(rows.map((row) => row.listing_id));
  if (listings.size === 0) return outcome("price_missing", "No captured closes for the issuer's common stock.");
  if (listings.size > 1) return outcome("price_listing_unresolved", "Closes are captured for more than one common-stock listing.");
  return { kind: "closes", captured_on: rows[0]!.captured_on, currency: rows[0]!.currency, closes: rows.map(({ trade_date, close_text }) => ({ trade_date, close_text })) };
}

/** Each FY with SEC facts on file, its period's end, and the date of the earliest filing that states it (the original 10-K's), if any does. */
export async function annualFilings(db: SqlExecutor, issuerId: string, first: number, last: number): Promise<AnnualFiling[]> {
  const { rows } = await db.query<AnnualFiling>(
    `select f.fiscal_year, max(f.period_end)::text as period_end, min(filings.filed)::text as filed
       from facts f left join (${FILED_BY_SOURCE}) filings on filings.source_id = f.source_id
      where f.subject_kind = 'issuer' and f.subject_id = $1::uuid
        and f.period_kind = 'fiscal_y' and f.fiscal_period = 'FY' and f.period_end is not null
        and f.fiscal_year between $2 and $3
      group by f.fiscal_year
      order by f.fiscal_year`,
    [issuerId, first, last],
  );
  return rows;
}

type Subject = Readonly<{ ticker: string; issuer_id: string; listing_id: string }>;

/** Each ticker's one active US common-stock listing and its issuer; a ticker without exactly one is an issuer outcome. */
export async function resolveTickers(db: SqlExecutor, tickers: ReadonlyArray<string>): Promise<{ subjects: Subject[]; unresolved: IssuerOutcome[] }> {
  const { rows } = await db.query<Subject>(
    `select l.ticker, i.issuer_id::text as issuer_id, l.listing_id::text as listing_id
       from listings l join instruments i on i.instrument_id = l.instrument_id
      where l.ticker = any($1::text[]) and l.active_to is null and i.asset_type = 'common_stock'
        and l.mic = any(array['ARCX', 'BATS', 'IEXG', 'XASE', 'XNAS', 'XNYS'])`,
    [[...tickers]],
  );
  const subjects: Subject[] = [];
  const unresolved: IssuerOutcome[] = [];
  for (const ticker of tickers) {
    const found = rows.filter((row) => row.ticker === ticker);
    if (found.length === 1) subjects.push(found[0]!);
    else unresolved.push({ ticker, outcome: "subject_unresolved", text: `${found.length} active US common-stock listings` });
  }
  return { subjects, unresolved };
}

/** Every issuer-year of the tickers, read on one connection: each as-of selection is its own read-only transaction on it. */
export async function runBacktest(pool: FinancialPool, tickers: ReadonlyArray<string>, years = BACKTEST_YEARS): Promise<BacktestRun> {
  return withPoolClient(pool, (db) => backtestOn(db, tickers, years));
}

async function backtestOn(db: SqlExecutor, tickers: ReadonlyArray<string>, years: typeof BACKTEST_YEARS): Promise<BacktestRun> {
  const { subjects, unresolved } = await resolveTickers(db, tickers);
  const rows: BacktestRow[] = [];
  const issuers = [...unresolved];
  const port = createEvidenceFinancialPort(db);
  for (const subject of subjects) {
    const filings = await annualFilings(db, subject.issuer_id, years.first, years.last + HORIZON_YEARS);
    const byYear = new Map(filings.map((filing) => [filing.fiscal_year, filing]));
    const offset = labelOffset(filings);
    const closes = await closeSeries(db, subject.issuer_id);
    const splits = await port.readSplitHistory({ subject: { kind: "issuer", id: subject.issuer_id }, as_of: new Date().toISOString() });
    for (let fiscalYear = years.first; fiscalYear <= years.last; fiscalYear += 1) {
      const filed = byYear.get(fiscalYear)?.filed;
      if (filed == null) {
        rows.push({ kind: "unread", ticker: subject.ticker, fiscal_year: fiscalYear, outcome: filingOutcome(byYear, fiscalYear)! });
        continue;
      }
      const base = await inputsAsOf(db, subject.issuer_id, dayAfter(filed));
      const laterFiled = byYear.get(fiscalYear + HORIZON_YEARS)?.filed;
      const later = laterFiled == null ? filingOutcome(byYear, fiscalYear + HORIZON_YEARS)! : await inputsAsOf(db, subject.issuer_id, dayAfter(laterFiled));
      rows.push(backtestRow({ ticker: subject.ticker, fiscal_year: fiscalYear, filed, label_offset: offset, base, later, closes, splits }));
    }
  }
  return { rows, issuers };
}

// Why a FY has no filing date to read it at, or null when it has one.
function filingOutcome(byYear: ReadonlyMap<number, AnnualFiling>, fiscalYear: number): Absent | null {
  const filing = byYear.get(fiscalYear);
  if (filing === undefined) return outcome("no_fy_facts", `No SEC facts labeled FY${fiscalYear} on file.`);
  return filing.filed === null ? outcome("no_filing_date", `FY${fiscalYear} facts are on file, but no filing that states them carries a filing date.`) : null;
}

const value = (figure: Figure): number | null => figure.kind === "value" ? figure.value : null;

// The first outcome that keeps a row from both growth figures, or "both".
function rowOutcome(row: BacktestRow): string {
  if (row.kind === "unread") return row.outcome.outcome;
  if (row.period !== null) return row.period.outcome;
  for (const [label, figure] of [["required growth", row.required_growth], ["realized growth", row.realized_fcf_cagr]] as const) {
    if (figure.kind === "outcome") return `${label}, ${figure.input === undefined ? "" : `${figure.input} `}${figure.outcome}`;
  }
  return "both";
}

function median(values: ReadonlyArray<number>): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length === 0 ? null : sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function summary(rows: ReadonlyArray<BacktestRow>): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(rowOutcome(row), (counts.get(rowOutcome(row)) ?? 0) + 1);
  const both = rows.filter((row): row is ReadRow => rowOutcome(row) === "both");
  const gap = (row: ReadRow) => value(row.realized_fcf_cagr)! - value(row.required_growth)!;
  const delivered = both.filter((row) => gap(row) >= 0);
  const hurdle = (group: ReadonlyArray<ReadRow>) => {
    const returns = group.flatMap((row) => value(row.price_return) ?? []);
    const middle = median(returns);
    return `${returns.length} ${returns.length === 1 ? "has" : "have"} a ${HORIZON_YEARS}-year price return, ${returns.filter((annual) => annual >= HURDLE).length} at or above ${(HURDLE * 100).toFixed(0)}% a year, median ${middle === null ? "n/a" : percentText(middle)}`;
  };
  const gapMedian = median(both.map(gap));
  // requiredGrowth bisects to a bracket under 0.0001 and returns its midpoint (valuation-model.ts), so it is within 0.005 points.
  const unsettled = both.filter((row) => Math.abs(gap(row)) < 0.00005).map((row) => `${row.ticker} FY${row.fiscal_year}`);
  return [
    `- **Rows.** ${rows.length} issuer-years.`,
    "- **Outcomes.** Each row's first outcome that keeps it from both growth figures.",
    ...[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => `  - ${count} ${name}`),
    `- **Realized against required.** ${both.length} rows have both. In ${delivered.length}, realized growth was at or above the required growth, compared unrounded. ${unsettled.length} of the ${both.length}${unsettled.length === 0 ? "" : ` (${unsettled.join(", ")})`} ${unsettled.length === 1 ? "differs" : "differ"} by less than 0.005 points, the required-growth solver's precision, so ${unsettled.length === 1 ? "its" : "their"} side is not settled. The median gap, realized minus required, is ${gapMedian === null ? "n/a" : (gapMedian * 100).toFixed(2)} points.`,
    `- **Against the hurdle.** Of the ${delivered.length} at or above required growth, ${hurdle(delivered)}. Of the ${both.length - delivered.length} below, ${hurdle(both.filter((row) => gap(row) < 0))}.`,
  ];
}

const COLUMNS = ["free_cash_flow", "net_cash", "stock_based_compensation", "shares_outstanding", "price", "multiple", "required_growth", "realized_growth", "share_change", "realized_share_change", "price_return"] as const;

function tableRow(row: BacktestRow): string {
  const escape = (text: string) => text.replaceAll("|", "\\|");
  if (row.kind === "unread") return `| ${[row.ticker, row.fiscal_year, "n/a", "n/a", ...COLUMNS.map(() => "n/a"), `**${row.outcome.outcome}** (${escape(row.outcome.text)})`].join(" | ")} |`;
  const { free_cash_flow, net_cash, stock_based_compensation, shares_outstanding } = row.inputs.figures;
  const figures = [free_cash_flow, net_cash, stock_based_compensation, shares_outstanding, row.price, row.todays_multiple, row.required_growth, row.realized_fcf_cagr, row.share_change, row.realized_share_change, row.price_return];
  // A figure blocked by an input repeats that input's outcome, so each is named once, under the input.
  const seen = new Set<string>();
  const named = figures.flatMap((figure, index) => {
    if (figure.kind === "value") return [];
    const label = figure.input ?? COLUMNS[index]!;
    const key = `${label}|${figure.outcome}|${figure.text}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [`${label}: **${figure.outcome}** (${escape(figure.text)})`];
  });
  const outcomes = [...(row.period === null ? [] : [`**${row.period.outcome}** (${escape(row.period.text)})`]), ...named];
  return `| ${[row.ticker, row.fiscal_year, row.filed, row.inputs.as_of, ...figures.map((figure) => figure.kind === "value" ? escape(figure.text) : "n/a"), outcomes.join("; ")].join(" | ")} |`;
}

/** The run's doc: the command that made it, the summary, the run's own notes, then one row per issuer-year and each issuer with no rows. */
export function renderBacktest(run: BacktestRun, doc: Readonly<{ ranOn: IsoDate; command: string; notes: string }>): string {
  const lines = [
    `# FCF required-growth backtest, ${doc.ranOn}`,
    "",
    `Generated by \`${doc.command}\`. Offline and dev only (#610). Inputs are the engine's selection as of the 10-K filing date + 1 day, with each SEC fact taken as public by the end of its filing date in New York. Prices are yfinance split-adjusted closes, never certified. Required growth is the growth of total free cash flow that day's close requires at that day's multiple, with ADR 0006's model, the 10% required return and d, the share change stock-based compensation implies. Realized growth is the same total free cash flow's growth to the 10-K five fiscal years later; the realized share change over those years, buybacks included, sits beside d. The price return is annualized over five years, price only, with no dividends.`,
    "",
    "## Summary",
    "",
    ...summary(run.rows),
    "",
    ...(doc.notes.trim() === "" ? [] : [doc.notes.trim(), ""]),
    "## Rows",
    "",
    "| Issuer | FY | Filed | As of | Free cash flow | Net cash | SBC | Shares | Close | Multiple | Required growth | Realized FCF CAGR, 5y | d, SBC share change | Realized share change, 5y | 5-year price return vs 10% hurdle | Named outcomes |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...run.rows.map(tableRow),
  ];
  if (run.issuers.length > 0) lines.push("", "## Issuers with no rows", "", ...run.issuers.map((issuer) => `- ${issuer.ticker}: **${issuer.outcome}** (${issuer.text})`));
  return `${lines.join("\n")}\n`;
}

/**
 * The tickers' issuer or listing ids. Throws, naming them, when any ticker
 * has no single listing: an empty id list makes the SEC backfill take every
 * issuer with SEC facts.
 */
export async function subjectIds(db: SqlExecutor, tickers: ReadonlyArray<string>, id: "issuer_id" | "listing_id"): Promise<string[]> {
  const { subjects, unresolved } = await resolveTickers(db, tickers);
  if (unresolved.length > 0) throw new Error(`unresolved tickers, no ids printed: ${unresolved.map((issuer) => `${issuer.ticker} (${issuer.text})`).join(", ")}`);
  return subjects.map((subject) => subject[id]);
}

// Each sample ticker's issuer takes its CIK from SEC's company_tickers.json (#597), unless it has one.
export async function attachCiks(db: SqlExecutor, tickers: ReadonlyArray<string>, file: string): Promise<void> {
  const entries = Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, { cik_str: number; ticker: string }>);
  const { subjects, unresolved } = await resolveTickers(db, tickers);
  for (const issuer of unresolved) console.error(`${issuer.ticker}: ${issuer.text}`);
  for (const subject of subjects) {
    const entry = entries.find((candidate) => candidate.ticker === subject.ticker);
    if (entry === undefined) {
      console.error(`${subject.ticker}: not in company_tickers.json`);
      continue;
    }
    const cik = normalizeCik(String(entry.cik_str));
    // Another issuer with this CIK is #597's split: its SEC facts stay there, and this ticker has none until the two merge.
    const { rows: [holder] } = await db.query<{ issuer_id: string }>(
      `select issuer_id::text as issuer_id from issuers where ltrim(cik, '0') = $1 and issuer_id <> $2::uuid limit 1`,
      [cik, subject.issuer_id],
    );
    if (holder !== undefined) {
      console.error(`${subject.ticker}: CIK ${cik} belongs to issuer ${holder.issuer_id}; not attached (#597)`);
      continue;
    }
    const { rows } = await db.query<{ cik: string }>(
      `update issuers set cik = coalesce(cik, $2), updated_at = now() where issuer_id = $1::uuid returning cik`,
      [subject.issuer_id, cik],
    );
    console.error(`${subject.ticker}: CIK ${rows[0]?.cik}`);
  }
}

function decimal(text: string) {
  const parsed = parseFinancialDecimal(text);
  if (!parsed.ok) throw new Error(`not a decimal: ${text}`);
  return parsed.value;
}

const rational = (text: string): ExactRational => rationalFromDecimal(decimal(text))!;
const toNumber = (value: ExactRational): number => Number(decimalText(value));

function decimalText(value: ExactRational): string {
  return canonicalDecimalString(roundRational(value, 6));
}

function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const dayAfter = (date: IsoDate): IsoDate => addDays(date, 1);

function yearsAfter(date: IsoDate, years: number): IsoDate {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { values } = parseArgs({ options: { tickers: { type: "string" }, "attach-ciks": { type: "string" }, "issuer-ids": { type: "boolean" }, "listing-ids": { type: "boolean" }, notes: { type: "string" } } });
  const tickers = (values.tickers ?? "").split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  if (tickers.length === 0) throw new Error("usage: --tickers AAPL,MSFT [--attach-ciks company_tickers.json | --issuer-ids | --listing-ids | --notes notes.md]");
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  try {
    if (values["attach-ciks"] !== undefined) return await attachCiks(pool, tickers, values["attach-ciks"]);
    if (values["issuer-ids"] || values["listing-ids"]) {
      console.log((await subjectIds(pool, tickers, values["issuer-ids"] ? "issuer_id" : "listing_id")).join(" "));
      return;
    }
    const notes = values.notes === undefined ? "" : readFileSync(values.notes, "utf8");
    const command = `npm run --silent backtest:fcf -- --tickers ${tickers.join(",")}${values.notes === undefined ? "" : ` --notes ${values.notes}`}`;
    process.stdout.write(renderBacktest(await runBacktest(pool, tickers), { ranOn: new Date().toISOString().slice(0, 10), command, notes }));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
