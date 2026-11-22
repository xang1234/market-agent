// A point-in-time backtest of the Call's required growth (ADR 0006, #610). For
// each issuer and each FY 10-K from 2016 to 2021 it reads the Call's inputs as
// of the filing date + 1 day, solves the growth the first close on or after
// that day required at that close's multiple, and sets beside it what
// followed: the FY free cash flow five 10-Ks later, the share count's change
// over those years, and the price five years later against the owner's 10%
// hurdle. Beside required growth it sets trailing growth, known at the same
// as-of date: from the 10-Ks 3 and 5 fiscal years earlier, each read as of
// its own filing date + 1 day, so as first filed. The gap, trailing minus
// required, is the ex-ante figure the run's summary splits returns by (#730).
// Offline and dev only: nothing here is written.
//
// Required growth g is the growth of total free cash flow, net of the share
// change d that stock-based compensation implies (ADR 0006: buybacks are paid
// out of the free cash flow already valued). So realized growth is total free
// cash flow too, and the realized share change, buybacks included, is its own
// figure beside d. Each growth also shows per share, with the earlier count
// restated by the splits between, so the buybacks' part is measured.
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
// Runbook on a dev DB, once the owner approves SEC fetches (each sample issuer
// needs its CIK first, and the split history the engine's share count requires):
//
//   cd services/fundamentals
//   export DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:54329/market_agent
//   export SEC_EDGAR_USER_AGENT="<name> <email>"
//   TICKERS=$(tr '\n' , < <ticker list> | sed 's/,$//')
//   npm run fill:ciks -- --file ../../.dev/company_tickers.json
//   LISTINGS=$(node --experimental-strip-types src/fcf-backtest.ts --tickers "$TICKERS" --listing-ids) &&
//     (cd ../market && POLYGON_API_KEY=... npm run sync:splits -- $LISTINGS)
//   ISSUERS=$(node --experimental-strip-types src/fcf-backtest.ts --tickers "$TICKERS" --issuer-ids) &&
//     npm run backfill:sec-statements -- --annual-history-years 16 $ISSUERS
//   npm run --silent backtest:fcf -- --tickers "$TICKERS" --notes <notes.md> > ../../docs/eval-runs/fcf-backtest/$(date -u +%F).md
//
// --issuer-ids and --listing-ids exit nonzero, naming them, when any ticker
// does not resolve: an empty id list backfills every issuer with SEC facts.
// A failed $(...) inside a command still runs it, so the ids are assigned first.
// 16 years reach FY2011, the 5-year trailing base of FY2016, for a filer whose
// newest 10-K is FY2026.
// --notes is the run's hand-written how-it-ran and caveats, set in the doc
// after the summary; everything else in the doc is this script's output.
//
// The closes are captured already (npm run capture:closes in services/market).

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "pg";

import {
  callModelOperations,
  canonicalDecimalString,
  conceptScope,
  createRuntimeAuthority,
  DEFAULT_CALL_SETTINGS,
  divideRationals,
  endOfLocalDay,
  evaluateBoundPlan,
  localDateOf,
  multiplyRationals,
  parseFinancialDecimal,
  rationalFromDecimal,
  rationalSign,
  requiredGrowth,
  roundRational,
  todaysMultiple,
  type ExactRational,
  type FinancialPlan,
  type FinancialRuntimeAuthority,
  type IsoDate,
  type ConceptScopeV1,
  type ValuationInputs,
  type ValuationOutcomeResult,
} from "../../financial-core/src/index.ts";
import { selectPlanInputs } from "../../financial-engine/src/bind-inputs.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, InputCandidate, SplitHistory, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { US_EQUITY_MICS } from "../../shared/src/identifiers.ts";
import { logPoolErrors, withPoolClient } from "../../shared/src/pool-client.ts";

export const BACKTEST_YEARS = { first: 2016, last: 2021 } as const;
const HORIZON_YEARS = 5;
const TRAILING_YEARS = [3, 5] as const;
export type TrailingYears = (typeof TRAILING_YEARS)[number];
const ZONE = "America/New_York";
// A Saturday as-of day before a Monday holiday reaches Tuesday's close in 3 days; 4 leaves room for a rare second closed day.
// A longer wait is a gap in the captures, so the row is stale_price rather than priced a week late.
const MAX_CLOSE_AGE_DAYS = 4;
const HURDLE = Number(DEFAULT_CALL_SETTINGS.required_return);
// The backtest's own reader: public SEC facts carry no user, so this id only satisfies the candidate query's signature.
const READER = "00000000-0000-4000-8000-000000000610";
const SLOT = "a";
// The Call's input nodes without its price: the close comes from daily_close_captures, not price_observations.
const OPERATIONS = callModelOperations(SLOT).filter((node) => node.node_id !== "market_cap_px" && node.node_id !== "market_cap");
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
  /** Present when the bound capex is filed as productive assets (#731). */
  capex_scope: ConceptScopeV1 | null;
  /** Present when the bound operating cash flow is filed for continuing operations (#743). */
  ocf_scope: ConceptScopeV1 | null;
  bound: ReadonlyArray<BoundInput>;
}>;

