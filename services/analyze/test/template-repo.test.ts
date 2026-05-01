import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import type { JsonValue, QueryExecutor } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../resolver/src/subject-ref.ts";
import {
  AnalyzeTemplateNotFoundError,
  AnalyzeTemplateValidationError,
  createAnalyzeTemplate,
  deleteAnalyzeTemplate,
  getAnalyzeTemplate,
  listAnalyzeTemplatesByUser,
  updateAnalyzeTemplate,
  type AnalyzeTemplateInput,
  type AnalyzeTemplateUpdate,
} from "../src/template-repo.ts";

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ISSUER_ID = "33333333-3333-4333-8333-333333333333";
const FIXED_NOW = "2026-05-01T12:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: QueryExecutor; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      const rows = responder(text, values) as R[];
      return {
        rows,
        rowCount: rows.length,
        command: "",
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

function templateRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    template_id: TEMPLATE_ID,
    user_id: USER_ID,
    name: "Quarterly earnings memo",
    prompt_template: "Summarize the latest quarter for {subject}.",
    source_categories: [],
    added_subject_refs: [],
    block_layout_hint: null,
    peer_policy: null,
    disclosure_policy: null,
    version: 1,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

const baseInput: AnalyzeTemplateInput = {
  user_id: USER_ID,
  name: "Quarterly earnings memo",
  prompt_template: "Summarize the latest quarter for {subject}.",
};

test("createAnalyzeTemplate inserts and returns a frozen row with version 1 and empty-array defaults", async () => {
  const { db, queries } = fakeDb(() => [templateRow()]);
  const row = await createAnalyzeTemplate(db, baseInput);
  assert.equal(row.template_id, TEMPLATE_ID);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.version, 1);
  assert.deepEqual([...row.source_categories], []);
  assert.deepEqual([...row.added_subject_refs], []);
  assert.equal(row.block_layout_hint, null);
  assert.equal(row.peer_policy, null);
  assert.equal(row.disclosure_policy, null);
  assert.equal(Object.isFrozen(row), true);
  assert.equal(queries[0].text.includes("insert into analyze_templates"), true);
  // user_id and name flow into the parameterized query; version is NOT bound
  // (the schema default + repo contract own initialization).
  assert.equal(queries[0].values?.[0], USER_ID);
  assert.equal(queries[0].values?.[1], "Quarterly earnings memo");
  assert.ok(
    !queries[0].text.includes("$8") || !/version/.test(queries[0].text.split("returning")[0] ?? ""),
    "insert must not bind version — schema default owns initialization",
  );
});

test("createAnalyzeTemplate rejects an empty name with AnalyzeTemplateValidationError", async () => {
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    createAnalyzeTemplate(db, { ...baseInput, name: "" }),
    (err: Error) => err instanceof AnalyzeTemplateValidationError && /name/.test(err.message),
  );
  assert.equal(queries.length, 0, "validator must short-circuit before any query");
});

test("createAnalyzeTemplate rejects an empty user_id", async () => {
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    createAnalyzeTemplate(db, { ...baseInput, user_id: "" }),
    (err: Error) => err instanceof AnalyzeTemplateValidationError && /user_id/.test(err.message),
  );
  assert.equal(queries.length, 0);
});

test("createAnalyzeTemplate rejects an empty prompt_template — a no-op template would silently produce empty memos", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    createAnalyzeTemplate(db, { ...baseInput, prompt_template: "" }),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /prompt_template/.test(err.message),
  );
});

test("createAnalyzeTemplate rejects non-array source_categories", async () => {
  // The downstream orchestrator (fra-oc8) maps source_categories to tool
  // bundles. Passing a string or object would silently coerce to JSON the
  // mapper can't enumerate; reject at the boundary instead.
  const { db } = fakeDb(() => []);
  await assert.rejects(
    createAnalyzeTemplate(db, {
      ...baseInput,
      source_categories: "company_profile" as unknown as ReadonlyArray<string>,
    }),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /source_categories/.test(err.message),
  );
});

test("createAnalyzeTemplate rejects source_categories with non-string elements", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    createAnalyzeTemplate(db, {
      ...baseInput,
      source_categories: [123 as unknown as string, "news"],
    }),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError &&
      /source_categories\[0\]/.test(err.message),
  );
});

