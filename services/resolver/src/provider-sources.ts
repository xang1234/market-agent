import type { UUID } from "./subject-ref.ts";

export const OPENFIGI_REFERENCE_SOURCE_ID: UUID = "00000000-0000-4000-a000-00000000000e";
export const GLEIF_REFERENCE_SOURCE_ID: UUID = "00000000-0000-4000-a000-00000000000f";
export const NASDAQ_TRADER_REFERENCE_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000010";

export const OPENFIGI_REFERENCE_PROVIDER = "openfigi_reference";
export const GLEIF_REFERENCE_PROVIDER = "gleif_reference";
export const NASDAQ_TRADER_REFERENCE_PROVIDER = "nasdaq_trader_reference";

export const OPENFIGI_REFERENCE_CANONICAL_URL = "https://api.openfigi.com/v3/mapping";
export const GLEIF_REFERENCE_CANONICAL_URL = "https://api.gleif.org/api/v1/lei-records";
export const NASDAQ_TRADER_REFERENCE_CANONICAL_URL =
  "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";

export const OPENFIGI_REFERENCE_SOURCE_KIND = "reference_data";
export const GLEIF_REFERENCE_SOURCE_KIND = "reference_data";
export const NASDAQ_TRADER_REFERENCE_SOURCE_KIND = "reference_data";

export const OPENFIGI_REFERENCE_TRUST_TIER = "secondary";
export const GLEIF_REFERENCE_TRUST_TIER = "primary";
export const NASDAQ_TRADER_REFERENCE_TRUST_TIER = "primary";

export const OPENFIGI_REFERENCE_LICENSE_CLASS = "free";
export const GLEIF_REFERENCE_LICENSE_CLASS = "public";
export const NASDAQ_TRADER_REFERENCE_LICENSE_CLASS = "public";

export const OPENFIGI_REFERENCE_ENABLED_ENV = "OPENFIGI_REFERENCE_ENABLED";
export const OPENFIGI_API_KEY_ENV = "OPENFIGI_API_KEY";
export const OPENFIGI_API_BASE_URL_ENV = "OPENFIGI_API_BASE_URL";
export const GLEIF_REFERENCE_ENABLED_ENV = "GLEIF_REFERENCE_ENABLED";
export const GLEIF_API_BASE_URL_ENV = "GLEIF_API_BASE_URL";
export const NASDAQ_TRADER_REFERENCE_ENABLED_ENV = "NASDAQ_TRADER_REFERENCE_ENABLED";
export const NASDAQ_TRADER_BASE_URL_ENV = "NASDAQ_TRADER_BASE_URL";

export const OPENFIGI_DEFAULT_API_BASE_URL = "https://api.openfigi.com";
export const GLEIF_DEFAULT_API_BASE_URL = "https://api.gleif.org/api/v1";
export const NASDAQ_TRADER_DEFAULT_BASE_URL = "https://www.nasdaqtrader.com";

export type OpenReferenceSourceDefinition = Readonly<{
  sourceId: UUID;
  provider: string;
  kind: "reference_data";
  canonicalUrl: string;
  trustTier: "primary" | "secondary";
  licenseClass: "free" | "public";
}>;

export const OPEN_REFERENCE_SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    sourceId: OPENFIGI_REFERENCE_SOURCE_ID,
    provider: OPENFIGI_REFERENCE_PROVIDER,
    kind: OPENFIGI_REFERENCE_SOURCE_KIND,
    canonicalUrl: OPENFIGI_REFERENCE_CANONICAL_URL,
    trustTier: OPENFIGI_REFERENCE_TRUST_TIER,
    licenseClass: OPENFIGI_REFERENCE_LICENSE_CLASS,
  }),
  Object.freeze({
    sourceId: GLEIF_REFERENCE_SOURCE_ID,
    provider: GLEIF_REFERENCE_PROVIDER,
    kind: GLEIF_REFERENCE_SOURCE_KIND,
    canonicalUrl: GLEIF_REFERENCE_CANONICAL_URL,
    trustTier: GLEIF_REFERENCE_TRUST_TIER,
    licenseClass: GLEIF_REFERENCE_LICENSE_CLASS,
  }),
  Object.freeze({
    sourceId: NASDAQ_TRADER_REFERENCE_SOURCE_ID,
    provider: NASDAQ_TRADER_REFERENCE_PROVIDER,
    kind: NASDAQ_TRADER_REFERENCE_SOURCE_KIND,
    canonicalUrl: NASDAQ_TRADER_REFERENCE_CANONICAL_URL,
    trustTier: NASDAQ_TRADER_REFERENCE_TRUST_TIER,
    licenseClass: NASDAQ_TRADER_REFERENCE_LICENSE_CLASS,
  }),
] as const satisfies ReadonlyArray<OpenReferenceSourceDefinition>);

export type OpenReferenceProviderConfig = Readonly<{
  openfigi: Readonly<{
    enabled: boolean;
    apiKey: string | null;
    baseUrl: string;
  }>;
  gleif: Readonly<{
    enabled: boolean;
    baseUrl: string;
  }>;
  nasdaqTrader: Readonly<{
    enabled: boolean;
    baseUrl: string;
  }>;
}>;

export function openReferenceProviderConfigFromEnv(
  env: Record<string, string | undefined>,
): OpenReferenceProviderConfig {
  return Object.freeze({
    openfigi: Object.freeze({
      enabled: env[OPENFIGI_REFERENCE_ENABLED_ENV] === "true",
      apiKey: env[OPENFIGI_API_KEY_ENV]?.trim() || null,
      baseUrl: env[OPENFIGI_API_BASE_URL_ENV]?.trim() || OPENFIGI_DEFAULT_API_BASE_URL,
    }),
    gleif: Object.freeze({
      enabled: env[GLEIF_REFERENCE_ENABLED_ENV] === "true",
      baseUrl: env[GLEIF_API_BASE_URL_ENV]?.trim() || GLEIF_DEFAULT_API_BASE_URL,
    }),
    nasdaqTrader: Object.freeze({
      enabled: env[NASDAQ_TRADER_REFERENCE_ENABLED_ENV] === "true",
      baseUrl: env[NASDAQ_TRADER_BASE_URL_ENV]?.trim() || NASDAQ_TRADER_DEFAULT_BASE_URL,
    }),
  });
}
