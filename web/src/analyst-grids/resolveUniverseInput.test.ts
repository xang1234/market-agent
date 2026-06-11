import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveUniverseSpecInput,
  UnresolvedTickersError,
} from "./resolveUniverseInput.ts";
import type { ResolvedSubject } from "../symbol/search.ts";

const ISSUER_ID = "75b269c6-8586-4508-a52d-491cfeeb45eb";
const OTHER_ISSUER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function listingSubject(issuerId: string): ResolvedSubject {
  return {
    subject_ref: { kind: "listing", id: "511d853d-54b6-47fe-a49b-6766fa50a8a5" },
    display_name: "AAPL · XNAS — Apple Inc.",
    confidence: 0.95,
    context: {
      issuer: {
        subject_ref: { kind: "issuer", id: issuerId },
        legal_name: "Apple Inc.",
      },
    },
  };
}

function issuerSubject(issuerId: string): ResolvedSubject {
  return {
    subject_ref: { kind: "issuer", id: issuerId },
    display_name: "Apple Inc.",
    confidence: 0.95,
  };
}

test("manual tickers resolve to issuer refs via the listing's issuer context", async () => {
  const resolved = await resolveUniverseSpecInput(
    { source: "manual", subject_refs: [{ kind: "issuer", id: "AAPL" }] },
    async ({ text }) => {
      assert.equal(text, "AAPL");
      return { subjects: [listingSubject(ISSUER_ID)] };
    },
  );
  assert.deepEqual(resolved, {
    source: "manual",
    subject_refs: [{ kind: "issuer", id: ISSUER_ID }],
  });
});

test("issuer-kind resolutions are used directly", async () => {
  const resolved = await resolveUniverseSpecInput(
    { source: "manual", subject_refs: [{ kind: "issuer", id: "Apple" }] },
    async () => ({ subjects: [issuerSubject(ISSUER_ID)] }),
  );
  assert.deepEqual(resolved, {
    source: "manual",
    subject_refs: [{ kind: "issuer", id: ISSUER_ID }],
  });
});

test("uuid entries pass through without calling the resolver", async () => {
  let calls = 0;
  const resolved = await resolveUniverseSpecInput(
    { source: "manual", subject_refs: [{ kind: "issuer", id: OTHER_ISSUER_ID }] },
    async () => {
      calls += 1;
      return { subjects: [] };
    },
  );
  assert.equal(calls, 0);
  assert.deepEqual(resolved, {
    source: "manual",
    subject_refs: [{ kind: "issuer", id: OTHER_ISSUER_ID }],
  });
});

test("unresolvable tickers throw UnresolvedTickersError naming them", async () => {
  await assert.rejects(
    () =>
      resolveUniverseSpecInput(
        { source: "manual", subject_refs: [{ kind: "issuer", id: "NOTREAL" }, { kind: "issuer", id: "FAKE2" }] },
        async () => ({ subjects: [] }),
      ),
    (error: unknown) =>
      error instanceof UnresolvedTickersError &&
      /NOTREAL/.test(error.message) &&
      /FAKE2/.test(error.message),
  );
});

test("a resolver failure marks the entry unresolved instead of crashing", async () => {
  await assert.rejects(
    () =>
      resolveUniverseSpecInput(
        { source: "manual", subject_refs: [{ kind: "issuer", id: "AAPL" }] },
        async () => {
          throw new Error("resolver down");
        },
      ),
    UnresolvedTickersError,
  );
});

test("peers source resolves a ticker issuer_id", async () => {
  const resolved = await resolveUniverseSpecInput(
    { source: "peers", issuer_id: "AAPL" },
    async () => ({ subjects: [listingSubject(ISSUER_ID)] }),
  );
  assert.deepEqual(resolved, { source: "peers", issuer_id: ISSUER_ID });
});

test("non-manual, non-peers specs pass through untouched", async () => {
  let calls = 0;
  const spec = { source: "watchlist", watchlist_id: OTHER_ISSUER_ID };
  const resolved = await resolveUniverseSpecInput(spec, async () => {
    calls += 1;
    return { subjects: [] };
  });
  assert.equal(calls, 0);
  assert.equal(resolved, spec);
});
