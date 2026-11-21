// The Call (ADR 0005, ADR 0006, #604): the agent's opinion on a stock,
// assembled from inputs an engine run certified, the owner's hurdle settings
// and the valuation model. Facts, assumptions and what the price requires
// each carry their kind and basis; the stance cites the rows it rests on.
//
// The exit multiple is anchored against the issuer's own last ten fiscal
// years of EV/FCF (#605), but no bear case is anchored yet, so ADR 0005's
// rule 1 still matches every Call that rule 0 does not. The stance has only
// its declined variant, and nothing here computes a hurdle price, a stability
// move or a scenario. The Call reads facts by identity and never feeds the
// fact layer.

import type { DecimalString, GapDisposition, IsoDate, LocalId, ReasonCode, Sha256Hex, UUID } from "./contracts.ts";
import { balanceComponents } from "./definitions.ts";
import { canonicalDecimalString, parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";
import type { RecordedSplit } from "./split-adjustment.ts";
import { fixed } from "./value-text.ts";
import { addRationals, compareRationals, divideRationals, multiplyRationals, rationalFromDecimal, rationalSign, roundRational, subtractRationals, type ExactRational } from "./rational.ts";
import {
  consensusRow,
  requiredGrowth,
  sessionsAfter,
  todaysMultiple,
  VALUATION_OUTCOMES,
  type ConsensusCapture,
  type ValuationInputs,
  type ValuationOutcome,
  type ValuationOutcomeResult,
} from "./valuation-model.ts";

export const CALL_VERSION = "call.v1";

/** Advice and valuation words: a price comparison ask with one is declined (#224), and neither a comparison nor a Call says one. */
export const ADVICE_WORDS = /\b(?:upside|downside|targets?|hold|expected|returns?|undervalued|overvalued|fair|worth|buy|sell|forecasts?|recommend\w*|cheap|expensive|potential)\b/iu;

/** ADR 0005's stance wording. A stated Call alone may say it; a factual answer never does. */
export const STANCE_WORDS = /\b(?:clears your hurdle|near your hurdle|falls short of your hurdle)\b/iu;

/** The fiscal years of EV/FCF an exit multiple is anchored on (operator decision on #605, 2026-11-21). */
export const ANCHOR_FISCAL_YEARS = 10;

type PlanNode = Readonly<Record<string, unknown> & { node_id: LocalId }>;
const BALANCES = balanceComponents("net_cash").map((component) => component.metric_key);

// The node a fiscal year's input is read from, `offset` years before the latest: the latest year's are the Call's own nodes.
function yearNode(offset: number, node: string): LocalId {
  return offset === 0 ? node : `fy${offset}_${node}`;
}

/** The nodes one fiscal year of the anchor's history reads its figures and citations from. */
export function callHistoryNodes(offset: number): Readonly<{
  free_cash_flow: LocalId;
  net_cash: LocalId;
  shares: LocalId;
  cited: Readonly<{ free_cash_flow: ReadonlyArray<LocalId>; net_cash: ReadonlyArray<LocalId>; shares: ReadonlyArray<LocalId> }>;
}> {
  const node = (name: string) => yearNode(offset, name);
  return {
    free_cash_flow: node("free_cash_flow"),
    net_cash: node("net_cash"),
    shares: node("weighted_average_diluted_shares"),
    cited: { free_cash_flow: [node("operating_cash_flow"), node("capex")], net_cash: BALANCES.map(node), shares: [node("weighted_average_diluted_shares")] },
  };
}

// One fiscal year's free cash flow and net cash, `offset` years before the latest.
function yearOperations(slot: LocalId, offset: number): PlanNode[] {
  const node = (name: string) => yearNode(offset, name);
  const read = (metric: string) => ({ node_id: node(metric), operation: "reported_metric", subject_slot: slot, metric_key: metric, period: { kind: "latest", period_type: "annual", offset } });
  return [
    read("operating_cash_flow"),
    read("capex"),
    { node_id: node("free_cash_flow"), operation: "free_cash_flow", operating_cash_flow: node("operating_cash_flow"), capex: node("capex") },
    ...BALANCES.map(read),
    { node_id: node("net_cash"), operation: "net_cash", ...Object.fromEntries(BALANCES.map((metric) => [metric, node(metric)])) },
  ];
}

/**
 * The model's nodes for one subject's Call: FY free cash flow, net cash from
 * the latest 10-K's balance sheet, last fiscal year's stock-based
 * compensation, and the share count and price a market cap reads
 * (valuation-plan.ts's market cap nodes).
 */
export function callModelOperations(slot: LocalId): ReadonlyArray<PlanNode> {
  return [
    ...yearOperations(slot, 0),
    { node_id: "stock_based_compensation", operation: "reported_metric", subject_slot: slot, metric_key: "stock_based_compensation", period: { kind: "latest", period_type: "annual", offset: 0 } },
    { node_id: "market_cap_px", operation: "reported_metric", subject_slot: slot, metric_key: "share_price", period: { kind: "at_cutoff" } },
    { node_id: "market_cap_shares", operation: "reported_metric", subject_slot: slot, metric_key: "shares_outstanding", period: { kind: "latest", period_type: "quarterly", offset: 0 } },
    { node_id: "market_cap", operation: "market_cap", price: "market_cap_px", shares: "market_cap_shares" },
  ];
}

/**
 * The engine plan's nodes for one subject's Call inputs: the model's, and for
 * the exit multiple's anchor each of the last ten fiscal years' free cash
 * flow, net cash and diluted weighted-average shares. A cover count binds
 * only from the latest filing (select-inputs.ts rule 9), so a year's EV reads
 * its 10-K's diluted count. The seal regenerates a Call only from a run whose
 * plan has exactly these.
 */
export function callInputOperations(slot: LocalId): ReadonlyArray<PlanNode> {
  const shares = (offset: number) => ({
    node_id: callHistoryNodes(offset).shares, operation: "reported_metric", subject_slot: slot, metric_key: "weighted_average_diluted_shares",
    period: { kind: "latest", period_type: "annual", offset },
  });
  return [
    ...callModelOperations(slot),
    shares(0),
    ...Array.from({ length: ANCHOR_FISCAL_YEARS - 1 }, (_, index) => [...yearOperations(slot, index + 1), shares(index + 1)]).flat(),
  ];
}

/** The node each Call figure is read from. */
export const CALL_FIGURE_NODES: Readonly<Record<CallFactId | "market_cap", LocalId>> = Object.freeze({
  free_cash_flow: "free_cash_flow",
  net_cash: "net_cash",
  stock_based_compensation: "stock_based_compensation",
  shares_outstanding: "market_cap_shares",
  share_price: "market_cap_px",
  market_cap: "market_cap",
});

/** The nodes a Call's inputs run publishes: each Call figure's, and each history year's. */
export const CALL_OUTPUT_NODES: ReadonlyArray<LocalId> = Object.freeze([
  ...new Set([
    ...Object.values(CALL_FIGURE_NODES),
    ...Array.from({ length: ANCHOR_FISCAL_YEARS }, (_, offset) => {
      const { free_cash_flow, net_cash, shares } = callHistoryNodes(offset);
      return [free_cash_flow, net_cash, shares];
    }).flat(),
  ]),
]);

/** The owner's hurdle settings (ADR 0005), each a canonical decimal inside its range. */
export type CallSettings = Readonly<{
  required_return: DecimalString;
  margin_of_safety: DecimalString;
  bear_loss_limit: DecimalString;
  near_band: DecimalString;
}>;

// ponytail: no settings store exists yet, so every Call uses ADR 0005's initial values and records them.
export const DEFAULT_CALL_SETTINGS: CallSettings = Object.freeze({ required_return: "0.1", margin_of_safety: "1.25", bear_loss_limit: "0.25", near_band: "0.1" });

const ONE = rationalFromDecimal({ coefficient: 1n, scale: 0 })!;
const SETTING_RANGES: Readonly<Record<keyof CallSettings, (value: ExactRational) => boolean>> = {
  required_return: (value) => rationalSign(value) > 0,
  margin_of_safety: (value) => compareRationals(value, ONE) >= 0,
  bear_loss_limit: (value) => rationalSign(value) > 0 && compareRationals(value, ONE) < 0,
  near_band: (value) => rationalSign(value) > 0,
};

/** The settings, or null when any is missing, extra, not a canonical decimal, or outside ADR 0005's range. */
export function parseCallSettings(value: unknown): CallSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  const names = Object.keys(SETTING_RANGES) as Array<keyof CallSettings>;
  if (entries.length !== names.length) return null;
  for (const name of names) {
    const text = (value as Record<string, unknown>)[name];
    const exact = typeof text === "string" ? decimal(text) : null;
    if (exact === null || canonicalDecimalString(exact) !== text || !SETTING_RANGES[name](rationalFromDecimal(exact)!)) return null;
  }
  return Object.freeze(Object.fromEntries(names.map((name) => [name, (value as Record<string, string>)[name]]))) as CallSettings;
}

