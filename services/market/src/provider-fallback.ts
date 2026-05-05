import type {
  BarsRequest,
  MarketDataAdapter,
  QuoteRequest,
} from "./adapter.ts";
import {
  isAvailable,
  unavailable,
  type MarketDataOutcome,
} from "./availability.ts";
import type { NormalizedBars } from "./bar.ts";
import type { NormalizedQuote } from "./quote.ts";
import type { UUID } from "./subject-ref.ts";

export type ProviderAuditOperation = "quote" | "bars";
export type ProviderAuditResult = "available" | "unavailable" | "threw";

export type ProviderAuditEvent = {
  providerName: string;
  sourceId: UUID;
  operation: ProviderAuditOperation;
  result: ProviderAuditResult;
  fallbackEligible: boolean;
  latencyMs: number;
  observedAt: string;
  reason?: string;
};

export type FallbackMarketDataAdapterOptions = {
  providerName: string;
  adapters: ReadonlyArray<MarketDataAdapter>;
  onAuditEvent?: (event: ProviderAuditEvent) => void;
  clock?: () => Date;
};

type ProviderCall<T> = (adapter: MarketDataAdapter) => Promise<MarketDataOutcome<T>>;

export function createFallbackMarketDataAdapter(
  options: FallbackMarketDataAdapterOptions,
): MarketDataAdapter {
  if (options.adapters.length === 0) {
    throw new Error("createFallbackMarketDataAdapter.adapters: must include at least one adapter");
  }
  const clock = options.clock ?? (() => new Date());

  return {
    providerName: options.providerName,
    sourceId: options.adapters[0].sourceId,
    getQuote(request: QuoteRequest) {
      return firstAvailable({
        adapters: options.adapters,
        operation: "quote",
        listing: request.listing,
        invoke: (adapter) => adapter.getQuote(request),
        onAuditEvent: options.onAuditEvent,
        clock,
      });
    },
    getBars(request: BarsRequest) {
      return firstAvailable({
        adapters: options.adapters,
        operation: "bars",
        listing: request.listing,
        invoke: (adapter) => adapter.getBars(request),
        onAuditEvent: options.onAuditEvent,
        clock,
      });
    },
  };
}

async function firstAvailable<T extends NormalizedQuote | NormalizedBars>(input: {
  adapters: ReadonlyArray<MarketDataAdapter>;
  operation: ProviderAuditOperation;
  listing: QuoteRequest["listing"];
  invoke: ProviderCall<T>;
  onAuditEvent?: (event: ProviderAuditEvent) => void;
  clock: () => Date;
}): Promise<MarketDataOutcome<T>> {
  let lastOutcome: MarketDataOutcome<T> | undefined;

  for (const adapter of input.adapters) {
    const started = Date.now();
    try {
      const outcome = await input.invoke(adapter);
      const fallbackEligible = !isAvailable(outcome) && outcome.retryable;
      input.onAuditEvent?.({
        providerName: adapter.providerName,
        sourceId: adapter.sourceId,
        operation: input.operation,
        result: isAvailable(outcome) ? "available" : "unavailable",
        fallbackEligible,
        latencyMs: Date.now() - started,
        observedAt: input.clock().toISOString(),
        reason: isAvailable(outcome) ? undefined : outcome.reason,
      });
      if (isAvailable(outcome) || !fallbackEligible) return outcome;
      lastOutcome = outcome;
    } catch {
      input.onAuditEvent?.({
        providerName: adapter.providerName,
        sourceId: adapter.sourceId,
        operation: input.operation,
        result: "threw",
        fallbackEligible: true,
        latencyMs: Date.now() - started,
        observedAt: input.clock().toISOString(),
        reason: "provider threw",
      });
    }
  }

  if (lastOutcome !== undefined) return lastOutcome;
  return unavailable({
    reason: "provider_error",
    listing: input.listing,
    source_id: input.adapters[0].sourceId,
    as_of: input.clock().toISOString(),
    retryable: true,
    detail: "all fallback providers failed",
  });
}
