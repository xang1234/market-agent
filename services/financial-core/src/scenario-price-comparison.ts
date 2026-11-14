// A sealed P/E scenario set against one stored closing price (#224). The
// scenario values are the earlier answer's certified results, held fixed: the
// scenario is never planned again. The price is a stored observation, so the
// comparison is source-linked, never a verified calculation; the #201
// certificate still covers only EPS × P/E.
//
// Everything a comparison shows or declines with is decided here, from records
// its caller loaded: the time a request means, which stored close is eligible,
// whether its session completed, whether price and scenarios share a currency
// and share basis, the formula, and every displayed string. Chat generates a
// comparison with this function and the seal generates it again from the same
// records, so the two can only agree.
//
// ponytail: a session's regular close comes from the caller's convention
// (market's US regular session); another exchange's listing is a named gap.

import type { DecimalString, IsoDate, IsoDateTime, Scenario, Sha256Hex, UUID } from "./contracts.ts";
import { SCENARIOS } from "./contracts.ts";
import { canonicalDecimalString, parseDerivedDecimalText, parseFinancialDecimal, subtractExactDecimals, type ExactDecimal } from "./exact-decimal.ts";
import { sourceClassOf, type SourceClass } from "./evidence-vocabulary.ts";
import { NUMERIC_POLICY } from "./numeric-policy.ts";
import { fixed } from "./value-text.ts";
import { conservativeAvailability, localDateOf, startOfLocalDay, type PublicationTiming } from "./public-time.ts";
import { divideRationals, rationalFromDecimal, rationalSign, rationalToValue, roundRational, type ExactRational } from "./rational.ts";
import { restateToReference, splitHistoryCovers, type RecordedSplit } from "./split-adjustment.ts";

export const SCENARIO_PRICE_COMPARISON_VERSION = "scenario-price-comparison.v1";
export const SCENARIO_CLOSE_SELECTION_VERSION = "scenario-close-selection.v1";

/** What every comparison says about itself. */
export const COMPARISON_NOTE =
  "Each scenario value set against one stored closing price as (scenario ÷ price) − 1. Conditional on the P/E you supplied; not a price target, forecast or recommendation.";

/** Every reason a comparison is not shown, and what the answer says instead. */
export const COMPARISON_GAPS = {
  scenario_unavailable: "The earlier answer has no verified bear, base and bull values whose evidence is still available, so nothing was compared.",
  requested_time_after_question: "The time asked for is after this question was asked, so no stored price can be from then.",
  scenario_not_public_at_cutoff: "The diluted EPS these scenarios use is not shown to have been public by the time asked for, so they are not set against a price from then.",
  price_coverage_missing: "No stored completed closing price is known at or before the time asked for.",
  publication_time_unknown: "A stored closing price from by then has no proof it was public by the time asked for, so it is not used.",
  conflicting_evidence: "Stored closing prices for the latest session disagree, so none is used.",
  session_incomplete: "The latest stored price is not stamped at its session's regular close, so it is not a completed close.",
  session_policy_unsupported: "This listing's exchange has no supported regular session close, so no closing price is used.",
  incompatible_currency: "The stored price and the scenario values are in different currencies; nothing is converted.",
  incompatible_basis: "The stored price and the scenario values are not shown to be on the same share basis.",
  split_history_missing: "The listing has no stored split history, so the price and the scenario values are not shown to be on the same share basis.",
  split_history_stale: "The listing's split history was last checked before the dates compared, so the share basis is not shown to match.",
  zero_denominator: "The stored price is zero, so nothing can be set against it.",
  non_positive_denominator: "The stored price is negative, so nothing is set against it.",
  price_timestamp_missing: "The stored price has no trade time.",
  price_timestamp_invalid: "The stored price's trade time is not a valid time.",
  precision_unverified: "The stored price is not an exact decimal.",
  source_class_not_allowed: "No stored closing price by then is from a source this answer's evidence may come from, so none is used.",
} as const;

export type ComparisonGap = keyof typeof COMPARISON_GAPS;

/** The time a comparison asks for: the latest close known when the question arrived, at or before an instant, or through a session date. */
export type ComparisonTime =
  | Readonly<{ kind: "latest" }>
  | Readonly<{ kind: "instant"; at: IsoDateTime }>
  | Readonly<{ kind: "session_date"; date: IsoDate }>;

/** The sealed scenario a comparison consumes: its certificate's identity, by snapshot. */
export type ScenarioRef = Readonly<{ snapshot_id: UUID; run_id: UUID; unit_id: string; presentation_hash: Sha256Hex }>;

