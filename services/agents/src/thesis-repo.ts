import { normalizeUniverseToIssuers } from "../../analyst-grids/src/subject-normalization.ts";
import { withTransaction } from "../../evidence/src/transaction.ts";
import { isSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "./agent-repo.ts";
import {
  parseThesisConditions,
  ThesisConflictError,
  ThesisNotFoundError,
  ThesisValidationError,
  type ConditionAssessment,
  type ThesisAssessment,
  type ThesisVersion,
} from "./thesis-types.ts";

type ThesisVersionDbRow = Omit<ThesisVersion, "subject_ref" | "conditions" | "created_at"> & {
  subject_ref: unknown;
  conditions: unknown;
  created_at: Date | string;
};

type ThesisAssessmentDbRow = Omit<ThesisAssessment, "results" | "assessed_at"> & {
  results: unknown;
  assessed_at: Date | string;
};

const VERSION_COLUMNS = `thesis_version_id::text as thesis_version_id,
       agent_id::text as agent_id,
       version,
       thesis,
       subject_ref,
       conditions,
       created_at`;

const ASSESSMENT_COLUMNS = `assessment_id::text as assessment_id,
       thesis_version_id::text as thesis_version_id,
       run_id::text as run_id,
       snapshot_id::text as snapshot_id,
       input_hash,
       results,
       model_version,
       prompt_version,
       assessed_at`;

export async function getCurrentThesis(
  db: QueryExecutor,
  agentId: string,
): Promise<ThesisVersion | null> {
  assertUuid(agentId, "agent_id");
  const { rows } = await db.query<ThesisVersionDbRow>(
    `select ${VERSION_COLUMNS}
       from agent_thesis_versions
      where agent_id = $1::uuid
      order by version desc
      limit 1`,
    [agentId],
  );
  return rows[0] === undefined ? null : thesisVersionFromDb(rows[0]);
}

export async function saveThesis(
  db: QueryExecutor,
  input: {
    agent_id: string;
    user_id: string;
    expected_version: number;
    thesis: string;
    subject_ref: { kind: "issuer"; id: string };
    conditions: import("./thesis-types.ts").ThesisCondition[];
  },
): Promise<ThesisVersion> {
  assertUuid(input.agent_id, "agent_id");
  assertUuid(input.user_id, "user_id");
  assertExpectedVersion(input.expected_version);
  const thesis = assertThesis(input.thesis);
  const subjectRef = assertIssuerSubject(input.subject_ref);
  const conditions = parseThesisConditions(input.conditions);

  return withTransaction(db, async ({ db: tx }) => {
    const locked = await tx.query<{ universe: unknown }>(
      `select universe
         from agents
        where agent_id = $1::uuid
          and user_id = $2::uuid
        for update`,
      [input.agent_id, input.user_id],
    );
    if (locked.rows[0] === undefined) throw new ThesisNotFoundError();
    if (!await isMatchingSingleIssuerUniverse(tx, locked.rows[0].universe, subjectRef.id)) {
      throw new ThesisConflictError("agent universe no longer matches the thesis issuer");
    }

    const current = await tx.query<{ version: number }>(
      `select version
         from agent_thesis_versions
        where agent_id = $1::uuid
        order by version desc
        limit 1`,
      [input.agent_id],
    );
    const currentVersion = current.rows[0]?.version ?? 0;
    if (currentVersion !== input.expected_version) {
      throw new ThesisConflictError(
        `expected thesis version ${input.expected_version}, current version is ${currentVersion}`,
      );
    }

    const inserted = await tx.query<ThesisVersionDbRow>(
      `insert into agent_thesis_versions
         (agent_id, version, thesis, subject_ref, conditions)
       values ($1::uuid, $2, $3, $4::jsonb, $5::jsonb)
       returning ${VERSION_COLUMNS}`,
      [
        input.agent_id,
        currentVersion + 1,
        thesis,
        JSON.stringify(subjectRef),
        JSON.stringify(conditions),
      ],
    );
    await tx.query(
      `update agents
          set thesis = $2,
              updated_at = now()
        where agent_id = $1::uuid`,
      [input.agent_id, thesis],
    );
    return thesisVersionFromDb(inserted.rows[0]);
  });
}

export async function loadThesisHistory(
  db: QueryExecutor,
  input: { agent_id: string; user_id: string },
): Promise<{ thesis: ThesisVersion | null; versions: ThesisVersion[]; assessments: ThesisAssessment[] }> {
  assertUuid(input.agent_id, "agent_id");
  assertUuid(input.user_id, "user_id");
  const owner = await db.query(
    `select 1
       from agents
      where agent_id = $1::uuid
        and user_id = $2::uuid`,
    [input.agent_id, input.user_id],
  );
  if (owner.rows[0] === undefined) throw new ThesisNotFoundError();

  const [versionsResult, assessmentsResult] = await Promise.all([
    db.query<ThesisVersionDbRow>(
      `select ${VERSION_COLUMNS}
         from agent_thesis_versions
        where agent_id = $1::uuid
        order by version desc
        limit 20`,
      [input.agent_id],
    ),
    db.query<ThesisAssessmentDbRow>(
      `select ${ASSESSMENT_COLUMNS}
         from agent_thesis_assessments a
         join agent_thesis_versions v using (thesis_version_id)
        where v.agent_id = $1::uuid
        order by a.assessed_at desc, a.assessment_id desc
        limit 20`,
      [input.agent_id],
    ),
  ]);
  const versions = versionsResult.rows.map(thesisVersionFromDb);
  return {
    thesis: versions[0] ?? null,
    versions,
    assessments: assessmentsResult.rows.map(thesisAssessmentFromDb),
  };
}

export async function findThesisAssessment(
  db: QueryExecutor,
  versionId: string,
  inputHash: string,
): Promise<ThesisAssessment | null> {
  assertUuid(versionId, "thesis_version_id");
  const normalizedHash = assertInputHash(inputHash);
  const { rows } = await db.query<ThesisAssessmentDbRow>(
    `select ${ASSESSMENT_COLUMNS}
       from agent_thesis_assessments
      where thesis_version_id = $1::uuid
        and input_hash = $2`,
    [versionId, normalizedHash],
  );
  return rows[0] === undefined ? null : thesisAssessmentFromDb(rows[0]);
}

export async function recordThesisAssessment(
  tx: QueryExecutor,
  input: Omit<ThesisAssessment, "assessment_id" | "assessed_at">,
): Promise<ThesisAssessment> {
  assertUuid(input.thesis_version_id, "thesis_version_id");
  assertUuid(input.run_id, "run_id");
  assertUuid(input.snapshot_id, "snapshot_id");
  const inputHash = assertInputHash(input.input_hash);
  const results = parseConditionAssessments(input.results);
  const modelVersion = input.model_version === null
    ? null
    : assertBoundedText(input.model_version, "model_version", 1, 200);
  const promptVersion = assertBoundedText(input.prompt_version, "prompt_version", 1, 200);
  const { rows } = await tx.query<ThesisAssessmentDbRow>(
    `insert into agent_thesis_assessments
       (thesis_version_id, run_id, snapshot_id, input_hash, results, model_version, prompt_version)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6, $7)
     on conflict (thesis_version_id, input_hash) do update
       set input_hash = agent_thesis_assessments.input_hash
     returning ${ASSESSMENT_COLUMNS}`,
    [
      input.thesis_version_id,
      input.run_id,
      input.snapshot_id,
      inputHash,
      JSON.stringify(results),
      modelVersion,
      promptVersion,
    ],
  );
  return thesisAssessmentFromDb(rows[0]);
}

function thesisVersionFromDb(row: ThesisVersionDbRow | undefined): ThesisVersion {
  if (row === undefined) throw new Error("thesis version write returned no row");
  return {
    thesis_version_id: row.thesis_version_id,
    agent_id: row.agent_id,
    version: row.version,
    thesis: row.thesis,
    subject_ref: assertIssuerSubject(jsonValue(row.subject_ref, "subject_ref")),
    conditions: parseThesisConditions(jsonValue(row.conditions, "conditions")),
    created_at: isoDate(row.created_at, "created_at"),
  };
}

function thesisAssessmentFromDb(row: ThesisAssessmentDbRow | undefined): ThesisAssessment {
  if (row === undefined) throw new Error("thesis assessment write returned no row");
  return {
    assessment_id: row.assessment_id,
    thesis_version_id: row.thesis_version_id,
    run_id: row.run_id,
    snapshot_id: row.snapshot_id,
    input_hash: row.input_hash,
    results: parseConditionAssessments(jsonValue(row.results, "results")),
    model_version: row.model_version,
    prompt_version: row.prompt_version,
    assessed_at: isoDate(row.assessed_at, "assessed_at"),
  };
}

function parseConditionAssessments(value: unknown): ConditionAssessment[] {
  if (!Array.isArray(value)) throw new ThesisValidationError("results must be an array");
  return value.map((item, index) => {
    const label = `results[${index}]`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ThesisValidationError(`${label} must be an object`);
    }
    const row = item as Record<string, unknown>;
    const conditionId = assertUuid(row.condition_id, `${label}.condition_id`);
    if (row.status !== "supported" && row.status !== "challenged" && row.status !== "unresolved") {
      throw new ThesisValidationError(`${label}.status is invalid`);
    }
    const reason = assertBoundedText(row.reason, `${label}.reason`, 1, 2_000);
    const claimRefs = parseUuidArray(row.claim_refs, `${label}.claim_refs`);
    const factRefs = parseUuidArray(row.fact_refs, `${label}.fact_refs`);
    if (row.method !== "metric" && row.method !== "model" && row.method !== "no_evidence") {
      throw new ThesisValidationError(`${label}.method is invalid`);
    }
    return {
      condition_id: conditionId,
      status: row.status,
      reason,
      claim_refs: claimRefs,
      fact_refs: factRefs,
      method: row.method,
    };
  });
}

function parseUuidArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new ThesisValidationError(`${label} must be an array`);
  return value.map((item, index) => assertUuid(item, `${label}[${index}]`));
}

function assertIssuerSubject(value: unknown): { kind: "issuer"; id: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ThesisValidationError("subject_ref must be an issuer subject");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "issuer") {
    throw new ThesisValidationError("subject_ref.kind must be issuer");
  }
  return { kind: "issuer", id: assertUuid(record.id, "subject_ref.id") };
}

async function isMatchingSingleIssuerUniverse(
  db: QueryExecutor,
  value: unknown,
  issuerId: string,
): Promise<boolean> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const universe = value as { mode?: unknown; subject_refs?: unknown };
  if (universe.mode !== "static" || !Array.isArray(universe.subject_refs) || universe.subject_refs.length !== 1) {
    return false;
  }
  const subject = universe.subject_refs[0];
  if (!isSubjectRef(subject)) return false;
  const normalized = await normalizeUniverseToIssuers(db, [subject as SubjectRef]);
  return normalized.length === 1 && normalized[0]?.kind === "issuer" && normalized[0].id === issuerId;
}

function assertThesis(value: unknown): string {
  return assertBoundedText(value, "thesis", 1, 20_000);
}

function assertInputHash(value: unknown): string {
  return assertBoundedText(value, "input_hash", 1, 512);
}

function assertBoundedText(value: unknown, label: string, min: number, max: number): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < min ||
    value.length > max
  ) {
    throw new ThesisValidationError(`${label} must be trimmed and between ${min} and ${max} characters`);
  }
  return value;
}

function assertExpectedVersion(value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ThesisValidationError("expected_version must be a non-negative integer");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ThesisValidationError(`${label} must be a UUID`);
  }
  return value;
}

function jsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ThesisValidationError(`${label} must be valid JSON`);
  }
}

function isoDate(value: Date | string, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ThesisValidationError(`${label} must be a valid date`);
  return date.toISOString();
}
