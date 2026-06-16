import { test } from "node:test";
import assert from "node:assert/strict";
import { createFallthroughHoldersRepository } from "../src/fallthrough-holders-repository.ts";
import type { HoldersRepository } from "../src/holders-repository.ts";

const INSIDER_ENV = { kind: "insider", family: "holders" } as never;
const DEV_ENV = { kind: "institutional", family: "holders" } as never;

test("fallthrough serves primary when it has coverage (fallback not consulted)", async () => {
  const calls: string[] = [];
  const primary: HoldersRepository = { find: async () => { calls.push("primary"); return INSIDER_ENV; } };
  const fallback: HoldersRepository = { find: async () => { calls.push("fallback"); return DEV_ENV; } };
  const composed = createFallthroughHoldersRepository(primary, fallback);
  const result = await composed.find("11111111-1111-4111-8111-111111111111" as never, "insider");
  assert.equal(result, INSIDER_ENV);
  assert.deepEqual(calls, ["primary"]);
});

test("fallthrough falls back when primary returns null", async () => {
  const primary: HoldersRepository = { find: async () => null };
  const fallback: HoldersRepository = { find: async () => DEV_ENV };
  const composed = createFallthroughHoldersRepository(primary, fallback);
  assert.equal(await composed.find("11111111-1111-4111-8111-111111111111" as never, "institutional"), DEV_ENV);
});
