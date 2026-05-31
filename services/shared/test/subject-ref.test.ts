import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMODITY_SUBJECT_KINDS,
  DECISION_HORIZONS,
  PUBLIC_SUBJECT_KINDS,
  SUBJECT_KINDS,
  assertPublicSubjectRef,
  assertSubjectRef,
  isPublicSubjectKind,
  formatSubjectRef,
  isSubjectKind,
  parseSubjectRefString,
} from "../src/subject-ref.ts";

const UUID = "00000000-0000-4000-8000-000000000001";

test("commodity subject kinds are the canonical market-stack vocabulary", () => {
  assert.deepEqual(COMMODITY_SUBJECT_KINDS, [
    "commodity",
    "benchmark",
    "contract",
    "curve",
    "region",
    "delivery_point",
    "asset",
    "producer",
    "route",
    "market_theme",
  ]);
  assert.deepEqual(DECISION_HORIZONS, ["1d", "1w", "1m", "3m"]);
  for (const kind of COMMODITY_SUBJECT_KINDS) {
    assert.equal(isSubjectKind(kind), true);
  }
  assert.equal(isSubjectKind("issuer"), true, "legacy equity kind remains accepted during migration");
  assert.equal(SUBJECT_KINDS.includes("portfolio"), true);
  assert.equal(SUBJECT_KINDS.includes("screen"), true);
});

test("public subject refs exclude legacy finance migration kinds", () => {
  assert.deepEqual(PUBLIC_SUBJECT_KINDS, [
    "commodity",
    "benchmark",
    "contract",
    "curve",
    "region",
    "delivery_point",
    "asset",
    "producer",
    "route",
    "market_theme",
    "portfolio",
    "screen",
  ]);
  assert.equal(isPublicSubjectKind("commodity"), true);
  assert.equal(isPublicSubjectKind("issuer"), false);
  assert.doesNotThrow(() => assertPublicSubjectRef({ kind: "commodity", id: UUID }, "subject"));
  assert.throws(
    () => assertPublicSubjectRef({ kind: "issuer", id: UUID }, "subject"),
    /subject.kind: must be one of commodity, benchmark, contract/,
  );
});

test("SubjectRef parsing and formatting supports commodity subjects", () => {
  const ref = { kind: "contract", id: UUID } as const;

  assertSubjectRef(ref, "contract_ref");
  assert.equal(formatSubjectRef(ref), `contract:${UUID}`);
  assert.deepEqual(parseSubjectRefString(`contract:${UUID}`), ref);
  assert.equal(parseSubjectRefString(`delivery_point:${UUID}`)?.kind, "delivery_point");
});
