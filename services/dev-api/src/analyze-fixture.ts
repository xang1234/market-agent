// In-memory fixture implementation of DevApiAnalyzeAdapter — the test/dev double
// used when no durable database is configured. Kept separate from the durable
// adapter (analyze-adapter.ts) so the real persistence path and the fake never
// share mutable state or get confused for one another. Reuses the analyze DTO
// mapping + cursor helpers exported by analyze-adapter.ts.

import {
  parseAnalyzeRunMetadata,
  serializeAnalyzeRunMetadataV1,
  withRerunOfRunId,
} from "../../analyze/src/index.ts";
import { shareArtifactToChat } from "../../artifact/src/index.ts";
import type { ChatThread } from "../../chat/src/threads-repo.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "../../agents/src/index.ts";
import {
  DevApiHttpError,
  isObjectRecord,
  nonEmptyString,
  stableUuid,
} from "./dev-api-shared.ts";
import {
  contentHash,
  enrichAnalyzeRunBlocks,
  readOptionalSubjectRef,
  resolveAnalyzePlaybookRequestOrHttpError,
  type DevAnalyzeRun,
  type DevAnalyzeRunSummary,
  type DevAnalyzeTemplate,
  type DevApiAnalyzeAdapter,
} from "./analyze-adapter.ts";

