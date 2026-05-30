import type { UUID } from "./subject-ref.ts";

export const POLYGON_MARKET_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000009";
export const YAHOO_FINANCE_DEV_MARKET_SOURCE_ID: UUID = "00000000-0000-4000-a000-00000000000b";
export const STOOQ_MARKET_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000011";

export const STOOQ_MARKET_PROVIDER = "stooq_market";
export const STOOQ_MARKET_CANONICAL_URL = "https://stooq.com/q/d/l/";
export const STOOQ_MARKET_SOURCE_KIND = "market_data";
export const STOOQ_MARKET_TRUST_TIER = "tertiary";
export const STOOQ_MARKET_LICENSE_CLASS = "free";

export const STOOQ_MARKET_ENABLED_ENV = "STOOQ_MARKET_ENABLED";
export const STOOQ_MARKET_BASE_URL_ENV = "STOOQ_MARKET_BASE_URL";
export const STOOQ_MARKET_DEFAULT_BASE_URL = STOOQ_MARKET_CANONICAL_URL;

export const STOOQ_MARKET_SOURCE = Object.freeze({
  sourceId: STOOQ_MARKET_SOURCE_ID,
  provider: STOOQ_MARKET_PROVIDER,
  kind: STOOQ_MARKET_SOURCE_KIND,
  canonicalUrl: STOOQ_MARKET_CANONICAL_URL,
  trustTier: STOOQ_MARKET_TRUST_TIER,
  licenseClass: STOOQ_MARKET_LICENSE_CLASS,
});

const MARKET_SOURCE_PROVIDER_NAMES: Record<UUID, string> = {
  [POLYGON_MARKET_SOURCE_ID]: "polygon_market",
  [YAHOO_FINANCE_DEV_MARKET_SOURCE_ID]: "yahoo_finance_dev_market",
  [STOOQ_MARKET_SOURCE.sourceId]: STOOQ_MARKET_SOURCE.provider,
};

export function providerNameForMarketSource(sourceId: UUID, fallback: string): string {
  return MARKET_SOURCE_PROVIDER_NAMES[sourceId] ?? fallback;
}

export type StooqMarketProviderConfig = Readonly<{
  enabled: boolean;
  baseUrl: string;
}>;

export function stooqMarketProviderConfigFromEnv(
  env: Record<string, string | undefined>,
): StooqMarketProviderConfig {
  return Object.freeze({
    enabled: env[STOOQ_MARKET_ENABLED_ENV] === "true",
    baseUrl: env[STOOQ_MARKET_BASE_URL_ENV]?.trim() || STOOQ_MARKET_DEFAULT_BASE_URL,
  });
}
