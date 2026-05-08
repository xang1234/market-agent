import type {
  BarsRequest,
  MarketDataAdapter,
  MarketDataOutcome,
  NormalizedBars,
  NormalizedQuote,
  QuoteRequest,
} from "./adapter.ts";
import { unavailable } from "./availability.ts";
import type { UUID } from "./subject-ref.ts";

export function createUnavailableMarketDataAdapter(options: {
  providerName: string;
  sourceId: UUID;
  detail: string;
  clock?: () => Date;
}): MarketDataAdapter {
  const clock = options.clock ?? (() => new Date());
  const envelope = (listing: QuoteRequest["listing"]): MarketDataOutcome<never> =>
    unavailable({
      reason: "provider_error",
      listing,
      source_id: options.sourceId,
      as_of: clock().toISOString(),
      retryable: false,
      detail: options.detail,
    });

  return {
    providerName: options.providerName,
    sourceId: options.sourceId,
    async getQuote(request: QuoteRequest): Promise<MarketDataOutcome<NormalizedQuote>> {
      return envelope(request.listing);
    },
    async getBars(request: BarsRequest): Promise<MarketDataOutcome<NormalizedBars>> {
      return envelope(request.listing);
    },
  };
}
