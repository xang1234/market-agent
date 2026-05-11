import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  SUBJECT_KINDS,
  assertSubjectRef,
  formatSubjectRef,
  isSubjectKind,
  isSubjectRef,
  parseSubjectRefString,
} from "../src/subject-ref.ts";

const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
const blockSchemaPath = join(workspaceRoot, "spec", "finance_research_block_schema.json");
const VALID_ID = "11111111-1111-4111-8111-111111111111";

test("SUBJECT_KINDS matches spec/finance_research_block_schema.json#/$defs/SubjectKind", () => {
  const schema = JSON.parse(readFileSync(blockSchemaPath, "utf8")) as {
    $defs: { SubjectKind: { enum: string[] } };
  };
  assert.deepEqual([...SUBJECT_KINDS], schema.$defs.SubjectKind.enum);
});

test("assertSubjectRef accepts every canonical SubjectKind with a UUID id", () => {
  for (const kind of SUBJECT_KINDS) {
    assertSubjectRef({ kind, id: VALID_ID }, "ref");
  }
});

test("subject kind and ref predicates enforce the canonical vocabulary", () => {
  assert.equal(isSubjectKind("issuer"), true);
  assert.equal(isSubjectKind("ticker"), false);
  assert.equal(isSubjectRef({ kind: "listing", id: VALID_ID }), true);
  assert.equal(isSubjectRef({ kind: "listing", id: "AAPL" }), false);
  assert.equal(isSubjectRef({ kind: "ticker", id: VALID_ID }), false);
});

test("assertSubjectRef rejects malformed shapes with a labeled error", () => {
  for (const malformed of [
    null,
    "not_an_object",
    {},
    { kind: "issuer" },
    { kind: "not_a_kind", id: VALID_ID },
    { kind: "issuer", id: "" },
    { kind: "issuer", id: "   " },
    { kind: "issuer", id: "not-uuid" },
  ]) {
    assert.throws(
      () => assertSubjectRef(malformed, "ref"),
      (err: Error) => /^ref(\.kind|\.id)?:/.test(err.message),
      `expected labeled error for ${JSON.stringify(malformed)}`,
    );
  }
});

test("formatSubjectRef and parseSubjectRefString roundtrip canonical refs", () => {
  const ref = { kind: "issuer" as const, id: VALID_ID };
  const formatted = formatSubjectRef(ref);
  assert.equal(formatted, `issuer:${VALID_ID}`);
  assert.deepEqual(parseSubjectRefString(formatted), ref);
});

test("parseSubjectRefString rejects route input and malformed canonical strings", () => {
  assert.equal(parseSubjectRefString("AAPL"), null);
  assert.equal(parseSubjectRefString("issuer:not-uuid"), null);
  assert.equal(parseSubjectRefString("ticker:11111111-1111-4111-8111-111111111111"), null);
  assert.equal(parseSubjectRefString("issuer:"), null);
});
