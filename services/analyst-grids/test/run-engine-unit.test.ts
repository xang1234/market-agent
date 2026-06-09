import test from "node:test";
import assert from "node:assert/strict";
import { runWithConcurrency, capUniverse, MAX_GRID_ROWS } from "../src/run-engine.ts";

test("capUniverse caps at MAX_GRID_ROWS and reports the dropped count", () => {
  const refs = Array.from({ length: 30 }, (_, i) => ({ kind: "issuer" as const, id: `id-${i}` }));
  const { capped, droppedRowCount } = capUniverse(refs);
  assert.equal(capped.length, MAX_GRID_ROWS);
  assert.equal(droppedRowCount, 30 - MAX_GRID_ROWS);
});

test("capUniverse leaves a small universe untouched", () => {
  const refs = [{ kind: "issuer" as const, id: "a" }];
  const { capped, droppedRowCount } = capUniverse(refs);
  assert.equal(capped.length, 1);
  assert.equal(droppedRowCount, 0);
});

test("runWithConcurrency runs all tasks and never exceeds the limit", async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(results.sort((a, b) => a - b), [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
});