export const CALL_INPUT_KINDS = ["reported_fact", "attributed_consensus", "market_observation", "owner_policy", "agent_assumption", "deterministic_result"] as const;
export type CallInputKind = (typeof CALL_INPUT_KINDS)[number];

export type CallFactId = "free_cash_flow" | "net_cash" | "stock_based_compensation" | "shares_outstanding" | "share_price";
export type CallRowId =
  | CallFactId
  | "required_return"
  | "exit_multiple"
  | "anchored_exit_multiple"
  | "share_change"
  | "bear_case"
  | "required_growth"
  | "required_growth_anchored"
  | "consensus";

/** A filing or observation a fact is read from; `date` is the day its publication proof says it was public by, or the close's session day. */
export type CallSource = Readonly<{ source_id: UUID; accession: string | null; period_end: IsoDate | null; date: IsoDate }>;
export type CallCitation = CallSource & Readonly<{ text: string }>;

export type CallFigure =
  | Readonly<{ kind: "value"; text: string }>
  | Readonly<{ kind: "outcome"; outcome: string; reason_code: ReasonCode | null; text: string }>;

export type CallRow = Readonly<{
  id: CallRowId;
  label: string;
  kind: CallInputKind;
  /** What the row rests on. An agent assumption's starts "judgment:" or "anchored:". */
  basis: string;
  figure: CallFigure;
  citations: ReadonlyArray<CallCitation>;
  /** The rows it is computed from. */
  from: ReadonlyArray<CallRowId>;
}>;

