import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import {
  addClaimClusterMember,
  buildClaimCanonicalSignature,
  upsertClaimCluster,
} from "../../evidence/src/claim-cluster-repo.ts";
import {
  loadLocalRuntimeEvidence,
  loadVerifierRowsForRefs,
  type LocalRuntimeClaimEvidence,
  type LocalRuntimeEvidence,
} from "../../evidence/src/local-runtime-evidence.ts";
import { loadEvidenceInspection } from "../../evidence/src/inspector.ts";
import { hashJsonValue, toolCallArgsDigest } from "../../observability/src/tool-call.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import { serializeJsonValue } from "../../observability/src/types.ts";
import { writeRunActivity } from "../../observability/src/run-activity.ts";
import { generateFinding, type FindingRow } from "../../agents/src/finding-generator.ts";
import type { SnapshotManifestDraft, SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { STAGED_SNAPSHOT_MANIFEST, stageSnapshotManifest } from "../../snapshot/src/manifest-staging.ts";
import {
  sealSnapshotInTransaction,
  sealSnapshotWithPool,
  snapshotTransactionClient,
} from "../../snapshot/src/snapshot-sealer.ts";
import type {
  DevApiAgentLoopStageFactory,
  DevApiAnalyzeWorkflowInput,
  DevApiAnalyzeWorkflowResult,
  DevApiServiceAdapterDeps,
} from "./http.ts";

let localPool: Pool | null = null;

type LocalRuntimeClusterGroup = {
  canonical_signature: string;
  claims: ReadonlyArray<LocalRuntimeClaimEvidence>;
  source_ids: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
};

type LocalRuntimeClusterEvidence = {
  evidence: LocalRuntimeEvidence;
  clusters: ReadonlyArray<LocalRuntimeClusterGroup>;
};

export async function runAnalyzeWorkflow(
  input: DevApiAnalyzeWorkflowInput,
): Promise<DevApiAnalyzeWorkflowResult> {
  const asOf = new Date().toISOString();
  const subjectRefs = normalizeSubjectRefs(input.subjectRefs);
  const evidence = await loadLocalRuntimeEvidence(pool(), {
    subject_refs: subjectRefs,
    user_id: input.userId,
  });
  const toolCallId = randomUUID();
  const toolResult = {
    kind: "local_analyze_workflow_result",
    template_id: input.template.template_id,
    bundle_ids: [...input.bundleIds],
    evidence_status: evidence.claim_refs.length > 0 ? "available" : "insufficient_evidence",
    manifest_contribution: {
      subject_refs: subjectRefs,
      claim_refs: evidence.claim_refs,
      document_refs: evidence.document_refs,
      source_ids: evidence.source_ids,
    },
  } satisfies JsonValue;
  await writeLocalToolCallLog(pool(), {
    toolCallId,
    toolName: "local_analyze_workflow",
    args: {
      template_id: input.template.template_id,
      source_categories: [...input.sourceCategories],
      bundle_ids: [...input.bundleIds],
      subject_refs: subjectRefs,
    },
    result: toolResult,
  });
  return {
    blocks: [
      {
        id: randomUUID(),
        kind: "rich_text",
        snapshot_id: input.snapshotId,
        data_ref: { kind: "rich_text", id: `analyze:${input.template.template_id}` },
        source_refs: evidence.source_ids,
        claim_refs: evidence.claim_refs,
        document_refs: evidence.document_refs,
        tool_call_ids: [toolCallId],
        as_of: asOf,
        subject_refs: subjectRefs,
        title: input.template.name,
        segments: [
          {
            type: "text",
            text: analyzeMemoText(input, evidence),
          },
        ],
      },
    ],
  };
}

export async function sealAnalyzeSnapshot(
  input: Parameters<DevApiServiceAdapterDeps["sealAnalyzeSnapshot"]>[0],
) {
  const blocks = input.blocks as ReadonlyArray<Record<string, unknown>>;
  const snapshotId = input.snapshotId;
  const asOf = maxBlockAsOf(blocks) ?? new Date().toISOString();
  const subjectRefs = subjectRefsFromBlocks(blocks);
  const manifest = await manifestFromBlockRefs({
    subjectRefs,
    asOf,
    modelVersion: "dev-api-local-runtime",
    blocks,
  });
  const verifierRows = await loadVerifierRowsForRefs(pool(), {
    source_ids: manifest.source_ids,
    document_refs: manifest.document_refs,
    claim_refs: manifest.claim_refs,
    user_id: input.userId,
  });
  return sealSnapshotWithPool(pool(), {
    snapshot_id: snapshotId,
    manifest,
    blocks: blocks as never,
    sources: verifierRows.sources,
    documents: verifierRows.documents,
    claims: verifierRows.claims,
  });
}

export async function inspectEvidence(
  input: Parameters<NonNullable<DevApiServiceAdapterDeps["inspectEvidence"]>>[0],
) {
  return loadEvidenceInspection(pool(), {
    user_id: input.userId,
    snapshot_id: input.snapshotId,
    ref: input.ref,
  });
}

export const createAgentLoopStages: DevApiAgentLoopStageFactory = ({ userId, runId, agent, trigger = "scheduled" }) => {
  const subjectRefs = normalizeSubjectRefs(subjectRefsFromUniverse(agent.universe));
  const asOf = new Date().toISOString();
  const activityClock = activityClockFrom(asOf);
  let findings: ReadonlyArray<FindingRow> = [];
  return {
    readDeltas: async ({ current_watermarks }) => ({
      trigger,
      run_id: runId,
      current_watermarks,
      subject_refs: subjectRefs,
      as_of: asOf,
      processed_claim_ids: processedClaimIdsFromWatermarks(current_watermarks),
    }),
    extractEvidence: async ({ deltas }) => ({
      deltas,
      evidence: await loadLocalRuntimeEvidence(pool(), {
        subject_refs: subjectRefs,
        user_id: userId,
        exclude_claim_ids: processedClaimIdsFromWatermarks(
          isJsonObject(deltas) ? deltas.current_watermarks : {},
        ),
      }),
    }),
    clusterEvidence: async ({ evidence }) => ({
      evidence,
      clusters: clusterLocalRuntimeEvidence(localRuntimeEvidence(evidence), subjectRefs),
    }),
    analyze: async ({ clusters }) => ({
      clusters: localRuntimeClusterEvidence(clusters).clusters,
    }),
    nextWatermarks: async ({ current_watermarks, evidence }) => {
      const loadedEvidence = localRuntimeEvidence(evidence);
      const existingLocal = localAgentWatermarks(current_watermarks);
      const processedClaimIds = uniqueStrings([
        ...processedClaimIdsFromWatermarks(current_watermarks),
        ...loadedEvidence.claim_refs,
      ]);
      return {
        ...(isJsonObject(current_watermarks) ? current_watermarks : {}),
        local_agent_evidence: {
          ...existingLocal,
          trigger,
          [`last_${trigger}_run_id`]: runId,
          last_checked_at: new Date().toISOString(),
          last_evidence_claim_count: loadedEvidence.claim_refs.length,
          processed_claim_ids: processedClaimIds,
        },
      };
    },
    applySideEffects: async ({ tx, evidence, clusters }) => {
      const loadedEvidence = localRuntimeEvidence(evidence);
      const clusterGroups = localRuntimeClusterEvidence(clusters).clusters;
      await writeRunActivity(tx, {
        user_id: userId,
        agent_id: agent.agent_id,
        stage: "reading",
        subject_refs: subjectRefs,
        source_refs: loadedEvidence.source_ids,
        summary: `Read ${loadedEvidence.claims.length} evidence ${plural(loadedEvidence.claims.length, "claim")} for the configured research universe.`,
        ts: activityClock(0),
      });

      if (clusterGroups.length === 0) {
        await writeRunActivity(tx, {
          user_id: userId,
          agent_id: agent.agent_id,
          stage: "dismissed",
          subject_refs: subjectRefs,
          summary: "No source-backed findings created because no evidence claims matched the configured universe.",
          ts: activityClock(1),
        });
        findings = [];
        return {
          findings: 0,
          activities: 2,
        };
      }

      await writeRunActivity(tx, {
        user_id: userId,
        agent_id: agent.agent_id,
        stage: "investigating",
        subject_refs: subjectRefs,
        source_refs: loadedEvidence.source_ids,
        summary: `Clustered ${loadedEvidence.claims.length} source-backed ${plural(loadedEvidence.claims.length, "claim")} into ${clusterGroups.length} evidence ${plural(clusterGroups.length, "cluster")}.`,
        ts: activityClock(1),
      });

      const snapshotId = randomUUID();
      const snapshotManifest = await sealAgentEvidenceSnapshot({
        tx,
        snapshotId,
        userId,
        subjectRefs,
        evidence: loadedEvidence,
      });

      const createdFindings: FindingRow[] = [];
      for (const group of clusterGroups) {
        const cluster = await upsertClusterForGroup(tx, group, subjectRefs, asOf);
        if (await agentAlreadyHasFindingForCluster(tx, agent.agent_id, cluster.cluster_id)) {
          continue;
        }
        const representativeClaim = group.claims[0];
        if (representativeClaim === undefined) continue;
        createdFindings.push(await generateFinding(tx, {
          agent_id: agent.agent_id,
          snapshot_id: snapshotId,
          snapshot_manifest: snapshotManifest,
          subject_refs: subjectRefs,
          claim_cluster_ids: [cluster.cluster_id],
          headline: representativeClaim.text_canonical,
          severity_input: severityInputForClaims(group.claims),
          source_refs: group.source_ids,
        }));
      }
      findings = createdFindings;

      await writeRunActivity(tx, {
        user_id: userId,
        agent_id: agent.agent_id,
        stage: "found",
        subject_refs: subjectRefs,
        source_refs: loadedEvidence.source_ids,
        summary: `Created ${createdFindings.length} source-backed ${plural(createdFindings.length, "finding")}.`,
        ts: activityClock(2),
      });

      return {
        findings: findings.length,
        activities: 3,
      };
    },
    alertFindings: async () => findings,
  };
};

async function sealAgentEvidenceSnapshot(input: {
  tx: QueryExecutor;
  snapshotId: string;
  userId: string;
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
  evidence: LocalRuntimeEvidence;
}): Promise<{ snapshot_id: string; source_ids: ReadonlyArray<string>; as_of: string }> {
  const asOf = new Date().toISOString();
  const toolCallId = randomUUID();
  const toolResult = {
    kind: "local_agent_evidence_result",
    evidence_status: "available",
    manifest_contribution: {
      subject_refs: input.subjectRefs,
      claim_refs: input.evidence.claim_refs,
      document_refs: input.evidence.document_refs,
      source_ids: input.evidence.source_ids,
    },
  } satisfies JsonValue;
  await writeLocalToolCallLog(input.tx, {
    toolCallId,
    toolName: "local_agent_evidence_retrieval",
    args: {
      subject_refs: input.subjectRefs,
      limit: input.evidence.claims.length,
    },
    result: toolResult,
  });
  const manifest = stageSnapshotManifest({
    subject_refs: input.subjectRefs,
    as_of: asOf,
    basis: "unadjusted",
    normalization: "raw",
    allowed_transforms: {},
    model_version: "dev-api-local-agent-runtime",
    tool_calls: [
      {
        tool_call_id: toolCallId,
        result: toolResult,
        subject_refs: input.subjectRefs,
        claim_refs: input.evidence.claim_refs,
        document_refs: input.evidence.document_refs,
        source_ids: input.evidence.source_ids,
      },
    ],
  });
  const verifierRows = await loadVerifierRowsForRefs(input.tx, {
    source_ids: manifest.source_ids,
    document_refs: manifest.document_refs,
    claim_refs: manifest.claim_refs,
    user_id: input.userId,
  });
  const seal = await sealSnapshotInTransaction(snapshotTransactionClient(input.tx), {
    snapshot_id: input.snapshotId,
    manifest,
    blocks: input.evidence.claims.map((claim) => ({
      id: `agent-evidence-${claim.claim_id}`,
      kind: "rich_text",
      snapshot_id: input.snapshotId,
      data_ref: { kind: "rich_text", id: claim.claim_id },
      source_refs: [claim.source_id],
      claim_refs: [claim.claim_id],
      document_refs: [claim.document_id],
      as_of: asOf,
      subject_refs: input.subjectRefs,
      segments: [{ type: "text", text: claim.text_canonical }],
    })) as never,
    sources: verifierRows.sources,
    documents: verifierRows.documents,
    claims: verifierRows.claims,
  });
  if (!seal.ok) {
    throw new Error(`local agent runtime failed to seal evidence snapshot: ${JSON.stringify(seal.verification.failures)}`);
  }
  return {
    snapshot_id: input.snapshotId,
    source_ids: manifest.source_ids,
    as_of: manifest.as_of,
  };
}

async function upsertClusterForGroup(
  db: QueryExecutor,
  group: LocalRuntimeClusterGroup,
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>,
  seenAt: string,
) {
  const cluster = await upsertClaimCluster(db, {
    canonical_signature: group.canonical_signature,
    seen_at: seenAt,
  });
  for (const claim of group.claims) {
    await addClaimClusterMember(db, {
      cluster_id: cluster.cluster_id,
      claim_id: claim.claim_id,
      relation: claim.polarity === "negative" ? "contradict" : "support",
    });
  }
  return cluster;
}

async function agentAlreadyHasFindingForCluster(
  db: QueryExecutor,
  agentId: string,
  clusterId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ finding_id: string }>(
    `select finding_id::text as finding_id
       from findings
      where agent_id = $1::uuid
        and claim_cluster_ids ? $2
      limit 1`,
    [agentId, clusterId],
  );
  return rows.length > 0;
}

