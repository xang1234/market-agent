import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS, ORIGINAL_REVENUE, seedCashResilience } from "../../financial-engine/test/db-fixtures.ts";
import {
  financialSectionIds,
  loadAnalyzeFinancialSections,
  prepareAnalyzeFinancialContext,
  sectionsServedByEngine,
  type AnalyzeFinancialSection,
} from "../src/financial-section.ts";
import { parseAnalyzeRunMetadata } from "../src/runMetadata.ts";
import { runDeterministicSections } from "../src/section-runner.ts";
import { committed, createMemoRun, CUTOFF, memoDatabase, playbook } from "./financial-fixtures.ts";

type Published = Extract<AnalyzeFinancialSection, { status: "published" }>;

function published(section: AnalyzeFinancialSection | undefined): Published {
  assert.equal(section?.status, "published", JSON.stringify(section));
  return section as Published;
}

function values(section: Published): Record<string, string> {
  return Object.fromEntries(section.block.financial.results.map((result) => [
    result.output_id,
    result.presented.kind === "value" ? result.presented.value : result.presented.kind === "gap" ? `gap:${result.disposition}` : result.presented.kind,
  ]));
}

test("numerical sections are chosen per playbook; narrative sections stay with the memo", () => {
  assert.deepEqual(financialSectionIds(playbook("earnings_quality")), ["revenue_trend"]);
  assert.deepEqual(financialSectionIds(playbook("peer_comparison")), ["peer_table"]);
  assert.deepEqual(financialSectionIds(playbook("investment_memo")), ["financial_health", "cash_resilience", "revenue_trend"]);
  assert.deepEqual(financialSectionIds(playbook("variant_view")), []);
});

test("the financial context freezes cutoff, basis, catalog, and the exact peers requested", () => {
  const base = { playbook: playbook("peer_comparison"), primary: { kind: "issuer" as const, id: IDS.issuerA }, knowledge_cutoff: "2024-03-01T05:00:00+05:00" };
  const peers = [IDS.issuerB, IDS.issuerA, IDS.issuerB].map((id) => ({ kind: "issuer" as const, id }));
  assert.equal(prepareAnalyzeFinancialContext({ ...base, mode: "off", peers }), null, "the lane is off");
  assert.equal(prepareAnalyzeFinancialContext({ ...base, mode: "enforce", primary: null, peers }), null, "no issuer to compute for");
  assert.equal(prepareAnalyzeFinancialContext({ ...base, mode: "enforce", playbook: playbook("variant_view"), peers }), null, "nothing numerical");
  const context = prepareAnalyzeFinancialContext({ ...base, mode: "enforce", peers })!;
  assert.deepEqual(context, {
    mode: "enforce",
    knowledge_cutoff: "2024-03-01T00:00:00.000Z",
    reporting_basis: "as_reported",
    catalog_version: "catalog.v1",
    primary: { kind: "issuer", id: IDS.issuerA },
    requested_peers: [{ kind: "issuer", id: IDS.issuerB }],
    sections: ["peer_table"],
  });
  const withoutPeerTable = prepareAnalyzeFinancialContext({ ...base, mode: "enforce", playbook: playbook("earnings_quality"), peers })!;
  assert.deepEqual(withoutPeerTable.requested_peers, [], "peers are requested only by a section that compares them");
});

test("sections the engine serves never run their legacy producers", async () => {
  const context = prepareAnalyzeFinancialContext({
    mode: "enforce", playbook: playbook("peer_comparison"), primary: { kind: "issuer", id: IDS.issuerA }, peers: [], knowledge_cutoff: CUTOFF,
  });
  const untouchable = new Proxy({}, { get: () => { throw new Error("a legacy producer ran for an engine-served section"); } });
  const seals = await runDeterministicSections(untouchable as never, {
    playbook: playbook("peer_comparison"),
    primary: { kind: "issuer", id: IDS.issuerA },
    snapshotId: "11111111-1111-4111-a111-111111111111",
    asOf: CUTOFF,
    servedByEngine: sectionsServedByEngine(context),
  });
  assert.deepEqual(seals, []);
});