export type CallReason = Readonly<{ cites: CallRowId; text: string }>;

/** Only the declined variant exists until an anchored bear case makes a stated stance reachable. */
export type CallStance = Readonly<{ kind: "declined"; rule: 0 | 1; text: string; reasons: ReadonlyArray<CallReason> }>;

/** The certified run a Call's inputs come from, and the fingerprint of its bound inputs. */
export type CallInputsRef = Readonly<{ snapshot_id: UUID; run_id: UUID; unit_id: LocalId; fingerprint: Sha256Hex }>;

export type CallContent = Readonly<{
  version: typeof CALL_VERSION;
  call_date: IsoDate;
  subject: Readonly<{ issuer_id: UUID; label: string }>;
  settings: CallSettings;
  inputs: CallInputsRef;
  /** Row 1: facts used, each cited. */
  facts: ReadonlyArray<CallRow>;
  /** Row 2: assumptions, each with its kind and basis. */
  assumptions: ReadonlyArray<CallRow>;
  /** Row 3: what the price requires, and the consensus shown beside it. */
  requires: ReadonlyArray<CallRow>;
  stance: CallStance;
}>;

/** An engine result: its certified value, or the gap it published. */
export type CallEngineFigure =
  | Readonly<{ kind: "value"; value: DecimalString; currency: string | null }>
  | Readonly<{ kind: "gap"; disposition: GapDisposition; reason_code: ReasonCode }>;

/** What a Call is assembled from: one certified run's results and sources, the owner's settings, and the consensus captures on file. */
export type CallEvidence = Readonly<{
  call_date: IsoDate;
  /** The listing's time zone, which the Call and price dates are dated in. */
  listing_timezone: string;
  subject: CallContent["subject"];
  settings: CallSettings;
  inputs: CallInputsRef;
  figures: Readonly<Record<CallFactId | "market_cap", CallEngineFigure>>;
  citations: Readonly<Record<CallFactId, ReadonlyArray<CallSource>>>;
  /** The fiscal year end free cash flow is for. */
  fiscal_year_end: IsoDate | null;
  /** The session date of the price. */
  price_date: IsoDate | null;
  consensus: ReadonlyArray<ConsensusCapture & Readonly<{ source_id: UUID }>>;
  /** The anchor's fiscal years, latest first: empty when the latest has no bound statement. */
  history: ReadonlyArray<CallHistoryYear>;
  /** The newest close capture retrieved by the Call's cutoff, or null when there is none. */
  closes: CallCloses | null;
  /** The listing's splits, or null when its split history is unknown. */
  splits: ReadonlyArray<RecordedSplit> | null;
}>;

/** One fiscal year's certified figures, each on the Call date's split basis, and the sources it binds. */
export type CallHistoryYear = Readonly<{
  fiscal_year: number;
  /** The end of the period free cash flow is for, or null when none is bound. */
  period_end: IsoDate | null;
  figures: Readonly<{ free_cash_flow: CallEngineFigure; net_cash: CallEngineFigure; shares: CallEngineFigure }>;
  citations: Readonly<{ free_cash_flow: ReadonlyArray<CallSource>; net_cash: ReadonlyArray<CallSource>; shares: ReadonlyArray<CallSource> }>;
}>;