function localRuntimeEvidence(value: unknown): LocalRuntimeEvidence {
  if (isJsonObject(value) && isJsonObject(value.evidence)) return value.evidence as unknown as LocalRuntimeEvidence;
  return value as LocalRuntimeEvidence;
}

function localRuntimeClusterEvidence(value: unknown): LocalRuntimeClusterEvidence {
  if (isJsonObject(value) && Array.isArray(value.clusters)) return value as unknown as LocalRuntimeClusterEvidence;
  const evidence = localRuntimeEvidence(value);
  return {
    evidence,
    clusters: clusterLocalRuntimeEvidence(evidence, evidence.subject_refs),
  };
}

function clusterLocalRuntimeEvidence(
  evidence: LocalRuntimeEvidence,
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>,
): ReadonlyArray<LocalRuntimeClusterGroup> {
  const groups = new Map<string, LocalRuntimeClaimEvidence[]>();
  for (const claim of evidence.claims) {
    const signature = buildClaimCanonicalSignature({
      predicate: claim.predicate,
      text_canonical: claim.text_canonical,
      event_type: claim.predicate,
      effective_time: claim.effective_time,
      subjects: subjectRefs,
    });
    groups.set(signature, [...(groups.get(signature) ?? []), claim]);
  }
  return Object.freeze([...groups.entries()].map(([canonicalSignature, claims]) => {
    const frozenClaims = Object.freeze([...claims]);
    return Object.freeze({
      canonical_signature: canonicalSignature,
      claims: frozenClaims,
      source_ids: Object.freeze(uniqueStrings(frozenClaims.map((claim) => claim.source_id))),
      document_refs: Object.freeze(uniqueStrings(frozenClaims.map((claim) => claim.document_id))),
      claim_refs: Object.freeze(uniqueStrings(frozenClaims.map((claim) => claim.claim_id))),
    });
  }));
}

