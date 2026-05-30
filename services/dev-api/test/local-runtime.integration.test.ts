import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import type { Client } from "pg";

import { claimAgentRun } from "../../agents/src/agent-run-repo.ts";
import { createAgent, getAgent } from "../../agents/src/agent-repo.ts";
import { runAgentLoop } from "../../agents/src/agent-loop.ts";
import { createAnalyzeTemplate } from "../../analyze/src/template-repo.ts";
import { createClaimArgument } from "../../evidence/src/claim-argument-repo.ts";
import { createClaimEvidence } from "../../evidence/src/claim-evidence-repo.ts";
import { createClaim } from "../../evidence/src/claim-repo.ts";
import { createDocument } from "../../evidence/src/document-repo.ts";
import { ephemeralRawBlobIdForSource } from "../../evidence/src/object-store.ts";
import { createSource } from "../../evidence/src/source-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  connectedPool,
  dockerAvailable,
  registerLifoCleanup,
} from "../../../db/test/docker-pg.ts";
import {
  closeLocalRuntimePoolForTests,
  createAgentLoopStages,
  runAnalyzeWorkflow,
  sealAnalyzeSnapshot,
} from "../src/local-runtime.ts";
import { createDevApiServer, createServiceDevApiAdapters } from "../src/http.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000099";
const SUBJECT_ID = "20000000-0000-4000-8000-000000000002";
const RUN_ID = "30000000-0000-4000-8000-000000000003";

async function seedUser(client: Client, userId = USER_ID): Promise<void> {
  await client.query(
    `insert into users (user_id, email) values ($1::uuid, $2)`,
    [userId, `${userId}@local-runtime-agent.example.com`],
  );
}

async function seedExistingEvidence(
  client: Client,
  input: { userId?: string | null; label: string; textCanonical?: string; effectiveTime?: string },
): Promise<{ claimId: string; documentId: string; sourceId: string }> {
  const asOf = input.effectiveTime ?? "2026-05-07T00:00:00.000Z";
  const source = await createSource(client, {
    provider: `seeded-local-evidence-${input.label}`,
    kind: "article",
    trust_tier: "secondary",
    license_class: "public",
    retrieved_at: asOf,
    content_hash: testHash(`source:${input.label}`),
    user_id: input.userId ?? null,
  });
  const document = (await createDocument(client, {
    source_id: source.source_id,
    kind: "article",
    title: `Seeded operating margin evidence (${input.label})`,
    published_at: asOf,
    content_hash: testHash(`document:${input.label}`),
    raw_blob_id: ephemeralRawBlobIdForSource(source.source_id),
    parse_status: "parsed",
  })).document;
  const claim = await createClaim(client, {
    document_id: document.document_id,
    predicate: "margin.quality",
    text_canonical: input.textCanonical ?? `${input.label} seeded evidence says operating margin quality improved because gross margin expanded.`,
    polarity: "positive",
    modality: "asserted",
    reported_by_source_id: source.source_id,
    effective_time: asOf,
    confidence: 0.84,
    status: "extracted",
  });
  await createClaimArgument(client, {
    claim_id: claim.claim_id,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    role: "subject",
  });
  await createClaimEvidence(client, {
    claim_id: claim.claim_id,
    document_id: document.document_id,
    locator: { kind: "paragraph", index: 3 },
    confidence: 0.84,
  });
  return { claimId: claim.claim_id, documentId: document.document_id, sourceId: source.source_id };
}

