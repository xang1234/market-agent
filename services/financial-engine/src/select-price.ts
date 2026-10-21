// Deterministic selection of a share price for one slot at the plan's
// knowledge cutoff (#444). Pure: the observations arrive already read, public
// only; nothing here reads the clock or the database.
//
// 1. Each source's latest observations of the listing known by the cutoff.
//    None is missing_input, or publication_time_unknown when one traded by
//    then has no known time. Only those from a source class the run was
//    granted are evidence, filtered before the newest is picked, so a newer
//    price from another source never hides an allowed one; when none is
//    allowed, the gap is source_class_not_allowed. Of the allowed, the newest
//    trade time, and among its observations the latest known.
// 2. Their tokens must be exact decimals within the numeric policy and agree;
//    equal values tie-break by observation id, differing ones conflict.
// 3. A price from before the last regular session the cutoff has closed is
//    stale (lastRegularSessionDate).
// 4. A price is on the split basis of its trade date in the listing's zone. It
//    binds restated to the reference date from the listing's split history,
//    which must have been fetched on or after that date.

import {
  canonicalDecimalString,
  compareRationals,
  localDateOf,
  parseFinancialDecimal,
  rationalFromDecimal,
  restateToReference,
  splitHistoryCovers,
  splitReferenceDate,
  type DecimalString,
  type ExactRational,
  type ReasonCode,
  type SplitAdjustmentV2,
} from "../../financial-core/src/index.ts";
import { lastRegularSessionDate } from "../../market/src/ytd-window.ts";
import type { PriceObservation, PriceObservationPage, SplitHistory } from "./ports.ts";
import { sourceAllowed, type SelectionPolicy } from "./select-inputs.ts";

export const PRICE_SELECTION_POLICY_VERSION = "price-at-cutoff-selection.v2";

export type PriceSelection =
  | Readonly<{ status: "selected"; observation: PriceObservation; value: DecimalString; split_adjustment: SplitAdjustmentV2 }>
  | Readonly<{ status: "gap"; reason_code: ReasonCode }>;

export function selectPrice(
  page: Extract<PriceObservationPage, { status: "ok" }>,
  history: Extract<SplitHistory, { status: "ok" }>,
  policy: Pick<SelectionPolicy, "knowledge_cutoff" | "allowed_source_classes">,
): PriceSelection {
  if (page.latest_by_source.length === 0) return gap(page.unknown_publication ? "publication_time_unknown" : "missing_input");
  const allowed = page.latest_by_source.filter((observation) => sourceAllowed(observation.source_class, policy));
  if (allowed.length === 0) return gap("source_class_not_allowed");
  const newest = allowed.reduce((best, observation) => (laterObservation(observation, best) ? observation : best));
  const latest = allowed.filter((observation) => !laterObservation(newest, observation));
  const priced: Array<{ observation: PriceObservation; value: ExactRational; text: DecimalString }> = [];
  for (const observation of latest) {
    const parsed = parseFinancialDecimal(observation.price_text);
    const value = parsed.ok ? rationalFromDecimal(parsed.value) : null;
    if (!parsed.ok || value === null) return gap("precision_unverified");
    priced.push({ observation, value, text: canonicalDecimalString(parsed.value) });
  }
  if (priced.some((entry) => compareRationals(entry.value, priced[0]!.value) !== 0)) return gap("conflicting_evidence");
  const chosen = priced.sort((left, right) => left.observation.observation_id.localeCompare(right.observation.observation_id))[0]!;

  const zone = history.timezone;
  const tradeDate = localDateOf(Date.parse(chosen.observation.observed_at), zone);
  if (tradeDate < lastRegularSessionDate(policy.knowledge_cutoff, zone)) return gap("stale_input");
  const referenceDate = splitReferenceDate(policy.knowledge_cutoff, zone);
  if (!splitHistoryCovers(history.checked_at, referenceDate, zone)) return gap("split_history_stale");
  const restated = restateToReference({
    native: chosen.value,
    value_kind: "price",
    as_filed_on: tradeDate,
    reference_date: referenceDate,
    listing_id: history.listing_id,
    listing_timezone: zone,
    splits: history.splits,
  });
  if (!restated.ok) return gap(restated.reason);
  return { status: "selected", observation: chosen.observation, value: chosen.text, split_adjustment: restated.adjustment };
}

/** Whether `left` traded later than `right`, or at the same time and was known later. */
function laterObservation(left: PriceObservation, right: PriceObservation): boolean {
  const traded = Date.parse(left.observed_at) - Date.parse(right.observed_at);
  return traded > 0 || (traded === 0 && Date.parse(left.known_at) > Date.parse(right.known_at));
}

function gap(reason_code: ReasonCode): PriceSelection {
  return { status: "gap", reason_code };
}
