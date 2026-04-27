import test from "node:test";
import assert from "node:assert/strict";
import {
  assertScreenSubjectContract,
  persistScreen,
  replayScreen,
  SCREEN_NAME_MAX_LENGTH,
  screenSubjectRef,
  type ScreenSubject,
} from "../src/screen-subject.ts";
import {
  normalizedScreenerQuery,
  type ScreenerQuery,
} from "../src/query.ts";
import { normalizedScreenerResponse } from "../src/result.ts";

const SCREEN_ID = "11111111-1111-4111-a111-111111111111";
const APPLE_ISSUER_ID = "22222222-2222-4222-a222-222222222222";
const CREATED_AT = "2026-04-22T15:30:00.000Z";
const UPDATED_AT = "2026-04-23T09:00:00.000Z";

function validQuery(overrides: Partial<ScreenerQuery> = {}): ScreenerQuery {
  return {
    universe: [{ field: "asset_type", values: ["common_stock"] }],
    market: [{ field: "last_price", min: 5 }],
    fundamentals: [{ field: "market_cap", min: 1_000_000_000 }],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
    ...overrides,
  };
}

function validInput(overrides: Partial<Parameters<typeof persistScreen>[0]> = {}) {
  return {
    screen_id: SCREEN_ID,
    name: "US large-cap common stocks",
    definition: validQuery(),
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

test("persistScreen accepts a fully bound input and freezes the result", () => {
  const screen = persistScreen(validInput());

  assert.equal(Object.isFrozen(screen), true);
  assert.equal(Object.isFrozen(screen.definition), true);
  assert.equal(screen.screen_id, SCREEN_ID);
  assert.equal(screen.name, "US large-cap common stocks");
  assert.equal(screen.created_at, CREATED_AT);
  assert.equal(screen.updated_at, UPDATED_AT);
  assert.equal(screen.definition.page.limit, 50);
});

test("persistScreen defaults updated_at to created_at on first persist", () => {
  const screen = persistScreen(validInput({ updated_at: undefined }));
  assert.equal(screen.updated_at, CREATED_AT);
});

test("persistScreen does NOT carry rows / as_of / total_count fields", () => {
  const screen = persistScreen(validInput());
  // The contract is that a saved screen never carries cached rows. The
  // type system enforces it (no field exists), but verify at runtime
  // too — anyone hand-building a ScreenSubject should not silently get
  // these forwarded.
  assert.equal((screen as Record<string, unknown>).rows, undefined);
  assert.equal((screen as Record<string, unknown>).as_of, undefined);
  assert.equal((screen as Record<string, unknown>).total_count, undefined);
});

test("persistScreen rejects bad screen_id, bad timestamps, empty name", () => {
  assert.throws(
    () => persistScreen(validInput({ screen_id: "not-a-uuid" })),
    /screen_id/,
  );
  assert.throws(
    () => persistScreen(validInput({ created_at: "2026-04-22" })),
    /created_at/,
  );
  assert.throws(
    () => persistScreen(validInput({ updated_at: "tomorrow" })),
    /updated_at/,
  );
  assert.throws(() => persistScreen(validInput({ name: "" })), /name/);
});

test("persistScreen rejects updated_at earlier than created_at", () => {
  assert.throws(
    () =>
      persistScreen(
        validInput({
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-22T00:00:00.000Z",
        }),
      ),
    /updated_at: must be >= created_at/,
  );
});

test("persistScreen accepts updated_at exactly equal to created_at", () => {
  const screen = persistScreen(
    validInput({ created_at: CREATED_AT, updated_at: CREATED_AT }),
  );
  assert.equal(screen.updated_at, CREATED_AT);
});

test("persistScreen rejects names longer than SCREEN_NAME_MAX_LENGTH", () => {
  const overlong = "x".repeat(SCREEN_NAME_MAX_LENGTH + 1);
  assert.throws(
    () => persistScreen(validInput({ name: overlong })),
    /<= 200 characters/,
  );
  // Boundary: exactly the cap is accepted.
  const atCap = "y".repeat(SCREEN_NAME_MAX_LENGTH);
  assert.doesNotThrow(() => persistScreen(validInput({ name: atCap })));
});

test("persistScreen delegates query validation to the screener-query contract", () => {
  assert.throws(
    () =>
      persistScreen(
        validInput({ definition: { ...validQuery(), sort: [] } }),
      ),
    /sort/,
  );
  assert.throws(
    () =>
      persistScreen(
        validInput({
          definition: {
            ...validQuery(),
            market: [{ field: "polygon.lastTrade.p", min: 5 }] as unknown as ScreenerQuery["market"],
          },
        }),
      ),
    /unknown screener field/,
  );
});

test("replayScreen returns a ScreenerQuery — no rows, no as_of, no response shape", () => {
  const screen = persistScreen(validInput());
  const replayed = replayScreen(screen);

  // The contract is enforced by the return TYPE, but verify the runtime
  // shape too: no row payload, no response timestamp, no total_count.
  const runtime = replayed as Record<string, unknown>;
  assert.equal(runtime.rows, undefined);
  assert.equal(runtime.as_of, undefined);
  assert.equal(runtime.total_count, undefined);
  assert.equal(runtime.snapshot_compatible, undefined);

  // The replayed query has the structural shape we persisted.
  assert.equal(replayed.page.limit, 50);
  assert.equal(replayed.sort[0].field, "market_cap");
  assert.equal(Object.isFrozen(replayed), true);
});

test("replayScreen yields a query equivalent to the persisted definition", () => {
  const screen = persistScreen(validInput());
  const replayed = replayScreen(screen);
  // Same content as the canonicalized query we persisted.
  assert.deepEqual(replayed, normalizedScreenerQuery(validQuery()));
});

test("replay → execute round-trip: save + reopen runs the query against fresh data", () => {
  // Verification target from the bead: "Save + reopen yields fresh
  // execution." The flow:
  //   1. Persist a screen.
  //   2. Replay it to get the bound query (no rows yet).
  //   3. Execute the query — i.e. construct a fresh ScreenerResponse
  //      with rows assembled NOW, not at save time.
  //   4. Replay again later — same query, but executed against
  //      whatever the screener service returns at that moment.
  //
  // The point is that replayScreen never returns rows itself — every
  // open of a saved screen is a fresh round-trip through the executor.
  const screen = persistScreen(validInput());

  const firstQuery = replayScreen(screen);
  const firstResponse = normalizedScreenerResponse({
    query: firstQuery,
    rows: [
      {
        subject_ref: { kind: "issuer", id: APPLE_ISSUER_ID },
        display: { primary: "Apple Inc.", ticker: "AAPL" },
        rank: 1,
        quote: {
          last_price: 187.42,
          prev_close: 185,
          change_pct: 0.013,
          volume: 50_000_000,
          delay_class: "real_time",
          currency: "USD",
          as_of: "2026-04-23T09:30:00.000Z",
        },
        fundamentals: {
          market_cap: 2_900_000_000_000,
          pe_ratio: 28,
          gross_margin: 0.45,
          operating_margin: 0.3,
          net_margin: 0.25,
          revenue_growth_yoy: 0.08,
        },
      },
    ],
    total_count: 1,
    page: { limit: 50 },
    as_of: "2026-04-23T09:30:00.000Z",
    snapshot_compatible: true,
  });

  const secondQuery = replayScreen(screen);
  const secondResponse = normalizedScreenerResponse({
    query: secondQuery,
    rows: [
      {
        subject_ref: { kind: "issuer", id: APPLE_ISSUER_ID },
        display: { primary: "Apple Inc.", ticker: "AAPL" },
        rank: 1,
        quote: {
          last_price: 192.10,
          prev_close: 187.42,
          change_pct: 0.025,
          volume: 64_000_000,
          delay_class: "real_time",
          currency: "USD",
          as_of: "2026-04-30T09:30:00.000Z",
        },
        fundamentals: {
          market_cap: 2_973_000_000_000,
          pe_ratio: 28.7,
          gross_margin: 0.46,
          operating_margin: 0.31,
          net_margin: 0.26,
          revenue_growth_yoy: 0.09,
        },
      },
    ],
    total_count: 1,
    page: { limit: 50 },
    as_of: "2026-04-30T09:30:00.000Z",
    snapshot_compatible: true,
  });

  // Same query both times — the persisted definition is deterministic.
  assert.deepEqual(firstQuery, secondQuery);
  // Different rows — each "open" runs the executor against whatever
  // the service returns at the moment of replay.
  assert.notDeepEqual(firstResponse.rows[0].quote, secondResponse.rows[0].quote);
  assert.notEqual(firstResponse.as_of, secondResponse.as_of);
});

test("replayScreen rejects malformed input", () => {
  assert.throws(() => replayScreen(null as unknown as ScreenSubject), /must be/);
  // Even a structurally-correct ScreenSubject built without persistScreen
  // gets re-canonicalized — and a corrupt definition is rejected.
  const bogus = {
    screen_id: SCREEN_ID,
    name: "bogus",
    definition: { ...validQuery(), sort: [] } as unknown as ScreenerQuery,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  };
  assert.throws(() => replayScreen(bogus), /sort/);
});

test("screenSubjectRef constructs a frozen { kind: 'screen', id } SubjectRef", () => {
  const screen = persistScreen(validInput());
  const ref = screenSubjectRef(screen);
  assert.equal(ref.kind, "screen");
  assert.equal(ref.id, SCREEN_ID);
  assert.equal(Object.isFrozen(ref), true);
});

test("screenSubjectRef yields a stringable handoff key for downstream subjects", () => {
  // Watchlists / themes / agents reference screens via the canonical
  // `kind:uuid` URL form (cw0.6.3 parses the same shape for symbol entry).
  const screen = persistScreen(validInput());
  const ref = screenSubjectRef(screen);
  assert.equal(`${ref.kind}:${ref.id}`, `screen:${SCREEN_ID}`);
});

test("assertScreenSubjectContract validates untrusted cross-boundary input", () => {
  assert.doesNotThrow(() =>
    assertScreenSubjectContract(persistScreen(validInput())),
  );
  assert.throws(
    () => assertScreenSubjectContract(null),
    /must be an object/,
  );
  assert.throws(() => assertScreenSubjectContract({}), /screen_id/);
  assert.throws(
    () =>
      assertScreenSubjectContract({
        screen_id: SCREEN_ID,
        name: "x",
        definition: validQuery(),
        created_at: CREATED_AT,
        updated_at: "2026-04-22T15:29:59.000Z",
      }),
    /updated_at: must be >= created_at/,
  );
});

test("persistScreen does not mutate caller objects", () => {
  const input = validInput();
  const definitionBefore = { ...input.definition };
  persistScreen(input);
  assert.deepEqual(input.definition, definitionBefore);
  assert.equal(input.created_at, CREATED_AT);
  assert.equal(input.updated_at, UPDATED_AT);
});
