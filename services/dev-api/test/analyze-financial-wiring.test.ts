// The dev API freezes a memo's financial context before any work, keeps the
// engine's sections away from legacy producers, publishes against the
// committed memo run, and reports declared sections from committed state.

import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyzeFinancialRun } from "../../analyze/src/financial-section.ts";
import { createServiceDevApiAdapters } from "../src/http.ts";

const USER = "00000000-0000-4000-8000-000000000001";
const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const ISSUER = "33333333-3333-4333-8333-333333333333";

function fakeDb() {
  let metadata: unknown = null;
  const client = {
    async query(text: string, values?: unknown[]) {
      if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };
      if (text.includes("insert into analyze_template_runs")) {
        metadata = JSON.parse(String(values?.[3]));
        return {
          rows: [{
            run_id: RUN, template_id: values?.[0], template_version: values?.[1], playbook_id: values?.[2], run_metadata: metadata,
            snapshot_id: values?.[4], blocks: JSON.parse(String(values?.[5])), created_at: "2026-05-06T00:00:00.000Z",
          }],
        };
      }
      // The memo run as the financial-section reader loads it.
      if (text.includes("from analyze_template_runs r join analyze_templates t")) {
        return { rows: [{ user_id: USER, template_id: TEMPLATE, template_version: 3, run_metadata: metadata }] };
      }
      if (text.includes("from analyze_run_financial_sections") || text.includes("from financial_runs f")) return { rows: [] };
      if (text.includes("from analyze_templates")) {
        return {
          rows: [{
            template_id: TEMPLATE, user_id: USER, name: "Earnings quality", prompt_template: "Review", source_categories: ["filings"],
            added_subject_refs: [], block_layout_hint: null, peer_policy: null, disclosure_policy: null, version: 3,
            created_at: "2026-05-06T00:00:00.000Z", updated_at: "2026-05-06T00:00:00.000Z",
          }],
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() {},
  };
  return { connect: async () => client, query: client.query };
}

function okSeal(snapshotId: string) {
  return {
    ok: true as const,
    snapshot: {
      snapshot_id: snapshotId, subject_refs: [], fact_refs: [], claim_refs: [], event_refs: [], document_refs: [], series_specs: [], source_ids: [],
      tool_call_ids: [], tool_call_result_hashes: [], as_of: "2026-05-06T00:00:00.000Z", basis: "test", normalization: {}, coverage_start: null,
      allowed_transforms: null, model_version: "test", parent_snapshot: null, created_at: "2026-05-06T00:00:00.000Z",
    },
    verification: { ok: true, failures: [] },
  };
}

test("a memo run declares its frozen financial context and publishes it against the committed run", async () => {
  const published: AnalyzeFinancialRun[] = [];
  let served: ReadonlySet<string> | undefined;
  const adapters = createServiceDevApiAdapters({
    db: fakeDb() as never,
    runAnalyzeWorkflow: (input) => ({
      blocks: [{ id: "memo-1", kind: "rich_text", snapshot_id: input.snapshotId, as_of: "2026-05-06T00:00:00.000Z", segments: [{ type: "text", text: "Narrative." }] }],
    }),
    sealAnalyzeSnapshot: async () => {
      throw new Error("a playbook run seals through buildAnalyzeRunSeals");
    },
    buildAnalyzeRunSeals: async (input) => {
      served = input.servedByEngine;
      return { blocks: input.memoBlocks, sealSnapshot: async () => okSeal(input.snapshotId) as never };
    },
    analyzeFinancial: {
      mode: "enforce",
      resolvePeers: async () => {
        throw new Error("earnings quality compares no peers");
      },
      publish: async (run) => {
        published.push(run);
        return { coverage: "none", sections: [] };
      },
    },
  } as never);

  const run = await adapters.analyze.createRun({
    userId: USER,
    body: { template_id: TEMPLATE, playbook_id: "earnings_quality", subject_ref: { kind: "issuer", id: ISSUER } },
  });

  const financial = (run.run_metadata as { financial: Record<string, unknown> }).financial;
  assert.deepEqual({ ...financial, knowledge_cutoff: typeof financial.knowledge_cutoff }, {
    mode: "enforce",
    knowledge_cutoff: "string",
    reporting_basis: "as_reported",
    catalog_version: "catalog.v1",
    primary: { kind: "issuer", id: ISSUER },
    requested_peers: [],
    sections: ["revenue_trend"],
  });
  assert.deepEqual([...served!], ["revenue_trend"], "the legacy revenue producer does not run beside the engine");
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], { user_id: USER, analyze_run_id: RUN, template_id: TEMPLATE, template_version: 3, context: financial });
  assert.deepEqual(run.financial_sections, {
    coverage: "none",
    sections: [{ section_id: "revenue_trend", status: "gap", reason_code: "not_started" }],
  }, "declared sections are read from committed state, never assumed complete");
});