/** One set of dev split-adjusted daily closes, as captured (daily_close_captures): never certified. */
export type CallCloses = Readonly<{
  source_id: UUID;
  /** The capture's day: its closes are on the split basis of that day. */
  captured_on: IsoDate;
  currency: string;
  /** Ordered by trade date. */
  closes: ReadonlyArray<Readonly<{ trade_date: IsoDate; close_text: DecimalString }>>;
}>;

const FACTS: ReadonlyArray<Readonly<{ id: CallFactId; label: string; kind: CallInputKind; basis: string; source: (citation: CallSource) => string }>> = [
  { id: "free_cash_flow", label: "Free cash flow", kind: "deterministic_result", basis: "free_cash_flow.v1: operating cash flow less PP&E capex, as reported in the latest 10-K", source: tenK },
  { id: "net_cash", label: "Net cash", kind: "deterministic_result", basis: "net_cash.v1: cash and securities less debt, from the same 10-K's balance sheet", source: tenK },
  { id: "stock_based_compensation", label: "Stock-based compensation", kind: "reported_fact", basis: "Reported in the latest 10-K's cash flow statement", source: tenK },
  {
    id: "shares_outstanding", label: "Shares outstanding", kind: "reported_fact", basis: "The newest cover-page count, under the engine's age and split rules",
    source: (citation) => `${citation.accession ?? "Filing"}, cover date ${citation.period_end}, public by ${citation.date}`,
  },
  { id: "share_price", label: "Share price", kind: "market_observation", basis: "The latest stored close on or before the Call date", source: (citation) => `Close on ${citation.date}` },
];

function tenK(citation: CallSource): string {
  return `10-K${citation.accession === null ? "" : ` ${citation.accession}`}, period ended ${citation.period_end}, public by ${citation.date}`;
}

// The model input each valuation outcome is about; any of these declines the Call under rule 0.
const INPUT_OUTCOME_ROWS: Partial<Record<ValuationOutcome, CallFactId>> = {
  non_positive_free_cash_flow: "free_cash_flow",
  stale_filing: "free_cash_flow",
  shares_missing: "shares_outstanding",
  price_missing: "share_price",
  stale_price: "share_price",
  incompatible_currency: "share_price",
};

const MODEL_INPUTS: ReadonlyArray<CallRowId> = ["free_cash_flow", "net_cash", "shares_outstanding", "share_price", "required_return", "exit_multiple", "share_change"];
const ANCHORED_MODEL_INPUTS = MODEL_INPUTS.map((id) => id === "exit_multiple" ? "anchored_exit_multiple" : id);

const ANCHOR_RULE = `The lowest of today's multiple, the median EV/FCF of the last ${ANCHOR_FISCAL_YEARS} fiscal years and the multiple whose implied perpetual growth at your required return is 4%, when each of those years has a multiple`;
const BEAR_CASE_REASON = "No bear case is anchored yet, so the bear value per share is not computed.";