export function createFixtureAnalyzeAdapter(): DevApiAnalyzeAdapter {
  const analyzeRuns: DevAnalyzeRun[] = [];
  const analyzeRunOwners = new Map<string, string>();
  const runOwner = (runId: string) => analyzeRunOwners.get(runId) ?? null;

  return {
    async listTemplates({ userId }) {
      return {
        templates: defaultAnalyzeTemplates(),
        runs: analyzeRuns
          .filter((run) => runOwner(run.run_id) === userId)
          .map(toAnalyzeRunSummary),
      };
    },
    async listRuns({ userId, limit, cursor }) {
      const runs = analyzeRuns
        .filter((run) => runOwner(run.run_id) === userId)
        .sort(compareAnalyzeRunsNewestFirst);
      const startIndex = cursor
        ? Math.max(0, runs.findIndex((run) => encodeAnalyzeRunCursor(run) === cursor) + 1)
        : 0;
      const page = runs.slice(startIndex, startIndex + limit);
      return {
        runs: page.map(toAnalyzeRunSummary),
        next_cursor: runs[startIndex + limit] && page.length > 0
          ? encodeAnalyzeRunCursor(page[page.length - 1])
          : null,
      };
    },
    async getRun({ userId, runId }) {
      const run = analyzeRuns.find((item) => item.run_id === runId && runOwner(item.run_id) === userId);
      if (!run) throw new DevApiHttpError(404, "analyze run not found");
      return run;
    },
    async createRun({ userId, body }) {
      const templateId = nonEmptyString(body.template_id) ?? EARNINGS_TEMPLATE_ID;
      const resolvedPlaybook = resolveFixtureAnalyzePlaybook(body);
      const primarySubjectRef = readOptionalSubjectRef(body.subject_ref ?? body.primary_subject_ref);
      const subjectRefs = primarySubjectRef ? [primarySubjectRef] : [];
      const sourceCategories = Array.isArray(body.source_categories)
        ? body.source_categories
          .filter((category): category is string => typeof category === "string" && category.trim() !== "")
          .map((category) => category.trim())
        : [...resolvedPlaybook.source_categories];
      const runId = stableUuid(`analyze-run:${userId}:${analyzeRuns.length}:${templateId}:${resolvedPlaybook.playbook.playbook_id}`);
      const snapshotId = stableUuid(`analyze-snapshot:${runId}`);
      const runMetadata = serializeAnalyzeRunMetadataV1({
        template_id: templateId,
        template_version: 1,
        playbook_id: resolvedPlaybook.playbook.playbook_id,
        playbook_version: resolvedPlaybook.playbook.version,
        instructions: resolvedPlaybook.instructions,
        source_categories: sourceCategories,
        subject_refs: subjectRefs,
      });
      const run: DevAnalyzeRun = {
        run_id: runId,
        template_id: templateId,
        template_name: fixtureTemplateName(templateId),
        template_version: 1,
        playbook_id: resolvedPlaybook.playbook.playbook_id,
        playbook_name: resolvedPlaybook.playbook.name,
        playbook_version: resolvedPlaybook.playbook.version,
        display_title: resolvedPlaybook.playbook.name,
        run_metadata: runMetadata,
        can_rerun: true,
        rerun_unavailable_reason: null,
        snapshot_id: snapshotId,
        blocks: [
          richTextBlock({
            id: stableUuid(`analyze-block:${runId}`),
            snapshotId,
            title: resolvedPlaybook.playbook.name,
            text: `${resolvedPlaybook.instructions} Sources: ${sourceCategories.join(", ")}.`,
            playbookSectionId: resolvedPlaybook.playbook.sections[0]?.section_id ?? "summary",
          }),
        ],
        created_at: new Date().toISOString(),
      };
      analyzeRuns.unshift(run);
      analyzeRunOwners.set(run.run_id, userId);
      return run;
    },
    async rerun({ userId, runId }) {
      const original = analyzeRuns.find((run) => run.run_id === runId && runOwner(run.run_id) === userId);
      if (!original) throw new DevApiHttpError(404, "analyze run not found");
      const metadata = parseAnalyzeRunMetadata(original.run_metadata);
      const rerunId = stableUuid(`analyze-rerun:${userId}:${runId}:${analyzeRuns.length}`);
      const snapshotId = stableUuid(`analyze-snapshot:${rerunId}`);
      const rerun: DevAnalyzeRun = {
        ...original,
        run_id: rerunId,
        snapshot_id: snapshotId,
        blocks: original.blocks.map((block, index) => cloneAnalyzeRunBlockForRerun(block, rerunId, snapshotId, index)),
        created_at: new Date().toISOString(),
        run_metadata: withRerunOfRunId(metadata, original.run_id),
        can_rerun: true,
        rerun_unavailable_reason: null,
      };
      analyzeRuns.unshift(rerun);
      analyzeRunOwners.set(rerun.run_id, userId);
      return rerun;
    },
    async shareRunToChat({ userId, runId, body }) {
      const run = analyzeRuns.find((candidate) => candidate.run_id === runId);
      if (!run || runOwner(run.run_id) !== userId) {
        throw new DevApiHttpError(404, "analyze run not found");
      }
      const thread = fixtureThread({
        userId,
        title: nonEmptyString(body.title) ?? "Research memo",
        primarySubjectRef: readOptionalSubjectRef(body.primary_subject_ref),
      });
      const blocks = enrichAnalyzeRunBlocks(run.blocks, run);
      const shared = await shareArtifactToChat({
        sources: [
          {
            source_kind: "memo",
            origin_snapshot_id: run.snapshot_id,
            blocks,
          },
        ],
        egress: {
          db: emptyEgressDb(),
          listFactsForEgress: async (_db, input) =>
            input.fact_ids.map((factId) => ({ fact_id: factId }) as never),
        },
      });
      if (!shared.ok) throw new DevApiHttpError(422, "artifact share rejected", shared.rejections);
      const sharedBlocks = shared.blocks as JsonValue;
      return {
        thread,
        message: {
          message_id: stableUuid(`artifact-message:${thread.thread_id}:${contentHash(sharedBlocks)}`),
          thread_id: thread.thread_id,
          role: "assistant",
          snapshot_id: shared.origin_snapshot_ids[0] ?? run.snapshot_id,
          blocks: sharedBlocks,
          content_hash: contentHash(sharedBlocks),
          created_at: new Date().toISOString(),
        },
        origin_snapshot_ids: shared.origin_snapshot_ids,
      };
    },
  };
}

