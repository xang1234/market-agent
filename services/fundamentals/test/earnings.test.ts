import test from "node:test";
import assert from "node:assert/strict";
import {
  freezeEarningsEventsEnvelope,
  type EarningsEventInput,
  type EarningsEventsEnvelopeInput,
} from "../src/earnings.ts";

const APPLE_ISSUER = { kind: "issuer" as const, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1" };
const SOURCE_ID = "00000000-0000-4000-a000-000000000007";

function makeEvent(overrides: Partial<EarningsEventInput> = {}): EarningsEventInput {
  return {
    release_date: "2024-10-31",
    period_end: "2024-09-28",
    fiscal_year: 2024,
    fiscal_period: "Q4",
    eps_actual: 1.64,
    eps_estimate_at_release: 1.6,
    source_id: SOURCE_ID,
    as_of: "2024-10-31T20:30:00.000Z",
    ...overrides,
  };
}

function makeEnvelope(events: EarningsEventInput[]): EarningsEventsEnvelopeInput {
  return {
    subject: APPLE_ISSUER,
    currency: "USD",
    events,
    as_of: "2024-11-01T20:30:00.000Z",
  };
}

test("freezeEarningsEventsEnvelope computes surprise_pct + direction from actual and estimate", () => {
  const env = freezeEarningsEventsEnvelope(makeEnvelope([makeEvent()]));
  const event = env.events[0];
  assert.equal(event.surprise_direction, "beat");
  assert.ok(event.surprise_pct !== null && Math.abs(event.surprise_pct - ((1.64 - 1.6) / 1.6) * 100) < 1e-9);
});

test("freezeEarningsEventsEnvelope flags miss when actual < estimate", () => {
  const env = freezeEarningsEventsEnvelope(
    makeEnvelope([makeEvent({ eps_actual: 1.88, eps_estimate_at_release: 1.94 })]),
  );
  assert.equal(env.events[0].surprise_direction, "miss");
  assert.ok(env.events[0].surprise_pct! < 0);
});

test("freezeEarningsEventsEnvelope flags inline when actual === estimate", () => {
  const env = freezeEarningsEventsEnvelope(
    makeEnvelope([makeEvent({ eps_actual: 1.5, eps_estimate_at_release: 1.5 })]),
  );
  assert.equal(env.events[0].surprise_direction, "inline");
  assert.equal(env.events[0].surprise_pct, 0);
});

test("freezeEarningsEventsEnvelope returns null surprise when actual or estimate is null", () => {
  const noActual = freezeEarningsEventsEnvelope(
    makeEnvelope([makeEvent({ eps_actual: null })]),
  );
  assert.equal(noActual.events[0].surprise_pct, null);
  assert.equal(noActual.events[0].surprise_direction, null);

  const noEstimate = freezeEarningsEventsEnvelope(
    makeEnvelope([makeEvent({ eps_estimate_at_release: null })]),
  );
  assert.equal(noEstimate.events[0].surprise_pct, null);
  assert.equal(noEstimate.events[0].surprise_direction, null);
});

test("freezeEarningsEventsEnvelope returns null surprise when estimate is zero (avoids div-by-zero)", () => {
  const env = freezeEarningsEventsEnvelope(
    makeEnvelope([makeEvent({ eps_estimate_at_release: 0 })]),
  );
  assert.equal(env.events[0].surprise_pct, null);
  assert.equal(env.events[0].surprise_direction, null);
});

test("freezeEarningsEventsEnvelope sorts events newest-first by release_date", () => {
  const env = freezeEarningsEventsEnvelope(
    makeEnvelope([
      makeEvent({ release_date: "2024-02-01", fiscal_year: 2024, fiscal_period: "Q1" }),
      makeEvent({ release_date: "2024-10-31", fiscal_year: 2024, fiscal_period: "Q4" }),
      makeEvent({ release_date: "2024-05-02", fiscal_year: 2024, fiscal_period: "Q2" }),
    ]),
  );
  assert.deepEqual(
    env.events.map((e) => e.release_date),
    ["2024-10-31", "2024-05-02", "2024-02-01"],
  );
});

test("freezeEarningsEventsEnvelope rejects duplicate fiscal periods", () => {
  assert.throws(
    () =>
      freezeEarningsEventsEnvelope(
        makeEnvelope([
          makeEvent({ fiscal_year: 2024, fiscal_period: "Q4" }),
          makeEvent({ fiscal_year: 2024, fiscal_period: "Q4", release_date: "2024-11-01" }),
        ]),
      ),
    /duplicate fiscal period 2024 Q4/,
  );
});

test("freezeEarningsEventsEnvelope rejects malformed input upfront", () => {
  assert.throws(
    () =>
      freezeEarningsEventsEnvelope(
        makeEnvelope([makeEvent({ source_id: "not-a-uuid" })]),
      ),
    /source_id/,
  );
  assert.throws(
    () =>
      freezeEarningsEventsEnvelope({
        ...makeEnvelope([]),
        currency: "DOLLARS",
      }),
    /currency/,
  );
});

test("freezeEarningsEventsEnvelope freezes the envelope and its events", () => {
  const env = freezeEarningsEventsEnvelope(makeEnvelope([makeEvent()]));
  assert.ok(Object.isFrozen(env));
  assert.ok(Object.isFrozen(env.events));
  assert.ok(Object.isFrozen(env.events[0]));
});