test("createAnalyzeTemplate validates added_subject_refs with assertSubjectRef so a malformed kind cannot reach the bundle mapper", async () => {
  // Reuses the resolver's canonical validator. Either a missing id or an
  // unknown kind must surface from there.
  const { db } = fakeDb(() => []);
  await assert.rejects(
    createAnalyzeTemplate(db, {
      ...baseInput,
      added_subject_refs: [{ kind: "not_a_kind", id: ISSUER_ID } as unknown as SubjectRef],
    }),
    (err: Error) => /^added_subject_refs\[0\]\.kind/.test(err.message),
  );
});

test("createAnalyzeTemplate serialises optional jsonb fields and stores added_subject_refs as a JSON array", async () => {
  const layoutHint: JsonValue = { sections: ["overview", "financials"] };
  const peerPolicy: JsonValue = { mode: "benchmark", max_peers: 5 };
  const disclosurePolicy: JsonValue = { include_sources: true };
  const refs: ReadonlyArray<SubjectRef> = [{ kind: "issuer", id: ISSUER_ID }];
  const { db, queries } = fakeDb(() => [
    templateRow({
      added_subject_refs: refs,
      block_layout_hint: layoutHint,
      peer_policy: peerPolicy,
      disclosure_policy: disclosurePolicy,
    }),
  ]);
  const row = await createAnalyzeTemplate(db, {
    ...baseInput,
    source_categories: ["financials_quarterly", "news"],
    added_subject_refs: refs,
    block_layout_hint: layoutHint,
    peer_policy: peerPolicy,
    disclosure_policy: disclosurePolicy,
  });
  // The insert binds each jsonb column as a serialised string for the cast.
  // Order tracks the insert-column order in the implementation.
  const values = queries[0].values ?? [];
  assert.equal(
    values.includes(JSON.stringify(["financials_quarterly", "news"])),
    true,
    "source_categories must be serialised for the jsonb cast",
  );
  assert.equal(values.includes(JSON.stringify(refs)), true);
  assert.equal(values.includes(JSON.stringify(layoutHint)), true);
  assert.equal(values.includes(JSON.stringify(peerPolicy)), true);
  assert.equal(values.includes(JSON.stringify(disclosurePolicy)), true);
  assert.deepEqual(row.block_layout_hint, layoutHint);
});

test("getAnalyzeTemplate returns null when the row does not exist", async () => {
  const { db } = fakeDb(() => []);
  const row = await getAnalyzeTemplate(db, TEMPLATE_ID);
  assert.equal(row, null);
});

test("getAnalyzeTemplate rejects an empty template_id with AnalyzeTemplateValidationError", async () => {
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    getAnalyzeTemplate(db, ""),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /template_id/.test(err.message),
  );
  assert.equal(queries.length, 0);
});

test("getAnalyzeTemplate returns the parsed row with subject_refs and version surfaced", async () => {
  const refs = [{ kind: "issuer", id: ISSUER_ID }];
  const { db } = fakeDb(() => [
    templateRow({ added_subject_refs: refs, version: 7 }),
  ]);
  const row = await getAnalyzeTemplate(db, TEMPLATE_ID);
  assert.ok(row);
  assert.equal(row.version, 7);
  assert.deepEqual([...row.added_subject_refs], refs);
});

test("listAnalyzeTemplatesByUser scopes by user_id, orders by name ascending, and freezes the array", async () => {
  // Templates are user-owned — listing must filter by user_id, never return
  // another user's rows. Order-by-name makes the picker UI deterministic.
  const { db, queries } = fakeDb(() => [
    templateRow({ name: "Competitive snapshot" }),
    templateRow({ template_id: "44444444-4444-4444-8444-444444444444", name: "Thesis review" }),
  ]);
  const rows = await listAnalyzeTemplatesByUser(db, USER_ID);
  assert.equal(rows.length, 2);
  assert.equal(Object.isFrozen(rows), true);
  assert.equal(queries[0].values?.[0], USER_ID);
  assert.equal(queries[0].text.includes("where user_id ="), true);
  assert.equal(queries[0].text.includes("order by name asc"), true);
});

test("listAnalyzeTemplatesByUser rejects an empty user_id", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    listAnalyzeTemplatesByUser(db, ""),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /user_id/.test(err.message),
  );
});