test("analyze financial sections", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for analyze financial section coverage");
    return;
  }
  const { db, pool, templateId } = await memoDatabase(t, "analyze-fin-section");
  await seedCashResilience(db);

  await t.test("each numerical section is its own certified unit under one plan and cutoff", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    const result = await memo.publish();
    assert.equal(result.coverage, "complete");
    assert.deepEqual(result.sections.map((section) => section.section_id), ["financial_health", "cash_resilience", "revenue_trend"]);
    const [health, resilience, trend] = result.sections.map(published);
    assert.notEqual(health.snapshot_id, trend.snapshot_id, "each section is sealed alone");
    assert.notEqual(health.snapshot_id, memo.snapshotId, "no certified number is merged into the narrative snapshot");
    assert.equal(health.run_id, trend.run_id, "one run fixes the context for every section");
    for (const section of [health, resilience, trend]) {
      assert.equal(section.block.kind, "financial_answer");
      assert.equal(section.block.financial.knowledge_cutoff, CUTOFF);
    }
    assert.deepEqual(values(trend), {
      revenue_trend_current: ORIGINAL_REVENUE,
      revenue_trend_prior: "365817000000",
      revenue_trend_growth: values(trend).revenue_trend_growth,
    });
    assert.match(values(trend).revenue_trend_growth!, /^0\.04/u, "growth is computed from the as-reported values");
    assert.match(values(health).financial_health_gross_margin!, /^0\.44/u);
    assert.deepEqual(Object.values(values(resilience!)), ["120", "100", "300", "600", "200", "1.2", "0.5", "1.5"], "five inputs and the three ratios (#210)");
    assert.deepEqual(await committed(db, memo.runId), { sections: 3, certificates: 3, plans: 1 });
    assert.deepEqual(await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }), result, "reads return the committed sections");
  });

  await t.test("a peer without eligible data stays in the table as a gap, and coverage says partial", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "peer_comparison", peers: [IDS.issuerB] });
    const result = await memo.publish();
    assert.equal(result.coverage, "partial");
    const table = published(result.sections[0]);
    const dispositions = Object.fromEntries(table.block.financial.results.map((row) => [row.output_id, row.disposition]));
    assert.deepEqual(dispositions, { peer_table_s0: "verified", peer_table_s1: "missing", peer_table_rank: "verified" });
    const labels = Object.values(table.block.financial.labels).map((label) => label.text);
    assert.ok(labels.includes("Alpha Industries Inc.") && labels.includes("Beta Holdings Corp."), "both requested companies are shown");
    const rank = table.block.financial.results.find((row) => row.output_id === "peer_table_rank")!.presented;
    assert.equal(rank.kind, "ranking");
    assert.equal(rank.kind === "ranking" && rank.complete, false, "no complete ranking over a partial peer set");
  });

  await t.test("the saved metadata preserves the run's financial context for reruns", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "peer_comparison", peers: [IDS.issuerB] });
    const saved = parseAnalyzeRunMetadata((await db.query(`select run_metadata from analyze_template_runs where run_id = $1`, [memo.runId])).rows[0].run_metadata);
    assert.deepEqual(saved.financial, memo.context);
    const rerun = await createMemoRun(db, pool, { templateId, playbookId: "peer_comparison", context: saved.financial! });
    const [first, second] = [await memo.publish(), await rerun.publish()];
    assert.deepEqual(values(published(second.sections[0])), values(published(first.sections[0])), "a rerun under the saved context computes the same values");
  });

  await t.test("a historical cutoff selects only what was public then", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality", cutoff: "2024-01-05T00:00:00.000Z" });
    const result = await memo.publish();
    assert.equal(result.coverage, "none", "nothing was public by the cutoff");
    const trend = published(result.sections[0]);
    assert.deepEqual(Object.fromEntries(trend.block.financial.results.map((row) => [row.output_id, row.disposition])), {
      revenue_trend_current: "missing",
      revenue_trend_prior: "missing",
      revenue_trend_growth: "blocked_dependency",
    }, "no value is published before its filing was public; the gaps are declared");
  });

  await t.test("another user cannot read a memo's sections", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
    await memo.publish();
    assert.equal(await loadAnalyzeFinancialSections(db, { userId: IDS.other, analyzeRunId: memo.runId }), null);
  });
});

test("a gap inside the optional cash-resilience section stays in that section", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for analyze financial section coverage");
    return;
  }
  const { db, pool, templateId } = await memoDatabase(t, "analyze-fin-optional");
  await seedCashResilience(db, { net_income: "-100" });
  const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
  const result = await memo.publish();
  const resilience = published(result.sections.find((section) => section.section_id === "cash_resilience"));
  assert.deepEqual(resilience.block.financial.coverage, { state: "partial", requested: 8, verified: 7 }, "a net loss leaves cash conversion undefined");
  assert.equal(result.coverage, "complete", "the required sections are fully verified");
  assert.deepEqual(await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }), result);

  // A run saved under a playbook version this code doesn't have can't know which sections were optional (#355 review).
  await db.query(`update analyze_template_runs set run_metadata = jsonb_set(run_metadata, '{playbook_version}', '99') where run_id = $1`, [memo.runId]);
  assert.equal((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))?.coverage, "partial");
});

test("a memo with no required financial section reads its optional sections' coverage (#355 review)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for analyze financial section coverage");
    return;
  }
  const { db, pool, templateId } = await memoDatabase(t, "analyze-fin-optional-only");
  await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.fy2022]);
  const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
  const result = await memo.publish();
  const trend = published(result.sections[0]);
  assert.equal(trend.block.financial.coverage.state, "partial", "the prior year is missing, so growth is blocked");
  assert.equal(result.coverage, "partial", "revenue trend is the memo's only verified section, so its gap is the memo's");
});