// In-memory pagination for the fixture's run list: newest-first sort, opaque
// base64 cursor, and the summary projection (drop blocks + run_metadata). The
// durable adapter paginates through the analyze package instead, so these are
// fixture-only.
function compareAnalyzeRunsNewestFirst(a: DevAnalyzeRunSummary, b: DevAnalyzeRunSummary): number {
  const created = b.created_at.localeCompare(a.created_at);
  return created === 0 ? b.run_id.localeCompare(a.run_id) : created;
}

function encodeAnalyzeRunCursor(run: Pick<DevAnalyzeRunSummary, "created_at" | "run_id">): string {
  return Buffer.from(JSON.stringify({
    created_at: run.created_at,
    run_id: run.run_id,
  })).toString("base64url");
}

function toAnalyzeRunSummary(run: DevAnalyzeRun): DevAnalyzeRunSummary {
  const { blocks: _blocks, run_metadata: _runMetadata, ...summary } = run;
  return summary;
}

function fixtureThread(input: {
  userId: string;
  title: string | null;
  primarySubjectRef: SubjectRef | null;
}): ChatThread {
  const now = new Date().toISOString();
  return {
    thread_id: stableUuid(`thread:${input.userId}:${input.title ?? ""}:${now}`),
    user_id: input.userId,
    title: input.title,
    primary_subject_ref: input.primarySubjectRef,
    latest_snapshot_id: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
}

function emptyEgressDb(): QueryExecutor {
  return {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
}

function resolveFixtureAnalyzePlaybook(body: Record<string, unknown>) {
  return resolveAnalyzePlaybookRequestOrHttpError({
    playbook_id: nonEmptyString(body.playbook_id) ?? "earnings_quality",
    instructions: nonEmptyString(body.instructions) ?? undefined,
    source_categories: Array.isArray(body.source_categories)
      ? body.source_categories.filter((category): category is string => typeof category === "string")
      : undefined,
  });
}

function cloneAnalyzeRunBlockForRerun(
  block: Record<string, unknown>,
  rerunId: string,
  snapshotId: string,
  index: number,
): Record<string, unknown> {
  const id = stableUuid(`analyze-rerun-block:${rerunId}:${index}`);
  const dataRef = block.data_ref;
  const dataRefRecord = isObjectRecord(dataRef) ? dataRef : { kind: "analyze_run" };
  return {
    ...block,
    id,
    snapshot_id: snapshotId,
    data_ref: {
      ...dataRefRecord,
      id,
    },
  };
}

function richTextBlock(input: {
  id: string;
  snapshotId: string;
  title: string;
  text: string;
  playbookSectionId?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    kind: "rich_text",
    snapshot_id: input.snapshotId,
    data_ref: input.playbookSectionId
      ? { kind: "analyze_run", id: input.id, params: { playbook_section_id: input.playbookSectionId } }
      : { kind: "analyze_run", id: input.id },
    source_refs: [],
    as_of: new Date(0).toISOString(),
    title: input.title,
    segments: [{ type: "text", text: input.text }],
  };
}

const EARNINGS_TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";

function fixtureTemplateName(templateId: string): string {
  return defaultAnalyzeTemplates().find((template) => template.template_id === templateId)?.name ?? "Analyze template";
}

function defaultAnalyzeTemplates(): DevAnalyzeTemplate[] {
  return [
    {
      template_id: EARNINGS_TEMPLATE_ID,
      name: "Earnings template",
      prompt_template: "Assess revenue quality, margins, cash conversion, and management commentary.",
      source_categories: ["filings", "transcripts", "news"],
      version: 1,
    },
    {
      template_id: VARIANT_TEMPLATE_ID,
      name: "Variant view",
      prompt_template: "Compare the market narrative with evidence-backed counterpoints.",
      source_categories: ["filings", "news", "transcripts"],
      version: 1,
    },
  ];
}
