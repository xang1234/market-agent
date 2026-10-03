// Fetch a YTD request's daily bars before the snapshot cutoff (#232).
//
// Chat charts only stored bars (perf-block.ts). For a live YTD request it first
// asks the market service for the required window, from before the prior
// year's last sessions to now, which fetches through the cached adapter and
// persists the bars. The turn captures its cutoff only afterwards, so the
// stored bars are inside it. Charting and its named gaps are unchanged: if this
// fetch fails or times out, the chart says what is missing.
//
// Frozen data modes (no-keys, analyst) never hydrate: the golden dataset
// answers from seeded bars, and live bars must not mix into it.

const DEFAULT_TIMEOUT_MS = 15_000;
// The bases the chart can use, in its order of preference (perf-block.ts).
const BASES = ["split_adjusted", "split_and_div_adjusted"] as const;

export function marketHydrationOrigin(env: NodeJS.ProcessEnv): string | null {
  if (env.DEV_NO_KEYS === "true" || env.DEV_MODE === "analyst") return null;
  return env.MARKET_ORIGIN?.trim() || null;
}

export async function hydrateYtdBars(input: {
  origin: string;
  listings: ReadonlyArray<{ id: string }>;
  now: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<void> {
  if (input.listings.length === 0) return;
  const fetchImpl = input.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // From Dec 20 of the prior year on every exchange's calendar: no exchange is
  // more than 14 hours behind UTC, so this year is never later than the
  // cutoff's local year, and the window only starts earlier.
  const year = new Date(Date.parse(input.now) - 14 * 60 * 60 * 1000).getUTCFullYear();
  const range = { start: `${year - 1}-12-20T00:00:00.000Z`, end: input.now };
  try {
    // Every company on one basis, or the chart cannot compare them: if any
    // company has no split-adjusted window, fetch them all dividend-adjusted.
    for (const basis of BASES) {
      const available = await fetchSeries(fetchImpl, input.origin, input.listings, range, basis, signal);
      if (available === input.listings.length) return;
    }
  } catch (reason) {
    console.warn("[chat] YTD price fetch failed; charting from the bars already stored", reason);
  }
}

async function fetchSeries(
  fetchImpl: typeof fetch,
  origin: string,
  listings: ReadonlyArray<{ id: string }>,
  range: { start: string; end: string },
  basis: (typeof BASES)[number],
  signal: AbortSignal,
): Promise<number> {
  const response = await fetchImpl(new URL("/v1/market/series", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject_refs: listings.map((listing) => ({ kind: "listing", id: listing.id })),
      range,
      interval: "1d",
      basis,
      normalization: "raw",
    }),
    signal,
  });
  if (!response.ok) {
    void response.body?.cancel();
    throw new Error(`market series request answered ${response.status}`);
  }
  const body = (await response.json()) as { results?: Array<{ outcome?: { outcome?: string } }> };
  return (body.results ?? []).filter((result) => result.outcome?.outcome === "available").length;
}
