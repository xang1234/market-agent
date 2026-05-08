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
): BarRange {
  const step = INTERVAL_MS[interval];
  const startMs = Math.floor(Date.parse(range.start) / step) * step;
  let endMs = Math.ceil(Date.parse(range.end) / step) * step;
  if (endMs <= startMs) endMs = startMs + step;
  return Object.freeze({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  });
}
