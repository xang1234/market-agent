import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GLEIF_API_BASE_URL_ENV,
  GLEIF_DEFAULT_API_BASE_URL,
  GLEIF_REFERENCE_CANONICAL_URL,
  GLEIF_REFERENCE_ENABLED_ENV,
  GLEIF_REFERENCE_LICENSE_CLASS,
  GLEIF_REFERENCE_PROVIDER,
  GLEIF_REFERENCE_SOURCE_ID,
  GLEIF_REFERENCE_SOURCE_KIND,
  GLEIF_REFERENCE_TRUST_TIER,
  NASDAQ_TRADER_BASE_URL_ENV,
  NASDAQ_TRADER_DEFAULT_BASE_URL,
  NASDAQ_TRADER_REFERENCE_CANONICAL_URL,
  NASDAQ_TRADER_REFERENCE_ENABLED_ENV,
  NASDAQ_TRADER_REFERENCE_LICENSE_CLASS,
  NASDAQ_TRADER_REFERENCE_PROVIDER,
  NASDAQ_TRADER_REFERENCE_SOURCE_ID,
  NASDAQ_TRADER_REFERENCE_SOURCE_KIND,
  NASDAQ_TRADER_REFERENCE_TRUST_TIER,
  OPENFIGI_API_BASE_URL_ENV,
  OPENFIGI_API_KEY_ENV,
  OPENFIGI_DEFAULT_API_BASE_URL,
  OPENFIGI_REFERENCE_CANONICAL_URL,
  OPENFIGI_REFERENCE_ENABLED_ENV,
  OPENFIGI_REFERENCE_LICENSE_CLASS,
  OPENFIGI_REFERENCE_PROVIDER,
  OPENFIGI_REFERENCE_SOURCE_ID,
  OPENFIGI_REFERENCE_SOURCE_KIND,
  OPENFIGI_REFERENCE_TRUST_TIER,
  OPEN_REFERENCE_SOURCE_DEFINITIONS,
  openReferenceProviderConfigFromEnv,
} from "../src/provider-sources.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSeededSourceRow(
  sourcesSql: string,
  source: {
    sourceId: string;
    provider: string;
    kind: string;
    canonicalUrl: string;
    trustTier: string;
    licenseClass: string;
  },
): void {
  assert.match(
    sourcesSql,
    new RegExp(
      [
        `'${escapeRegExp(source.sourceId)}'`,
        `'${escapeRegExp(source.provider)}'`,
        `'${escapeRegExp(source.kind)}'`,
        `'${escapeRegExp(source.canonicalUrl)}'`,
        `'${escapeRegExp(source.trustTier)}'`,
        `'${escapeRegExp(source.licenseClass)}'`,
      ].join(",\\s*"),
    ),
    `${source.provider} descriptor must match the seeded source row`,
  );
}

test("open reference source constants match the seeded source registry", () => {
  const sourcesSql = readFileSync(new URL("../../../db/seed/sources.sql", import.meta.url), "utf8");

  assert.deepEqual(
    OPEN_REFERENCE_SOURCE_DEFINITIONS.map((source) => [
      source.sourceId,
      source.provider,
      source.kind,
      source.canonicalUrl,
      source.trustTier,
      source.licenseClass,
    ]),
    [
      [
        "00000000-0000-4000-a000-00000000000e",
        "openfigi_reference",
        "reference_data",
        "https://api.openfigi.com/v3/mapping",
        "secondary",
        "free",
      ],
      [
        "00000000-0000-4000-a000-00000000000f",
        "gleif_reference",
        "reference_data",
        "https://api.gleif.org/api/v1/lei-records",
        "primary",
        "public",
      ],
      [
        "00000000-0000-4000-a000-000000000010",
        "nasdaq_trader_reference",
        "reference_data",
        "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt",
        "primary",
        "public",
      ],
    ],
  );
  assert.deepEqual(OPEN_REFERENCE_SOURCE_DEFINITIONS[0], {
    sourceId: OPENFIGI_REFERENCE_SOURCE_ID,
    provider: OPENFIGI_REFERENCE_PROVIDER,
    kind: OPENFIGI_REFERENCE_SOURCE_KIND,
    canonicalUrl: OPENFIGI_REFERENCE_CANONICAL_URL,
    trustTier: OPENFIGI_REFERENCE_TRUST_TIER,
    licenseClass: OPENFIGI_REFERENCE_LICENSE_CLASS,
  });
  assert.deepEqual(OPEN_REFERENCE_SOURCE_DEFINITIONS[1], {
    sourceId: GLEIF_REFERENCE_SOURCE_ID,
    provider: GLEIF_REFERENCE_PROVIDER,
    kind: GLEIF_REFERENCE_SOURCE_KIND,
    canonicalUrl: GLEIF_REFERENCE_CANONICAL_URL,
    trustTier: GLEIF_REFERENCE_TRUST_TIER,
    licenseClass: GLEIF_REFERENCE_LICENSE_CLASS,
  });
  assert.deepEqual(OPEN_REFERENCE_SOURCE_DEFINITIONS[2], {
    sourceId: NASDAQ_TRADER_REFERENCE_SOURCE_ID,
    provider: NASDAQ_TRADER_REFERENCE_PROVIDER,
    kind: NASDAQ_TRADER_REFERENCE_SOURCE_KIND,
    canonicalUrl: NASDAQ_TRADER_REFERENCE_CANONICAL_URL,
    trustTier: NASDAQ_TRADER_REFERENCE_TRUST_TIER,
    licenseClass: NASDAQ_TRADER_REFERENCE_LICENSE_CLASS,
  });
  for (const source of OPEN_REFERENCE_SOURCE_DEFINITIONS) {
    assertSeededSourceRow(sourcesSql, source);
  }
});

