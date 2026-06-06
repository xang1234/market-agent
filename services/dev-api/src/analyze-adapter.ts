// Analyze domain adapter for dev-api. Owns the analyze run/template DTOs, the
// durable + fixture implementations of DevApiAnalyzeAdapter, the shared
// persist+seal tail (persistAnalyzeRun), and the analyze-only request/response
// helpers. http.ts composes these builders into the combined DevApiAdapters and
// keeps only the thin HTTP routing. Extracted from http.ts (fra-g477).

import { createHash, randomUUID } from "node:crypto";
import {
  ANALYZE_PLAYBOOKS,
  AnalyzePlaybookError,
  AnalyzeRunMetadataError,
  getAnalyzeTemplate,
  getAnalyzeTemplateRunForUser,
  listAnalyzeTemplateRunsByUser,
  listAnalyzeTemplatesByUser,
  mapSourceCategoriesToBundles,
  parseAnalyzeRunMetadata,
  persistAnalyzeTemplateRunAfterSnapshotSealWithPool,
  resolveAnalyzePlaybookRequest,
  serializeAnalyzeRunMetadataV1,
  SourceCategoryMappingError,
  type AnalyzeRunMetadataV1,
  type AnalyzeTemplateRow,
  type AnalyzeTemplateRunRow,
  type AnalyzeTemplateRunSummaryRow,
  type AnalyzeTemplateRunWithTemplateRow,
  type AnalyzeTemplateRunClientPool,
} from "../../analyze/src/index.ts";
import type { AnalyzePlaybook } from "../../analyze/src/playbook.ts";
import {
  shareArtifactToChat,
  type ShareableArtifactBlock,
} from "../../artifact/src/index.ts";
import {
  persistImportedArtifactMessage,
  type ChatMessagePersistenceDb,
  type ChatMessageRow,
} from "../../chat/src/messages.ts";
import {
  createThread,
  type ChatThread,
  type ChatThreadsDb,
} from "../../chat/src/threads-repo.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import { isSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import type { QueryExecutor } from "../../agents/src/index.ts";
import {
  DevApiHttpError,
  nonEmptyString,
} from "./dev-api-shared.ts";

export type DevAnalyzeRunSummary = {
  run_id: string;
  template_id: string;
  template_name: string;
  template_version: number;
  playbook_id: string | null;
  playbook_name: string | null;
  playbook_version: number | null;
  display_title: string;
  can_rerun: boolean;
  rerun_unavailable_reason: string | null;
  snapshot_id: string;
  created_at: string;
};

export type DevAnalyzeRun = DevAnalyzeRunSummary & {
  run_metadata: unknown;
  blocks: ReadonlyArray<Record<string, unknown>>;
};

export type DevAnalyzeTemplate = {
  template_id: string;
  name: string;
  prompt_template: string;
  source_categories: string[];
  version: number;
};

export type DevArtifactShareResult = {
  thread: ChatThread;
  message: ChatMessageRow;
  origin_snapshot_ids: ReadonlyArray<string>;
};

export type DevApiAnalyzeAdapter = {
  listTemplates(input: { userId: string }): Promise<{
    templates: DevAnalyzeTemplate[];
    runs?: DevAnalyzeRunSummary[];
  }>;
  listRuns(input: { userId: string; limit: number; cursor: string | null }): Promise<{
    runs: DevAnalyzeRunSummary[];
    next_cursor: string | null;
  }>;
  getRun(input: { userId: string; runId: string }): Promise<DevAnalyzeRun>;
  createRun(input: {
    userId: string;
    body: Record<string, unknown>;
  }): Promise<DevAnalyzeRun>;
  rerun(input: { userId: string; runId: string }): Promise<DevAnalyzeRun>;
  shareRunToChat(input: {
    userId: string;
    runId: string;
    body: Record<string, unknown>;
  }): Promise<DevArtifactShareResult>;
};

