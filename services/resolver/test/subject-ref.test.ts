import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBJECT_KINDS,
  assertSubjectRef,
  formatSubjectRef,
  isSubjectRef,
  parseSubjectRefString,
} from "../src/subject-ref.ts";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

test("resolver re-exports the canonical SubjectRef helpers", () => {
  for (const kind of SUBJECT_KINDS) {
    assertSubjectRef({ kind, id: VALID_ID }, "ref");
  }
  assert.equal(formatSubjectRef({ kind: "issuer", id: VALID_ID }), `issuer:${VALID_ID}`);
  assert.deepEqual(parseSubjectRefString(`issuer:${VALID_ID}`), { kind: "issuer", id: VALID_ID });
});

test("resolver canonical SubjectRef rejects non-UUID route/search ids", () => {
  assert.equal(isSubjectRef({ kind: "listing", id: "AAPL" }), false);
  assert.throws(() => assertSubjectRef({ kind: "listing", id: "AAPL" }, "ref"), /ref\.id: must be a UUID/);
});
