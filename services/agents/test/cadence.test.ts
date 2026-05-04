import assert from "node:assert/strict";
import test from "node:test";

import {
  CadenceValidationError,
  compileAgentCadence,
  nextDueAt,
} from "../src/cadence.ts";

test("compileAgentCadence maps hourly cadence to a one-hour interval schedule", () => {
  assert.deepEqual(compileAgentCadence("hourly"), {
    cadence: "hourly",
    kind: "interval",
    interval_ms: 60 * 60 * 1000,
  });
});

test("compileAgentCadence maps daily cadence to a one-day interval schedule", () => {
  assert.deepEqual(compileAgentCadence("daily"), {
    cadence: "daily",
    kind: "interval",
    interval_ms: 24 * 60 * 60 * 1000,
  });
});

test("compileAgentCadence maps on-filing cadence to an event-driven schedule", () => {
  assert.deepEqual(compileAgentCadence("on-filing"), {
    cadence: "on-filing",
    kind: "event",
    event: "filing_ingested",
  });
});

test("compileAgentCadence rejects unsupported and empty cadences", () => {
  assert.throws(() => compileAgentCadence("weekly"), CadenceValidationError);
  assert.throws(() => compileAgentCadence(""), CadenceValidationError);
  assert.throws(() => compileAgentCadence(" daily "), CadenceValidationError);
});

test("nextDueAt advances interval schedules and returns null for event schedules", () => {
  const lastRun = "2026-05-04T00:00:00.000Z";
  assert.equal(
    nextDueAt(compileAgentCadence("hourly"), lastRun),
    "2026-05-04T01:00:00.000Z",
  );
  assert.equal(
    nextDueAt(compileAgentCadence("daily"), lastRun),
    "2026-05-05T00:00:00.000Z",
  );
  assert.equal(nextDueAt(compileAgentCadence("on-filing"), lastRun), null);
});

test("nextDueAt rejects invalid lastRunAt values", () => {
  assert.throws(
    () => nextDueAt(compileAgentCadence("hourly"), "invalid-date"),
    CadenceValidationError,
  );
});
