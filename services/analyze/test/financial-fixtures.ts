// Shared harness for the Analyze financial-section tests: a real engine
// database with the owner's template and memo runs persisted through the
// production template-run persister.

import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client, Pool } from "pg";
import { connectedPool } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import {
  prepareAnalyzeFinancialContext,
  publishAnalyzeFinancialSections,
  type AnalyzeFinancialContext,
  type AnalyzeFinancialMode,
} from "../src/financial-section.ts";
import { ANALYZE_PLAYBOOKS, type AnalyzePlaybook } from "../src/playbook.ts";
import { serializeAnalyzeRunMetadataV1 } from "../src/runMetadata.ts";
import { persistAnalyzeTemplateRunAfterSnapshotSealWithPool } from "../src/template-runner.ts";

/** After both fixture filings are public; as-reported revenue is the original FY2023 disclosure. */
export const CUTOFF = "2024-03-01T00:00:00.000Z";

export function playbook(id: string): AnalyzePlaybook {
  return ANALYZE_PLAYBOOKS.find((item) => item.playbook_id === id)!;
}

export async function memoDatabase(t: TestContext, prefix: string): Promise<{ db: Client; pool: Pool; templateId: string }> {
  const db = await engineDatabase(t, prefix);
  const pool = await connectedPool(t, databaseUrl(db));
  const templateId = (await db.query<{ template_id: string }>(
    `insert into analyze_templates (user_id, name, prompt_template) values ($1, 'Fixture memo', 'Analyze {subject}') returning template_id::text`,
    [IDS.owner],
  )).rows[0]!.template_id;
  return { db, pool, templateId };
}

/**
 * Persists a memo run whose narrative snapshot is already sealed, declaring
 * the financial context in its metadata, and returns what publishing needs.
 */
export async function createMemoRun(
  db: Client,
  pool: Pool,
  input: { templateId: string; playbookId: string; peers?: string[]; mode?: AnalyzeFinancialMode; cutoff?: string; context?: AnalyzeFinancialContext },
) {
  const book = playbook(input.playbookId);
  const context = input.context ?? prepareAnalyzeFinancialContext({
    mode: input.mode ?? "enforce",
    playbook: book,
    primary: { kind: "issuer", id: IDS.issuerA },
    peers: (input.peers ?? []).map((id) => ({ kind: "issuer" as const, id })),
    knowledge_cutoff: input.cutoff ?? CUTOFF,
  });
  const snapshotId = randomUUID();
  await db.query(
    `insert into snapshots (snapshot_id, subject_refs, fact_refs, claim_refs, event_refs, document_refs, series_specs, source_ids,
                            tool_call_ids, tool_call_result_hashes, as_of, basis, normalization, allowed_transforms)
     values ($1, $2, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', $3, 'reported', 'raw', 'null')`,
    [snapshotId, JSON.stringify([{ kind: "issuer", id: IDS.issuerA }]), context?.knowledge_cutoff ?? CUTOFF],
  );
  const runId = randomUUID();
  const persisted = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
    run_id: runId,
    template_id: input.templateId,
    template_version: 1,
    playbook_id: book.playbook_id,
    blocks: [{ id: "summary-1", kind: "rich_text", snapshot_id: snapshotId, segments: [{ type: "text", text: "Narrative memo." }] }],
    run_metadata: serializeAnalyzeRunMetadataV1({
      template_id: input.templateId,
      template_version: 1,
      playbook_id: book.playbook_id,
      playbook_version: book.version,
      instructions: book.default_instructions,
      source_categories: book.default_source_categories,
      subject_refs: [{ kind: "issuer", id: IDS.issuerA }],
      ...(context ? { financial: context } : {}),
    }),
    sealSnapshot: async () => narrativeSeal(snapshotId, context?.knowledge_cutoff ?? CUTOFF),
  });
  if (!persisted.ok) throw new Error("fixture memo did not persist");
  const publish = () => publishAnalyzeFinancialSections(
    { pool, evidence: createEvidenceFinancialPort },
    { user_id: IDS.owner, analyze_run_id: runId, template_id: input.templateId, template_version: 1, context: context! },
  );
  return { runId, snapshotId, context, publish };
}

function narrativeSeal(snapshotId: string, asOf: string): SnapshotSealResult {
  return {
    ok: true,
    snapshot: {
      snapshot_id: snapshotId, created_at: asOf, subject_refs: [{ kind: "issuer", id: IDS.issuerA }], fact_refs: [], claim_refs: [], event_refs: [],
      document_refs: [], series_specs: [], source_ids: [], tool_call_ids: [], tool_call_result_hashes: [], as_of: asOf, basis: "reported",
      normalization: "raw", coverage_start: null, allowed_transforms: null, model_version: null, parent_snapshot: null,
    },
    verification: { ok: true, failures: [] },
  } as unknown as SnapshotSealResult;
}

export async function committed(db: Client, runId: string) {
  const one = async (sql: string) => Number((await db.query(sql, [runId])).rows[0].n);
  return {
    sections: await one(`select count(*)::int as n from analyze_run_financial_sections where analyze_run_id = $1`),
    certificates: await one(`select count(*)::int as n from snapshot_financial_runs c join financial_runs r on r.run_id = c.run_id where r.parent_id = $1`),
    plans: await one(`select count(distinct plan_id)::int as n from financial_runs where parent_id = $1`),
  };
}
