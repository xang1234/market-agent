import type {
  BarsRequest,
  MarketDataAdapter,
  MarketDataOutcome,
  NormalizedBars,
  NormalizedQuote,
  QuoteRequest,
} from "./adapter.ts";
import { available, isAvailable, unavailable } from "./availability.ts";
import type { MarketCacheRepository } from "./cache-repository.ts";

export type CachedMarketDataAdapterOptions = {
  provider: MarketDataAdapter;
  cache: MarketCacheRepository;
  clock?: () => Date;
};

const QUOTE_TTL_MS = 30 * 60 * 1000;
const INTRADAY_BARS_TTL_MS = 30 * 60 * 1000;

export function createCachedMarketDataAdapter(
  options: CachedMarketDataAdapterOptions,
): MarketDataAdapter {
  const clock = options.clock ?? (() => new Date());
  const { provider, cache } = options;

  return {
    providerName: provider.providerName,
    sourceId: provider.sourceId,

    async getQuote(request: QuoteRequest): Promise<MarketDataOutcome<NormalizedQuote>> {
      const now = clock();
      const nowIso = now.toISOString();
      const fresh = await cache.findFreshQuote(request.listing, nowIso);
      if (fresh) return available(fresh.quote);

      const stale = await cache.findLatestQuote(request.listing);
      const outcome = await provider.getQuote(request);
      if (isAvailable(outcome)) {
        await cache.storeQuote(outcome.data, {
          provider: provider.providerName,
          fetched_at: nowIso,
          expires_at: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
        });
        return outcome;
      }
      if (stale) {
        return unavailable({
          reason: "stale_data",
          listing: request.listing,
          source_id: stale.quote.source_id,
          as_of: stale.quote.as_of,
          retryable: outcome.retryable,
          detail: `cached quote expired at ${stale.expires_at}; ${outcome.detail ?? "provider unavailable"}`,
        });
      }
      return outcome;
    },

    async getBars(request: BarsRequest): Promise<MarketDataOutcome<NormalizedBars>> {
      const now = clock();
      const nowIso = now.toISOString();
      const fresh = await cache.findFreshBars({
        listing: request.listing,
        interval: request.interval,
        range: request.range,
        adjustment_basis: "split_and_div_adjusted",
        now: nowIso,
      });
      if (fresh) return available(fresh.bars);

      const stale = await cache.findLatestBars(
        request.listing,
        request.interval,
        request.range,
        "split_and_div_adjusted",
      );
      const outcome = await provider.getBars(request);
      if (isAvailable(outcome)) {
        await cache.storeBars(outcome.data, {
          provider: provider.providerName,
          fetched_at: nowIso,
          expires_at: barsExpiresAt(now, request.interval),
        });
        return outcome;
      }
      if (stale) {
        return unavailable({
          reason: "stale_data",
          listing: request.listing,
          source_id: stale.bars.source_id,
          as_of: stale.bars.as_of,
          retryable: outcome.retryable,
          detail: `cached bars expired at ${stale.expires_at}; ${outcome.detail ?? "provider unavailable"}`,
        });
      }
      return outcome;
    },
  };
}

function barsExpiresAt(now: Date, interval: BarsRequest["interval"]): string {
  if (interval !== "1d") {
    return new Date(now.getTime() + INTRADAY_BARS_TTL_MS).toISOString();
  }
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  ));
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}
