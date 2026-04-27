import test from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryScreenRepository,
  ScreenNotFoundError,
} from "../src/screen-repository.ts";
import { persistScreen } from "../src/screen-subject.ts";
import type { ScreenerQuery } from "../src/query.ts";

const SCREEN_A = "11111111-1111-4111-a111-111111111111";
const SCREEN_B = "22222222-2222-4222-a222-222222222222";
const SCREEN_C = "33333333-3333-4333-a333-333333333333";

function query(): ScreenerQuery {
  return {
    universe: [{ field: "asset_type", values: ["common_stock"] }],
    market: [{ field: "last_price", min: 5 }],
    fundamentals: [{ field: "market_cap", min: 1_000_000_000 }],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
  };
}

function makeScreen(id: string, name: string, ts: string) {
  return persistScreen({
    screen_id: id,
    name,
    definition: query(),
    created_at: ts,
    updated_at: ts,
  });
}

test("save → find round-trip returns the saved screen", async () => {
  const repo = createInMemoryScreenRepository();
  const screen = makeScreen(SCREEN_A, "Large-cap tech", "2026-04-22T10:00:00.000Z");
  const result = await repo.save(screen);
  assert.equal(result.status, "created");
  assert.equal(result.screen.screen_id, SCREEN_A);
  const found = await repo.find(SCREEN_A);
  assert.equal(found?.name, "Large-cap tech");
});

test("save with an existing screen_id replaces and returns 'replaced' status", async () => {
  const repo = createInMemoryScreenRepository();
  const v1 = makeScreen(SCREEN_A, "v1", "2026-04-22T10:00:00.000Z");
  const v2 = persistScreen({
    screen_id: SCREEN_A,
    name: "v2",
    definition: query(),
    created_at: "2026-04-22T10:00:00.000Z",
    updated_at: "2026-04-23T10:00:00.000Z",
  });
  await repo.save(v1);
  const result = await repo.save(v2);
  assert.equal(result.status, "replaced");
  const found = await repo.find(SCREEN_A);
  assert.equal(found?.name, "v2");
  assert.equal(found?.updated_at, "2026-04-23T10:00:00.000Z");
});

test("find returns null when the screen_id is unknown", async () => {
  const repo = createInMemoryScreenRepository();
  const found = await repo.find(SCREEN_A);
  assert.equal(found, null);
});

test("find rejects malformed screen_id (not a UUID v4)", async () => {
  const repo = createInMemoryScreenRepository();
  await assert.rejects(() => repo.find("not-a-uuid"), /must be a UUID v4/);
});

test("list returns saved screens sorted by updated_at desc (freshest first)", async () => {
  const repo = createInMemoryScreenRepository();
  await repo.save(makeScreen(SCREEN_A, "old", "2026-04-20T00:00:00.000Z"));
  await repo.save(makeScreen(SCREEN_B, "newest", "2026-04-25T00:00:00.000Z"));
  await repo.save(makeScreen(SCREEN_C, "middle", "2026-04-22T00:00:00.000Z"));
  const items = await repo.list();
  assert.deepEqual(
    items.map((s) => s.name),
    ["newest", "middle", "old"],
  );
});

test("list returns a frozen array (caller cannot mutate)", async () => {
  const repo = createInMemoryScreenRepository();
  await repo.save(makeScreen(SCREEN_A, "x", "2026-04-22T00:00:00.000Z"));
  const items = await repo.list();
  assert.throws(() => (items as unknown as unknown[]).push("foo"));
});

test("delete removes the record; subsequent delete throws ScreenNotFoundError", async () => {
  const repo = createInMemoryScreenRepository();
  await repo.save(makeScreen(SCREEN_A, "x", "2026-04-22T00:00:00.000Z"));
  await repo.delete(SCREEN_A);
  assert.equal(await repo.find(SCREEN_A), null);
  await assert.rejects(() => repo.delete(SCREEN_A), ScreenNotFoundError);
});

test("delete rejects malformed screen_id", async () => {
  const repo = createInMemoryScreenRepository();
  await assert.rejects(() => repo.delete("nope"), /must be a UUID v4/);
});

test("createInMemoryScreenRepository accepts seeded initial records", async () => {
  const seed = [
    makeScreen(SCREEN_A, "seed-1", "2026-04-22T00:00:00.000Z"),
    makeScreen(SCREEN_B, "seed-2", "2026-04-23T00:00:00.000Z"),
  ];
  const repo = createInMemoryScreenRepository(seed);
  assert.equal((await repo.find(SCREEN_A))?.name, "seed-1");
  assert.equal((await repo.find(SCREEN_B))?.name, "seed-2");
});

test("createInMemoryScreenRepository rejects duplicate screen_ids in the seed", () => {
  const seed = [
    makeScreen(SCREEN_A, "x", "2026-04-22T00:00:00.000Z"),
    makeScreen(SCREEN_A, "y", "2026-04-23T00:00:00.000Z"),
  ];
  assert.throws(
    () => createInMemoryScreenRepository(seed),
    /duplicate screen_id/,
  );
});
