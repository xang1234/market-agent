import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  decodeWeeklyBundle,
  parseWeeklyBundle,
  sanitizeNonFiniteNumbers,
  BundleParseError,
} from "../src/bundle.ts";

const BUNDLE = {
  schema_version: "weekly-reference-bundle-v1",
  market: "US",
  as_of_date: "2026-06-03",
  snapshot: {
    rows: [
      { symbol: "A", exchange: "NYSE", normalized_payload: { market_cap: 100, rsi_14: 70 } },
      { symbol: "B", exchange: "NASDAQ", normalized_payload: { market_cap: null, perf_year: 12.3 } },
    ],
  },
  universe: [
    {
      symbol: "A",
      name: "Agilent Technologies Inc",
      exchange: "XNYS",
      currency: "USD",
      timezone: "America/New_York",
      sector: "Healthcare",
      industry: "Diagnostics & Research",
      market: "US",
      is_active: true,
    },
  ],
};

test("decodeWeeklyBundle round-trips a real gzip payload", () => {
  const gz = gzipSync(Buffer.from(JSON.stringify(BUNDLE)));
  const bundle = decodeWeeklyBundle(gz);
  assert.equal(bundle.market, "US");
  assert.equal(bundle.as_of_date, "2026-06-03");
  assert.equal(bundle.snapshot.rows.length, 2);
  assert.equal(bundle.snapshot.rows[0].symbol, "A");
  assert.equal(bundle.universe[0].exchange, "XNYS");
});

test("decodeWeeklyBundle rejects non-gzip bytes", () => {
  assert.throws(
    () => decodeWeeklyBundle(Buffer.from("not gzip at all")),
    (error: unknown) => error instanceof BundleParseError && /gunzip/.test(error.message),
  );
});

test("parseWeeklyBundle rejects an unexpected schema_version", () => {
  assert.throws(
    () => parseWeeklyBundle({ ...BUNDLE, schema_version: "weekly-reference-bundle-v2" }),
    (error: unknown) => error instanceof BundleParseError && /unexpected schema_version/.test(error.message),
  );
});

test("parseWeeklyBundle rejects a non-array snapshot.rows", () => {
  assert.throws(
    () => parseWeeklyBundle({ ...BUNDLE, snapshot: { rows: "nope" } }),
    (error: unknown) => error instanceof BundleParseError && /snapshot\.rows/.test(error.message),
  );
});

test("parseWeeklyBundle defaults a missing universe to an empty array", () => {
  const { universe: _omit, ...withoutUniverse } = BUNDLE;
  const bundle = parseWeeklyBundle(withoutUniverse);
  assert.deepEqual(bundle.universe, []);
});

test("sanitizeNonFiniteNumbers rewrites Python NaN/Infinity tokens in value position", () => {
  assert.equal(sanitizeNonFiniteNumbers('{"a": NaN}'), '{"a": null}');
  assert.equal(
    sanitizeNonFiniteNumbers('{"a": Infinity, "b": -Infinity}'),
    '{"a": null, "b": null}',
  );
  assert.equal(sanitizeNonFiniteNumbers("[NaN, 1, NaN]"), "[null, 1, null]");
});

test("sanitizeNonFiniteNumbers leaves NaN substrings inside quoted strings alone", () => {
  // A value terminator must follow — a closing quote protects in-string text.
  assert.equal(sanitizeNonFiniteNumbers('{"note": "value: NaN"}'), '{"note": "value: NaN"}');
  assert.equal(sanitizeNonFiniteNumbers('{"co": "NaN Holdings"}'), '{"co": "NaN Holdings"}');
});

test("decodeWeeklyBundle decodes a bundle carrying bare NaN literals (the real-world case)", () => {
  // The producer is a Python pipeline; this mirrors its json.dumps(allow_nan=True) output.
  const raw =
    '{"schema_version":"weekly-reference-bundle-v1","market":"US","as_of_date":"2026-06-03",' +
    '"snapshot":{"rows":[{"symbol":"A","exchange":"NYSE","normalized_payload":' +
    '{"market_cap_usd":100,"perf_half_year":NaN,"rsi_14":70}}]},"universe":[]}';
  const bundle = decodeWeeklyBundle(gzipSync(Buffer.from(raw)));
  assert.equal(bundle.snapshot.rows[0].normalized_payload.perf_half_year, null);
  assert.equal(bundle.snapshot.rows[0].normalized_payload.rsi_14, 70);
});
