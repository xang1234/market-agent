import assert from "node:assert/strict";
import test from "node:test";
import { conservativeAvailability, endOfLocalDay, freshnessAt, publicAtCutoff, type PublicationTiming } from "../src/public-time.ts";

const dateProof = (noLaterThan: string, timezone = "America/New_York"): PublicationTiming => ({
  available_not_before: null,
  available_no_later_than: noLaterThan,
  timing_precision: "date",
  source_timezone: timezone,
});

test("end of a source-local day is computed in that zone, across DST", () => {
  assert.equal(endOfLocalDay("2024-01-10", "America/New_York"), "2024-01-11T04:59:59.999Z");
  assert.equal(endOfLocalDay("2024-07-10", "America/New_York"), "2024-07-11T03:59:59.999Z");
  assert.equal(endOfLocalDay("2024-03-10", "America/New_York"), "2024-03-11T03:59:59.999Z"); // DST starts that day
  assert.equal(endOfLocalDay("2024-01-10", "Asia/Tokyo"), "2024-01-10T14:59:59.999Z");
  assert.equal(endOfLocalDay("2024-01-10", "UTC"), "2024-01-10T23:59:59.999Z");
});

test("a date-only publication spans the whole source-local day; midnight is never assumed", () => {
  // Stored as local midnight: the conservative bound is still the end of that day.
  const proof = dateProof("2024-01-10T00:00:00-05:00");
  assert.deepEqual(conservativeAvailability(proof), { known: true, upper_bound: "2024-01-11T04:59:59.999Z" });
  assert.equal(publicAtCutoff(proof, "2024-01-10T12:00:00-05:00"), "not_yet_public");
  assert.equal(publicAtCutoff(proof, "2024-01-10T23:59:59.999-05:00"), "eligible");
});

test("public Jan 10, ingested Feb 1, cutoff Jan 15: eligible from the source-version proof alone", () => {
  assert.equal(publicAtCutoff(dateProof("2024-01-10T23:59:59.999-05:00"), "2024-01-15T23:59:59.999-05:00"), "eligible");
  // A Jan 20 restatement is not public at a Jan 15 cutoff.
  assert.equal(publicAtCutoff(dateProof("2024-01-20T23:59:59.999-05:00"), "2024-01-15T23:59:59.999-05:00"), "not_yet_public");
});

test("instant and observed proofs use their exact upper bound", () => {
  const instant: PublicationTiming = { available_not_before: null, available_no_later_than: "2024-01-10T16:05:00Z", timing_precision: "instant", source_timezone: "UTC" };
  assert.equal(publicAtCutoff(instant, "2024-01-10T16:05:00Z"), "eligible");
  assert.equal(publicAtCutoff(instant, "2024-01-10T16:04:59.999Z"), "not_yet_public");
  const observed: PublicationTiming = { ...instant, timing_precision: "observed_public" };
  assert.equal(publicAtCutoff(observed, "2024-01-10T16:04:00Z"), "not_yet_public");
});

test("unknown or invalid source time zones cannot manufacture a publication time", () => {
  assert.deepEqual(conservativeAvailability(dateProof("2024-01-10T00:00:00Z", "Mars/Olympus")), { known: false });
  assert.equal(publicAtCutoff(dateProof("2024-01-10T00:00:00Z", ""), "2024-12-31T00:00:00Z"), "publication_time_unknown");
  assert.equal(publicAtCutoff(dateProof("not-a-date"), "2024-12-31T00:00:00Z"), "publication_time_unknown");
});

test("freshness is measured from the period end to the cutoff, never to execution time", () => {
  assert.equal(freshnessAt("2023-12-31", "2024-01-15T23:59:59.999-05:00", 30), "fresh");
  assert.equal(freshnessAt("2023-12-31", "2024-03-01T00:00:00Z", 30), "stale");
  assert.equal(freshnessAt("2023-12-31", "2024-01-30T00:00:00Z", 30), "fresh");
  assert.equal(freshnessAt("2023-12-31", "2024-01-31T00:00:00Z", 30), "stale");
  assert.equal(freshnessAt("2020-12-31", "2030-01-01T00:00:00Z", null), "fresh");
});
