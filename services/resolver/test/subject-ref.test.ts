import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { SUBJECT_KINDS, assertSubjectRef } from "../src/subject-ref.ts";

const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
const blockSchemaPath = join(workspaceRoot, "spec", "finance_research_block_schema.json");

test("SUBJECT_KINDS matches spec/finance_research_block_schema.json#/$defs/SubjectKind", () => {
  const schema = JSON.parse(readFileSync(blockSchemaPath, "utf8")) as {
    $defs: { SubjectKind: { enum: string[] } };
  };
  assert.deepEqual([...SUBJECT_KINDS], schema.$defs.SubjectKind.enum);
});

test("assertSubjectRef accepts every SubjectKind from the spec union", () => {
  for (const kind of SUBJECT_KINDS) {
    assertSubjectRef({ kind, id: "11111111-1111-4111-8111-111111111111" }, "ref");
  }
});

test("assertSubjectRef rejects malformed shapes with a labeled error", () => {
  for (const malformed of [null, "not_an_object", {}, { kind: "issuer" }, { kind: "not_a_kind", id: "x" }, { kind: "issuer", id: "" }]) {
    assert.throws(
      () => assertSubjectRef(malformed, "ref"),
      (err: Error) => /^ref(\.kind|\.id)?:/.test(err.message),
      `expected labeled error for ${JSON.stringify(malformed)}`,
    );
  }
});
