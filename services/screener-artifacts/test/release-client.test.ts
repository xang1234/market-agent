import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { loadArtifactConfig } from "../src/config.ts";
import {
  fetchWeeklyBundle,
  fetchWeeklyManifest,
  weeklyBundleUrl,
  weeklyManifestUrl,
  ReleaseFetchError,
} from "../src/release-client.ts";
import type { WeeklyReferenceManifest } from "../src/types.ts";

const config = loadArtifactConfig({});

const BUNDLE = {
  schema_version: "weekly-reference-bundle-v1",
  market: "US",
  as_of_date: "2026-06-03",
  snapshot: { rows: [{ symbol: "A", exchange: "NYSE", normalized_payload: { market_cap_usd: 100 } }] },
  universe: [
    {
      symbol: "A",
      name: "Alpha",
      exchange: "XNYS",
      currency: "USD",
      timezone: "America/New_York",
      sector: "Tech",
      industry: "Software",
      market: "US",
      is_active: true,
    },
  ],
};

const GZ = gzipSync(Buffer.from(JSON.stringify(BUNDLE)));
const SHA = createHash("sha256").update(GZ).digest("hex");

const MANIFEST: WeeklyReferenceManifest = {
  schema_version: "weekly-reference-manifest-v1",
  market: "US",
  as_of_date: "2026-06-03",
  bundle_asset_name: "weekly-reference-us-20260603.json.gz",
  sha256: SHA,
  generated_at: "2026-06-03T10:18:57Z",
};

test("weeklyManifestUrl / weeklyBundleUrl build the release asset URLs", () => {
  assert.equal(
    weeklyManifestUrl(config, "US"),
    "https://github.com/xang1234/stock-screener/releases/download/weekly-reference-data/weekly-reference-latest-us.json",
  );
  assert.equal(
    weeklyBundleUrl(config, "asset.json.gz"),
    "https://github.com/xang1234/stock-screener/releases/download/weekly-reference-data/asset.json.gz",
  );
});

test("fetchWeeklyManifest parses the pointer JSON", async () => {
  const manifest = await fetchWeeklyManifest(config, "US", {
    fetchImpl: async () => new Response(JSON.stringify(MANIFEST)),
  });
  assert.equal(manifest.bundle_asset_name, "weekly-reference-us-20260603.json.gz");
});

test("fetchWeeklyManifest throws ReleaseFetchError on a non-200", async () => {
  await assert.rejects(
    () =>
      fetchWeeklyManifest(config, "US", {
        fetchImpl: async () => new Response("not found", { status: 404 }),
      }),
    (error: unknown) => error instanceof ReleaseFetchError && /HTTP 404/.test(error.message),
  );
});

test("fetchWeeklyBundle verifies the sha256 and decodes", async () => {
  const bundle = await fetchWeeklyBundle(config, MANIFEST, {
    fetchImpl: async () => new Response(GZ),
  });
  assert.equal(bundle.universe[0].exchange, "XNYS");
  assert.equal(bundle.snapshot.rows.length, 1);
});

test("fetchWeeklyBundle throws on a sha256 mismatch (corrupted download)", async () => {
  const tampered: WeeklyReferenceManifest = { ...MANIFEST, sha256: "deadbeef" };
  await assert.rejects(
    () => fetchWeeklyBundle(config, tampered, { fetchImpl: async () => new Response(GZ) }),
    (error: unknown) => error instanceof ReleaseFetchError && /sha256 mismatch/.test(error.message),
  );
});
