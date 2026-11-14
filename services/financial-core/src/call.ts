// The Call (ADR 0005, ADR 0006, #604): the agent's opinion on a stock,
// assembled from inputs an engine run certified, the owner's hurdle settings
// and the valuation model. Facts, assumptions and what the price requires
// each carry their kind and basis; the stance cites the rows it rests on.
//
// Until an exit multiple can be anchored (#605), ADR 0005's rule 1 matches
// every Call that rule 0 does not, so the stance has only its declined
// variant, and nothing here computes a hurdle price, a stability move or a
// scenario. The Call reads facts by identity and never feeds the fact layer.

import type { DecimalString, GapDisposition, IsoDate, LocalId, ReasonCode, Sha256Hex, UUID } from "./contracts.ts";
import { balanceComponents } from "./definitions.ts";
import { canonicalDecimalString, parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";
import { fixed } from "./value-text.ts";
import { compareRationals, divideRationals, multiplyRationals, rationalFromDecimal, rationalSign, roundRational, type ExactRational } from "./rational.ts";
import {
  consensusRow,
  requiredGrowth,
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

const LATEST_YEAR = Object.freeze({ kind: "latest", period_type: "annual", offset: 0 });

/**
 * The engine plan's nodes for one subject's Call inputs: FY free cash flow,
 * net cash from the latest 10-K's balance sheet, last fiscal year's
 * stock-based compensation, and the share count and price a market cap reads
 * (valuation-plan.ts's market cap nodes). The seal regenerates a Call only
 * from a run whose plan has exactly these.
 */
export function callInputOperations(slot: LocalId): ReadonlyArray<Readonly<Record<string, unknown> & { node_id: LocalId }>> {
  const read = (metric: string, period: object = LATEST_YEAR) => ({ node_id: metric, operation: "reported_metric", subject_slot: slot, metric_key: metric, period });
  const balances = balanceComponents("net_cash").map((component) => component.metric_key);
  return [
    read("operating_cash_flow"),
    read("capex"),
    { node_id: "free_cash_flow", operation: "free_cash_flow", operating_cash_flow: "operating_cash_flow", capex: "capex" },
    ...balances.map((metric) => read(metric)),
    { node_id: "net_cash", operation: "net_cash", ...Object.fromEntries(balances.map((metric) => [metric, metric])) },
    read("stock_based_compensation"),
    { node_id: "market_cap_px", operation: "reported_metric", subject_slot: slot, metric_key: "share_price", period: { kind: "at_cutoff" } },
    { node_id: "market_cap_shares", operation: "reported_metric", subject_slot: slot, metric_key: "shares_outstanding", period: { kind: "latest", period_type: "quarterly", offset: 0 } },
    { node_id: "market_cap", operation: "market_cap", price: "market_cap_px", shares: "market_cap_shares" },
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
export type CallRowId = CallFactId | "required_return" | "exit_multiple" | "share_change" | "required_growth" | "consensus";

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

/** Only the declined variant exists until #605 makes a stated stance reachable. */
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
  const { multiple, shareChange, growth } = modelFigures(evidence, causes);
  const assumptions: CallRow[] = [
    {
      id: "required_return", label: "Required return (r)", kind: "owner_policy", basis: "Your hurdle settings",
      figure: { kind: "value", text: `${percentText(evidence.settings.required_return)}%` }, citations: [], from: [],
    },
    {
      id: "exit_multiple", label: "Exit multiple (X): today's multiple", kind: "deterministic_result",
      basis: "(P × S0 − N) ÷ F0 at the Call date; no anchored exit multiple exists yet", figure: multiple, citations: [],
      from: ["share_price", "shares_outstanding", "net_cash", "free_cash_flow"],
    },
    {
      id: "share_change", label: "Annual share change (d)", kind: "agent_assumption",
      basis: "judgment: last fiscal year's stock-based compensation ÷ market cap at the Call date, used as the future rate", figure: shareChange, citations: [],
      from: ["stock_based_compensation", "share_price", "shares_outstanding"],
    },
  ];
  const requires: CallRow[] = [
    {
      id: "required_growth", label: "Required growth at today's multiple", kind: "deterministic_result",
      basis: "The annual growth of free cash flow per share at which five years of discounted cash flow, the exit at today's multiple and net cash per share equal the price",
      figure: growth, citations: [], from: MODEL_INPUTS,
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
    stance: causes.length > 0
      ? { kind: "declined", rule: 0, text: "Declined under rule 0: an input has no certified value, so no stance is stated.", reasons: causes.map(reason) }
      : {
        kind: "declined",
        rule: 1,
        text: "Declined under rule 1: the exit multiple has no anchor, so no stance is stated.",
        reasons: [{
          cites: "exit_multiple",
          text: "Today's multiple is the only exit multiple on file. Anchoring another needs about ten years of the company's own multiple history, which is not captured yet.",
        }],
      },
  };
}

type Outcome = Extract<CallFigure, { kind: "outcome" }>;
// An input outcome that declines the Call under rule 0, by the row it is about.
type Cause = Readonly<{ cites: CallRowId; label: string; figure: Outcome }>;

const reason = (cause: Cause): CallReason => ({ cites: cause.cites, text: `${cause.label}: ${cause.figure.text}` });

/**
 * Today's multiple, the share change and the growth the price requires, from
 * the model. An input outcome the model finds (a stale filing or price, a
 * non-positive free cash flow) or a market cap the engine did not certify
 * joins `causes`; with any cause, each figure names the first.
 */
function modelFigures(evidence: CallEvidence, causes: Cause[]): Readonly<{ multiple: CallFigure; shareChange: CallFigure; growth: CallFigure }> {
  if (causes.length === 0) {
    const value = (id: CallFactId) => rational((evidence.figures[id] as Extract<CallEngineFigure, { kind: "value" }>).value);
    const currency = (id: CallFactId) => (evidence.figures[id] as Extract<CallEngineFigure, { kind: "value" }>).currency ?? "";
    const inputs: ValuationInputs = {
      call_date: evidence.call_date,
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
      if (today.kind === "outcome") return { multiple: outcomeFigure(today), shareChange, growth: outcomeFigure(today) };
      if (d !== null && compareRationals(d, MINUS_ONE) <= 0) {
        causes.push({ cites: "share_change", label: "Annual share change (d)", figure: outcomeFigure(VALUATION_RESULT("share_change_out_of_range")) });
        return { multiple: { kind: "value", text: today.text }, shareChange: causes[0]!.figure, growth: { ...causes[0]!.figure, text: `Not computed. ${reason(causes[0]!).text}` } };
      }
      return { multiple: { kind: "value", text: today.text }, shareChange, growth: d === null ? shareChange : solved(requiredGrowth(inputs, { share_change: d, exit_multiple: today.value })) };
    }
  }
  const notComputed: CallFigure = { ...causes[0]!.figure, text: `Not computed. ${reason(causes[0]!).text}` };
  return { multiple: notComputed, shareChange: notComputed, growth: notComputed };
}

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
