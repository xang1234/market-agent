import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STOOQ_MARKET_BASE_URL_ENV,
  STOOQ_MARKET_CANONICAL_URL,
  STOOQ_MARKET_DEFAULT_BASE_URL,
  STOOQ_MARKET_ENABLED_ENV,
  STOOQ_MARKET_LICENSE_CLASS,
  STOOQ_MARKET_PROVIDER,
  STOOQ_MARKET_SOURCE,
  STOOQ_MARKET_SOURCE_ID,
  STOOQ_MARKET_SOURCE_KIND,
  STOOQ_MARKET_TRUST_TIER,
  providerNameForMarketSource,
  stooqMarketProviderConfigFromEnv,
} from "../src/provider-sources.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("Stooq market source constants match the seeded source registry", () => {
  const sourcesSql = readFileSync(new URL("../../../db/seed/sources.sql", import.meta.url), "utf8");

  assert.equal(STOOQ_MARKET_SOURCE_ID, "00000000-0000-4000-a000-000000000011");
  assert.equal(STOOQ_MARKET_PROVIDER, "stooq_market");
  assert.equal(STOOQ_MARKET_SOURCE_KIND, "market_data");
  assert.equal(STOOQ_MARKET_TRUST_TIER, "tertiary");
  assert.equal(STOOQ_MARKET_LICENSE_CLASS, "free");
  assert.equal(STOOQ_MARKET_CANONICAL_URL, "https://stooq.com/q/d/l/");
  assert.deepEqual(STOOQ_MARKET_SOURCE, {
    sourceId: STOOQ_MARKET_SOURCE_ID,
    provider: STOOQ_MARKET_PROVIDER,
    kind: STOOQ_MARKET_SOURCE_KIND,
    canonicalUrl: STOOQ_MARKET_CANONICAL_URL,
    trustTier: STOOQ_MARKET_TRUST_TIER,
    licenseClass: STOOQ_MARKET_LICENSE_CLASS,
  });
  assert.match(
    sourcesSql,
    new RegExp(
      [
        `'${escapeRegExp(STOOQ_MARKET_SOURCE.sourceId)}'`,
        `'${escapeRegExp(STOOQ_MARKET_SOURCE.provider)}'`,
        `'${escapeRegExp(STOOQ_MARKET_SOURCE.kind)}'`,
        `'${escapeRegExp(STOOQ_MARKET_SOURCE.canonicalUrl)}'`,
        `'${escapeRegExp(STOOQ_MARKET_SOURCE.trustTier)}'`,
        `'${escapeRegExp(STOOQ_MARKET_SOURCE.licenseClass)}'`,
      ].join(",\\s*"),
    ),
    "Stooq descriptor must match the seeded source row",
  );
});

test("providerNameForMarketSource maps Stooq provenance to the stable provider name", () => {
  assert.equal(providerNameForMarketSource(STOOQ_MARKET_SOURCE_ID, "fallback"), STOOQ_MARKET_PROVIDER);
  assert.equal(providerNameForMarketSource("99999999-9999-4999-8999-999999999999", "fallback"), "fallback");
});

test("Stooq market config env gate defaults to disabled EOD source", () => {
  assert.equal(STOOQ_MARKET_ENABLED_ENV, "STOOQ_MARKET_ENABLED");
  assert.equal(STOOQ_MARKET_BASE_URL_ENV, "STOOQ_MARKET_BASE_URL");
  assert.equal(STOOQ_MARKET_DEFAULT_BASE_URL, STOOQ_MARKET_CANONICAL_URL);
  assert.deepEqual(stooqMarketProviderConfigFromEnv({}), {
    enabled: false,
    baseUrl: STOOQ_MARKET_DEFAULT_BASE_URL,
  });
  assert.deepEqual(stooqMarketProviderConfigFromEnv({
    STOOQ_MARKET_ENABLED: "true",
    STOOQ_MARKET_BASE_URL: "https://stooq.test/q/d/l/",
  }), {
    enabled: true,
    baseUrl: "https://stooq.test/q/d/l/",
  });
});

test("env example documents Stooq enablement and EOD limitation", () => {
  const envExample = readFileSync(new URL("../../../.env.dev.example", import.meta.url), "utf8");

  assert.match(envExample, /^STOOQ_MARKET_ENABLED=false$/m);
  assert.match(envExample, /^STOOQ_MARKET_BASE_URL=https:\/\/stooq\.com\/q\/d\/l\/$/m);
  assert.match(envExample, /daily historical bars only/i);
  assert.match(envExample, /realtime quote or intraday/i);
});