function severityInputForClaims(claims: ReadonlyArray<LocalRuntimeClaimEvidence>) {
  const representative = claims[0];
  if (representative === undefined) {
    throw new Error("cannot score an empty evidence cluster");
  }
  return {
    evidence: {
      trust_tier: scoringTrustTier(bestTrustTier(claims)),
      corroborating_source_count: uniqueStrings(claims.map((claim) => claim.source_id)).length,
      confidence: clamp01(Math.max(...claims.map((claim) => claim.confidence))),
    },
    impact: {
      direction: scoringDirection(representative.polarity),
      channel: "demand" as const,
      horizon: "near_term" as const,
      confidence: 0.5,
    },
    thesis_relevance: 0.5,
  };
}

function bestTrustTier(claims: ReadonlyArray<LocalRuntimeClaimEvidence>): string {
  const rank = new Map([
    ["primary", 4],
    ["user", 3],
    ["secondary", 2],
    ["tertiary", 1],
  ]);
  return [...claims]
    .sort((left, right) => (rank.get(right.trust_tier) ?? 0) - (rank.get(left.trust_tier) ?? 0))[0]?.trust_tier ?? "secondary";
}

function processedClaimIdsFromWatermarks(value: unknown): ReadonlyArray<string> {
  const local = localAgentWatermarks(value);
  const processed = local.processed_claim_ids;
  return Array.isArray(processed) ? uniqueStrings(processed.filter((id): id is string => typeof id === "string" && isUuid(id))) : [];
}

