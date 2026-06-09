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

test("screen source delegates to the injected resolver", async () => {
  const refs = await resolveUniverse(deps(), USER_ID, { source: "screen", screen_id: "s1" });
  assert.deepEqual(refs, [REF_A, REF_B]);
});

test("invalid manual subject_refs raise GridValidationError", async () => {
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "manual", subject_refs: [{ kind: "bogus", id: "x" } as never] }),
    GridValidationError,
  );
});
