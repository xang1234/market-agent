// Earnings-release events surface the chronology of past quarterly releases:
// when each release happened, which fiscal period it covered, and how the
// reported actual EPS compared to the consensus estimate at-release. This
// is event-shaped data, NOT a derivation: the at-release estimate is
// frozen at the moment of release, never recomputed from current consensus.
//
// `family: "earnings_events"` keeps these rows distinct from analyst
// consensus (forward-looking) and from reported statement Fact rows.

import { FISCAL_PERIODS, type FiscalPeriod } from "./statement.ts";
import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFiniteNumber,
  assertIso8601Utc,
  assertIsoDate,
  assertNonNegativeInteger,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type EarningsSurpriseDirection = "beat" | "miss" | "inline";

export type EarningsEventInput = {
  release_date: string;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  eps_actual: number | null;
  eps_estimate_at_release: number | null;
  source_id: UUID;
  as_of: string;
};

export type EarningsEvent = {
  release_date: string;
  period_end: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  eps_actual: number | null;
  eps_estimate_at_release: number | null;
  surprise_pct: number | null;
  surprise_direction: EarningsSurpriseDirection | null;
  source_id: UUID;
  as_of: string;
};

export type EarningsEventsEnvelopeInput = {
  subject: IssuerSubjectRef;
  currency: string;
  events: ReadonlyArray<EarningsEventInput>;
  as_of: string;
};

export type EarningsEventsEnvelope = {
  subject: IssuerSubjectRef;
  family: "earnings_events";
  currency: string;
  events: ReadonlyArray<EarningsEvent>;
  as_of: string;
};

export function freezeEarningsEventsEnvelope(
  input: EarningsEventsEnvelopeInput,
): EarningsEventsEnvelope {
  const subject = freezeIssuerRef(input.subject, "earningsEvents.subject");
  assertCurrency(input.currency, "earningsEvents.currency");
  assertIso8601Utc(input.as_of, "earningsEvents.as_of");
  if (!Array.isArray(input.events)) {
    throw new Error("earningsEvents.events: must be an array");
  }
  const events: EarningsEvent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.events.length; i++) {
    const event = freezeEarningsEvent(input.events[i], `earningsEvents.events[${i}]`);
    const dedupKey = `${event.fiscal_year}::${event.fiscal_period}`;
    if (seen.has(dedupKey)) {
      throw new Error(
        `earningsEvents.events[${i}]: duplicate fiscal period ${event.fiscal_year} ${event.fiscal_period}`,
      );
    }
    seen.add(dedupKey);
    events.push(event);
  }
  events.sort((a, b) => b.release_date.localeCompare(a.release_date));
  return Object.freeze({
    subject,
    family: "earnings_events",
    currency: input.currency,
    events: Object.freeze(events),
    as_of: input.as_of,
  });
}

function freezeEarningsEvent(input: EarningsEventInput, label: string): EarningsEvent {
  if (input === null || typeof input !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  assertIsoDate(input.release_date, `${label}.release_date`);
  assertIsoDate(input.period_end, `${label}.period_end`);
  assertNonNegativeInteger(input.fiscal_year, `${label}.fiscal_year`);
  assertOneOf(input.fiscal_period, FISCAL_PERIODS, `${label}.fiscal_period`);
  if (input.eps_actual !== null) {
    assertFiniteNumber(input.eps_actual, `${label}.eps_actual`);
  }
  if (input.eps_estimate_at_release !== null) {
    assertFiniteNumber(input.eps_estimate_at_release, `${label}.eps_estimate_at_release`);
  }
  assertUuid(input.source_id, `${label}.source_id`);
  assertIso8601Utc(input.as_of, `${label}.as_of`);
  const { surprise_pct, surprise_direction } = computeSurprise(
    input.eps_actual,
    input.eps_estimate_at_release,
  );
  return Object.freeze({
    release_date: input.release_date,
    period_end: input.period_end,
    fiscal_year: input.fiscal_year,
    fiscal_period: input.fiscal_period,
    eps_actual: input.eps_actual,
    eps_estimate_at_release: input.eps_estimate_at_release,
    surprise_pct,
    surprise_direction,
    source_id: input.source_id,
    as_of: input.as_of,
  });
}

function computeSurprise(
  actual: number | null,
  estimate: number | null,
): { surprise_pct: number | null; surprise_direction: EarningsSurpriseDirection | null } {
  if (actual === null || estimate === null || estimate === 0) {
    return { surprise_pct: null, surprise_direction: null };
  }
  const surprise_pct = ((actual - estimate) / Math.abs(estimate)) * 100;
  const surprise_direction: EarningsSurpriseDirection =
    actual > estimate ? "beat" : actual < estimate ? "miss" : "inline";
  return { surprise_pct, surprise_direction };
}
