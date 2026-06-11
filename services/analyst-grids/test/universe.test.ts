import test from "node:test";
import assert from "node:assert/strict";

import { resolveUniverse, type UniverseResolverDeps } from "../src/universe.ts";
import { GridValidationError } from "../src/types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const REF_A: SubjectRef = { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" };
const REF_B: SubjectRef = { kind: "issuer", id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" };

function deps(over: Partial<UniverseResolverDeps> = {}): UniverseResolverDeps {
  return {
    resolveScreen: async () => [REF_A, REF_B],
    resolveWatchlist: async () => [REF_A],
    resolvePortfolio: async () => [REF_B],
    resolvePeers: async () => [REF_A, REF_B],
    ...over,
  };
}

test("manual source returns its inline subject_refs unchanged", async () => {
  const refs = await resolveUniverse(deps(), USER_ID, {
    source: "manual",
    subject_refs: [REF_A, REF_B],
  });
  assert.deepEqual(refs, [REF_A, REF_B]);
});

const SCREEN_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";

test("screen source delegates to the injected resolver", async () => {
  const refs = await resolveUniverse(deps(), USER_ID, { source: "screen", screen_id: SCREEN_ID });
  assert.deepEqual(refs, [REF_A, REF_B]);
});

test("empty watchlist_id raises GridValidationError without calling the resolver", async () => {
  let called = false;
  const d = deps({
    resolveWatchlist: async () => {
      called = true;
      return [REF_A];
    },
  });
  await assert.rejects(
    () => resolveUniverse(d, USER_ID, { source: "watchlist", watchlist_id: "" }),
    GridValidationError,
  );
  assert.equal(called, false, "resolver must not see an invalid id");
});

test("non-uuid ids raise GridValidationError for every id-based source", async () => {
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "screen", screen_id: "s1" }),
    GridValidationError,
  );
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "portfolio", portfolio_id: "not-a-uuid" }),
    GridValidationError,
  );
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "peers", issuer_id: "AAPL" }),
    GridValidationError,
  );
});

test("manual source without a subject_refs array raises GridValidationError", async () => {
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "manual" } as never),
    GridValidationError,
  );
});

test("invalid manual subject_refs raise GridValidationError", async () => {
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "manual", subject_refs: [{ kind: "bogus", id: "x" } as never] }),
    GridValidationError,
  );
});

test("peers limit is clamped to a bounded positive integer range", async () => {
  let captured: number | undefined;
  const d = deps({
    resolvePeers: async (_issuerId, limit) => {
      captured = limit;
      return [REF_A];
    },
  });
  const base = { source: "peers", issuer_id: REF_A.id } as const;
  await resolveUniverse(d, USER_ID, { ...base, limit: 9999 });
  assert.equal(captured, 50); // clamped to MAX_PEER_LIMIT
  await resolveUniverse(d, USER_ID, { ...base, limit: 0 });
  assert.equal(captured, 1); // raised to the minimum
  await resolveUniverse(d, USER_ID, base);
  assert.equal(captured, 5); // DEFAULT_PEER_LIMIT when unspecified
});
