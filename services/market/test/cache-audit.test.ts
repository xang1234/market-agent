import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSeriesCacheAuditDashboard,
  seriesCacheIdentity,
  type SeriesCacheAuditEvent,
} from "../src/series-query.ts";
import { aaplListing, msftListing } from "./fixtures.ts";

const BASE_QUERY = {
  subject_refs: [aaplListing, msftListing],
  range: {
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-04-01T00:00:00.000Z",
  },
  interval: "1d" as const,
  basis: "split_and_div_adjusted" as const,
  normalization: "pct_return" as const,
};

function event(
  result: SeriesCacheAuditEvent["result"],
  overrides: Partial<typeof BASE_QUERY> = {},
): SeriesCacheAuditEvent {
  return {
    cacheName: "series",
    result,
    identity: seriesCacheIdentity(
      { ...BASE_QUERY, ...overrides },
      "2026-04-22T15:30:00.000Z",
    ),
    observedAt: "2026-04-22T16:00:00.000Z",
  };
}

test("buildSeriesCacheAuditDashboard reports hit rate by cache identity dimension", () => {
  const dashboard = buildSeriesCacheAuditDashboard([
    event("hit"),
    event("hit"),
    event("miss", { interval: "1h" }),
    event("miss", { normalization: "raw" }),
  ]);

  assert.equal(dashboard.total, 4);
  assert.equal(dashboard.hits, 2);
  assert.equal(dashboard.misses, 2);
  assert.equal(dashboard.hitRate, 0.5);
  assert.deepEqual(dashboard.byDimension.interval, [
    { value: "1d", total: 3, hits: 2, misses: 1, hitRate: 2 / 3 },
    { value: "1h", total: 1, hits: 0, misses: 1, hitRate: 0 },
  ]);
  assert.deepEqual(dashboard.byDimension.normalization, [
    { value: "pct_return", total: 3, hits: 2, misses: 1, hitRate: 2 / 3 },
    { value: "raw", total: 1, hits: 0, misses: 1, hitRate: 0 },
  ]);
  assert.deepEqual(dashboard.byDimension.basis, [
    {
      value: "split_and_div_adjusted",
      total: 4,
      hits: 2,
      misses: 2,
      hitRate: 0.5,
    },
  ]);
  assert.equal(dashboard.byDimension.subjectSet[0].total, 4);
  assert.equal(dashboard.byDimension.freshnessBoundary[0].value, "2026-04-22T15:30:00.000Z");
});

test("buildSeriesCacheAuditDashboard returns stable empty buckets with no events", () => {
  const dashboard = buildSeriesCacheAuditDashboard([]);

  assert.equal(dashboard.total, 0);
  assert.equal(dashboard.hitRate, 0);
  assert.deepEqual(dashboard.byDimension.interval, []);
  assert.deepEqual(dashboard.byDimension.subjectSet, []);
});