function testHash(seed: string): string {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function sorted(values: ReadonlyArray<string>): string[] {
  return [...values].sort();
}

async function startDevApiServer(
  t: TestContext,
  adapters: ReturnType<typeof createServiceDevApiAdapters>,
): Promise<string> {
  const server = createDevApiServer({}, { adapters });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test(
  "local analyze runtime produces verifier-valid claim/document/source backed blocks",
  { skip: !dockerAvailable(), timeout: 120_000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "dev-api-local-analyze-runtime");
    const previousDevApiUrl = process.env.DEV_API_DATABASE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DEV_API_DATABASE_URL = databaseUrl;
    registerLifoCleanup(t, async () => {
      await closeLocalRuntimePoolForTests();
      if (previousDevApiUrl === undefined) {
        delete process.env.DEV_API_DATABASE_URL;
      } else {
        process.env.DEV_API_DATABASE_URL = previousDevApiUrl;
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    });

    const client = await connectedClient(t, databaseUrl);
    await seedUser(client);
    await seedUser(client, OTHER_USER_ID);
    const otherUserSeeded = await seedExistingEvidence(client, { userId: OTHER_USER_ID, label: "other-user" });
    const seeded = await seedExistingEvidence(client, { userId: USER_ID, label: "owned" });
    const template = await createAnalyzeTemplate(client, {
      user_id: USER_ID,
      name: "Evidence-backed memo",
      prompt_template: "Summarize the evidence",
      source_categories: ["filings", "news"],
    });

    const snapshotId = "40000000-0000-4000-8000-000000000004";
    const rendered = await runAnalyzeWorkflow({
      userId: USER_ID,
      template,
      body: {},
      snapshotId,
      instructions: "Summarize the evidence",
      sourceCategories: ["filings"],
      bundleIds: ["company_profile", "filings"],
      subjectRefs: [{ kind: "issuer", id: SUBJECT_ID }],
      playbookSectionId: "summary",
    });

    assert.equal(rendered.blocks.length >= 1, true);
    const firstBlock = rendered.blocks[0]!;
    assert.equal(firstBlock.snapshot_id, snapshotId);
    assert.equal(
      (firstBlock.data_ref as { params?: { playbook_section_id?: string } }).params?.playbook_section_id,
      "summary",
    );
    assert.equal(Array.isArray(firstBlock.source_refs), true);
    assert.deepEqual(firstBlock.source_refs, [seeded.sourceId]);
    assert.equal(Array.isArray(firstBlock.claim_refs), true);
    assert.deepEqual(firstBlock.claim_refs, [seeded.claimId]);
    assert.equal(Array.isArray(firstBlock.document_refs), true);
    assert.deepEqual(firstBlock.document_refs, [seeded.documentId]);
    assert.match(JSON.stringify(firstBlock), /owned seeded evidence says operating margin quality improved/);
    assert.doesNotMatch(JSON.stringify(firstBlock), /other-user seeded evidence/);
    assert.equal((firstBlock.claim_refs as unknown[]).includes(otherUserSeeded.claimId), false);

    const seal = await sealAnalyzeSnapshot({
      snapshotId,
      userId: USER_ID,
      templateId: template.template_id,
      body: {},
      blocks: rendered.blocks,
    });

    assert.equal(seal.ok, true, JSON.stringify(seal.verification.failures));
    if (!seal.ok) return;
    assert.equal(seal.snapshot.snapshot_id, snapshotId);
    assert.equal(seal.snapshot.source_ids.length > 0, true);
    assert.equal(seal.snapshot.claim_refs.length > 0, true);
    assert.equal(seal.snapshot.document_refs.length > 0, true);

    const pool = await connectedPool(t, databaseUrl);
    const base = await startDevApiServer(t, createServiceDevApiAdapters({
      db: pool,
      runAnalyzeWorkflow,
      sealAnalyzeSnapshot,
      createAgentLoopStages,
    }));
    const response = await fetch(`${base}/v1/analyze/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": USER_ID,
      },
      body: JSON.stringify({
        template_id: template.template_id,
        instructions: "Summarize the evidence",
        source_categories: ["filings"],
        subject_ref: { kind: "issuer", id: SUBJECT_ID },
      }),
    });
    const body = await response.json() as { blocks?: Array<Record<string, unknown>>; snapshot_id?: string };
    assert.equal(response.status, 201);
    assert.deepEqual(body.blocks?.[0]?.claim_refs, [seeded.claimId]);
    assert.equal(typeof body.snapshot_id, "string");
  },
);

test(
  "local agent runtime creates snapshot-backed findings that real alert evaluation can fire on",
  { skip: !dockerAvailable(), timeout: 120_000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "dev-api-local-agent-runtime");
    const previousDevApiUrl = process.env.DEV_API_DATABASE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DEV_API_DATABASE_URL = databaseUrl;
    registerLifoCleanup(t, async () => {
      await closeLocalRuntimePoolForTests();
      if (previousDevApiUrl === undefined) {
        delete process.env.DEV_API_DATABASE_URL;
      } else {
        process.env.DEV_API_DATABASE_URL = previousDevApiUrl;
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    });

    const seedClient = await connectedClient(t, databaseUrl);
    await seedUser(seedClient);
    const canonicalClusterText = "operating margin quality improved because gross margin expanded.";
    const seeded = await seedExistingEvidence(seedClient, {
      userId: USER_ID,
      label: "owned",
      textCanonical: canonicalClusterText,
    });
    const corroborating = await seedExistingEvidence(seedClient, {
      userId: USER_ID,
      label: "owned-corroborating",
      textCanonical: canonicalClusterText,
    });

    const alertRules = [
      {
        rule_id: "local-runtime-check",
        severity_at_least: "medium",
        headline_contains: "operating margin quality",
        channels: ["email"],
      },
    ];
    const agent = await createAgent(seedClient, {
      user_id: USER_ID,
      name: "Local runtime integration agent",
      thesis: "Track whether the configured universe has fresh evidence.",
      cadence: "daily",
      universe: {
        mode: "static",
        subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
      },
      alert_rules: alertRules,
    });
    const claim = await claimAgentRun(seedClient, {
      run_id: RUN_ID,
      agent_id: agent.agent_id,
      inputs_watermark: agent.watermarks,
    });
    assert.equal(claim.claimed, true);

    const pool = await connectedPool(t, databaseUrl);
    const result = await runAgentLoop({
      pool,
      agent_id: agent.agent_id,
      run_id: RUN_ID,
      current_watermarks: agent.watermarks,
      alert_rules: alertRules,
      stages: createAgentLoopStages({ userId: USER_ID, runId: RUN_ID, agent, trigger: "manual" }),
    });

    assert.deepEqual(result.outputs_summary, {
      findings: 1,
      activities: 3,
      alerts: { evaluated_rules: 1, evaluated_findings: 1, fired: 1 },
    });

    const findingRows = (
      await seedClient.query<{
        finding_id: string;
        agent_id: string;
        snapshot_id: string;
        subject_refs: unknown;
        claim_cluster_ids: unknown;
        severity: string;
        headline: string;
        summary_blocks: unknown;
      }>(
        `select finding_id::text as finding_id,
                agent_id::text as agent_id,
                snapshot_id::text as snapshot_id,
                subject_refs,
                claim_cluster_ids,
                severity,
                headline,
                summary_blocks
           from findings
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows;

    assert.equal(findingRows.length, 1);
    const finding = findingRows[0];
    assert.equal(finding.agent_id, agent.agent_id);
    assert.equal(finding.severity, "medium");
    assert.match(finding.headline, /operating margin quality improved/);
    assert.deepEqual(finding.subject_refs, [{ kind: "issuer", id: SUBJECT_ID }]);
    assert.equal(Array.isArray(finding.claim_cluster_ids), true);
    assert.equal((finding.claim_cluster_ids as string[]).length, 1);
    const clusterId = (finding.claim_cluster_ids as string[])[0];
    const clusterMemberRows = (
      await seedClient.query<{ claim_id: string }>(
        `select claim_id::text as claim_id
           from claim_cluster_members
          where cluster_id = $1::uuid`,
        [clusterId],
      )
    ).rows;
    assert.deepEqual(sorted(clusterMemberRows.map((row) => row.claim_id)), sorted([seeded.claimId, corroborating.claimId]));

    const snapshotRows = (
      await seedClient.query<{
        basis: string;
        model_version: string | null;
        subject_refs: unknown;
        source_ids: unknown;
        claim_refs: unknown;
        document_refs: unknown;
      }>(
        `select basis, model_version, subject_refs, source_ids, claim_refs, document_refs
           from snapshots
          where snapshot_id = $1::uuid`,
        [finding.snapshot_id],
      )
    ).rows;
    assert.equal(snapshotRows.length, 1, "finding must reference a sealed snapshot row");
    assert.equal(snapshotRows[0].basis, "unadjusted");
    assert.equal(snapshotRows[0].model_version, "dev-api-local-agent-runtime");
    assert.deepEqual(snapshotRows[0].subject_refs, [{ kind: "issuer", id: SUBJECT_ID }]);
    assert.deepEqual(sorted(snapshotRows[0].source_ids as string[]), sorted([seeded.sourceId, corroborating.sourceId]));
    assert.deepEqual(sorted(snapshotRows[0].claim_refs as string[]), sorted([seeded.claimId, corroborating.claimId]));
    assert.deepEqual(sorted(snapshotRows[0].document_refs as string[]), sorted([seeded.documentId, corroborating.documentId]));

    assert.equal(Array.isArray(finding.summary_blocks), true);
    const summaryBlock = (finding.summary_blocks as Array<Record<string, unknown>>)[0];
    assert.equal(summaryBlock.kind, "finding_card");
    assert.equal(summaryBlock.finding_id, finding.finding_id);
    assert.equal(summaryBlock.snapshot_id, finding.snapshot_id);
    assert.deepEqual(summaryBlock.subject_refs, [{ kind: "issuer", id: SUBJECT_ID }]);
    assert.deepEqual(sorted(summaryBlock.source_refs as string[]), sorted([seeded.sourceId, corroborating.sourceId]));

    const activityRows = (
      await seedClient.query<{
        stage: string;
        source_refs: unknown;
        summary: string;
      }>(
        `select stage, source_refs, summary
           from run_activities
          where agent_id = $1::uuid
          order by ts asc, run_activity_id asc`,
        [agent.agent_id],
      )
    ).rows;
    assert.deepEqual(activityRows.map((row) => row.stage), ["reading", "investigating", "found"]);
    assert.match(activityRows[0].summary, /Read 2 evidence claims/);
    assert.match(activityRows[1].summary, /Clustered 2 source-backed claims into 1 evidence cluster/);
    assert.match(activityRows[2].summary, /Created 1 source-backed finding/);
    assert.deepEqual(sorted(activityRows[2].source_refs as string[]), sorted([seeded.sourceId, corroborating.sourceId]));

    const alertRows = (
      await seedClient.query<{
        run_id: string;
        finding_id: string;
        rule_id: string;
        status: string;
        channels: unknown;
        trigger_refs: unknown;
      }>(
        `select run_id::text as run_id,
                finding_id::text as finding_id,
                rule_id,
                status,
                channels,
                trigger_refs
           from alerts_fired
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows;
    assert.equal(alertRows.length, 1);
    assert.equal(alertRows[0].run_id, RUN_ID);
    assert.equal(alertRows[0].finding_id, finding.finding_id);
    assert.equal(alertRows[0].rule_id, "local-runtime-check");
    assert.equal(alertRows[0].status, "pending_notification");
    assert.deepEqual(alertRows[0].channels, ["email"]);
    assert.deepEqual(alertRows[0].trigger_refs, [
      { kind: "finding", id: finding.finding_id },
    ]);

    const updatedAgent = await getAgent(seedClient, agent.agent_id);
    assert.notEqual(updatedAgent, null);
    const secondRunId = "30000000-0000-4000-8000-000000000013";
    const secondResult = await runAgentLoop({
      pool,
      agent_id: agent.agent_id,
      run_id: secondRunId,
      current_watermarks: updatedAgent!.watermarks,
      alert_rules: alertRules,
      stages: createAgentLoopStages({ userId: USER_ID, runId: secondRunId, agent: updatedAgent!, trigger: "manual" }),
    });

    assert.deepEqual(secondResult.outputs_summary, {
      findings: 0,
      activities: 2,
      alerts: { evaluated_rules: 1, evaluated_findings: 0, fired: 0 },
    });
    const postRerunFindingCount = Number((
      await seedClient.query<{ count: string }>(
        `select count(*)::text as count
           from findings
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows[0].count);
    assert.equal(postRerunFindingCount, 1);
    const postRerunAlertCount = Number((
      await seedClient.query<{ count: string }>(
        `select count(*)::text as count
           from alerts_fired
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows[0].count);
    assert.equal(postRerunAlertCount, 1);

    const laterCorroborating = await seedExistingEvidence(seedClient, {
      userId: USER_ID,
      label: "owned-later-corroborating",
      textCanonical: canonicalClusterText,
    });
    const agentAfterNoopRun = await getAgent(seedClient, agent.agent_id);
    assert.notEqual(agentAfterNoopRun, null);
    const thirdRunId = "30000000-0000-4000-8000-000000000023";
    const thirdResult = await runAgentLoop({
      pool,
      agent_id: agent.agent_id,
      current_watermarks: agentAfterNoopRun!.watermarks,
      stages: createAgentLoopStages({ userId: USER_ID, runId: thirdRunId, agent: agentAfterNoopRun!, trigger: "manual" }),
    });

    assert.deepEqual(thirdResult.outputs_summary, {
      findings: 0,
      activities: 3,
    });
    const postClusterUpdateFindingCount = Number((
      await seedClient.query<{ count: string }>(
        `select count(*)::text as count
           from findings
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows[0].count);
    assert.equal(postClusterUpdateFindingCount, 1);
    const postClusterUpdateAlertCount = Number((
      await seedClient.query<{ count: string }>(
        `select count(*)::text as count
           from alerts_fired
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows[0].count);
    assert.equal(postClusterUpdateAlertCount, 1);
    const updatedClusterMemberRows = (
      await seedClient.query<{ claim_id: string }>(
        `select claim_id::text as claim_id
           from claim_cluster_members
          where cluster_id = $1::uuid`,
        [clusterId],
      )
    ).rows;
    assert.deepEqual(
      sorted(updatedClusterMemberRows.map((row) => row.claim_id)),
      sorted([seeded.claimId, corroborating.claimId, laterCorroborating.claimId]),
    );
  },
);

test(
  "local agent runtime records an empty evidence run without fabricating findings",
  { skip: !dockerAvailable(), timeout: 120_000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "dev-api-local-agent-runtime-empty");
    const previousDevApiUrl = process.env.DEV_API_DATABASE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DEV_API_DATABASE_URL = databaseUrl;
    registerLifoCleanup(t, async () => {
      await closeLocalRuntimePoolForTests();
      if (previousDevApiUrl === undefined) {
        delete process.env.DEV_API_DATABASE_URL;
      } else {
        process.env.DEV_API_DATABASE_URL = previousDevApiUrl;
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    });

    const seedClient = await connectedClient(t, databaseUrl);
    await seedUser(seedClient);
    const agent = await createAgent(seedClient, {
      user_id: USER_ID,
      name: "Empty local runtime integration agent",
      thesis: "Track whether the configured universe has fresh evidence.",
      cadence: "daily",
      universe: {
        mode: "static",
        subject_refs: [{ kind: "issuer", id: SUBJECT_ID }],
      },
      alert_rules: [
        {
          rule_id: "empty-run-check",
          severity_at_least: "medium",
          channels: ["email"],
        },
      ],
    });
    const emptyRunId = "30000000-0000-4000-8000-000000000004";
    const claim = await claimAgentRun(seedClient, {
      run_id: emptyRunId,
      agent_id: agent.agent_id,
      inputs_watermark: agent.watermarks,
    });
    assert.equal(claim.claimed, true);

    const pool = await connectedPool(t, databaseUrl);
    const result = await runAgentLoop({
      pool,
      agent_id: agent.agent_id,
      run_id: emptyRunId,
      current_watermarks: agent.watermarks,
      alert_rules: agent.alert_rules as ReadonlyArray<unknown>,
      stages: createAgentLoopStages({ userId: USER_ID, runId: emptyRunId, agent, trigger: "manual" }),
    });

    assert.deepEqual(result.outputs_summary, {
      findings: 0,
      activities: 2,
      alerts: { evaluated_rules: 1, evaluated_findings: 0, fired: 0 },
    });

    const findingCount = Number((
      await seedClient.query<{ count: string }>(
        `select count(*)::text as count
           from findings
          where agent_id = $1::uuid`,
        [agent.agent_id],
      )
    ).rows[0].count);
    assert.equal(findingCount, 0);

    const activityRows = (
      await seedClient.query<{ stage: string; summary: string }>(
        `select stage, summary
           from run_activities
          where agent_id = $1::uuid
          order by ts asc, run_activity_id asc`,
        [agent.agent_id],
      )
    ).rows;
    assert.deepEqual(activityRows.map((row) => row.stage), ["reading", "dismissed"]);
    assert.match(activityRows[0].summary, /Read 0 evidence claims/);
    assert.match(activityRows[1].summary, /No source-backed findings created/);
  },
);
