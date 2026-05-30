import type {
  BarsRequest,
  MarketDataAdapter,
  MarketDataOutcome,
  NormalizedBars,
  NormalizedQuote,
  QuoteRequest,
} from "./adapter.ts";
import { isUnavailable } from "./availability.ts";
import {
  createFallbackMarketDataAdapter,
  type FallbackMarketDataAdapterOptions,
  type ProviderAuditEvent,
  type ProviderAuditOperation,
} from "./provider-fallback.ts";

export type FallbackEligibility = NonNullable<FallbackMarketDataAdapterOptions["isFallbackEligible"]>;

export type DailyBarsAwareFallbackMarketDataAdapterOptions = {
  providerName: string;
  realtimeAdapters: ReadonlyArray<MarketDataAdapter>;
  dailyBarsFallbackAdapters: ReadonlyArray<MarketDataAdapter>;
  isRealtimeFallbackEligible?: FallbackEligibility;
  isDailyBarsFallbackEligible?: FallbackEligibility;
  onAuditEvent?: (event: ProviderAuditEvent) => void;
  clock?: () => Date;
};

export function createDailyBarsAwareFallbackMarketDataAdapter(
  options: DailyBarsAwareFallbackMarketDataAdapterOptions,
): MarketDataAdapter {
  const realtime = createFallbackMarketDataAdapter({
    providerName: options.providerName,
    adapters: options.realtimeAdapters,
    isFallbackEligible: options.isRealtimeFallbackEligible,
    onAuditEvent: options.onAuditEvent,
    clock: options.clock,
  });
  const daily = options.dailyBarsFallbackAdapters.length > 0
    ? createFallbackMarketDataAdapter({
        providerName: options.providerName,
        adapters: [...options.realtimeAdapters, ...options.dailyBarsFallbackAdapters],
        isFallbackEligible: (outcome, adapter, operation) =>
          eligibleDailyBarsGap(outcome, operation) ||
          options.isDailyBarsFallbackEligible?.(outcome, adapter, operation) === true ||
          options.isRealtimeFallbackEligible?.(outcome, adapter, operation) === true,
        onAuditEvent: options.onAuditEvent,
        clock: options.clock,
      })
    : realtime;

  return {
    providerName: options.providerName,
    sourceId: realtime.sourceId,
    getQuote(request: QuoteRequest): Promise<MarketDataOutcome<NormalizedQuote>> {
      return realtime.getQuote(request);
    },
    getBars(request: BarsRequest): Promise<MarketDataOutcome<NormalizedBars>> {
      return request.interval === "1d" ? daily.getBars(request) : realtime.getBars(request);
    },
  };
}

function eligibleDailyBarsGap(
  outcome: MarketDataOutcome<NormalizedQuote | NormalizedBars>,
  operation: ProviderAuditOperation,
): boolean {
  return operation === "bars" && isUnavailable(outcome) && outcome.reason === "missing_coverage";
}
