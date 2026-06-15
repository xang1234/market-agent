import test from "node:test";
import assert from "node:assert/strict";
import { parseWeeklyManifest, ManifestParseError } from "../src/manifest.ts";

// A real manifest shape (trimmed) — mirrors weekly-reference-latest-us.json.
const VALID = {
  as_of_date: "2026-06-03",
  bundle_asset_name: "weekly-reference-us-20260603-fundamentals_v1_us-20260603063002.json.gz",
  coverage: { active_symbols: 9886, covered_active_symbols: 9845, missing_active_symbols: 41 },
  generated_at: "2026-06-03T10:18:57Z",
  market: "US",
  schema_version: "weekly-reference-manifest-v1",
  sha256: "e45308207e147a1c1bb59f8db18381b0dee11d0621ec6f3a947dfa8cb18c4b4e",
  source_revision: "fundamentals_v1_us:20260603063002",
  warnings: [],
};

test("parseWeeklyManifest returns the validated pointer fields", () => {
  const manifest = parseWeeklyManifest(VALID);
  assert.equal(manifest.market, "US");
  assert.equal(manifest.as_of_date, "2026-06-03");
  assert.equal(manifest.bundle_asset_name, VALID.bundle_asset_name);
  assert.equal(manifest.sha256, VALID.sha256);
  assert.equal(manifest.coverage?.covered_active_symbols, 9845);
});

test("parseWeeklyManifest rejects an unexpected schema_version", () => {
  assert.throws(
    () => parseWeeklyManifest({ ...VALID, schema_version: "weekly-reference-manifest-v2" }),
    (error: unknown) =>
      error instanceof ManifestParseError && /unexpected schema_version/.test(error.message),
  );
});

test("parseWeeklyManifest rejects a missing sha256", () => {
  const { sha256: _omit, ...withoutSha } = VALID;
  assert.throws(
    () => parseWeeklyManifest(withoutSha),
    (error: unknown) => error instanceof ManifestParseError && /sha256/.test(error.message),
  );
});

test("parseWeeklyManifest rejects non-object input", () => {
  assert.throws(() => parseWeeklyManifest("nope"), ManifestParseError);
  assert.throws(() => parseWeeklyManifest(null), ManifestParseError);
  assert.throws(() => parseWeeklyManifest([VALID]), ManifestParseError);
});

test("parseWeeklyManifest tolerates a missing coverage block", () => {
  const { coverage: _omit, ...withoutCoverage } = VALID;
  const manifest = parseWeeklyManifest(withoutCoverage);
  assert.equal(manifest.coverage, undefined);
});