function localAgentWatermarks(value: unknown): Record<string, JsonValue> {
  if (!isJsonObject(value)) return {};
  return isJsonObject(value.local_agent_evidence) ? value.local_agent_evidence : {};
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function scoringTrustTier(value: string): "primary" | "secondary" | "tertiary" | "user" {
  if (value === "primary" || value === "secondary" || value === "tertiary" || value === "user") return value;
  return "secondary";
}

function scoringDirection(value: string): "positive" | "negative" | "mixed" | "unknown" {
  if (value === "positive" || value === "negative" || value === "mixed" || value === "unknown") return value;
  return "unknown";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function activityClockFrom(asOf: string): (offsetMs: number) => Date {
  const start = Date.parse(asOf);
  return (offsetMs) => new Date(start + offsetMs);
}

function pool(): Pool {
  if (localPool) return localPool;
  const databaseUrl = process.env.DEV_API_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for dev-api local runtime");
  }
  localPool = new Pool({ connectionString: databaseUrl });
  return localPool;
}

async function writeLocalToolCallLog(db: QueryExecutor, input: {
  toolCallId: string;
  threadId?: string | null;
  toolName: string;
  args: JsonValue;
  result: JsonValue;
}): Promise<void> {
  await db.query(
    `insert into tool_call_logs
       (tool_call_id, thread_id, tool_name, args, result_hash, duration_ms, status, error_code)
     values ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8)
     on conflict (tool_call_id) do update
        set result_hash = excluded.result_hash,
            status = excluded.status,
            error_code = excluded.error_code`,
    [
      input.toolCallId,
      input.threadId ?? null,
      input.toolName,
      serializeJsonValue(toolCallArgsDigest(input.args)),
      hashJsonValue(input.result),
      0,
      "ok",
      null,
    ],
  );
}

async function manifestFromBlockRefs(input: {
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
  asOf: string;
  modelVersion: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
}): Promise<SnapshotManifestDraft> {
  const toolCallIds = uuidRefsFromBlocks(input.blocks, "tool_call_ids");
  const toolCallResultHashes = await loadToolCallResultHashes(toolCallIds);
  return Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true,
    subject_refs: Object.freeze([...input.subjectRefs]),
    fact_refs: Object.freeze([]),
    claim_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "claim_refs")),
    event_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "event_refs")),
    document_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "document_refs")),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze(uuidRefsFromBlocks(input.blocks, "source_refs")),
    tool_call_ids: Object.freeze(toolCallIds),
    tool_call_result_hashes: Object.freeze(toolCallResultHashes),
    as_of: input.asOf,
    basis: "unadjusted",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: Object.freeze({}),
    model_version: input.modelVersion,
    parent_snapshot: null,
  });
}

