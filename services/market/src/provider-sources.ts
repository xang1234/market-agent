import type { UUID } from "./subject-ref.ts";

export const POLYGON_MARKET_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000009";
export const YAHOO_FINANCE_DEV_MARKET_SOURCE_ID: UUID = "00000000-0000-4000-a000-00000000000b";

const MARKET_SOURCE_PROVIDER_NAMES: Record<UUID, string> = {
  [POLYGON_MARKET_SOURCE_ID]: "polygon_market",
  [YAHOO_FINANCE_DEV_MARKET_SOURCE_ID]: "yahoo_finance_dev_market",
};

export function providerNameForMarketSource(sourceId: UUID, fallback: string): string {
  return MARKET_SOURCE_PROVIDER_NAMES[sourceId] ?? fallback;
}
