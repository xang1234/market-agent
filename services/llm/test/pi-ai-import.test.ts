import assert from "node:assert/strict";
import test from "node:test";

test("imports pi-ai package", async () => {
  const piAi = await import("@earendil-works/pi-ai");

  assert.ok(piAi);
  assert.ok(Object.keys(piAi).length > 0);
});