export type Close = Readonly<{ trade_date: IsoDate; close_text: string }>;
/** One capture's closes, on the split basis of `basis_date`: the day it was retrieved on, on the listing's calendar. */
export type CloseSeries = Readonly<{ kind: "closes"; basis_date: IsoDate; currency: string; closes: ReadonlyArray<Close> }>;

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
  /** From this 10-K to the one five fiscal years later. */
  realized: Growth;
  /** To this 10-K from the ones 3 and 5 fiscal years earlier: known at the as-of date. */
  trailing: Readonly<Record<TrailingYears, Growth>>;
  price_return: Figure;
}>;

/** Annual growth between two 10-Ks of total free cash flow, of free cash flow per share, and of the share count. */
export type Growth = Readonly<{ fcf: Figure; per_share: Figure; shares: Figure }>;

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
  const scopeOf = (slot: string) => {
    const binding = bindings.get(slot);
    return binding?.status === "bound" && "fact_id" in binding.input ? conceptScope(binding.input.inference) : null;
  };
  return { as_of: asOf, figures, exact, currency, fiscal_year_end: operating?.period_end ?? null, capex_scope: scopeOf("capex"), ocf_scope: scopeOf("operating_cash_flow"), bound };
}

/**
 * One issuer-year: the growth the first close on or after the as-of day
 * required at that close's multiple, the growth to the 10-K five fiscal years
 * later and from the 10-Ks 3 and 5 fiscal years earlier, and the annualized
 * price return over five years from that close.
 */