async function loadToolCallResultHashes(
  toolCallIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<{ tool_call_id: string; result_hash: string }>> {
  if (toolCallIds.length === 0) return Object.freeze([]);
  const { rows } = await pool().query<{ tool_call_id: string; result_hash: string }>(
    `select tool_call_id::text as tool_call_id,
            result_hash
       from tool_call_logs
      where tool_call_id = any($1::uuid[])
        and status = 'ok'
        and result_hash is not null`,
    [toolCallIds],
  );
  const byId = new Map(rows.map((row) => [row.tool_call_id, row.result_hash]));
  return Object.freeze(
    toolCallIds.flatMap((tool_call_id) => {
      const result_hash = byId.get(tool_call_id);
      return result_hash === undefined ? [] : [Object.freeze({ tool_call_id, result_hash })];
    }),
  );
}

function uuidRefsFromBlocks(
  blocks: ReadonlyArray<Record<string, unknown>>,
  key: string,
): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const block of blocks) {
    const values = block[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== "string" || !isUuid(value) || seen.has(value)) continue;
      seen.add(value);
      refs.push(value);
    }
  }
  return refs;
}

export async function closeLocalRuntimePoolForTests(): Promise<void> {
  const poolToClose = localPool;
  localPool = null;
  await poolToClose?.end();
}