export type SealedScenario = Readonly<{
  ref: ScenarioRef;
  /** Each certified scenario result, bear, base and bull; `value` is null for a gap. */
  rows: ReadonlyArray<Readonly<{ scenario: Scenario; result_id: UUID; multiple_text: string; value: Readonly<{ value: DecimalString; currency: string }> | null }>>;
  /** Whether the EPS the scenarios read, and its source, are still available. */
  available: boolean;
  /** When the EPS's source version is proven public, as its binding recorded it. */
  eps_publication: Pick<PublicationTiming, "available_no_later_than" | "timing_precision" | "source_timezone">;
  /** The listing and date whose split basis the EPS was restated to; null when it was bound with none. */
  eps_anchor: Readonly<{ listing_id: UUID; reference_date: IsoDate }> | null;
  /** The source classes the scenario's run may bind (sourceClassOf): a close is admitted from these alone. */
  allowed_source_classes: ReadonlyArray<SourceClass>;
}>;

/** A stored price row as read, unchecked: the database forbids some of what this checks, a synthetic or tampered row may not. */
export type StoredClose = Readonly<{
  observation_id: UUID;
  listing_id: UUID;
  source_id: UUID;
  body_sha256: Sha256Hex;
  kind: string;
  price_text: string;
  currency: string;
  observed_at: string | null;
  known_at: string | null;
  fetched_at: string;
  adjustment_basis: string;
  /** The source's `sources.kind`, which with its id decides its class. */
  source_kind: string;
  /** The source's stored name (`sources.provider`), which the comparison shows. */
  source_name: string;
}>;

export type ComparisonListing = Readonly<{
  listing_id: UUID;
  ticker: string;
  timezone: string;
  /** The instant a session of this date closes on its exchange's regular calendar; null when no convention is supported. */
  session_close_at: (date: IsoDate) => IsoDateTime | null;
}>;

/** A request's cutoff: an instant, inclusive unless it is a date's next local midnight. */
export type ComparisonWindow = Readonly<{ at: IsoDateTime; inclusive: boolean }>;

export type ComparisonInput = Readonly<{
  scenario: SealedScenario;
  requested: ComparisonTime;
  received_at: IsoDateTime;
  /** The EPS anchor's listing; null when the EPS has none. */
  listing: ComparisonListing | null;
  /** Each public source's newest close known within the window (closeReadWindow), and whether a close traded by then lacks that proof. */
  closes: Readonly<{ candidates: ReadonlyArray<StoredClose>; unknown_publication: boolean }>;
  /** The listing's stored split history; null when none was ever stored. */
  splits: Readonly<{ checked_at: IsoDateTime; splits: ReadonlyArray<RecordedSplit> }> | null;
}>;

export type DisplayedValue = Readonly<{ value: DecimalString; text: string; full_text: string }>;

export type PriceEvidence = Readonly<{
  observation_id: UUID;
  kind: "session_close";
  listing_id: UUID;
  ticker: string;
  currency: string;
  session_date: IsoDate;
  observed_at: IsoDateTime;
  known_at: IsoDateTime;
  fetched_at: IsoDateTime;
  source_id: UUID;
  source_name: string;
  body_sha256: Sha256Hex;
  adjustment_basis: "unadjusted";
  heading: string;
  price: DisplayedValue;
}>;

export type BasisEvidence = Readonly<{
  eps_reference_date: IsoDate;
  price_session_date: IsoDate;
  split_history_checked_at: IsoDateTime;
  split_factor: "1";
  text: string;
}>;

export type ComparisonRow = Readonly<{
  scenario: Scenario;
  result_id: UUID;
  multiple_text: string;
  scenario_value: DisplayedValue;
  /** scenario − price, exact. */
  difference: DisplayedValue;
  /** (scenario ÷ price) − 1 under the numeric policy; `text` is it × 100 at two places. */
  percent: DisplayedValue & Readonly<{ exact: boolean }>;
}>;

export type ComparisonOutcome =
  | Readonly<{ kind: "gap"; reason: ComparisonGap; text: string }>
  | Readonly<{ kind: "comparison"; price: PriceEvidence; basis: BasisEvidence; rows: readonly [ComparisonRow, ComparisonRow, ComparisonRow] }>;

export type ComparisonContent = Readonly<{
  version: typeof SCENARIO_PRICE_COMPARISON_VERSION;
  selection_policy_version: typeof SCENARIO_CLOSE_SELECTION_VERSION;
  numeric_policy_version: string;
  scenario: ScenarioRef;
  requested: ComparisonTime;
  received_at: IsoDateTime;
  /** Null only when the listing whose calendar dates the request is unknown. */
  cutoff: (ComparisonWindow & Readonly<{ text: string }>) | null;
  note: typeof COMPARISON_NOTE;
  outcome: ComparisonOutcome;
}>;

