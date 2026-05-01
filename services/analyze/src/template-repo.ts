import type { JsonValue, QueryExecutor } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../resolver/src/subject-ref.ts";
import { assertSubjectRef } from "../../resolver/src/subject-ref.ts";

export class AnalyzeTemplateNotFoundError extends Error {
  constructor(message = "analyze template not found") {
    super(message);
    this.name = "AnalyzeTemplateNotFoundError";
  }
}

export class AnalyzeTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeTemplateValidationError";
  }
}

export type AnalyzeTemplateInput = {
  user_id: string;
  name: string;
  prompt_template: string;
  source_categories?: ReadonlyArray<string>;
  added_subject_refs?: ReadonlyArray<SubjectRef>;
  block_layout_hint?: JsonValue | null;
  peer_policy?: JsonValue | null;
  disclosure_policy?: JsonValue | null;
};

// Patch surface for updateAnalyzeTemplate. Each field is optional; supplying
// at least one is required (an empty patch would still bump version, minting
// a phantom revision with no semantic change). version itself is read-only:
// every successful update increments it atomically in SQL.
export type AnalyzeTemplateUpdate = {
  name?: string;
  prompt_template?: string;
  source_categories?: ReadonlyArray<string>;
  added_subject_refs?: ReadonlyArray<SubjectRef>;
  block_layout_hint?: JsonValue | null;
  peer_policy?: JsonValue | null;
  disclosure_policy?: JsonValue | null;
};