test("open reference provider config env gates default to disabled providers", () => {
  assert.deepEqual(openReferenceProviderConfigFromEnv({}), {
    openfigi: {
      enabled: false,
      apiKey: null,
      baseUrl: OPENFIGI_DEFAULT_API_BASE_URL,
    },
    gleif: {
      enabled: false,
      baseUrl: GLEIF_DEFAULT_API_BASE_URL,
    },
    nasdaqTrader: {
      enabled: false,
      baseUrl: NASDAQ_TRADER_DEFAULT_BASE_URL,
    },
  });
});

test("open reference provider config reads explicit env gates and endpoints", () => {
  assert.equal(OPENFIGI_REFERENCE_ENABLED_ENV, "OPENFIGI_REFERENCE_ENABLED");
  assert.equal(OPENFIGI_API_KEY_ENV, "OPENFIGI_API_KEY");
  assert.equal(OPENFIGI_API_BASE_URL_ENV, "OPENFIGI_API_BASE_URL");
  assert.equal(GLEIF_REFERENCE_ENABLED_ENV, "GLEIF_REFERENCE_ENABLED");
  assert.equal(GLEIF_API_BASE_URL_ENV, "GLEIF_API_BASE_URL");
  assert.equal(NASDAQ_TRADER_REFERENCE_ENABLED_ENV, "NASDAQ_TRADER_REFERENCE_ENABLED");
  assert.equal(NASDAQ_TRADER_BASE_URL_ENV, "NASDAQ_TRADER_BASE_URL");

  assert.deepEqual(openReferenceProviderConfigFromEnv({
    OPENFIGI_REFERENCE_ENABLED: "true",
    OPENFIGI_API_KEY: " figi-key ",
    OPENFIGI_API_BASE_URL: "https://openfigi.test",
    GLEIF_REFERENCE_ENABLED: "true",
    GLEIF_API_BASE_URL: "https://gleif.test/api/v1",
    NASDAQ_TRADER_REFERENCE_ENABLED: "true",
    NASDAQ_TRADER_BASE_URL: "https://nasdaq.test",
  }), {
    openfigi: {
      enabled: true,
      apiKey: "figi-key",
      baseUrl: "https://openfigi.test",
    },
    gleif: {
      enabled: true,
      baseUrl: "https://gleif.test/api/v1",
    },
    nasdaqTrader: {
      enabled: true,
      baseUrl: "https://nasdaq.test",
    },
  });
});

test("env example documents open reference provider gates and optional OpenFIGI key", () => {
  const envExample = readFileSync(new URL("../../../.env.dev.example", import.meta.url), "utf8");

  for (const name of [
    OPENFIGI_REFERENCE_ENABLED_ENV,
    OPENFIGI_API_KEY_ENV,
    OPENFIGI_API_BASE_URL_ENV,
    GLEIF_REFERENCE_ENABLED_ENV,
    GLEIF_API_BASE_URL_ENV,
    NASDAQ_TRADER_REFERENCE_ENABLED_ENV,
    NASDAQ_TRADER_BASE_URL_ENV,
  ]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"), `${name} must be present in .env.dev.example`);
  }
  assert.match(envExample, /discovery\/enrichment/i);
  assert.match(envExample, /do not overwrite existing SEC\/Polygon\/local identifiers/i);
});