/** The Call its evidence gives: rows 1 to 3 and the stance, declined under rule 0 or rule 1. */
export function assembleCall(evidence: CallEvidence): CallContent {
  const engine = factFigures(evidence);
  const facts = FACTS.map((fact): CallRow => ({
    id: fact.id,
    label: fact.label,
    kind: fact.kind,
    basis: fact.basis,
    figure: engine[fact.id],
    citations: evidence.citations[fact.id].map((citation) => ({ ...citation, text: fact.source(citation) })),
    from: [],
  }));
  const causes: Cause[] = facts.flatMap((row) => row.figure.kind === "outcome" ? [{ cites: row.id, label: row.label, figure: row.figure }] : []);
  const { multiple, shareChange, growth, today, growthAt } = modelFigures(evidence, causes);
  // Only a Call no input outcome declines is anchored; otherwise both anchored rows name the first cause.
  const anchor = causes.length > 0 ? null : anchorExitMultiple(evidence, today);
  const assumptions: CallRow[] = [
    {
      id: "required_return", label: "Required return (r)", kind: "owner_policy", basis: "Your hurdle settings",
      figure: { kind: "value", text: `${percentText(evidence.settings.required_return)}%` }, citations: [], from: [],
    },
    {
      id: "exit_multiple", label: "Today's multiple", kind: "deterministic_result",
      basis: "(P × S0 − N) ÷ F0 at the Call date", figure: multiple, citations: [],
      from: ["share_price", "shares_outstanding", "net_cash", "free_cash_flow"],
    },
    {
      id: "anchored_exit_multiple", label: "Exit multiple (X), anchored", kind: "agent_assumption",
      basis: anchor?.kind === "anchored" ? anchor.basis : ANCHOR_RULE,
      figure: anchor === null ? notComputedFigure(causes[0]!)
        : anchor.kind === "anchored" ? { kind: "value", text: `${multipleText(anchor.value)}x` }
        : { kind: "outcome", outcome: "unanchored", reason_code: null, text: `Not anchored: ${lowerFirst(anchor.text)}` },
      citations: anchor?.kind === "anchored" ? anchor.citations : [],
      from: ["exit_multiple", "required_return"],
    },
    {
      id: "share_change", label: "Annual share change (d)", kind: "agent_assumption",
      basis: "judgment: last fiscal year's stock-based compensation ÷ market cap at the Call date, used as the future rate", figure: shareChange, citations: [],
      from: ["stock_based_compensation", "share_price", "shares_outstanding"],
    },
    {
      id: "bear_case", label: "Bear case", kind: "agent_assumption",
      basis: "None is assumed: rule 1 needs an anchored bear case before a bear value per share, a hurdle price or a stance is stated",
      figure: { kind: "outcome", outcome: "unanchored", reason_code: null, text: "Not anchored" }, citations: [], from: [],
    },
  ];
  const requires: CallRow[] = [
    {
      id: "required_growth", label: "Required growth at today's multiple", kind: "deterministic_result",
      basis: "The annual growth of free cash flow per share at which five years of discounted cash flow, the exit at today's multiple and net cash per share equal the price",
      figure: growth, citations: [], from: MODEL_INPUTS,
    },
    {
      id: "required_growth_anchored", label: "Required growth at the anchored exit multiple", kind: "deterministic_result",
      basis: "The annual growth of free cash flow per share at which five years of discounted cash flow, the exit at the anchored exit multiple and net cash per share equal the price",
      figure: anchor === null ? notComputedFigure(causes[0]!)
        : anchor.kind === "anchored" ? growthAt(anchor.value)
        : { kind: "outcome", outcome: "unanchored", reason_code: null, text: "Not computed: the exit multiple is not anchored." },
      citations: [], from: ANCHORED_MODEL_INPUTS,
    },
    consensus(evidence),
  ];
  return {
    version: CALL_VERSION,
    call_date: evidence.call_date,
    subject: evidence.subject,
    settings: evidence.settings,
    inputs: evidence.inputs,
    facts,
    assumptions,
    requires,
    stance: anchor === null
      ? { kind: "declined", rule: 0, text: "Declined under rule 0: an input has no certified value, so no stance is stated.", reasons: causes.map(reason) }
      : anchor.kind === "anchored"
        ? {
          kind: "declined",
          rule: 1,
          text: "Declined under rule 1: the exit multiple is anchored, but the bear case is not, so no stance is stated.",
          reasons: [{ cites: "bear_case", text: BEAR_CASE_REASON }],
        }
        : {
          kind: "declined",
          rule: 1,
          text: "Declined under rule 1: neither the exit multiple nor the bear case is anchored, so no stance is stated.",
          reasons: [{ cites: "anchored_exit_multiple", text: anchor.text }, { cites: "bear_case", text: BEAR_CASE_REASON }],
        },
  };
}

type Outcome = Extract<CallFigure, { kind: "outcome" }>;
// An input outcome that declines the Call under rule 0, by the row it is about.
type Cause = Readonly<{ cites: CallRowId; label: string; figure: Outcome }>;

const reason = (cause: Cause): CallReason => ({ cites: cause.cites, text: `${cause.label}: ${cause.figure.text}` });

const notComputedFigure = (cause: Cause): CallFigure => ({ ...cause.figure, text: `Not computed. ${reason(cause).text}` });

type ModelFigures = Readonly<{
  multiple: CallFigure;
  shareChange: CallFigure;
  growth: CallFigure;
  /** Today's multiple, when it is positive. */
  today: ExactRational | null;
  /** The growth the price requires at another exit multiple. */
  growthAt: (exitMultiple: ExactRational) => CallFigure;
}>;

/**
 * Today's multiple, the share change and the growth the price requires, from
 * the model. An input outcome the model finds (a stale filing or price, a
 * non-positive free cash flow) or a market cap the engine did not certify
 * joins `causes`; with any cause, each figure names the first.
 */
