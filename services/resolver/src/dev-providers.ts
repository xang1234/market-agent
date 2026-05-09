import type { DiscoveredListing, DiscoveryAssetType, TickerDiscoveryProvider } from "./discovery.ts";
import { normalizeCik } from "./normalize.ts";

export type DevProvidersTickerDiscoveryProviderOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type DevProviderEnvelope =
  | {
      status: "available";
      data?: {
        listings?: unknown[];
      };
    }
  | {
      status: "unavailable";
      reason?: string;
      retryable?: boolean;
      detail?: string;
    };

type DevProviderListing = {
  ticker?: unknown;
  legal_name?: unknown;
  mic?: unknown;
  trading_currency?: unknown;
  timezone?: unknown;
  asset_type?: unknown;
  cik?: unknown;
  figi_composite?: unknown;
};

const SUPPORTED_ASSET_TYPES = new Set<DiscoveryAssetType>(["common_stock", "adr", "etf"]);
const DEFAULT_TIMEOUT_MS = 5_000;

export function createDevProvidersTickerDiscoveryProvider(
  options: DevProvidersTickerDiscoveryProviderOptions,
): TickerDiscoveryProvider {
  const baseUrl = options.baseUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async discoverTicker(ticker: string): Promise<DiscoveredListing[]> {
      const normalizedTicker = ticker.trim().toUpperCase();
      if (!normalizedTicker) return [];

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          new URL(`/reference/ticker/${encodeURIComponent(normalizedTicker)}`, baseUrl),
          { signal: controller.signal },
        );
        if (!response.ok) return [];
        const envelope = (await response.json()) as DevProviderEnvelope;
        if (envelope.status !== "available") return [];
        const rows = Array.isArray(envelope.data?.listings) ? envelope.data.listings : [];
        return rows.flatMap((row) => {
          const listing = discoveredListingFromDevProvider(row, normalizedTicker);
          return listing ? [listing] : [];
        });
      } catch {
        return [];
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createFallbackTickerDiscoveryProvider(
  providers: ReadonlyArray<TickerDiscoveryProvider>,
): TickerDiscoveryProvider {
  return {
    async discoverTicker(ticker: string): Promise<DiscoveredListing[]> {
      for (const provider of providers) {
        const discovered = await provider.discoverTicker(ticker);
        if (discovered.length > 0) return discovered;
      }
      return [];
    },
  };
}

function discoveredListingFromDevProvider(
  value: unknown,
  requestedTicker: string,
): DiscoveredListing | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as DevProviderListing;
  const ticker = stringValue(row.ticker)?.toUpperCase();
  const legalName = stringValue(row.legal_name);
  const mic = stringValue(row.mic)?.toUpperCase();
  const tradingCurrency = stringValue(row.trading_currency)?.toUpperCase();
  const timezone = stringValue(row.timezone);
  const assetType = stringValue(row.asset_type) as DiscoveryAssetType | null;

  if (!ticker || ticker !== requestedTicker) return null;
  if (!legalName || !mic || !tradingCurrency || !timezone || !assetType) return null;
  if (!SUPPORTED_ASSET_TYPES.has(assetType)) return null;

  return {
    ticker,
    legal_name: legalName,
    market: "stocks",
    active: true,
    mic,
    trading_currency: tradingCurrency,
    timezone,
    asset_type: assetType,
    ...(stringValue(row.cik) ? { cik: normalizeCik(stringValue(row.cik)!) } : {}),
    ...(stringValue(row.figi_composite) ? { figi_composite: stringValue(row.figi_composite)! } : {}),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
