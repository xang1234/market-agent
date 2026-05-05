import assert from "node:assert/strict";
import test from "node:test";

import type { ScreenSubject } from "../../screener/src/screen-subject.ts";

import {
  getHomeSavedScreens,
  MAX_HOME_SAVED_SCREENS_LIMIT,
} from "../src/saved-screens.ts";
import type { HomeSavedScreensProvider } from "../src/secondary-types.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const SCREEN_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SCREEN_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const SCREEN_C = "cccccccc-cccc-4ccc-accc-cccccccccccc";

function screen(
  overrides: Partial<ScreenSubject> & Pick<ScreenSubject, "screen_id" | "name" | "updated_at">,
): ScreenSubject {
  return Object.freeze({
    created_at: overrides.created_at ?? "2026-04-01T00:00:00.000Z",
    definition:
      overrides.definition ??
      Object.freeze({
        universe: Object.freeze([Object.freeze({ field: "exchange", values: Object.freeze(["XNAS"]) })]),
        market: Object.freeze([Object.freeze({ field: "price", min: 10 })]),
        fundamentals: Object.freeze([]),
        sort: Object.freeze([]),
        page: Object.freeze({ limit: 50 }),
      }),
    screen_id: overrides.screen_id,
    name: overrides.name,
    updated_at: overrides.updated_at,
  });
}

function staticProvider(rows: ReadonlyArray<ScreenSubject>): HomeSavedScreensProvider {
  return async () => rows;
}

test("getHomeSavedScreens returns rows sorted updated_at desc, truncated to limit", async () => {
  const rows = [
    screen({ screen_id: SCREEN_A, name: "High-momentum US large caps", updated_at: "2026-05-01T00:00:00.000Z" }),
    screen({ screen_id: SCREEN_B, name: "Cheap dividend aristocrats", updated_at: "2026-05-04T00:00:00.000Z" }),
    screen({ screen_id: SCREEN_C, name: "Recently-IPO'd software", updated_at: "2026-05-05T00:00:00.000Z" }),
  ];
  const result = await getHomeSavedScreens({
    user_id: USER_ID,
    listSavedScreens: staticProvider(rows),
    limit: 2,
  });
  assert.deepEqual(
    result.rows.map((row) => row.screen_id),
    [SCREEN_C, SCREEN_B],
  );
});

test("getHomeSavedScreens projects each row through the documented shape", async () => {
  const result = await getHomeSavedScreens({
    user_id: USER_ID,
    listSavedScreens: staticProvider([
      screen({ screen_id: SCREEN_A, name: "Basic universe", updated_at: "2026-05-05T12:00:00.000Z" }),
    ]),
  });
  const row = result.rows[0];
  assert.equal(row.screen_id, SCREEN_A);
  assert.equal(row.name, "Basic universe");
  assert.equal(row.updated_at, "2026-05-05T12:00:00.000Z");
  assert.deepEqual(row.replay_target, { kind: "screen", id: SCREEN_A });
});

test("getHomeSavedScreens summarises filter count and dimensions deterministically", async () => {
  const rows = [
    screen({
      screen_id: SCREEN_A,
      name: "Multi-dimension",
      updated_at: "2026-05-05T00:00:00.000Z",
      definition: Object.freeze({
        universe: Object.freeze([
          Object.freeze({ field: "exchange", values: Object.freeze(["XNAS"]) }),
        ]),
        market: Object.freeze([
          Object.freeze({ field: "price", min: 10 }),
          Object.freeze({ field: "volume", min: 1_000_000 }),
        ]),
        fundamentals: Object.freeze([Object.freeze({ field: "pe_ratio", max: 25 })]),
        sort: Object.freeze([]),
        page: Object.freeze({ limit: 50 }),
      }),
    }),
  ];
  const result = await getHomeSavedScreens({
    user_id: USER_ID,
    listSavedScreens: staticProvider(rows),
  });
  assert.equal(result.rows[0].filter_summary, "4 filters · universe, market, fundamentals");
});

test("getHomeSavedScreens reports a zero-filter screen with a stable phrase", async () => {
  const rows = [
    screen({
      screen_id: SCREEN_A,
      name: "Empty",
      updated_at: "2026-05-05T00:00:00.000Z",
      definition: Object.freeze({
        universe: Object.freeze([]),
        market: Object.freeze([]),
        fundamentals: Object.freeze([]),
        sort: Object.freeze([]),
        page: Object.freeze({ limit: 50 }),
      }),
    }),
  ];
  const result = await getHomeSavedScreens({
    user_id: USER_ID,
    listSavedScreens: staticProvider(rows),
  });
  assert.equal(result.rows[0].filter_summary, "no filters");
});

test("getHomeSavedScreens defaults limit to 5 and clamps the upper bound", async () => {
  const initial = Array.from({ length: 25 }, (_, i) =>
    screen({
      screen_id: `00000000-0000-4000-a000-${i.toString().padStart(12, "0")}`,
      name: `s${i}`,
      updated_at: `2026-05-${String(5 - (i % 5)).padStart(2, "0")}T00:00:00.000Z`,
    }),
  );

  const def = await getHomeSavedScreens({
    user_id: USER_ID,
    listSavedScreens: staticProvider(initial),
  });
  assert.equal(def.rows.length, 5);

  const big = await getHomeSavedScreens({
    user_id: USER_ID,
    listSavedScreens: staticProvider(initial),
    limit: 9_999,
  });
  assert.equal(big.rows.length, MAX_HOME_SAVED_SCREENS_LIMIT);
});

test("getHomeSavedScreens rejects non-positive limits", async () => {
  const provider = staticProvider([]);
  await assert.rejects(
    getHomeSavedScreens({ user_id: USER_ID, listSavedScreens: provider, limit: 0 }),
    /limit/i,
  );
  await assert.rejects(
    getHomeSavedScreens({ user_id: USER_ID, listSavedScreens: provider, limit: -1 }),
    /limit/i,
  );
  await assert.rejects(
    getHomeSavedScreens({ user_id: USER_ID, listSavedScreens: provider, limit: 1.5 }),
    /limit/i,
  );
});

test("getHomeSavedScreens rejects malformed user_id", async () => {
  await assert.rejects(
    getHomeSavedScreens({
      user_id: "not-a-uuid",
      listSavedScreens: staticProvider([]),
    }),
    /user_id/i,
  );
});

test("getHomeSavedScreens forwards user_id to the provider", async () => {
  let observed: string | null = null;
  const provider: HomeSavedScreensProvider = async (user_id) => {
    observed = user_id;
    return [];
  };
  await getHomeSavedScreens({ user_id: USER_ID, listSavedScreens: provider });
  assert.equal(observed, USER_ID);
});

test("getHomeSavedScreens never returns rows from a different user when the provider scopes correctly", async () => {
  // Per-user provider: returns rows tagged for the requested user only. This
  // models the contract Home relies on; the dev wiring must enforce it.
  const userScopedRows = new Map<string, ReadonlyArray<ScreenSubject>>([
    [USER_ID, [screen({ screen_id: SCREEN_A, name: "Mine", updated_at: "2026-05-05T00:00:00.000Z" })]],
    [OTHER_USER_ID, [screen({ screen_id: SCREEN_B, name: "Theirs", updated_at: "2026-05-05T00:00:00.000Z" })]],
  ]);
  const provider: HomeSavedScreensProvider = async (user_id) => userScopedRows.get(user_id) ?? [];
  const result = await getHomeSavedScreens({ user_id: USER_ID, listSavedScreens: provider });
  assert.deepEqual(
    result.rows.map((r) => r.screen_id),
    [SCREEN_A],
  );
});