test("updateAnalyzeTemplate bumps version and returns the updated row", async () => {
  // Each successful update bumps version; reruns on an old version anchor
  // back to a sealed snapshot from that version, so the bump is the
  // explainability hook.
  const { db, queries } = fakeDb(() => [
    templateRow({ name: "renamed", version: 2 }),
  ]);
  const row = await updateAnalyzeTemplate(db, TEMPLATE_ID, { name: "renamed" });
  assert.equal(row.name, "renamed");
  assert.equal(row.version, 2);
  // The update SQL must increment version atomically (not read-modify-write).
  assert.match(queries[0].text, /version\s*=\s*version\s*\+\s*1/);
  assert.match(queries[0].text, /updated_at\s*=\s*now\(\)/);
});

test("updateAnalyzeTemplate rejects an empty patch — silent no-ops are a footgun", async () => {
  // An empty patch would still bump version (because the SQL does), creating
  // a phantom revision with no semantic change. Reject at the validator.
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    updateAnalyzeTemplate(db, TEMPLATE_ID, {} as AnalyzeTemplateUpdate),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /at least one/i.test(err.message),
  );
  assert.equal(queries.length, 0);
});

test("updateAnalyzeTemplate throws AnalyzeTemplateNotFoundError when the row is missing", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    updateAnalyzeTemplate(db, TEMPLATE_ID, { name: "renamed" }),
    (err: Error) => err instanceof AnalyzeTemplateNotFoundError,
  );
});

test("updateAnalyzeTemplate validates added_subject_refs in the patch with the same canonical assertion", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    updateAnalyzeTemplate(db, TEMPLATE_ID, {
      added_subject_refs: [{ kind: "issuer", id: "" } as unknown as SubjectRef],
    }),
    (err: Error) => /^added_subject_refs\[0\]\.id/.test(err.message),
  );
});

test("updateAnalyzeTemplate validates source_categories shape in the patch", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    updateAnalyzeTemplate(db, TEMPLATE_ID, {
      source_categories: [42 as unknown as string],
    }),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /source_categories\[0\]/.test(err.message),
  );
});

test("updateAnalyzeTemplate uses COALESCE so omitted fields keep their previous value", async () => {
  // The patch supplies only `name`; the SQL must not null out any other
  // column. COALESCE($n, column) is the idiomatic shape — a literal `update
  // ... set name = $1` would be fine here too, but as the patch surface
  // grows the COALESCE pattern lets every column be optional from one
  // template-shaped statement.
  const { db, queries } = fakeDb(() => [templateRow({ name: "renamed", version: 2 })]);
  await updateAnalyzeTemplate(db, TEMPLATE_ID, { name: "renamed" });
  // Either pattern is acceptable, but the intent — that omitted columns are
  // preserved — must be encoded in the SQL.
  assert.ok(
    /coalesce\(/i.test(queries[0].text) || !/=\s*\$\d+/.test(queries[0].text.replace(/where[\s\S]+/i, "")),
    "update must preserve omitted columns (typically via COALESCE on each optional bind)",
  );
});

test("deleteAnalyzeTemplate throws AnalyzeTemplateNotFoundError when the row is missing", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    deleteAnalyzeTemplate(db, TEMPLATE_ID),
    (err: Error) => err instanceof AnalyzeTemplateNotFoundError,
  );
});

test("deleteAnalyzeTemplate rejects an empty template_id before any query", async () => {
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    deleteAnalyzeTemplate(db, ""),
    (err: Error) =>
      err instanceof AnalyzeTemplateValidationError && /template_id/.test(err.message),
  );
  assert.equal(queries.length, 0);
});

test("analyze_templates drift-tests against the spec SQL: jsonb columns and version default must match the repo contract", () => {
  // Reads the actual schema and pins the column shape the repo depends on.
  // If the schema ever changes source_categories from jsonb → text, or drops
  // the version default, the implicit contract here breaks loudly instead
  // of producing wrong-shape rows at runtime.
  const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
  const schemaSource = readFileSync(join(workspaceRoot, "spec", "finance_research_db_schema.sql"), "utf8");
  const tableMatch = schemaSource.match(/create table analyze_templates \(([\s\S]*?)\);/);
  assert.ok(tableMatch, "expected create table analyze_templates in spec/finance_research_db_schema.sql");
  const body = tableMatch[1];
  for (const expected of [
    /source_categories jsonb not null default '\[\]'::jsonb/,
    /added_subject_refs jsonb not null default '\[\]'::jsonb/,
    /block_layout_hint jsonb/,
    /peer_policy jsonb/,
    /disclosure_policy jsonb/,
    /version integer not null default 1/,
  ]) {
    assert.match(body, expected, `analyze_templates must declare ${expected}`);
  }
});
