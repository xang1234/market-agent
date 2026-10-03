// Fetch a YTD request's daily bars before the snapshot cutoff (#232).
//
// Chat charts only stored bars (perf-block.ts). For a live YTD request it first
// asks the market service for the required window, from before the prior
// year's last sessions to the last completed session, which fetches through the
// cached adapter and persists the bars. The turn captures its cutoff only
// afterwards, so the stored bars are inside it. Charting and its named gaps are
// unchanged: if this fetch fails or times out, the chart says what is missing.
//
// Frozen data modes (no-keys, analyst) never hydrate: the golden dataset
// answers from seeded bars, and live bars must not mix into it.

import { completedSessionsEnd, selectYtdWindow, type DailyClose } from "../../market/src/ytd-window.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
// The bases the chart can use, in its order of preference (perf-block.ts).
const BASES = ["split_adjusted", "split_and_div_adjusted"] as const;

export type HydrationListing = { id: string; timeZone: string };

export function marketHydrationOrigin(env: NodeJS.ProcessEnv): string | null {
  if (env.DEV_NO_KEYS === "true" || env.DEV_MODE === "analyst") return null;
  // The chat profile serves market in-process from the one-process app, on its
  // own host and port (services/app/src/dev.ts); MARKET_ORIGIN then names the
  // standalone market server, which is not running.
  if (env.DEV_PROFILE === "chat") {
    return `http://${selfHost(env.APP_HOST ?? "127.0.0.1")}:${env.APP_PORT ?? env.WEB_PORT ?? "5173"}`;
  }
  return env.MARKET_ORIGIN?.trim() || null;
}

// The host to reach a server bound to `bindHost`: loopback for a wildcard bind,
// and an IPv6 literal in brackets.
function selfHost(bindHost: string): string {
  const host = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost === "::" ? "::1" : bindHost;
  return host.includes(":") ? `[${host}]` : host;
}

export async function hydrateYtdBars(input: {
  origin: string;
  listings: ReadonlyArray<HydrationListing>;
  now: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<void> {
  if (input.listings.length === 0) return;
  const fetchImpl = input.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // Every company on one basis, or the chart cannot compare them. A basis is
    // enough only when what came back makes a full YTD window (an "available"
    // answer can still hold no bars); otherwise fetch them all on the next.
    for (const basis of BASES) {
      const bars = await fetchWindows(fetchImpl, input.origin, input.listings, input.now, basis, signal);
      const window = selectYtdWindow(
        input.listings.map((listing) => ({ label: listing.id, timeZone: listing.timeZone, bars: bars.get(listing.id) ?? [] })),
        input.now,
      );
      if (window.ok) return;
    }
  } catch (reason) {
    console.warn("[chat] YTD price fetch failed; charting from the bars already stored", reason);
  }
}

// One series request per range: from Dec 20 of the prior year (no exchange is
// more than 14 hours behind UTC, so the year is never later than the cutoff's
// local year) to the end of each exchange's last completed session, never into
// a session still trading, whose bar would be cached as its close.
async function fetchWindows(
  fetchImpl: typeof fetch,
  origin: string,
  listings: ReadonlyArray<HydrationListing>,
  now: string,
  basis: (typeof BASES)[number],
  signal: AbortSignal,
): Promise<Map<string, DailyClose[]>> {
  const year = new Date(Date.parse(now) - 14 * 60 * 60 * 1000).getUTCFullYear();
  const start = `${year - 1}-12-20T00:00:00.000Z`;
  const byEnd = new Map<string, HydrationListing[]>();
  for (const listing of listings) {
    const end = completedSessionsEnd(now, listing.timeZone);
    byEnd.set(end, [...(byEnd.get(end) ?? []), listing]);
  }
  const bars = new Map<string, DailyClose[]>();
  for (const [end, group] of byEnd) {
    const response = await fetchImpl(new URL("/v1/market/series", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject_refs: group.map((listing) => ({ kind: "listing", id: listing.id })),
        range: { start, end },
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
    const body = (await response.json()) as {
      results?: Array<{ listing?: { id?: string }; outcome?: { outcome?: string; data?: { bars?: DailyClose[] } } }>;
    };
    for (const result of body.results ?? []) {
      if (result.listing?.id && result.outcome?.outcome === "available") bars.set(result.listing.id, result.outcome.data?.bars ?? []);
    }
  }
  return bars;
}