/**
 * The cutoff a request means for a listing. A date is the whole of it on the
 * listing's exchange calendar, up to the next local midnight (exclusive), and
 * never past the question's own arrival. "future" when the time asked for has
 * not begun by then.
 */
export function comparisonWindow(requested: ComparisonTime, receivedAt: IsoDateTime, timeZone: string): ComparisonWindow | "future" {
  const received = Date.parse(receivedAt);
  switch (requested.kind) {
    case "latest":
      return { at: receivedAt, inclusive: true };
    case "instant":
      return Date.parse(requested.at) > received ? "future" : { at: requested.at, inclusive: true };
    case "session_date": {
      if (Date.parse(startOfLocalDay(requested.date, timeZone)) > received) return "future";
      const next = startOfLocalDay(nextDate(requested.date), timeZone);
      return Date.parse(next) > received ? { at: receivedAt, inclusive: true } : { at: next, inclusive: false };
    }
  }
}

export function compareScenarioToPrice(input: ComparisonInput): ComparisonContent {
  const { scenario, listing } = input;
  const window = listing === null ? null : comparisonWindow(input.requested, input.received_at, listing.timezone);
  const content = (cutoff: ComparisonWindow | null, outcome: ComparisonOutcome): ComparisonContent => ({
    version: SCENARIO_PRICE_COMPARISON_VERSION,
    selection_policy_version: SCENARIO_CLOSE_SELECTION_VERSION,
    numeric_policy_version: NUMERIC_POLICY.version,
    scenario: scenario.ref,
    requested: input.requested,
    received_at: input.received_at,
    cutoff: cutoff === null ? null : { ...cutoff, text: cutoffText(input.requested, cutoff, listing?.timezone ?? null) },
    note: COMPARISON_NOTE,
    outcome,
  });
  const gap = (reason: ComparisonGap, cutoff: ComparisonWindow | null = window === "future" ? null : window) =>
    content(cutoff, { kind: "gap", reason, text: COMPARISON_GAPS[reason] });

  const rows = SCENARIOS.map((name) => scenario.rows.find((row) => row.scenario === name));
  if (!scenario.available || rows.some((row) => row?.value === null || row === undefined)) return gap("scenario_unavailable");
  if (listing === null || window === null || scenario.eps_anchor === null || scenario.eps_anchor.listing_id !== listing.listing_id) return gap("incompatible_basis");
  if (window === "future") return gap("requested_time_after_question");
  const published = conservativeAvailability({ available_not_before: null, ...scenario.eps_publication });
  if (!published.known || !within(published.upper_bound, window)) return gap("scenario_not_public_at_cutoff");

  // As the engine binds a price (sourceClassOf), per source: a close from a source the run may not use never hides one it may.
  const admitted = input.closes.candidates.filter((row) => {
    const sourceClass = sourceClassOf({ kind: row.source_kind, source_id: row.source_id }, "price");
    return sourceClass !== null && scenario.allowed_source_classes.includes(sourceClass);
  });
  if (admitted.length === 0 && input.closes.candidates.length > 0) return gap("source_class_not_allowed");
  const selected = selectClose({ candidates: admitted, unknown_publication: input.closes.unknown_publication });
  if (typeof selected === "string") return gap(selected);
  const close = checkedClose(selected, listing);
  if (typeof close === "string") return gap(close);
  // The reader bounds known_at already; a row it should not have returned never stands for one public then.
  if (!within(close.known_at, window)) return gap("publication_time_unknown");

  const currency = rows[0]!.value!.currency;
  if (rows.some((row) => row!.value!.currency !== currency) || close.row.currency !== currency) return gap("incompatible_currency");

  const basis = shareBasis(scenario.eps_anchor.reference_date, close.session_date, input.splits, listing);
  if (typeof basis === "string") return gap(basis);

  const compared = rows.map((row) => compareRow(row!, close, currency));
  if (compared.some((row) => row === null)) return gap("precision_unverified");
  return content(window, {
    kind: "comparison",
    price: {
      observation_id: close.row.observation_id,
      kind: "session_close",
      listing_id: listing.listing_id,
      ticker: listing.ticker,
      currency,
      session_date: close.session_date,
      observed_at: close.observed_at,
      known_at: close.known_at,
      fetched_at: close.fetched_at,
      source_id: close.row.source_id,
      source_name: close.row.source_name,
      body_sha256: close.row.body_sha256,
      adjustment_basis: "unadjusted",
      heading: `${input.requested.kind === "latest" ? "Latest stored completed close" : "Stored completed close"}: ${close.session_date}`,
      price: perShare(close.decimal, currency),
    },
    basis,
    rows: compared as unknown as readonly [ComparisonRow, ComparisonRow, ComparisonRow],
  });
}

