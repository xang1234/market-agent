import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyzeFinancialRun } from "../../analyze/src/financial-section.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import { createServiceDevApiAdapters } from "../src/http.ts";
import { fakePgQuery, sealedSnapshot } from "./fakes.ts";

const USER = "00000000-0000-4000-8000-000000000001";
const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const ISSUER = "33333333-3333-4333-8333-333333333333";
const ORIGINAL = "44444444-4444-4444-8444-444444444444";

const MEMO_WITHOUT_FINANCIAL_CONTEXT = {
  run_id: ORIGINAL, template_id: TEMPLATE, template_version: 3, playbook_id: "earnings_quality", template_name: "Earnings quality",
  run_metadata: {
    schema_version: 1, template_id: TEMPLATE, template_version: 3, playbook_id: "earnings_quality", playbook_version: 1,
    instructions: "Review", source_categories: ["filings"], subject_refs: [{ kind: "issuer", id: ISSUER }],
  },
  snapshot_id: "55555555-5555-4555-8555-555555555555", blocks: [], created_at: "2026-05-01T00:00:00.000Z",
};

function fakeDb() {
  let metadata: unknown = null;
  const client = {
    query: fakePgQuery(async (text: string, values?: unknown[]) => {
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
      if (text.includes("t.name as template_name")) return { rows: [MEMO_WITHOUT_FINANCIAL_CONTEXT] };
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
    }),
    release() {},
  };
  return { connect: async () => client, query: client.query };
}

function okSeal(snapshotId: string): SnapshotSealResult {
  return { ok: true, snapshot: sealedSnapshot(snapshotId), verification: { ok: true, failures: [] } };
}

type Hydration = { years: Array<[string, number]>; at: string };

function adaptersWith(published: AnalyzeFinancialRun[], hydrated: Hydration[], workflow = true) {
  return createServiceDevApiAdapters({
    db: fakeDb(),
    runAnalyzeWorkflow: workflow ? (input) => ({
      blocks: [{ id: "memo-1", kind: "rich_text", snapshot_id: input.snapshotId, as_of: "2026-05-06T00:00:00.000Z", segments: [{ type: "text", text: "Narrative." }] }],
    }) : undefined,
    sealAnalyzeSnapshot: async () => {
      throw new Error("a playbook run seals through buildAnalyzeRunSeals");
    },
    buildAnalyzeRunSeals: async (input) => ({ blocks: input.memoBlocks, sealSnapshot: async () => okSeal(input.snapshotId) }),
    analyzeFinancial: {
      resolvePeers: async () => {
        throw new Error("earnings quality compares no peers");
      },
      hydrate: async (years) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        hydrated.push({ years: [...years], at: new Date().toISOString() });
      },
      publish: async (run) => {
        published.push(run);
        return { coverage: "none", sections: [] };
      },
    },
  });
}

test("a memo run hydrates its issuer, declares its frozen financial context, and publishes it against the committed run", async () => {
  const published: AnalyzeFinancialRun[] = [];
  const hydrated: Hydration[] = [];
  const run = await adaptersWith(published, hydrated).analyze.createRun({
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
  assert.deepEqual(hydrated.map((call) => call.years), [[[ISSUER, 2]]], "revenue_trend reads the latest two years");
  assert.ok(String(financial.knowledge_cutoff) >= hydrated[0]!.at, "the cutoff is taken after the facts are fetched");
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], { user_id: USER, analyze_run_id: RUN, template_id: TEMPLATE, template_version: 3, context: financial });
  assert.deepEqual(run.financial_sections, {
    coverage: "none",
    sections: [{ section_id: "revenue_trend", status: "gap", reason_code: "not_started" }],
  }, "declared sections are read from committed state, never assumed complete");
});

test("a rerun of a memo saved without a financial context hydrates and publishes a fresh one", async () => {
  const published: AnalyzeFinancialRun[] = [];
  const hydrated: Hydration[] = [];
  const run = await adaptersWith(published, hydrated).analyze.rerun({ userId: USER, runId: ORIGINAL });

  const metadata = run.run_metadata as { rerun_of_run_id: string; financial: Record<string, unknown> };
  assert.equal(metadata.rerun_of_run_id, ORIGINAL);
  assert.deepEqual(metadata.financial.sections, ["revenue_trend"]);
  assert.deepEqual(metadata.financial.primary, { kind: "issuer", id: ISSUER });
  assert.deepEqual(hydrated.map((call) => call.years), [[[ISSUER, 2]]]);
  assert.deepEqual(published.map((entry) => entry.context), [metadata.financial]);
  assert.deepEqual(run.financial_sections?.sections, [{ section_id: "revenue_trend", status: "gap", reason_code: "not_started" }]);
});

test("a memo with no workflow configured is refused before any SEC fetch", async () => {
  const hydrated: Hydration[] = [];
  await assert.rejects(
    adaptersWith([], hydrated, false).analyze.createRun({
      userId: USER,
      body: { template_id: TEMPLATE, playbook_id: "earnings_quality", subject_ref: { kind: "issuer", id: ISSUER } },
    }),
    { status: 503 },
  );
  assert.deepEqual(hydrated, []);
});