function modelFigures(evidence: CallEvidence, causes: Cause[]): ModelFigures {
  if (causes.length === 0) {
    const value = (id: CallFactId) => rational((evidence.figures[id] as Extract<CallEngineFigure, { kind: "value" }>).value);
    const currency = (id: CallFactId) => (evidence.figures[id] as Extract<CallEngineFigure, { kind: "value" }>).currency ?? "";
    const inputs: ValuationInputs = {
      call_date: evidence.call_date,
      listing_timezone: evidence.listing_timezone,
      free_cash_flow: value("free_cash_flow"),
      period_end: evidence.fiscal_year_end!,
      shares: value("shares_outstanding"),
      net_cash: value("net_cash"),
      price: value("share_price"),
      price_date: evidence.price_date!,
      currency: { reporting: currency("free_cash_flow"), price: currency("share_price") },
      required_return: rational(evidence.settings.required_return),
    };
    const today = todaysMultiple(inputs);
    const about = today.kind === "outcome" && today.outcome === "incompatible_currency" && currency("free_cash_flow") !== "USD"
      ? "free_cash_flow"
      : today.kind === "outcome" ? INPUT_OUTCOME_ROWS[today.outcome] : undefined;
    if (about !== undefined) causes.push({ cites: about, label: FACTS.find((fact) => fact.id === about)!.label, figure: outcomeFigure(today as ValuationOutcomeResult) });
    const cap = evidence.figures.market_cap;
    if (causes.length === 0 && cap.kind === "gap") causes.push({ cites: "share_change", label: "Market cap", figure: gapFigure(cap) });
    if (causes.length === 0 && cap.kind === "value") {
      const d = divideRationals(value("stock_based_compensation"), rational(cap.value));
      const shareChange: CallFigure = d === null ? outcomeFigure(VALUATION_RESULT("numeric_limit_exceeded")) : { kind: "value", text: `${percent(d, 3)}% a year` };
      const growthAt = (exitMultiple: ExactRational) => d === null ? shareChange : solved(requiredGrowth(inputs, { share_change: d, exit_multiple: exitMultiple }));
      if (today.kind === "outcome") return { multiple: outcomeFigure(today), shareChange, growth: outcomeFigure(today), today: null, growthAt };
      if (d !== null && compareRationals(d, MINUS_ONE) <= 0) {
        causes.push({ cites: "share_change", label: "Annual share change (d)", figure: outcomeFigure(VALUATION_RESULT("share_change_out_of_range")) });
        const notComputed = notComputedFigure(causes[0]!);
        return { multiple: { kind: "value", text: today.text }, shareChange: causes[0]!.figure, growth: notComputed, today: null, growthAt: () => notComputed };
      }
      return { multiple: { kind: "value", text: today.text }, shareChange, growth: growthAt(today.value), today: today.value, growthAt };
    }
  }
  const notComputed = notComputedFigure(causes[0]!);
  return { multiple: notComputed, shareChange: notComputed, growth: notComputed, today: null, growthAt: () => notComputed };
}

type Anchor =
  | Readonly<{ kind: "anchored"; value: ExactRational; basis: string; citations: ReadonlyArray<CallCitation> }>
  | Readonly<{ kind: "unanchored"; text: string }>;

type YearMultiple = Readonly<{ fiscal_year: number; multiple: ExactRational; citation: CallCitation }>;

const FOUR_PERCENT = rational("0.04");
const MAX_CLOSE_SESSIONS = 5;

/**
 * The anchored exit multiple (operator decision on #605): the lowest of
 * today's multiple, the median of the last ten fiscal years' EV/FCF and the
 * cap at which the implied perpetual growth (X·r − 1) / (X + 1) is 4%. Each
 * year's EV is its last captured close on or before its fiscal year end times
 * its diluted shares restated to the closes' split basis, less its net cash.
 * A year without a multiple, a capex tag blocking its free cash flow
 * included, leaves the exit multiple unanchored. The closes are dev only, so
 * an anchored multiple is an agent assumption and never certified.
 */