export function backtestRow(input: Readonly<{
  ticker: string;
  fiscal_year: number;
  filed: IsoDate;
  /** The issuer's fiscal year label less its period's end year (labelOffset). */
  label_offset: number;
  base: AsOfInputs;
  later: AsOfInputs | Absent;
  /** Each earlier 10-K's inputs as of its own filing date + 1 day. */
  earlier: Readonly<Record<TrailingYears, AsOfInputs | Absent>>;
  closes: CloseSeries | Absent;
  splits: SplitHistory;
}>): ReadRow {
  const { base, closes, splits } = input;
  // The other 10-K, `years` fiscal years from this one, read and checked for its period.
  const other = (years: number, read: AsOfInputs | Absent): Read | Absent => {
    const label = `FY${years > 0 ? "+" : ""}${years}`;
    if ("kind" in read) return named(label, read) as Absent;
    const period = periodCheck(read, input.fiscal_year + years, input.label_offset);
    return period === null ? { inputs: read, label: `${label} ` } : named(label, period) as Absent;
  };
  const own: Read = { inputs: base, label: "" };
  const close = closes.kind === "outcome" ? closes : closeOnOrAfter(closes, base.as_of);
  const price = close.kind === "outcome" || closes.kind === "outcome" ? close : splitBasis(close, closes, splits);
  const { multiple, share_change, growth: required } = solve(base, price, closes);
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
    required_growth: required,
    realized: growth(own, other(HORIZON_YEARS, input.later), HORIZON_YEARS, splits),
    trailing: { 3: growth(other(-3, input.earlier[3]), own, 3, splits), 5: growth(other(-5, input.earlier[5]), own, 5, splits) },
    price_return: priceReturn(close, closes),
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
    // The Call is made at the close it prices, which is on or after the as-of day the inputs are read at.
    call_date: close.trade_date,
    listing_timezone: ZONE,
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
  // d, ADR 0006's default: last fiscal year's stock-based compensation over the market cap at the close.
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

/** One 10-K's inputs, and the label that names its figures' outcomes: "" for the row's own, "FY+5 " or "FY-3 " for the other. */
type Read = Readonly<{ inputs: AsOfInputs; label: string }>;

// The annual growth from one 10-K to the one `years` fiscal years later, each ratio exact before its root.
function growth(from: Read | Absent, to: Read | Absent, years: number, splits: SplitHistory): Growth {
  const absent = [from, to].find((read): read is Absent => "kind" in read);
  if (absent !== undefined) return { fcf: absent, per_share: absent, shares: absent };
  const [start, end] = [from as Read, to as Read];
  const annual = (ratio: ExactRational) => percent(toNumber(ratio) ** (1 / years) - 1);
  const missing = (...ids: InputId[]): Figure | null => {
    for (const id of ids) for (const read of [start, end]) {
      const figure = read.inputs.figures[id];
      if (figure.kind === "outcome") return named(`${read.label}${id}`, figure);
    }
    return null;
  };
  const exact = (read: Read, id: InputId) => read.inputs.exact[id]!;
  // Called only past missing("free_cash_flow"): an end with no figure has no exact value to sign.
  const nonPositive = () => rationalSign(exact(start, "free_cash_flow")) <= 0 || rationalSign(exact(end, "free_cash_flow")) <= 0;
  const noGrowth = outcome("non_positive_base", "Free cash flow at one end is zero or negative, so it has no growth rate.");
  const fcf = (): Figure => nonPositive() ? noGrowth : annual(divideRationals(exact(end, "free_cash_flow"), exact(start, "free_cash_flow"))!);
  // The engine states each count on its own as-of day's basis; the splits between them restate the earlier one.
  // A reported share count may be zero; dividing by it, or taking its root, has no growth rate.
  const shareRatio = (): ExactRational | Absent => splits.status === "gap"
    ? outcome(splits.reason_code, "No split history to put both share counts on one basis.")
    : rationalSign(exact(start, "shares_outstanding")) <= 0 || rationalSign(exact(end, "shares_outstanding")) <= 0
    ? outcome("non_positive_shares", "A share count at one end is zero or negative, so it has no growth rate.")
    : divideRationals(exact(end, "shares_outstanding"), multiplyRationals(exact(start, "shares_outstanding"), splitFactor(splits, start.inputs.as_of, end.inputs.as_of))!)!;
  // Free cash flow over capex, or OCF, in two scopes is no growth of one measure (#731, #743).
  const rescoped = (): Figure | null => (start.inputs.capex_scope === null) !== (end.inputs.capex_scope === null)
    ? outcome("incompatible_definition", "Capex is filed as PaymentsToAcquireProductiveAssets at one end and as PP&E at the other, so the two free cash flows do not measure the same spending.")
    : (start.inputs.ocf_scope === null) !== (end.inputs.ocf_scope === null)
    ? outcome("incompatible_definition", "Operating cash flow is filed for continuing operations at one end and as the total at the other, so the two free cash flows do not measure the same cash flow.")
    : null;
  const shares = (): Figure => {
    const ratio = shareRatio();
    return "kind" in ratio ? ratio : annual(ratio);
  };
  const perShare = (): Figure => {
    const ratio = shareRatio();
    if ("kind" in ratio) return ratio;
    return nonPositive() ? noGrowth : annual(divideRationals(divideRationals(exact(end, "free_cash_flow"), exact(start, "free_cash_flow"))!, ratio)!);
  };
  return {
    fcf: missing("free_cash_flow") ?? rescoped() ?? fcf(),
    per_share: missing("free_cash_flow", "shares_outstanding") ?? rescoped() ?? perShare(),
    shares: missing("shares_outstanding") ?? shares(),
  };
}

// From the close the Call priced to the first close on or after five years after it.
function priceReturn(start: Restated | Absent, closes: CloseSeries | Absent): Figure {
  if (closes.kind === "outcome") return named("price", closes);
  if (start.kind === "outcome") return named("price", start);
  const end = closeOnOrAfter(closes, yearsAfter(start.trade_date, HORIZON_YEARS));
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

/**
 * The first adjusted close on or after `date`, at most MAX_CLOSE_AGE_DAYS
 * later. Never an earlier one: the close of a filing day can precede the
 * filing, and a weekend or holiday as-of day has no close of its own.
 */
function closeOnOrAfter(series: CloseSeries, date: IsoDate): Restated | Absent {
  const close = series.closes.find((entry) => entry.trade_date >= date);
  if (close === undefined) return { kind: "outcome", outcome: "price_missing", text: `No captured close on or after ${date}; captures end ${series.closes.at(-1)?.trade_date ?? "nowhere"}.` };
  if (daysBetween(date, close.trade_date) > MAX_CLOSE_AGE_DAYS) {
    return { kind: "outcome", outcome: "stale_price", text: `The first captured close on or after ${date} is ${close.trade_date}.` };
  }
  return { kind: "value", value: rationalFromDecimal(decimal(close.close_text))!, text: close.close_text, trade_date: close.trade_date };
}

// A split-adjusted close restated to its own day's basis: times every split after that day and on or before the capture.
function splitBasis(close: Restated, series: CloseSeries, splits: SplitHistory): Restated | Figure {
  if (splits.status === "gap") return outcome(splits.reason_code, "No split history to restate the adjusted close to its own day.");
  const value = multiplyRationals(close.value, splitFactor(splits, close.trade_date, series.basis_date))!;
  return { ...close, value, text: decimalText(value) };
}

function splitFactor(splits: Extract<SplitHistory, { status: "ok" }>, after: IsoDate, through: IsoDate): ExactRational {
  return splits.splits
    .filter((split) => split.execution_date > after && split.execution_date <= through)
    .reduce((factor, split) => multiplyRationals(factor, divideRationals(rational(split.split_to), rational(split.split_from))!)!, rational("1"));
}

/** The closes of the issuer's one common-stock listing from its newest capture, whichever source took it: one split basis, one close a day. */
export async function closeSeries(db: SqlExecutor, issuerId: string): Promise<CloseSeries | Absent> {
  const { rows } = await db.query<{ listing_id: string; retrieved_at: Date; timezone: string; currency: string; trade_date: string; close_text: string }>(
    `with newest as (
       select distinct on (d.listing_id) d.listing_id, d.source_id, d.captured_on
         from daily_close_captures d
         join listings l on l.listing_id = d.listing_id
         join instruments i on i.instrument_id = l.instrument_id
        where i.issuer_id = $1::uuid and i.asset_type = 'common_stock'
        order by d.listing_id, d.captured_on desc, d.retrieved_at desc, d.source_id)
     select d.listing_id::text as listing_id, d.retrieved_at, l.timezone, d.currency, d.trade_date::text as trade_date, d.close_text
       from daily_close_captures d join newest using (listing_id, source_id, captured_on) join listings l using (listing_id)
      order by d.trade_date`,
    [issuerId],
  );
  const listings = new Set(rows.map((row) => row.listing_id));
  if (listings.size === 0) return outcome("price_missing", "No captured closes for the issuer's common stock.");
  if (listings.size > 1) return outcome("price_listing_unresolved", "Closes are captured for more than one common-stock listing.");
  // captured_on is the UTC day (0081); split dates are the listing's, and an evening capture in New York is already the next UTC day.
  const [first] = rows as [typeof rows[number]];
  return { kind: "closes", basis_date: localDateOf(first.retrieved_at.getTime(), first.timezone), currency: first.currency, closes: rows.map(({ trade_date, close_text }) => ({ trade_date, close_text })) };
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
        and l.mic = any($2::text[])`,
    [[...tickers], US_EQUITY_MICS],
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
    const filings = await annualFilings(db, subject.issuer_id, years.first - Math.max(...TRAILING_YEARS), years.last + HORIZON_YEARS);
    const byYear = new Map(filings.map((filing) => [filing.fiscal_year, filing]));
    const offset = labelOffset(filings);
    const closes = await closeSeries(db, subject.issuer_id);
    const splits = await port.readSplitHistory({ subject: { kind: "issuer", id: subject.issuer_id }, as_of: new Date().toISOString() });
    // Each FY's 10-K as of its filing date + 1 day, read once: one row's base is another's FY-3, FY-5 or FY+5.
    const reads = new Map<number, AsOfInputs>();
    const readFy = async (fiscalYear: number): Promise<AsOfInputs | Absent> => {
      const filed = byYear.get(fiscalYear)?.filed;
      if (filed == null) return filingOutcome(byYear, fiscalYear)!;
      if (!reads.has(fiscalYear)) reads.set(fiscalYear, await inputsAsOf(db, subject.issuer_id, dayAfter(filed)));
      return reads.get(fiscalYear)!;
    };
    for (let fiscalYear = years.first; fiscalYear <= years.last; fiscalYear += 1) {
      const base = await readFy(fiscalYear);
      if ("kind" in base) {
        rows.push({ kind: "unread", ticker: subject.ticker, fiscal_year: fiscalYear, outcome: base });
        continue;
      }
      rows.push(backtestRow({
        ticker: subject.ticker, fiscal_year: fiscalYear, filed: byYear.get(fiscalYear)!.filed!, label_offset: offset, base,
        later: await readFy(fiscalYear + HORIZON_YEARS),
        earlier: { 3: await readFy(fiscalYear - 3), 5: await readFy(fiscalYear - 5) },
        closes, splits,
      }));
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
  for (const [label, figure] of [["required growth", row.required_growth], ["realized growth", row.realized.fcf]] as const) {
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
  const gap = (row: ReadRow) => value(row.realized.fcf)! - value(row.required_growth)!;
  const delivered = both.filter((row) => gap(row) >= 0);
  const hurdle = (group: ReadonlyArray<ReadRow>) => {
    const returns = group.flatMap((row) => value(row.price_return) ?? []);
    return `${returns.length} ${returns.length === 1 ? "has" : "have"} a ${HORIZON_YEARS}-year price return, ${aboveHurdle(returns)}`;
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
    ...trailingGaps(rows),
    buybacks(rows),
  ];
}

const rowCount = (n: number) => `${n} row${n === 1 ? "" : "s"}`;
const medianText = (values: ReadonlyArray<number>) => {
  const middle = median(values);
  return middle === null ? "n/a" : percentText(middle);
};
const aboveHurdle = (returns: ReadonlyArray<number>) => `${returns.filter((annual) => annual >= HURDLE).length} at or above ${(HURDLE * 100).toFixed(0)}% a year, median ${medianText(returns)}`;

// The ex-ante split: each row's gap, trailing minus required, against its 5-year price return.
function trailingGaps(rows: ReadonlyArray<BacktestRow>): string[] {
  const lines = ["- **Trailing against required, ex ante.** The gap is trailing growth of total free cash flow minus required growth, both known at the as-of date. The trailing CAGR runs from the 10-K 3 or 5 fiscal years earlier to the row's own, each as first filed. Each split counts rows with a gap and a 5-year price return, sorted by the gap; a period_mismatch row is left out."];
  for (const years of TRAILING_YEARS) {
    const gaps = rows.flatMap((row) => {
      if (row.kind === "unread" || row.period !== null) return [];
      const [trailing, required] = [value(row.trailing[years].fcf), value(row.required_growth)];
      return trailing === null || required === null ? [] : [{ row, gap: trailing - required, price_return: value(row.price_return) }];
    });
    const priced = gaps.flatMap((entry) => entry.price_return === null ? [] : [{ ...entry, price_return: entry.price_return }])
      .sort((a, b) => a.gap - b.gap || a.row.ticker.localeCompare(b.row.ticker) || a.row.fiscal_year - b.row.fiscal_year);
    // Rows of one issuer move together, so each bucket also counts its issuers.
    const fromIssuers = (group: typeof priced) => {
      const issuers = new Set(group.map((entry) => entry.row.ticker)).size;
      return `${rowCount(group.length)} from ${issuers} issuer${issuers === 1 ? "" : "s"}`;
    };
    const bucket = (group: typeof priced) => `${fromIssuers(group)}, ${aboveHurdle(group.map((entry) => entry.price_return))}`;
    const points = (gap: number) => (gap * 100).toFixed(2);
    lines.push(`  - **${years}-year gap.** ${fromIssuers(priced)}, and ${gaps.length - priced.length} more with no ${HORIZON_YEARS}-year price return. At or above 0, ${bucket(priced.filter((entry) => entry.gap >= 0))}. Below 0, ${bucket(priced.filter((entry) => entry.gap < 0))}.`);
    // Thirds go by rank, so gaps tied across a boundary split by ticker and FY.
    ["Lowest", "Middle", "Highest"].forEach((name, third) => {
      const group = priced.filter((_, index) => Math.floor((3 * index) / priced.length) === third);
      lines.push(group.length === 0
        ? `    - ${name} third: 0 rows.`
        : `    - ${name} third, gap ${points(group[0]!.gap)} to ${points(group.at(-1)!.gap)} points: ${bucket(group)}.`);
    });
  }
  return lines;
}

// Realized growth per share beside the total: what buybacks added that required growth leaves out.
// Every median is over the same rows, so a row with no d leaves all four.
function buybacks(rows: ReadonlyArray<BacktestRow>): string {
  const figures = (row: ReadRow) => [row.realized.fcf, row.realized.per_share, row.realized.shares, row.share_change];
  const realized = rows.filter((row): row is ReadRow => row.kind === "read" && row.period === null && value(row.realized.fcf) !== null && value(row.realized.per_share) !== null);
  const all = realized.filter((row) => figures(row).every((figure) => value(figure) !== null));
  const noD = realized.length - all.length;
  const medianOf = (index: number) => medianText(all.map((row) => value(figures(row)[index]!)!));
  return `- **Buybacks.** ${rowCount(all.length)} ${all.length === 1 ? "has" : "have"} realized growth in total and per share and a d${noD === 0 ? "" : `; ${noD} more ${noD === 1 ? "has" : "have"} no d`}. Median a year: total ${medianOf(0)}, per share ${medianOf(1)}, realized share change ${medianOf(2)}, d ${medianOf(3)}.`;
}

const COLUMNS = ["free_cash_flow", "net_cash", "stock_based_compensation", "shares_outstanding", "price", "multiple", "required_growth", "trailing_3y", "trailing_3y_per_share", "trailing_5y", "trailing_5y_per_share", "realized_growth", "realized_per_share", "share_change", "realized_share_change", "price_return"] as const;

function tableRow(row: BacktestRow): string {
  const escape = (text: string) => text.replaceAll("|", "\\|");
  if (row.kind === "unread") return `| ${[row.ticker, row.fiscal_year, "n/a", "n/a", ...COLUMNS.map(() => "n/a"), `**${row.outcome.outcome}** (${escape(row.outcome.text)})`].join(" | ")} |`;
  const { free_cash_flow, net_cash, stock_based_compensation, shares_outstanding } = row.inputs.figures;
  const { 3: three, 5: five } = row.trailing;
  const figures = [free_cash_flow, net_cash, stock_based_compensation, shares_outstanding, row.price, row.todays_multiple, row.required_growth, three.fcf, three.per_share, five.fcf, five.per_share, row.realized.fcf, row.realized.per_share, row.share_change, row.realized.shares, row.price_return];
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
    `Generated by \`${doc.command}\`. Offline and dev only (#610). Inputs are the engine's selection as of the 10-K filing date + 1 day, with each SEC fact taken as public by the end of its filing date in New York. The price is the first close on or after that day, a yfinance split-adjusted close, never certified. Required growth is the growth of total free cash flow that price requires at its multiple, with ADR 0006's model, the 10% required return and d, the share change stock-based compensation implies. Trailing growth is the same total free cash flow's growth to this 10-K from the ones 3 and 5 fiscal years earlier, each read as of its own filing date + 1 day, so known at the as-of date. Realized growth is its growth to the 10-K five fiscal years later; the realized share change over those years, buybacks included, sits beside d. Each growth is also shown per share, the earlier count restated for splits. The price return is annualized over five years from that close, price only, with no dividends.`,
    "",
    "## Summary",
    "",
    ...summary(run.rows),
    "",
    ...(doc.notes.trim() === "" ? [] : [doc.notes.trim(), ""]),
    "## Rows",
    "",
    "| Issuer | FY | Filed | As of | Free cash flow | Net cash | SBC | Shares | Close | Multiple | Required growth | Trailing FCF CAGR, 3y | Per share, 3y | Trailing FCF CAGR, 5y | Per share, 5y | Realized FCF CAGR, 5y | Realized per share, 5y | d, SBC share change | Realized share change, 5y | 5-year price return vs 10% hurdle | Named outcomes |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
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

function decimal(text: string) {
  const parsed = parseFinancialDecimal(text);
  if (!parsed.ok) throw new Error(`not a decimal: ${text}`);
  return parsed.value;
}

const rational = (text: string): ExactRational => rationalFromDecimal(decimal(text))!;
// Relative precision, not six decimal places: a growth ratio of 0.0000004 must not round to zero before its root.
const decimalNumber = (value: ExactRational["numerator"]): number => Number(value.coefficient) / 10 ** value.scale;
const toNumber = (value: ExactRational): number => decimalNumber(value.numerator) / decimalNumber(value.denominator);

function decimalText(value: ExactRational): string {
  return canonicalDecimalString(roundRational(value, 6));
}

function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const dayAfter = (date: IsoDate): IsoDate => addDays(date, 1);

function yearsAfter(date: IsoDate, years: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  // Day 0 of the next month is this month's last, so 29 February clamps to the 28th in a year without one.
  const last = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return new Date(Date.UTC(year + years, month - 1, Math.min(day, last))).toISOString().slice(0, 10);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { values } = parseArgs({ options: { tickers: { type: "string" }, "issuer-ids": { type: "boolean" }, "listing-ids": { type: "boolean" }, notes: { type: "string" } } });
  const tickers = (values.tickers ?? "").split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  if (tickers.length === 0) throw new Error("usage: --tickers AAPL,MSFT [--issuer-ids | --listing-ids | --notes notes.md]");
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  try {
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
