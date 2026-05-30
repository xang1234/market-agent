import type { BarInterval, BarRange } from "./bar.ts";

const INTERVAL_MS: Record<BarInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function canonicalizeProviderBarRange(
  range: BarRange,
  interval: BarInterval,
  timezone: string,
): BarRange {
  const startMs = floorZonedBucket(Date.parse(range.start), interval, timezone);
  let endMs = ceilZonedBucket(Date.parse(range.end), interval, timezone);
  if (endMs <= startMs) {
    endMs = zonedPartsToUtcMs(addInterval(localParts(startMs, timezone), interval), timezone);
  }
  return Object.freeze({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  });
}

export function zonedDateStartUtcIso(date: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`date must be YYYY-MM-DD; received ${date}`);
  }
  const [, year, month, day] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    utcDate.getUTCFullYear() !== parts.year ||
    utcDate.getUTCMonth() + 1 !== parts.month ||
    utcDate.getUTCDate() !== parts.day
  ) {
    throw new Error(`date must be a valid YYYY-MM-DD value; received ${date}`);
  }
  return new Date(
    zonedPartsToUtcMs(
      {
        ...parts,
        hour: 0,
        minute: 0,
        second: 0,
      },
      timezone,
    ),
  ).toISOString();
}

export function zonedDateParam(ms: number, timezone: string): string {
  if (!Number.isFinite(ms)) {
    throw new Error(`ms must be finite; received ${ms}`);
  }
  const parts = localParts(ms, timezone);
  return `${parts.year}${pad2(parts.month)}${pad2(parts.day)}`;
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function floorZonedBucket(ms: number, interval: BarInterval, timezone: string): number {
  const parts = localParts(ms, timezone);
  if (interval === "1d") {
    return zonedPartsToUtcMs({ ...parts, hour: 0, minute: 0, second: 0 }, timezone);
  }
  if (interval === "1h") {
    return zonedPartsToUtcMs({ ...parts, minute: 0, second: 0 }, timezone);
  }

  const stepMinutes = INTERVAL_MS[interval] / 60_000;
  return zonedPartsToUtcMs(
    {
      ...parts,
      minute: Math.floor(parts.minute / stepMinutes) * stepMinutes,
      second: 0,
    },
    timezone,
  );
}

function ceilZonedBucket(ms: number, interval: BarInterval, timezone: string): number {
  const floored = floorZonedBucket(ms, interval, timezone);
  if (floored === ms) return floored;
  return zonedPartsToUtcMs(addInterval(localParts(floored, timezone), interval), timezone);
}

function addInterval(parts: LocalParts, interval: BarInterval): LocalParts {
  const d = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) +
      INTERVAL_MS[interval],
  );
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

function localParts(ms: number, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Partial<LocalParts> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type === "year") out.year = Number(part.value);
    if (part.type === "month") out.month = Number(part.value);
    if (part.type === "day") out.day = Number(part.value);
    if (part.type === "hour") out.hour = Number(part.value);
    if (part.type === "minute") out.minute = Number(part.value);
    if (part.type === "second") out.second = Number(part.value);
  }
  if (
    out.year === undefined ||
    out.month === undefined ||
    out.day === undefined ||
    out.hour === undefined ||
    out.minute === undefined ||
    out.second === undefined
  ) {
    throw new Error(`could not resolve timezone bucket parts for ${timezone}`);
  }
  return out as LocalParts;
}

function zonedPartsToUtcMs(parts: LocalParts, timezone: string): number {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let guess = localAsUtc;
  for (let i = 0; i < 4; i++) {
    const next = localAsUtc - timezoneOffsetMs(guess, timezone);
    if (next === guess) return next;
    guess = next;
  }
  return guess;
}

function timezoneOffsetMs(ms: number, timezone: string): number {
  const parts = localParts(ms, timezone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - ms;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