function anchorExitMultiple(evidence: CallEvidence, today: ExactRational | null): Anchor {
  const unanchored = (text: string): Anchor => ({ kind: "unanchored", text });
  if (today === null) return unanchored("There is no positive multiple today.");
  const { closes, splits } = evidence;
  if (closes === null) return unanchored("No closes are captured for the listing by the Call's cutoff.");
  if (splits === null) return unanchored("The listing's split history is unknown, so no share count can be put on the closes' split basis.");
  // The engine states each count on the Call date's split basis; the closes are on their capture day's.
  const basis = splits
    .filter((split) => split.execution_date > closes.captured_on && split.execution_date <= evidence.call_date)
    .reduce((factor, split) => multiplyRationals(factor, divideRationals(rational(split.split_to), rational(split.split_from))!)!, ONE);
  const years = evidence.history.map((year) => yearMultiple(year, closes, basis, evidence.listing_timezone));
  const multiples = years.filter((year): year is YearMultiple => "multiple" in year);
  if (multiples.length < ANCHOR_FISCAL_YEARS) {
    const gaps = years.flatMap((year) => "text" in year ? [` FY${year.fiscal_year}: ${year.text}.`] : []);
    return unanchored(`Only ${multiples.length} of the last ${ANCHOR_FISCAL_YEARS} fiscal years have an EV/FCF multiple.${gaps.join("")}`);
  }
  const sorted = multiples.map((year) => year.multiple).sort(compareRationals);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[middle]! : divideRationals(addRationals(sorted[middle - 1]!, sorted[middle]!)!, rational("2"))!;
  // gT <= 4% exactly when X·(r − 4%) <= 1 + 4%; at r <= 4% no positive X implies more, so nothing caps it.
  const r = rational(evidence.settings.required_return);
  const cap = compareRationals(r, FOUR_PERCENT) > 0 ? divideRationals(addRationals(ONE, FOUR_PERCENT)!, subtractRationals(r, FOUR_PERCENT)!) : null;
  const value = [today, median, ...(cap === null ? [] : [cap])].reduce((low, candidate) => compareRationals(candidate, low) < 0 ? candidate : low);
  const span = `FY${multiples.at(-1)!.fiscal_year} to FY${multiples[0]!.fiscal_year}`;
  const rate = `your ${percentText(evidence.settings.required_return)}% required return`;
  const capped = cap === null
    ? `, with no cap: at ${rate} no multiple implies perpetual growth above 4%`
    : ` and ${multipleText(cap)}x, the multiple whose implied perpetual growth at ${rate} is 4%`;
  return {
    kind: "anchored",
    value,
    basis: `anchored: the lowest of today's multiple ${multipleText(today)}x, the ${span} median EV/FCF ${multipleText(median)}x (range ${multipleText(sorted[0]!)}x to ${multipleText(sorted.at(-1)!)}x)${capped}. `
      + "Each year's EV is its last close on or before its fiscal year end times its diluted weighted-average shares on the closes' split basis, less its net cash.",
    citations: [
      ...multiples.map((year) => year.citation).reverse(),
      { source_id: closes.source_id, accession: null, period_end: null, date: closes.captured_on, text: `yfinance split-adjusted daily closes, captured ${closes.captured_on}; dev only, never certified` },
    ],
  };
}

// One fiscal year's EV/FCF, (close × shares − net cash) ÷ free cash flow, or why it has none.
function yearMultiple(year: CallHistoryYear, closes: CallCloses, basis: ExactRational, timeZone: string): YearMultiple | Readonly<{ fiscal_year: number; text: string }> {
  const missing = (text: string) => ({ fiscal_year: year.fiscal_year, text });
  const uncertified = (label: string, gap: Extract<CallEngineFigure, { kind: "gap" }>) => missing(`${label} not certified (${gap.disposition}, ${gap.reason_code})`);
  const { free_cash_flow: cash, net_cash: net, shares: count } = year.figures;
  if (cash.kind === "gap") return uncertified("free cash flow", cash);
  if (net.kind === "gap") return uncertified("net cash", net);
  if (count.kind === "gap") return uncertified("diluted shares", count);
  if (cash.currency !== "USD" || net.currency !== "USD" || closes.currency !== "USD") return missing("not in USD");
  const end = year.period_end!;
  if (year.citations.net_cash.some((citation) => citation.period_end !== end)) return missing(`net cash is not at its fiscal year end, ${end}`);
  if (year.citations.shares.some((citation) => citation.period_end !== end)) return missing(`diluted shares are not for the fiscal year that ends ${end}`);
  const flow = rational(cash.value);
  if (rationalSign(flow) <= 0) return missing("free cash flow is not positive");
  const close = closes.closes.findLast((entry) => entry.trade_date <= end);
  if (close === undefined || sessionsAfter(close.trade_date, end, timeZone) > MAX_CLOSE_SESSIONS) return missing(`no captured close in the ${MAX_CLOSE_SESSIONS} trading days to ${end}`);
  const price = rational(close.close_text);
  const restated = divideRationals(rational(count.value), basis)!;
  const enterprise = subtractRationals(multiplyRationals(price, restated)!, rational(net.value));
  if (enterprise !== null && rationalSign(enterprise) <= 0) return missing("net cash is at least the market cap");
  const multiple = enterprise === null ? null : divideRationals(enterprise, flow);
  if (multiple === null) return missing(VALUATION_OUTCOMES.numeric_limit_exceeded.text);
  const amount = (text: DecimalString) => `USD ${fixed(decimal(text)!, Math.max(decimal(text)!.scale, 0))}`;
  return {
    fiscal_year: year.fiscal_year,
    multiple,
    citation: {
      ...year.citations.free_cash_flow[0]!,
      text: `FY${year.fiscal_year}: ${multipleText(multiple)}x, (close ${fixed(roundRational(price, 2), 2)} on ${close.trade_date} × ${fixed(roundRational(restated, 0), 0)} shares − net cash ${amount(net.value)}) ÷ free cash flow ${amount(cash.value)}`,
    },
  };
}