// Whether an instant is by a window's cutoff, to the microsecond.
function within(instant: string, window: ComparisonWindow): boolean {
  const at = microsOf(instant);
  const cutoff = microsOf(window.at);
  return at !== null && cutoff !== null && (window.inclusive ? at <= cutoff : at < cutoff);
}

// An instant to the microsecond, the database's precision: Date.parse keeps
// only milliseconds. Null for no valid instant, or one finer than that.
function microsOf(instant: string): bigint | null {
  const match = /^(.+T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(instant);
  const ms = match === null ? Number.NaN : Date.parse(`${match[1]}${match[3]}`);
  return Number.isNaN(ms) ? null : BigInt(ms) * 1000n + BigInt((match![2] ?? "").padEnd(6, "0"));
}

// UTC, with milliseconds as this system writes times, and six places only for a time that has finer ones.
function isoOf(micros: bigint): IsoDateTime {
  const iso = new Date(Number(micros / 1000n)).toISOString();
  const finer = micros % 1000n;
  return finer === 0n ? iso : `${iso.slice(0, -1)}${finer.toString().padStart(3, "0")}Z`;
}

// The newest close among each source's newest; one session's closes must agree, and the lowest id decides among equals.
function selectClose(closes: ComparisonInput["closes"]): StoredClose | "price_coverage_missing" | "publication_time_unknown" | "conflicting_evidence" | "precision_unverified" {
  if (closes.candidates.length === 0) return closes.unknown_publication ? "publication_time_unknown" : "price_coverage_missing";
  // A row with no usable trade time cannot be ordered; checkedClose names its gap.
  const untimed = closes.candidates.find((row) => row.observed_at === null || microsOf(row.observed_at) === null);
  if (untimed !== undefined) return untimed;
  const traded = (row: StoredClose) => microsOf(row.observed_at!)!;
  const newest = closes.candidates.map(traded).reduce((left, right) => (left > right ? left : right));
  const latest = closes.candidates.filter((row) => traded(row) === newest);
  const values = latest.map((row) => parseFinancialDecimal(row.price_text));
  if (values.some((value) => !value.ok)) return "precision_unverified";
  const texts = new Set(values.map((value) => canonicalDecimalString((value as { ok: true; value: ExactDecimal }).value)));
  if (texts.size > 1) return "conflicting_evidence";
  return [...latest].sort((left, right) => left.observation_id.localeCompare(right.observation_id))[0]!;
}

type CheckedClose = Readonly<{ row: StoredClose; decimal: ExactDecimal; value: ExactRational; session_date: IsoDate; observed_at: IsoDateTime; known_at: IsoDateTime; fetched_at: IsoDateTime }>;

// A close is a session_close stamped at its session's regular close, with a known time and a positive exact price.
function checkedClose(row: StoredClose, listing: ComparisonListing): CheckedClose | ComparisonGap {
  if (row.listing_id !== listing.listing_id) return "incompatible_basis";
  if (row.observed_at === null || row.observed_at === "") return "price_timestamp_missing";
  const observed = microsOf(row.observed_at);
  const fetched = microsOf(row.fetched_at);
  if (observed === null || fetched === null) return "price_timestamp_invalid";
  const known = row.known_at === null ? null : microsOf(row.known_at);
  // Known before it traded: the time proves nothing.
  if (known === null || known < observed) return "publication_time_unknown";
  const sessionDate = localDateOf(Number(observed / 1000n), listing.timezone);
  const closeAt = listing.session_close_at(sessionDate);
  if (closeAt === null) return "session_policy_unsupported";
  // ponytail: weekends only; an exchange holiday is not checked, so a close stamped on one stands.
  const weekday = new Date(`${sessionDate}T00:00:00.000Z`).getUTCDay();
  if (row.kind !== "session_close" || weekday === 0 || weekday === 6 || microsOf(closeAt) !== observed) return "session_incomplete";
  if (row.adjustment_basis !== "unadjusted") return "incompatible_basis";
  const parsed = parseFinancialDecimal(row.price_text);
  const value = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  if (!parsed.ok || value === null) return "precision_unverified";
  const sign = rationalSign(value);
  if (sign === 0) return "zero_denominator";
  if (sign < 0) return "non_positive_denominator";
  return { row, decimal: parsed.value, value, session_date: sessionDate, observed_at: isoOf(observed), known_at: isoOf(known), fetched_at: isoOf(fetched) };
}

// The EPS was restated to its reference date's split basis and the price is on its session's: no split may change the basis between them.
function shareBasis(referenceDate: IsoDate, sessionDate: IsoDate, history: ComparisonInput["splits"], listing: ComparisonListing): BasisEvidence | ComparisonGap {
  if (history === null) return "split_history_missing";
  const [from, to] = referenceDate <= sessionDate ? [referenceDate, sessionDate] : [sessionDate, referenceDate];
  if (!splitHistoryCovers(history.checked_at, to, listing.timezone)) return "split_history_stale";
  const one = rationalFromDecimal({ coefficient: 1n, scale: 0 })!;
  const factor = restateToReference({
    native: one, value_kind: "price", as_filed_on: from, reference_date: to,
    listing_id: listing.listing_id, listing_timezone: listing.timezone, splits: history.splits,
  });
  if (!factor.ok || factor.adjustment.factor.numerator !== factor.adjustment.factor.denominator) return "incompatible_basis";
  const checkedAt = new Date(Date.parse(history.checked_at)).toISOString();
  return {
    eps_reference_date: referenceDate,
    price_session_date: sessionDate,
    split_history_checked_at: checkedAt,
    split_factor: "1",
    text: `Same share basis: the EPS is on the split basis of ${referenceDate} and the price on that of ${sessionDate}, and ${listing.ticker}'s split history, checked ${checkedAt.slice(0, 10)}, has no split between them.`,
  };
}

function compareRow(row: SealedScenario["rows"][number], close: CheckedClose, currency: string): ComparisonRow | null {
  const parsed = parseDerivedDecimalText(row.value!.value);
  if (!parsed.ok) return null;
  // Two finite decimals differ by a finite decimal: the stored difference is exact.
  const differenceValue = subtractExactDecimals(parsed.value, close.decimal);
  const difference = rationalFromDecimal(differenceValue);
  const ratio = difference === null ? null : divideRationals(difference, close.value);
  const ratioValue = ratio === null ? null : rationalToValue(ratio);
  if (difference === null || ratio === null || ratioValue === null) return null;
  const percent = { coefficient: ratioValue.value.coefficient, scale: ratioValue.value.scale - 2 };
  // Shown from the exact values: one already rounded to the policy's digits can round again the other way.
  const percentShown = { coefficient: roundRational(ratio, 4).coefficient, scale: 2 };
  return {
    scenario: row.scenario,
    result_id: row.result_id,
    multiple_text: row.multiple_text,
    scenario_value: perShare(parsed.value, currency),
    difference: {
      value: canonicalDecimalString(differenceValue),
      text: `${currency} ${signed(fixed(roundRational(difference, 2), 2))} per share`,
      full_text: `${currency} ${signed(canonicalDecimalString(differenceValue))} per share`,
    },
    percent: {
      value: canonicalDecimalString(ratioValue.value),
      exact: ratioValue.exact,
      text: `${signed(fixed(percentShown, 2))}%`,
      full_text: `${signed(canonicalDecimalString(percent))}%`,
    },
  };
}

function perShare(value: ExactDecimal, currency: string): DisplayedValue {
  return { value: canonicalDecimalString(value), text: `${currency} ${fixed(value, 2)} per share`, full_text: `${currency} ${canonicalDecimalString(value)} per share` };
}

// An explicit sign on what is shown: "+20.00", "-20.00", and "0.00" for a value that shows as zero.
function signed(text: string): string {
  return text.startsWith("-") || !/[1-9]/u.test(text) ? text : `+${text}`;
}

function cutoffText(requested: ComparisonTime, window: ComparisonWindow, timeZone: string | null): string {
  switch (requested.kind) {
    case "latest":
      return `The latest stored completed close known when you asked (${utcTime(window.at)})`;
    case "instant":
      return `The latest stored completed close known at or before ${utcTime(window.at)}`;
    case "session_date":
      return window.inclusive
        ? `The latest stored completed close known through ${requested.date} (${timeZone}), up to when you asked (${utcTime(window.at)})`
        : `The latest stored completed close known through the end of ${requested.date} (${timeZone})`;
  }
}

// To the minute, with seconds and milliseconds only when the time has them.
function utcTime(instant: IsoDateTime): string {
  const iso = new Date(Date.parse(instant)).toISOString();
  const shown = iso.endsWith(":00.000Z") ? iso.slice(0, 16) : iso.endsWith(".000Z") ? iso.slice(0, 19) : iso.slice(0, 23);
  return `${shown.replace("T", " ")} UTC`;
}

function nextDate(date: IsoDate): IsoDate {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
