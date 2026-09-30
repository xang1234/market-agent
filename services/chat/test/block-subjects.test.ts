import assert from "node:assert/strict";
import test from "node:test";

import { subjectRefsForBlock } from "../src/local-runtime.ts";

const NVDA_ISSUER = { kind: "issuer" as const, id: "60000000-0000-4000-8000-000000000001" };
const AMD_ISSUER = { kind: "issuer" as const, id: "60000000-0000-4000-8000-000000000002" };
const NVDA_LISTING = { kind: "listing" as const, id: "62000000-0000-4000-8000-000000000001" };
const AMD_LISTING = { kind: "listing" as const, id: "62000000-0000-4000-8000-000000000002" };

test("a block that lists its own subjects keeps them, one per label and line", () => {
  const performance = { kind: "perf_comparison", subject_refs: [NVDA_LISTING, AMD_LISTING] };
  assert.deepEqual(subjectRefsForBlock(performance, [NVDA_ISSUER, AMD_ISSUER]), [NVDA_LISTING, AMD_LISTING]);
});

test("other blocks carry the turn's subjects plus any they name", () => {
  const comparison = { kind: "metrics_comparison", subjects: [NVDA_ISSUER, AMD_ISSUER] };
  assert.deepEqual(subjectRefsForBlock(comparison, [NVDA_LISTING]), [NVDA_LISTING, NVDA_ISSUER, AMD_ISSUER]);
  assert.deepEqual(subjectRefsForBlock({ kind: "rich_text" }, [NVDA_LISTING]), [NVDA_LISTING]);
});
