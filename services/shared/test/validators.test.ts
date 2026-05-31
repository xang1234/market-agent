import assert from "node:assert/strict";
import test from "node:test";

import {
  assertIsoDateTime,
  assertNonEmptyString,
  assertOneOf,
  assertUnitInterval,
  assertUuid,
} from "../src/validators.ts";

test("shared validators cover common service boundary checks", () => {
  assert.doesNotThrow(() => assertUuid("11111111-1111-4111-8111-111111111111", "id"));
  assert.doesNotThrow(() => assertIsoDateTime("2026-05-31T00:00:00.000Z", "as_of"));
  assert.doesNotThrow(() => assertUnitInterval(0.7, "confidence"));
  assert.doesNotThrow(() => assertNonEmptyString(" copper ", "label"));
  assert.doesNotThrow(() => assertOneOf("supply", ["supply", "demand"] as const, "channel"));

  assert.throws(() => assertUuid("not-a-uuid", "id"), /id must be a UUID v4/);
  assert.throws(() => assertIsoDateTime("2026-05-31", "as_of"), /as_of must be an ISO timestamp/);
  assert.throws(() => assertUnitInterval(1.1, "confidence"), /confidence must be in \[0, 1\]/);
  assert.throws(() => assertNonEmptyString(" ", "label"), /label must be a non-empty string/);
  assert.throws(() => assertOneOf("weather", ["supply", "demand"] as const, "channel"), /channel must be one of supply, demand/);
});