export type AnalyzeTemplateRow = {
  template_id: string;
  user_id: string;
  name: string;
  prompt_template: string;
  source_categories: ReadonlyArray<string>;
  added_subject_refs: ReadonlyArray<SubjectRef>;
  block_layout_hint: JsonValue | null;
  peer_policy: JsonValue | null;
  disclosure_policy: JsonValue | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type AnalyzeTemplateDbRow = {
  template_id: string;
  user_id: string;
  name: string;
  prompt_template: string;
  source_categories: unknown;
  added_subject_refs: unknown;
  block_layout_hint: JsonValue | null;
  peer_policy: JsonValue | null;
  disclosure_policy: JsonValue | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const SELECT_COLUMNS = `template_id::text as template_id,
       user_id::text as user_id,
       name,
       prompt_template,
       source_categories,
       added_subject_refs,
       block_layout_hint,
       peer_policy,
       disclosure_policy,
       version,
       created_at,
       updated_at`;

export async function createAnalyzeTemplate(
  db: QueryExecutor,
  input: AnalyzeTemplateInput,
): Promise<AnalyzeTemplateRow> {
  validateCreateInput(input);
  const { rows } = await db.query<AnalyzeTemplateDbRow>(
    `insert into analyze_templates
       (user_id, name, prompt_template, source_categories, added_subject_refs,
        block_layout_hint, peer_policy, disclosure_policy)
     values ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
     returning ${SELECT_COLUMNS}`,
    [
      input.user_id,
      input.name,
      input.prompt_template,
      JSON.stringify(input.source_categories ?? []),
      JSON.stringify(input.added_subject_refs ?? []),
      serializeOptionalJson(input.block_layout_hint),
      serializeOptionalJson(input.peer_policy),
      serializeOptionalJson(input.disclosure_policy),
    ],
  );
  return rowFromDb(rows[0]);
}

export async function getAnalyzeTemplate(
  db: QueryExecutor,
  templateId: string,
): Promise<AnalyzeTemplateRow | null> {
  assertUuidString(templateId, "template_id");
  const { rows } = await db.query<AnalyzeTemplateDbRow>(
    `select ${SELECT_COLUMNS}
       from analyze_templates
      where template_id = $1::uuid`,
    [templateId],
  );
  return rows[0] ? rowFromDb(rows[0]) : null;
}

// Templates are user-owned — every list query must scope by user_id.
// Listing is alpha-by-name so the picker UI is deterministic.
export async function listAnalyzeTemplatesByUser(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<AnalyzeTemplateRow>> {
  assertUuidString(userId, "user_id");
  const { rows } = await db.query<AnalyzeTemplateDbRow>(
    `select ${SELECT_COLUMNS}
       from analyze_templates
      where user_id = $1::uuid
      order by name asc`,
    [userId],
  );
  return Object.freeze(rows.map(rowFromDb));
}

// Patch update. version is incremented atomically in SQL (`version + 1`)
// rather than read-modify-write, so concurrent updates don't lose
// increments. Each optional column uses COALESCE($n, column) so omitting a
// field in the patch preserves its current value.
export async function updateAnalyzeTemplate(
  db: QueryExecutor,
  templateId: string,
  patch: AnalyzeTemplateUpdate,
): Promise<AnalyzeTemplateRow> {
  assertUuidString(templateId, "template_id");
  validateUpdatePatch(patch);
  const { rows } = await db.query<AnalyzeTemplateDbRow>(
    `update analyze_templates
        set name = coalesce($2, name),
            prompt_template = coalesce($3, prompt_template),
            source_categories = coalesce($4::jsonb, source_categories),
            added_subject_refs = coalesce($5::jsonb, added_subject_refs),
            block_layout_hint = coalesce($6::jsonb, block_layout_hint),
            peer_policy = coalesce($7::jsonb, peer_policy),
            disclosure_policy = coalesce($8::jsonb, disclosure_policy),
            version = version + 1,
            updated_at = now()
      where template_id = $1::uuid
      returning ${SELECT_COLUMNS}`,
    [
      templateId,
      patch.name ?? null,
      patch.prompt_template ?? null,
      patch.source_categories === undefined ? null : JSON.stringify(patch.source_categories),
      patch.added_subject_refs === undefined ? null : JSON.stringify(patch.added_subject_refs),
      serializePatchJson(patch, "block_layout_hint"),
      serializePatchJson(patch, "peer_policy"),
      serializePatchJson(patch, "disclosure_policy"),
    ],
  );
  if (rows.length === 0) throw new AnalyzeTemplateNotFoundError();
  return rowFromDb(rows[0]);
}

export async function deleteAnalyzeTemplate(
  db: QueryExecutor,
  templateId: string,
): Promise<void> {
  assertUuidString(templateId, "template_id");
  const result = await db.query(
    `delete from analyze_templates where template_id = $1::uuid`,
    [templateId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AnalyzeTemplateNotFoundError();
  }
}

function validateCreateInput(input: AnalyzeTemplateInput): void {
  assertUuidString(input.user_id, "user_id");
  assertNonEmptyString(input.name, "name");
  assertNonEmptyString(input.prompt_template, "prompt_template");
  if (input.source_categories !== undefined) {
    assertStringArray(input.source_categories, "source_categories");
  }
  if (input.added_subject_refs !== undefined) {
    assertSubjectRefArray(input.added_subject_refs, "added_subject_refs");
  }
}

// Mutable AnalyzeTemplate fields the SQL update path actually applies.
// validateUpdatePatch rejects any other key so a typo'd field doesn't
// pass the "non-empty patch" gate and mint a phantom version bump.
const ALLOWED_PATCH_KEYS: ReadonlySet<keyof AnalyzeTemplateUpdate> = new Set([
  "name",
  "prompt_template",
  "source_categories",
  "added_subject_refs",
  "block_layout_hint",
  "peer_policy",
  "disclosure_policy",
]);

function validateUpdatePatch(patch: AnalyzeTemplateUpdate): void {
  const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  const unknownKeys = keys.filter((k) => !ALLOWED_PATCH_KEYS.has(k as keyof AnalyzeTemplateUpdate));
  if (unknownKeys.length > 0) {
    throw new AnalyzeTemplateValidationError(
      `patch contains unknown field(s): ${unknownKeys.join(", ")}`,
    );
  }
  if (keys.length === 0) {
    throw new AnalyzeTemplateValidationError(
      "patch must contain at least one mutable field — empty updates would mint a phantom version bump",
    );
  }
  if (patch.name !== undefined) assertNonEmptyString(patch.name, "name");
  if (patch.prompt_template !== undefined) {
    assertNonEmptyString(patch.prompt_template, "prompt_template");
  }
  if (patch.source_categories !== undefined) {
    assertStringArray(patch.source_categories, "source_categories");
  }
  if (patch.added_subject_refs !== undefined) {
    assertSubjectRefArray(patch.added_subject_refs, "added_subject_refs");
  }
}

function assertStringArray(value: unknown, label: string): asserts value is ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new AnalyzeTemplateValidationError(`${label}: must be an array of strings`);
  }
  value.forEach((v, i) => {
    if (typeof v !== "string" || v.length === 0) {
      throw new AnalyzeTemplateValidationError(`${label}[${i}]: must be a non-empty string`);
    }
  });
}

function assertSubjectRefArray(
  value: unknown,
  label: string,
): asserts value is ReadonlyArray<SubjectRef> {
  if (!Array.isArray(value)) {
    throw new AnalyzeTemplateValidationError(`${label}: must be an array of subject refs`);
  }
  value.forEach((ref, index) => assertSubjectRef(ref, `${label}[${index}]`));
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AnalyzeTemplateValidationError(`${label}: must be a non-empty string`);
  }
}

// RFC 4122 UUID shape (versions 1-5). Catches malformed IDs before the
// SQL ::uuid cast surfaces them as raw Postgres errors that callers
// can't pattern-match on.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuidString(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!UUID_RE.test(value)) {
    throw new AnalyzeTemplateValidationError(`${label}: must be a UUID`);
  }
}

