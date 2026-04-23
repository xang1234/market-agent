import test from "node:test";
import assert from "node:assert/strict";
import { serializeJsonValue, serializeNullableJsonValue } from "../src/types.ts";

test("serializeNullableJsonValue returns SQL NULL for undefined and null", () => {
  assert.equal(serializeNullableJsonValue(undefined), null);
  assert.equal(serializeNullableJsonValue(null), null);
});

test("serializeJsonValue rejects circular references", () => {
  const value: Record<string, unknown> = { name: "cycle" };
  value.self = value;

  assert.throws(() => serializeJsonValue(value as never), /circular/i);
});

test("serializeJsonValue rejects bigint payloads", () => {
  assert.throws(() => serializeJsonValue({ count: 1n } as never), /bigint/i);
});
