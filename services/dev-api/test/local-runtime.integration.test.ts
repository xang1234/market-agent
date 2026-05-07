import assert from "node:assert/strict";
import test from "node:test";

import type { Client } from "pg";

import { claimAgentRun } from "../../agents/src/agent-run-repo.ts";
import { createAgent } from "../../agents/src/agent-repo.ts";
import { runAgentLoop } from "../../agents/src/agent-loop.ts";
import { createAnalyzeTemplate } from "../../analyze/src/template-repo.ts";
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

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "20000000-0000-4000-8000-000000000002";
const RUN_ID = "30000000-0000-4000-8000-000000000003";

async function seedUser(client: Client): Promise<void> {
  await client.query(
    `insert into users (user_id, email) values ($1::uuid, $2)`,
    [USER_ID, "local-runtime-agent@example.com"],
  );
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
    });

    assert.equal(rendered.blocks.length >= 1, true);
    const firstBlock = rendered.blocks[0]!;
    assert.equal(firstBlock.snapshot_id, snapshotId);
    assert.equal(Array.isArray(firstBlock.source_refs), true);
    assert.equal((firstBlock.source_refs as unknown[]).length > 0, true);
    assert.equal(Array.isArray(firstBlock.claim_refs), true);
    assert.equal((firstBlock.claim_refs as unknown[]).length > 0, true);
    assert.equal(Array.isArray(firstBlock.document_refs), true);
    assert.equal((firstBlock.document_refs as unknown[]).length > 0, true);

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

    const alertRules = [
      {
        rule_id: "local-runtime-check",
        severity_at_least: "medium",
        headline_contains: "configured research universe",
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
      stages: createAgentLoopStages({ userId: USER_ID, runId: RUN_ID, agent }),
    });

    assert.deepEqual(result.outputs_summary, {
      findings: 1,
      activities: 1,
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
    assert.match(finding.headline, /configured research universe/);
    assert.deepEqual(finding.subject_refs, [{ kind: "issuer", id: SUBJECT_ID }]);
    assert.equal(Array.isArray(finding.claim_cluster_ids), true);

    const snapshotRows = (
      await seedClient.query<{
        basis: string;
        model_version: string | null;
        subject_refs: unknown;
      }>(
        `select basis, model_version, subject_refs
           from snapshots
          where snapshot_id = $1::uuid`,
        [finding.snapshot_id],
      )
    ).rows;
    assert.equal(snapshotRows.length, 1, "finding must reference a sealed snapshot row");
    assert.equal(snapshotRows[0].basis, "unadjusted");
    assert.equal(snapshotRows[0].model_version, "dev-api-local-agent-runtime");
    assert.deepEqual(snapshotRows[0].subject_refs, [{ kind: "issuer", id: SUBJECT_ID }]);

    assert.equal(Array.isArray(finding.summary_blocks), true);
    const summaryBlock = (finding.summary_blocks as Array<Record<string, unknown>>)[0];
    assert.equal(summaryBlock.kind, "finding_card");
    assert.equal(summaryBlock.finding_id, finding.finding_id);
    assert.equal(summaryBlock.snapshot_id, finding.snapshot_id);
    assert.deepEqual(summaryBlock.subject_refs, [{ kind: "issuer", id: SUBJECT_ID }]);

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
  },
);
