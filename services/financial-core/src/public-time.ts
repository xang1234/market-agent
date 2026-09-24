// Public-information timing. A source version is eligible at a cutoff only
// when the conservative upper bound of its demonstrated public availability is
// no later than the cutoff. Date-only publication spans the whole source-local
// day; an intraday cutoff never assumes midnight availability. An unknown or
// invalid source time zone cannot manufacture a publication time. Freshness is
// measured to the cutoff, never to execution time. No wall-clock access.

import type { IsoDate, IsoDateTime } from "./contracts.ts";
import { dayNumber } from "./periods.ts";

export type PublicationTiming = {
  available_not_before: string | null;
  available_no_later_than: string;
  timing_precision: "instant" | "date" | "observed_public";
  source_timezone: string;
};

const MINUTE_MS = 60_000;

/** The last millisecond of `date` in `timeZone`, as a UTC ISO timestamp. */
export function endOfLocalDay(date: IsoDate, timeZone: string): IsoDateTime {
  const [year, month, day] = date.split("-").map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!, 23, 59, 59, 999);
  // The zone offset at the answer may differ from the offset at the guess
  // across a DST transition; one correction step settles it.
  let instant = wallClock - offsetMs(wallClock, timeZone);
  instant = wallClock - offsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

export function conservativeAvailability(proof: PublicationTiming): { known: true; upper_bound: IsoDateTime } | { known: false } {
  const stated = Date.parse(proof.available_no_later_than);
  if (!isKnownTimeZone(proof.source_timezone) || Number.isNaN(stated)) return { known: false };
  if (proof.timing_precision !== "date") return { known: true, upper_bound: new Date(stated).toISOString() };
  const localDate = localDateOf(stated, proof.source_timezone);
  const endOfDay = Date.parse(endOfLocalDay(localDate, proof.source_timezone));
  return { known: true, upper_bound: new Date(Math.max(stated, endOfDay)).toISOString() };
}

export function publicAtCutoff(proof: PublicationTiming, cutoff: IsoDateTime): "eligible" | "not_yet_public" | "publication_time_unknown" {
  const availability = conservativeAvailability(proof);
  const cutoffMs = Date.parse(cutoff);
  if (!availability.known || Number.isNaN(cutoffMs)) return "publication_time_unknown";
  return Date.parse(availability.upper_bound) <= cutoffMs ? "eligible" : "not_yet_public";
}

/** Whole days from the period end to the cutoff's UTC date, compared with the saved maximum age. */
export function freshnessAt(periodEnd: IsoDate, cutoff: IsoDateTime, maxAgeDays: number | null): "fresh" | "stale" {
  if (maxAgeDays === null) return "fresh";
  const cutoffDate = new Date(Date.parse(cutoff)).toISOString().slice(0, 10);
  return dayNumber(cutoffDate) - dayNumber(periodEnd) <= maxAgeDays ? "fresh" : "stale";
}

function localDateOf(instant: number, timeZone: string): IsoDate {
  const local = new Date(instant + offsetMs(instant, timeZone));
  return local.toISOString().slice(0, 10);
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (local = UTC + offset). */
function offsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const wholeSecondInstant = instant - (((instant % 1000) + 1000) % 1000);
  return Math.round((localAsUtc - wholeSecondInstant) / MINUTE_MS) * MINUTE_MS;
}

function isKnownTimeZone(zone: string): boolean {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