function serializeOptionalJson(value: JsonValue | null | undefined): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

// COALESCE-driven patch: `undefined` is the "skip" signal — we bind SQL
// NULL, COALESCE falls through, the column keeps its current value.
//
// Explicit `null` overwrites the column with the JSON null literal
// (`'null'::jsonb`), NOT SQL NULL. The two are distinct in pg
// (`where col is null` excludes JSON-null rows, `where col = 'null'::jsonb`
// matches them), but the row parser surfaces JSON null back as JS `null`,
// so callers see `block_layout_hint: null` either way.
//
// Clearing an already-set jsonb column back to SQL NULL is intentionally
// out of scope for this CRUD surface. The orchestrator's reuse paths read
// these columns via JSON parse: SQL NULL, JSON null, and missing keys all
// surface as "no hint" / "no policy" upstream, so the SQL-vs-JSON-null
// distinction buys nothing today. If a future caller actually needs SQL
// NULL semantics, add a separate clear helper or a per-column "include"
// flag rather than overloading patch null.
function serializePatchJson(
  patch: AnalyzeTemplateUpdate,
  key: "block_layout_hint" | "peer_policy" | "disclosure_policy",
): string | null {
  const value = patch[key];
  if (value === undefined) return null;
  if (value === null) return JSON.stringify(null);
  return JSON.stringify(value);
}

function rowFromDb(row: AnalyzeTemplateDbRow | undefined): AnalyzeTemplateRow {
  if (!row) throw new Error("analyze_templates insert/select did not return a row");
  return Object.freeze({
    template_id: row.template_id,
    user_id: row.user_id,
    name: row.name,
    prompt_template: row.prompt_template,
    source_categories: parseSourceCategories(row.source_categories),
    added_subject_refs: parseSubjectRefs(row.added_subject_refs),
    block_layout_hint: row.block_layout_hint,
    peer_policy: row.peer_policy,
    disclosure_policy: row.disclosure_policy,
    version: typeof row.version === "string" ? Number(row.version) : row.version,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function parseSourceCategories(value: unknown): ReadonlyArray<string> {
  // pg returns jsonb columns parsed; assert shape so a wire-format break
  // crashes loudly instead of leaking unknown data into the orchestrator's
  // bundle mapper.
  if (!Array.isArray(value)) {
    throw new Error(
      "analyze_templates.source_categories: expected jsonb array, got " + typeof value,
    );
  }
  if (!value.every((v) => typeof v === "string" && v.length > 0)) {
    throw new Error(
      "analyze_templates.source_categories: expected array of non-empty strings",
    );
  }
  return Object.freeze([...value]);
}

function parseSubjectRefs(value: unknown): ReadonlyArray<SubjectRef> {
  if (!Array.isArray(value)) {
    throw new Error(
      "analyze_templates.added_subject_refs: expected jsonb array, got " + typeof value,
    );
  }
  value.forEach((ref, index) =>
    assertSubjectRef(ref, `analyze_templates.added_subject_refs[${index}]`),
  );
  return Object.freeze(value.map((ref) => Object.freeze({ ...(ref as SubjectRef) })));
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
