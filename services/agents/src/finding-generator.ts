import { randomUUID } from "node:crypto";
import { assertSubjectRef, type SubjectRef } from "../../resolver/src/subject-ref.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";
import {
  buildFindingSummaryBlocks,
  type FindingCardBlock,
} from "./finding-summary-blocks.ts";
import {
  FINDING_SEVERITIES,
  scoreFindingSeverity,
  type FindingSeverity,
  type SeverityScoringInput,
} from "./severity-scorer.ts";

export type GenerateFindingInput = {
  finding_id?: string;
  agent_id: string;
  snapshot_id: string;
  snapshot_manifest: FindingSnapshotManifest;
  subject_refs: ReadonlyArray<SubjectRef>;
  claim_cluster_ids: ReadonlyArray<string>;
  headline: string;
  severity_input: SeverityScoringInput;
  source_refs: ReadonlyArray<string>;
};

export type FindingSnapshotManifest = {
  snapshot_id: string;
  source_ids: ReadonlyArray<string>;
  as_of: string;
};

export type FindingRow = {
  finding_id: string;
  agent_id: string;
  snapshot_id: string;
  subject_refs: ReadonlyArray<SubjectRef>;
  claim_cluster_ids: ReadonlyArray<string>;
  severity: FindingSeverity;
  headline: string;
  summary_blocks: ReadonlyArray<FindingCardBlock>;
  created_at: string;
};

type FindingDbRow = {
  finding_id: string;
  agent_id: string;
  snapshot_id: string;
  subject_refs: unknown;
  claim_cluster_ids: unknown;
  severity: FindingSeverity;
  headline: string;
  summary_blocks: unknown;
  created_at: Date | string;
};

export class FindingGenerationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FindingGenerationValidationError";
  }
}

const SELECT_COLUMNS = `finding_id::text as finding_id,
       agent_id::text as agent_id,
       snapshot_id::text as snapshot_id,
       subject_refs,
       claim_cluster_ids,
       severity,
       headline,
       summary_blocks,
       created_at`;

export async function generateFinding(
  db: QueryExecutor,
  input: GenerateFindingInput,
): Promise<FindingRow> {
  assertGenerateFindingInput(input);
  const findingId = input.finding_id ?? randomUUID();
  const scored = scoreFindingSeverity(input.severity_input);
  const summaryBlocks = buildFindingSummaryBlocks({
    finding_id: findingId,
    snapshot_id: input.snapshot_id,
    headline: input.headline,
    severity: scored.severity,
    subject_refs: input.subject_refs,
    source_refs: input.source_refs,
    as_of: input.snapshot_manifest.as_of,
  });

  const { rows } = await db.query<FindingDbRow>(
    `insert into findings
       (finding_id, agent_id, snapshot_id, subject_refs, claim_cluster_ids, severity, headline, summary_blocks)
     values ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::jsonb, $6::finding_severity, $7, $8::jsonb)
     returning ${SELECT_COLUMNS}`,
    [
      findingId,
      input.agent_id,
      input.snapshot_id,
      JSON.stringify(input.subject_refs),
      JSON.stringify(input.claim_cluster_ids),
      scored.severity,
      input.headline.trim(),
      JSON.stringify(summaryBlocks),
    ],
  );

  return rowFromDb(rows[0]);
}

function rowFromDb(row: FindingDbRow): FindingRow {
  const finding = {
    finding_id: row.finding_id,
    agent_id: row.agent_id,
    snapshot_id: row.snapshot_id,
    subject_refs: freezeJsonArray(row.subject_refs, "subject_refs") as ReadonlyArray<SubjectRef>,
    claim_cluster_ids: freezeJsonArray(row.claim_cluster_ids, "claim_cluster_ids") as ReadonlyArray<string>,
    severity: assertSeverity(row.severity),
    headline: row.headline,
    summary_blocks: freezeJsonArray(row.summary_blocks, "summary_blocks") as ReadonlyArray<FindingCardBlock>,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
  return Object.freeze(finding);
}

function assertGenerateFindingInput(input: GenerateFindingInput): void {
  if (input.finding_id !== undefined) assertUuidString(input.finding_id, "finding_id");
  assertUuidString(input.agent_id, "agent_id");
  assertUuidString(input.snapshot_id, "snapshot_id");
  assertSnapshotManifest(input);
  if (!Array.isArray(input.subject_refs)) {
    throw new FindingGenerationValidationError("subject_refs must be an array");
  }
  input.subject_refs.forEach((ref, index) => {
    try {
      assertSubjectRef(ref);
    } catch (error) {
      throw new FindingGenerationValidationError(`subject_refs[${index}] ${(error as Error).message}`);
    }
  });
  if (!Array.isArray(input.claim_cluster_ids)) {
    throw new FindingGenerationValidationError("claim_cluster_ids must be an array");
  }
  input.claim_cluster_ids.forEach((id, index) => assertUuidString(id, `claim_cluster_ids[${index}]`));
  assertNonEmptyString(input.headline, "headline");
  if (!Array.isArray(input.source_refs)) {
    throw new FindingGenerationValidationError("source_refs must be an array");
  }
  const manifestSourceIds = new Set(input.snapshot_manifest.source_ids);
  input.source_refs.forEach((id, index) => {
    assertUuidString(id, `source_refs[${index}]`);
    if (!manifestSourceIds.has(id)) {
      throw new FindingGenerationValidationError(`source_refs[${index}] must exist in snapshot_manifest.source_ids`);
    }
  });
}

function assertUuidString(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    throw new FindingGenerationValidationError(`${field} must be a UUID`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FindingGenerationValidationError(`${field} must be a non-empty string`);
  }
}

function assertDateTimeString(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new FindingGenerationValidationError(`${field} must be an ISO date-time string`);
  }
}

function assertSnapshotManifest(input: GenerateFindingInput): void {
  if (typeof input.snapshot_manifest !== "object" || input.snapshot_manifest === null) {
    throw new FindingGenerationValidationError("snapshot_manifest must be an object");
  }
  assertUuidString(input.snapshot_manifest.snapshot_id, "snapshot_manifest.snapshot_id");
  if (input.snapshot_manifest.snapshot_id !== input.snapshot_id) {
    throw new FindingGenerationValidationError("snapshot_manifest.snapshot_id must match snapshot_id");
  }
  if (!Array.isArray(input.snapshot_manifest.source_ids)) {
    throw new FindingGenerationValidationError("snapshot_manifest.source_ids must be an array");
  }
  input.snapshot_manifest.source_ids.forEach((id, index) =>
    assertUuidString(id, `snapshot_manifest.source_ids[${index}]`),
  );
  assertDateTimeString(input.snapshot_manifest.as_of, "snapshot_manifest.as_of");
}

function assertSeverity(value: unknown): FindingSeverity {
  if (!FINDING_SEVERITIES.includes(value as FindingSeverity)) {
    throw new FindingGenerationValidationError("finding row severity is invalid");
  }
  return value as FindingSeverity;
}

function freezeJsonArray(value: unknown, field: string): ReadonlyArray<JsonValue> {
  if (!Array.isArray(value)) {
    throw new FindingGenerationValidationError(`finding row ${field} must be an array`);
  }
  return Object.freeze(value.map((item) => deepFreezeJson(item as JsonValue)));
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreezeJson(item));
    return Object.freeze(value) as T;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => deepFreezeJson(item as JsonValue));
    return Object.freeze(value) as T;
  }
  return value;
}