function analyzeMemoText(
  input: DevApiAnalyzeWorkflowInput,
  evidence?: { claims: ReadonlyArray<{ text_canonical: string }> },
): string {
  const sources = input.sourceCategories.length > 0 ? input.sourceCategories.join(", ") : "base template scope";
  const subjects = input.subjectRefs.length > 0
    ? input.subjectRefs.map((subject) => `${subject.kind}:${subject.id}`).join(", ")
    : "the active workspace context";
  const evidenceText = evidence === undefined
    ? ""
    : evidence.claims.length > 0
    ? `Evidence claims:\n${evidence.claims.map((claim, index) => `${index + 1}. ${claim.text_canonical}`).join("\n")}`
    : "Insufficient local evidence: no existing claims, facts, or events were found for the requested subjects.";
  return [
    input.instructions,
    `Sources: ${sources}.`,
    `Subjects: ${subjects}.`,
    `Bundles: ${input.bundleIds.join(", ")}.`,
    evidenceText,
  ].filter((line) => line.length > 0).join("\n\n");
}

function subjectRefsFromBlocks(blocks: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<SnapshotSubjectRef> {
  const refs: SnapshotSubjectRef[] = [];
  for (const block of blocks) {
    const subjectRefs = block.subject_refs;
    if (!Array.isArray(subjectRefs)) continue;
    for (const subjectRef of subjectRefs) {
      if (isSnapshotSubjectRef(subjectRef)) refs.push(subjectRef);
    }
  }
  return normalizeSubjectRefs(refs);
}

function subjectRefsFromUniverse(universe: unknown): ReadonlyArray<SnapshotSubjectRef> {
  if (!isJsonObject(universe)) return [];
  if (universe.mode === "static" && Array.isArray(universe.subject_refs)) {
    return universe.subject_refs.filter(isSnapshotSubjectRef);
  }
  if (typeof universe.mode === "string" && typeof universe[`${universe.mode}_id`] === "string") {
    const kind = universe.mode === "agent" ? "screen" : universe.mode;
    const id = universe[`${universe.mode}_id`];
    if (isSnapshotSubjectKind(kind) && isUuid(id)) return [{ kind, id }];
  }
  return [];
}

function normalizeSubjectRefs(
  refs: ReadonlyArray<unknown>,
): ReadonlyArray<SnapshotSubjectRef> {
  return refs.filter(isSnapshotSubjectRef);
}

function maxBlockAsOf(blocks: ReadonlyArray<Record<string, unknown>>): string | null {
  const values = blocks
    .map((block) => block.as_of)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return values.at(-1) ?? null;
}

function isSnapshotSubjectRef(value: unknown): value is SnapshotSubjectRef {
  if (!isJsonObject(value)) return false;
  return isSnapshotSubjectKind(value.kind) && typeof value.id === "string" && isUuid(value.id);
}

function isSnapshotSubjectKind(value: unknown): value is SnapshotSubjectRef["kind"] {
  return value === "issuer" ||
    value === "instrument" ||
    value === "listing" ||
    value === "theme" ||
    value === "macro_topic" ||
    value === "portfolio" ||
    value === "screen";
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
