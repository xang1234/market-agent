import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { SUBJECT_KINDS } from "../src/subject-ref.ts";

const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
const blockSchemaPath = join(workspaceRoot, "spec", "finance_research_block_schema.json");

test("SUBJECT_KINDS matches spec/finance_research_block_schema.json#/$defs/SubjectKind", () => {
  const schema = JSON.parse(readFileSync(blockSchemaPath, "utf8"));
  const specEnum = schema?.$defs?.SubjectKind?.enum;
  assert.ok(Array.isArray(specEnum), "spec SubjectKind.enum should be an array");
  assert.deepEqual([...SUBJECT_KINDS], specEnum);
});
