import test from "node:test";
import assert from "node:assert/strict";
import { resolveScreenWith } from "../src/universe-wiring.ts";
import { GridValidationError } from "../src/types.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const SCREEN = "55555555-5555-4555-a555-555555555555";

const FAKE_SCREEN = { screen_id: SCREEN, user_id: USER, name: "s", definition: { market: [], sort: [], page: { limit: 10 } }, created_at: "x", updated_at: "x" };

test("resolveScreenWith maps executed screen rows to subject refs", async () => {
  const refs = await resolveScreenWith(
    { find: async () => FAKE_SCREEN, execute: async () => ({ rows: [{ subject_ref: { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" } }] }) },
    USER,
    SCREEN,
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "issuer");
});

test("resolveScreenWith denies a screen the user does not own", async () => {
  await assert.rejects(
    () => resolveScreenWith({ find: async () => ({ ...FAKE_SCREEN, user_id: "other" }), execute: async () => ({ rows: [] }) }, USER, SCREEN),
    GridValidationError,
  );
});

test("resolveScreenWith denies a missing screen", async () => {
  await assert.rejects(
    () => resolveScreenWith({ find: async () => null, execute: async () => ({ rows: [] }) }, USER, SCREEN),
    GridValidationError,
  );
});