export type DevApiAnalyzeWorkflowInput = {
  userId: string;
  template: AnalyzeTemplateRow;
  body: Record<string, unknown>;
  snapshotId: string;
  instructions: string;
  playbookPrompt: string;
  playbookName?: string | null;
  sourceCategories: ReadonlyArray<string>;
  bundleIds: ReadonlyArray<string>;
  subjectRefs: ReadonlyArray<SubjectRef>;
  playbookSectionId?: string | null;
};

export type DevApiAnalyzeWorkflowResult = {
  blocks: ReadonlyArray<Record<string, unknown>>;
};

// Deps the durable analyze adapter needs. The combined DevApiServiceAdapterDeps
// (http.ts) intersects this with the agents/evidence deps.
export type AnalyzeServiceDeps = {
  db: QueryExecutor & AnalyzeTemplateRunClientPool & ChatMessagePersistenceDb & ChatThreadsDb;
  runAnalyzeWorkflow?(
    input: DevApiAnalyzeWorkflowInput,
  ): Promise<DevApiAnalyzeWorkflowResult> | DevApiAnalyzeWorkflowResult;
  sealAnalyzeSnapshot(input: {
    snapshotId: string;
    userId: string;
    templateId: string;
    body: Record<string, unknown>;
    blocks: ReadonlyArray<Record<string, unknown>>;
  }): Promise<SnapshotSealResult>;
  // Optional per-section run: merges deterministic section blocks (peer_table)
  // into the run. When absent, createRun falls back to the narrative memo only.
  buildAnalyzeRunSeals?(input: {
    snapshotId: string;
    userId: string;
    memoBlocks: ReadonlyArray<Record<string, unknown>>;
    playbook: AnalyzePlaybook;
    subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
    asOf: string;
  }): Promise<{
    blocks: ReadonlyArray<Record<string, unknown>>;
    sealSnapshot: () => Promise<SnapshotSealResult>;
  }>;
};

function requireNonEmpty(value: unknown, label: string): string {
  const text = nonEmptyString(value);
  if (text === null) throw new DevApiHttpError(400, `${label} is required`);
  return text;
}

export function readOptionalSubjectRef(value: unknown): SubjectRef | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DevApiHttpError(400, "primary_subject_ref is invalid");
  }
  if (!isSubjectRef(value)) {
    throw new DevApiHttpError(400, "primary_subject_ref is invalid");
  }
  return value;
}

