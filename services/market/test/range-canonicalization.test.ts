import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeProviderBarRange,
  zonedDateParam,
  zonedDateStartUtcIso,
} from "../src/range-canonicalization.ts";

test("canonicalizeProviderBarRange aligns daily buckets to the listing timezone", () => {
  const range = canonicalizeProviderBarRange(
    {
      start: "2026-04-08T11:56:58.042Z",
      end: "2026-05-08T11:56:58.042Z",
    },
    "1d",
    "America/New_York",
  );

  assert.deepEqual(range, {
    start: "2026-04-08T04:00:00.000Z",
    end: "2026-05-09T04:00:00.000Z",
  });
});

test("canonicalizeProviderBarRange preserves sub-daily bucket boundaries in local time", () => {
  const range = canonicalizeProviderBarRange(
    {
      start: "2026-01-15T14:37:12.000Z",
      end: "2026-01-15T15:01:00.000Z",
    },
    "15m",
    "America/New_York",
  );

  assert.deepEqual(range, {
    start: "2026-01-15T14:30:00.000Z",
    end: "2026-01-15T15:15:00.000Z",
  });
});

test("zonedDateStartUtcIso maps a provider date to the listing timezone's UTC bucket", () => {
  assert.equal(
    zonedDateStartUtcIso("2026-05-06", "America/New_York"),
    "2026-05-06T04:00:00.000Z",
  );
  assert.equal(
    zonedDateParam(Date.parse("2026-05-08T20:00:00.000Z"), "America/New_York"),
    "20260508",
  );
});

test("zoned date helpers reject invalid provider dates and timestamps", () => {
  assert.throws(() => zonedDateStartUtcIso("2026-02-31", "America/New_York"), /valid YYYY-MM-DD/);
  assert.throws(() => zonedDateStartUtcIso("20260506", "America/New_York"), /YYYY-MM-DD/);
  assert.throws(() => zonedDateParam(Number.NaN, "America/New_York"), /finite/);
});
