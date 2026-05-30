export const ANALYZE_RUN_METADATA_SCHEMA_VERSION = 1;

export type AnalyzeRunMetadataSubjectRef = {
  kind: string;
  id: string;
};

export type AnalyzeRunMetadataV1 = {
  schema_version: 1;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  playbook_version: number | null;
  instructions: string;
  source_categories: ReadonlyArray<string>;
  subject_refs: ReadonlyArray<AnalyzeRunMetadataSubjectRef>;
  rerun_of_run_id?: string;
};

export class AnalyzeRunMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeRunMetadataError";
  }
}

export function serializeAnalyzeRunMetadataV1(
  input: Omit<AnalyzeRunMetadataV1, "schema_version">,
): AnalyzeRunMetadataV1 {
  return Object.freeze({
    schema_version: ANALYZE_RUN_METADATA_SCHEMA_VERSION,
    template_id: expectString(input.template_id, "template_id"),
    template_version: expectPositiveInteger(input.template_version, "template_version"),
    playbook_id: nullableString(input.playbook_id, "playbook_id"),
    playbook_version: nullablePositiveInteger(input.playbook_version, "playbook_version"),
    instructions: expectString(input.instructions, "instructions"),
    source_categories: Object.freeze(
      input.source_categories.map((category) => expectString(category, "source_category")),
    ),
    subject_refs: Object.freeze(input.subject_refs.map(parseSubjectRef)),
    ...(input.rerun_of_run_id
      ? { rerun_of_run_id: expectString(input.rerun_of_run_id, "rerun_of_run_id") }
      : {}),
  });
}

export function parseAnalyzeRunMetadata(value: unknown): AnalyzeRunMetadataV1 {
  if (!isRecord(value)) throw new AnalyzeRunMetadataError("run_metadata must be an object");
  if (value.schema_version !== ANALYZE_RUN_METADATA_SCHEMA_VERSION) {
    throw new AnalyzeRunMetadataError("run_metadata schema version is unsupported");
  }

  return serializeAnalyzeRunMetadataV1({
    template_id: value.template_id,
    template_version: value.template_version,
    playbook_id: value.playbook_id ?? null,
    playbook_version: value.playbook_version ?? null,
    instructions: value.instructions,
    source_categories: expectStringArray(value.source_categories, "source_categories"),
    subject_refs: expectSubjectRefs(value.subject_refs),
    rerun_of_run_id: typeof value.rerun_of_run_id === "string" ? value.rerun_of_run_id : undefined,
  });
}

export function withRerunOfRunId(metadata: AnalyzeRunMetadataV1, runId: string): AnalyzeRunMetadataV1 {
  return serializeAnalyzeRunMetadataV1({
    ...metadata,
    rerun_of_run_id: runId,
  });
}

function parseSubjectRef(value: AnalyzeRunMetadataSubjectRef): AnalyzeRunMetadataSubjectRef {
  return Object.freeze({
    kind: expectString(value.kind, "subject_ref.kind"),
    id: expectString(value.id, "subject_ref.id"),
  });
}

function expectSubjectRefs(value: unknown): ReadonlyArray<AnalyzeRunMetadataSubjectRef> {
  if (!Array.isArray(value)) throw new AnalyzeRunMetadataError("subject_refs must be an array");
  return Object.freeze(
    value.map((item) => {
      if (!isRecord(item)) throw new AnalyzeRunMetadataError("subject_ref must be an object");
      return parseSubjectRef({
        kind: item.kind,
        id: item.id,
      } as AnalyzeRunMetadataSubjectRef);
    }),
  );
}

function expectStringArray(value: unknown, field: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new AnalyzeRunMetadataError(`${field} must be an array`);
  return Object.freeze(value.map((item) => expectString(item, field)));
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AnalyzeRunMetadataError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : expectString(value, field);
}

function expectPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AnalyzeRunMetadataError(`${field} must be a positive integer`);
  }
  return value;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  return value === null ? null : expectPositiveInteger(value, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