export function contentHash(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

// Shared persist+seal tail for both createRun and rerun. When the per-section
// runner is wired AND the run has a playbook, it runs the deterministic section
// producers (e.g. peer_table) and merges their blocks + seal; otherwise the run
// is the narrative memo only. Seals with the snapshot-id mismatch guard and
// persists the run row.
async function persistAnalyzeRun(
  deps: AnalyzeServiceDeps,
  input: {
    template: { template_id: string; version: number; name: string };
    snapshotId: string;
    userId: string;
    body: Record<string, unknown>;
    memoBlocks: ReadonlyArray<Record<string, unknown>>;
    playbook: AnalyzePlaybook | undefined;
    playbookId: string | null;
    subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
    runMetadata: AnalyzeRunMetadataV1;
  },
): Promise<DevAnalyzeRun> {
  const runAsOf = (input.memoBlocks[0]?.as_of as string | undefined) ?? new Date().toISOString();
  let blocks: ReadonlyArray<Record<string, unknown>>;
  let sealRun: () => Promise<SnapshotSealResult>;
  if (deps.buildAnalyzeRunSeals && input.playbook) {
    const runSeals = await deps.buildAnalyzeRunSeals({
      snapshotId: input.snapshotId,
      userId: input.userId,
      memoBlocks: input.memoBlocks,
      playbook: input.playbook,
      subjectRefs: input.subjectRefs,
      asOf: runAsOf,
    });
    blocks = Object.freeze(runSeals.blocks.map((block) => Object.freeze({ ...block })));
    sealRun = runSeals.sealSnapshot;
  } else {
    blocks = Object.freeze(input.memoBlocks.map((block) => Object.freeze({ ...block })));
    sealRun = () =>
      deps.sealAnalyzeSnapshot({
        snapshotId: input.snapshotId,
        userId: input.userId,
        templateId: input.template.template_id,
        body: input.body,
        blocks,
      });
  }
  const persisted = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(deps.db, {
    template_id: input.template.template_id,
    template_version: input.template.version,
    blocks: blocks as JsonValue,
    playbook_id: input.playbookId,
    run_metadata: input.runMetadata,
    sealSnapshot: async () => {
      const seal = await sealRun();
      if (seal.ok && seal.snapshot.snapshot_id !== input.snapshotId) {
        return {
          ok: false,
          verification: {
            ok: false,
            failures: [
              {
                reason_code: "invalid_block_binding",
                details: {
                  reason: "analyze_snapshot_id_mismatch",
                  expected_snapshot_id: input.snapshotId,
                  actual_snapshot_id: seal.snapshot.snapshot_id,
                },
              },
            ],
          },
        };
      }
      return seal;
    },
  });
  if (!persisted.ok) {
    throw new DevApiHttpError(422, "snapshot seal failed");
  }
  return toDevAnalyzeRun(deps.db, persisted.run, input.template.name);
}

export function createServiceAnalyzeAdapter(deps: AnalyzeServiceDeps): DevApiAnalyzeAdapter {
  return {
    async listTemplates({ userId }) {
      const templates = await listAnalyzeTemplatesByUser(deps.db, userId);
      const runs = (
        await Promise.all(
          templates.map((template) => listAnalyzeRunsForTemplate(deps.db, template.template_id, template.name)),
        )
      ).flat();
      return {
        templates: templates.map((template) => ({
          template_id: template.template_id,
          name: template.name,
          prompt_template: template.prompt_template,
          source_categories: [...template.source_categories],
          version: template.version,
        })),
        runs,
      };
    },
    async listRuns({ userId, limit, cursor }) {
      const page = await listAnalyzeTemplateRunsByUser(deps.db, { userId, limit, cursor });
      return {
        runs: await Promise.all(page.runs.map((run) => toDevAnalyzeRunSummary(deps.db, run))),
        next_cursor: page.next_cursor,
      };
    },
    async getRun({ userId, runId }) {
      const run = await getAnalyzeTemplateRunForUser(deps.db, { userId, runId });
      if (run === null) throw new DevApiHttpError(404, "analyze run not found");
      return toDevAnalyzeRun(deps.db, run, run.template_name);
    },
    async createRun({ userId, body }) {
      const templateId = requireNonEmpty(body.template_id, "template_id");
      const template = await getAnalyzeTemplate(deps.db, templateId);
      if (template === null || template.user_id !== userId) {
        throw new DevApiHttpError(404, "analyze template not found");
      }
      const snapshotId = randomUUID();
      const resolvedPlaybook = resolveAnalyzePlaybookRequestOrHttpError({
        playbook_id: nonEmptyString(body.playbook_id) ?? "earnings_quality",
        instructions: nonEmptyString(body.instructions) ?? undefined,
        source_categories: body.source_categories === undefined
          ? undefined
          : readAnalyzeSourceCategories(body.source_categories, []),
      });
      const sourceCategories = body.source_categories === undefined
        ? [...resolvedPlaybook.source_categories]
        : readAnalyzeSourceCategories(body.source_categories, []);
      const bundleIds = analyzeBundleIds(sourceCategories);
      const subjectRefs = analyzeSubjectRefs({
        primary: readOptionalSubjectRef(body.subject_ref ?? body.primary_subject_ref),
        added: template.added_subject_refs,
      });
      const instructions = resolvedPlaybook.instructions;
      const runMetadata = serializeAnalyzeRunMetadataV1({
        template_id: template.template_id,
        template_version: template.version,
        playbook_id: resolvedPlaybook.playbook.playbook_id,
        playbook_version: resolvedPlaybook.playbook.version,
        instructions,
        source_categories: sourceCategories,
        subject_refs: subjectRefs,
      });
      if (!deps.runAnalyzeWorkflow) {
        throw new DevApiHttpError(503, "durable analyze workflow is not configured");
      }
      const rendered = await deps.runAnalyzeWorkflow({
        userId,
        template,
        body,
        snapshotId,
        instructions,
        playbookPrompt: resolvedPlaybook.prompt,
        playbookName: resolvedPlaybook.playbook.name,
        sourceCategories,
        bundleIds,
        subjectRefs,
        playbookSectionId: resolvedPlaybook.playbook.sections[0]?.section_id ?? null,
      });
      return persistAnalyzeRun(deps, {
        template,
        snapshotId,
        userId,
        body,
        memoBlocks: rendered.blocks.map((block) => ({ ...block })),
        playbook: resolvedPlaybook.playbook,
        playbookId: resolvedPlaybook.playbook.playbook_id,
        subjectRefs,
        runMetadata,
      });
    },
    async rerun({ userId, runId }) {
      const original = await getAnalyzeTemplateRunForUser(deps.db, { userId, runId });
      if (original === null) throw new DevApiHttpError(404, "analyze run not found");
      const metadata = parseStoredAnalyzeRunMetadata(original.run_metadata);
      if (metadata.template_id !== original.template_id) {
        throw new DevApiHttpError(409, "analyze run metadata is not rerunnable");
      }
      const template = await getAnalyzeTemplate(deps.db, original.template_id);
      if (template === null || template.user_id !== userId) {
        throw new DevApiHttpError(409, "analyze template is no longer runnable");
      }
      if (!deps.runAnalyzeWorkflow) {
        throw new DevApiHttpError(503, "durable analyze workflow is not configured");
      }
      const sourceCategories = [...metadata.source_categories];
      const bundleIds = analyzeBundleIds(sourceCategories);
      const subjectRefs = metadata.subject_refs.map((ref) => analyzeSubjectRefFromMetadata(ref));
      const playbook = metadata.playbook_id === null
        ? undefined
        : ANALYZE_PLAYBOOKS.find((candidate) => candidate.playbook_id === metadata.playbook_id);
      const playbookPrompt = playbook
        ? resolveAnalyzePlaybookRequest({
          playbook_id: playbook.playbook_id,
          instructions: metadata.instructions,
          source_categories: metadata.source_categories,
        }).prompt
        : metadata.instructions;
      const rerunMetadata = serializeAnalyzeRunMetadataV1({
        template_id: template.template_id,
        template_version: template.version,
        playbook_id: metadata.playbook_id,
        playbook_version: metadata.playbook_version,
        instructions: metadata.instructions,
        source_categories: sourceCategories,
        subject_refs: subjectRefs,
        rerun_of_run_id: original.run_id,
      });
      const snapshotId = randomUUID();
      const body = {
        template_id: template.template_id,
        ...(metadata.playbook_id ? { playbook_id: metadata.playbook_id } : {}),
        instructions: metadata.instructions,
        source_categories: sourceCategories,
        ...(subjectRefs[0] ? { subject_ref: subjectRefs[0] } : {}),
      };
      const rendered = await deps.runAnalyzeWorkflow({
        userId,
        template,
        body,
        snapshotId,
        instructions: metadata.instructions,
        playbookPrompt,
        playbookName: playbook?.name ?? null,
        sourceCategories,
        bundleIds,
        subjectRefs,
        playbookSectionId: playbook?.sections[0]?.section_id ?? null,
      });
      return persistAnalyzeRun(deps, {
        template,
        snapshotId,
        userId,
        body,
        memoBlocks: rendered.blocks.map((block) => ({ ...block })),
        playbook,
        playbookId: metadata.playbook_id,
        subjectRefs,
        runMetadata: rerunMetadata,
      });
    },
    async shareRunToChat({ userId, runId, body }) {
      const run = await getAnalyzeTemplateRunForUser(deps.db, { userId, runId });
      if (run === null) throw new DevApiHttpError(404, "analyze run not found");
      const blocks = enrichAnalyzeRunBlocks(run.blocks, run);
      const shared = await shareArtifactToChat({
        sources: [
          {
            source_kind: "memo",
            origin_snapshot_id: run.snapshot_id,
            blocks,
          },
        ],
        egress: { db: deps.db },
      });
      if (!shared.ok) throw new DevApiHttpError(422, "artifact share rejected", shared.rejections);
      const snapshotId = shared.origin_snapshot_ids[0];
      if (snapshotId === undefined) throw new DevApiHttpError(422, "artifact share rejected");

      const client = await deps.db.connect();
      try {
        await client.query("begin");
        const thread = await createThread(client, userId, {
          title: nonEmptyString(body.title) ?? "Research memo",
          primary_subject_ref: readOptionalSubjectRef(body.primary_subject_ref) ?? undefined,
        });
        const message = await persistImportedArtifactMessage(client, {
          thread_id: thread.thread_id,
          user_id: userId,
          role: "assistant",
          snapshot_id: snapshotId,
          blocks: shared.blocks as JsonValue,
          content_hash: contentHash(shared.blocks as JsonValue),
        });
        if (message === null) throw new DevApiHttpError(404, "chat thread not found");
        await client.query("commit");
        return {
          thread,
          message,
          origin_snapshot_ids: shared.origin_snapshot_ids,
        };
      } catch (error) {
        try {
          await client.query("rollback");
        } catch (rollbackError) {
          if (error !== null && typeof error === "object") {
            (error as { rollback_error?: unknown }).rollback_error = rollbackError;
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

const DEFAULT_ANALYZE_RUN_LIMIT = 25;
const MAX_ANALYZE_RUN_LIMIT = 100;

type AnalyzeRunPaginationInput = {
  limit: number;
  cursor: string | null;
};

export function readAnalyzeRunPagination(params: URLSearchParams): AnalyzeRunPaginationInput {
  const cursor = nonEmptyString(params.get("cursor"));
  if (cursor !== null) decodeAnalyzeRunCursor(cursor);
  return {
    limit: readBoundedLimit(params.get("limit"), DEFAULT_ANALYZE_RUN_LIMIT, MAX_ANALYZE_RUN_LIMIT),
    cursor,
  };
}

function readBoundedLimit(value: string | null, defaultLimit: number, maxLimit: number): number {
  if (value === null || value.trim() === "") return defaultLimit;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DevApiHttpError(400, "limit must be a positive integer");
  }
  return Math.min(parsed, maxLimit);
}

function decodeAnalyzeRunCursor(value: string): { created_at: string; run_id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const createdAt = nonEmptyString(parsed.created_at);
    const runId = nonEmptyString(parsed.run_id);
    if (createdAt === null || runId === null) throw new Error("invalid cursor payload");
    return { created_at: createdAt, run_id: runId };
  } catch {
    throw new DevApiHttpError(400, "cursor is invalid");
  }
}

function readAnalyzeSourceCategories(
  value: unknown,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) {
    throw new DevApiHttpError(400, "source_categories must be an array");
  }
  const categories = value.map((category, index) => {
    const text = nonEmptyString(category);
    if (text === null) throw new DevApiHttpError(400, `source_categories[${index}] must be a non-empty string`);
    return text;
  });
  return categories;
}

function analyzeBundleIds(sourceCategories: ReadonlyArray<string>): ReadonlyArray<string> {
  try {
    return mapSourceCategoriesToBundles({ categories: sourceCategories }).bundle_ids;
  } catch (error) {
    if (error instanceof SourceCategoryMappingError) {
      throw new DevApiHttpError(400, error.message);
    }
    throw error;
  }
}

function analyzeSubjectRefs(input: {
  primary: SubjectRef | null;
  added: ReadonlyArray<SubjectRef>;
}): ReadonlyArray<SubjectRef> {
  const byKey = new Map<string, SubjectRef>();
  for (const ref of [
    ...(input.primary ? [input.primary] : []),
    ...input.added,
  ]) {
    byKey.set(`${ref.kind}:${ref.id}`, { kind: ref.kind, id: ref.id });
  }
  return Object.freeze([...byKey.values()]);
}

export function enrichAnalyzeRunBlocks(
  blocks: ReadonlyArray<Record<string, unknown> | JsonValue>,
  run: Pick<AnalyzeTemplateRunRow | DevAnalyzeRun, "run_id" | "template_id" | "template_version" | "snapshot_id" | "created_at">,
): ShareableArtifactBlock[] {
  return blocks.map((block) => {
    if (block === null || typeof block !== "object" || Array.isArray(block)) {
      return block as ShareableArtifactBlock;
    }
    const record = block as Record<string, JsonValue>;
    const dataRef = record.data_ref;
    const dataRefRecord = dataRef !== null && typeof dataRef === "object" && !Array.isArray(dataRef)
      ? dataRef as Record<string, JsonValue>
      : { kind: "analyze_run", id: run.run_id };
    const params = dataRefRecord.params;
    const paramsRecord = params !== null && typeof params === "object" && !Array.isArray(params)
      ? params as Record<string, JsonValue>
      : {};
    return {
      ...record,
      data_ref: {
        ...dataRefRecord,
        params: {
          ...paramsRecord,
          analyze_run_id: run.run_id,
          analyze_template_id: run.template_id,
          analyze_template_version: run.template_version,
          analyze_run_created_at: run.created_at,
          origin_snapshot_id: run.snapshot_id,
        },
      },
    } as ShareableArtifactBlock;
  });
}

async function listAnalyzeRunsForTemplate(
  db: AnalyzeTemplateRunClientPool & QueryExecutor,
  templateId: string,
  templateName = "Analyze template",
): Promise<DevAnalyzeRunSummary[]> {
  const { listAnalyzeTemplateRunsByTemplate } = await import("../../analyze/src/index.ts");
  const rows = await listAnalyzeTemplateRunsByTemplate(db, templateId);
  return Promise.all(rows.map((row) => toDevAnalyzeRunSummary(db, row, templateName)));
}

async function toDevAnalyzeRunSummary(
  db: QueryExecutor,
  row: AnalyzeTemplateRunSummarySource,
  templateName = "template_name" in row ? row.template_name : "Analyze template",
): Promise<DevAnalyzeRunSummary> {
  return withDurableAnalyzeRerunEligibility(db, toDevAnalyzeRunSummaryFields(row, templateName), row);
}

async function toDevAnalyzeRun(
  db: QueryExecutor,
  row: AnalyzeTemplateRunRow | AnalyzeTemplateRunWithTemplateRow,
  templateName = "template_name" in row ? row.template_name : "Analyze template",
): Promise<DevAnalyzeRun> {
  const summary = await withDurableAnalyzeRerunEligibility(
    db,
    toDevAnalyzeRunSummaryFields(row, templateName),
    row,
  );
  return {
    ...summary,
    run_metadata: row.run_metadata,
    blocks: row.blocks as ReadonlyArray<Record<string, unknown>>,
  };
}

type AnalyzeTemplateRunSummarySource =
  | AnalyzeTemplateRunSummaryRow
  | AnalyzeTemplateRunRow
  | AnalyzeTemplateRunWithTemplateRow;

function toDevAnalyzeRunSummaryFields(
  row: AnalyzeTemplateRunSummarySource,
  templateName: string,
): DevAnalyzeRunSummary {
  const metadata = hasAnalyzeRunMetadata(row)
    ? safeParseStoredAnalyzeRunMetadata(row.run_metadata)
    : null;
  const playbookId = metadata?.playbook_id ?? row.playbook_id;
  const playbook = playbookId === null
    ? undefined
    : ANALYZE_PLAYBOOKS.find((candidate) => candidate.playbook_id === playbookId);
  const summaryRerunFields = hasAnalyzeRunSummaryRerunFields(row);
  return {
    run_id: row.run_id,
    template_id: row.template_id,
    template_name: templateName,
    template_version: row.template_version,
    playbook_id: playbookId,
    playbook_name: playbook?.name ?? null,
    playbook_version: summaryRerunFields ? row.playbook_version : metadata?.playbook_version ?? null,
    display_title: playbook?.name ?? templateName,
    can_rerun: summaryRerunFields ? row.can_rerun : metadata !== null,
    rerun_unavailable_reason: summaryRerunFields ? row.rerun_unavailable_reason : metadata === null
      ? "This run's metadata is not rerunnable."
      : null,
    snapshot_id: row.snapshot_id,
    created_at: row.created_at,
  };
}

function hasAnalyzeRunMetadata(
  row: AnalyzeTemplateRunSummarySource,
): row is AnalyzeTemplateRunRow | AnalyzeTemplateRunWithTemplateRow {
  return "run_metadata" in row;
}

function hasAnalyzeRunSummaryRerunFields(
  row: AnalyzeTemplateRunSummarySource,
): row is AnalyzeTemplateRunSummaryRow {
  return "can_rerun" in row;
}

async function withDurableAnalyzeRerunEligibility(
  db: QueryExecutor,
  summary: DevAnalyzeRunSummary,
  row: AnalyzeTemplateRunSummarySource,
): Promise<DevAnalyzeRunSummary> {
  if (!summary.can_rerun) return summary;
  const metadata = hasAnalyzeRunMetadata(row)
    ? safeParseStoredAnalyzeRunMetadata(row.run_metadata)
    : null;
  if (metadata !== null && metadata.template_id !== row.template_id) {
    return {
      ...summary,
      can_rerun: false,
      rerun_unavailable_reason: "This run's metadata is not rerunnable.",
    };
  }
  const template = await getAnalyzeTemplate(db, metadata?.template_id ?? row.template_id);
  if (template === null) {
    return {
      ...summary,
      can_rerun: false,
      rerun_unavailable_reason: "The template used by this run is no longer runnable.",
    };
  }
  return summary;
}

function parseStoredAnalyzeRunMetadata(value: unknown): AnalyzeRunMetadataV1 {
  try {
    return parseAnalyzeRunMetadata(value);
  } catch (error) {
    if (error instanceof AnalyzeRunMetadataError) {
      throw new DevApiHttpError(409, "analyze run metadata is not rerunnable");
    }
    throw error;
  }
}

function safeParseStoredAnalyzeRunMetadata(value: unknown): AnalyzeRunMetadataV1 | null {
  try {
    return parseAnalyzeRunMetadata(value);
  } catch {
    return null;
  }
}

function analyzeSubjectRefFromMetadata(ref: { kind: string; id: string }): SubjectRef {
  if (!isSubjectRef(ref)) {
    throw new DevApiHttpError(409, "analyze run metadata is not rerunnable");
  }
  return Object.freeze({ kind: ref.kind, id: ref.id });
}

export function resolveAnalyzePlaybookRequestOrHttpError(
  input: Parameters<typeof resolveAnalyzePlaybookRequest>[0],
) {
  try {
    return resolveAnalyzePlaybookRequest(input);
  } catch (error) {
    if (error instanceof AnalyzePlaybookError) {
      throw new DevApiHttpError(400, error.message);
    }
    throw error;
  }
}