const multipleText = (value: ExactRational) => fixed(roundRational(value, 2), 2);
const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

// Each fact's figure, with net cash from another filing or balance-sheet date than free cash flow's 10-K as incompatible_period (ADR 0006).
function factFigures(evidence: CallEvidence): Record<CallFactId | "market_cap", CallFigure> {
  const figures = Object.fromEntries(Object.entries(evidence.figures).map(([id, figure]) => [id, figure.kind === "gap" ? gapFigure(figure) : { kind: "value", text: valueText(id as CallFactId, figure) }])) as Record<CallFactId | "market_cap", CallFigure>;
  const tenKs = new Set(evidence.citations.free_cash_flow.map((citation) => citation.source_id));
  const sameFiling = evidence.citations.net_cash.every((citation) => tenKs.has(citation.source_id) && citation.period_end === evidence.fiscal_year_end);
  if (evidence.figures.free_cash_flow.kind === "value" && evidence.figures.net_cash.kind === "value" && !sameFiling) {
    figures.net_cash = { kind: "outcome", outcome: "incompatible_period", reason_code: "incompatible_period", text: "Not from free cash flow's 10-K and balance-sheet date" };
  }
  return figures;
}

function valueText(id: CallFactId, figure: Extract<CallEngineFigure, { kind: "value" }>): string {
  const exact = decimal(figure.value)!;
  const number = fixed(exact, Math.max(exact.scale, 0));
  if (id === "shares_outstanding") return `${number} shares`;
  const amount = `${figure.currency ?? ""} ${number}`.trim();
  return id === "share_price" ? `${amount} per share` : amount;
}

function gapFigure(figure: Extract<CallEngineFigure, { kind: "gap" }>): Outcome {
  return { kind: "outcome", outcome: figure.disposition, reason_code: figure.reason_code, text: `Not certified: ${figure.disposition} (${figure.reason_code})` };
}

function outcomeFigure(result: ValuationOutcomeResult): Outcome {
  return { kind: "outcome", outcome: result.outcome, reason_code: result.reason_code, text: result.text };
}

function solved(result: ReturnType<typeof requiredGrowth>): CallFigure {
  return result.kind === "value" ? { kind: "value", text: `${result.text} a year` } : outcomeFigure(result);
}

const VALUATION_RESULT = (outcome: ValuationOutcome): ValuationOutcomeResult => ({ kind: "outcome", outcome, ...VALUATION_OUTCOMES[outcome] });

function consensus(evidence: CallEvidence): CallRow {
  const row = consensusRow(evidence.consensus, evidence.call_date);
  const base = {
    id: "consensus" as const,
    label: "Attributed consensus: Finviz EPS growth, next 5 years",
    kind: "attributed_consensus" as const,
    from: [],
  };
  if (row.kind === "outcome") return { ...base, basis: "Finviz consensus as captured; none on or within 7 days before the Call date", figure: outcomeFigure(row), citations: [] };
  const capture = evidence.consensus.find((entry) => entry.captured_on === row.capture.captured_on && entry.eps_growth_next_5y === row.capture.eps_growth_next_5y)!;
  return {
    ...base,
    basis: `Finviz eps_growth_next_5y, captured ${capture.captured_on}. It is EPS growth, not free cash flow growth, shown beside the result and never an input`,
    figure: { kind: "value", text: `${capture.eps_growth_next_5y}%` },
    citations: [{ source_id: capture.source_id, accession: null, period_end: null, date: capture.captured_on, text: `Captured ${capture.captured_on}` }],
  };
}

function decimal(text: string): ExactDecimal | null {
  const parsed = parseFinancialDecimal(text);
  return parsed.ok ? parsed.value : null;
}

function rational(text: DecimalString): ExactRational {
  return rationalFromDecimal(decimal(text)!)!;
}

const MINUS_ONE = rationalFromDecimal({ coefficient: -1n, scale: 0 })!;
const HUNDRED = rationalFromDecimal({ coefficient: 100n, scale: 0 })!;

function percent(value: ExactRational, places: number): string {
  return fixed(roundRational(multiplyRationals(value, HUNDRED)!, places), places);
}

function percentText(text: DecimalString): string {
  return canonicalDecimalString(roundRational(multiplyRationals(rational(text), HUNDRED)!, 6));
}
