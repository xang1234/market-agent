import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import test from "node:test";

import { FINANCIAL_CATALOG_VERSION } from "../services/financial-core/src/index.ts";
import { buildReport, recordedModel } from "./verified-finance-eval.ts";
import { HELD_OUT_QUESTIONS, RECORDED_DRAFTS } from "./verified-finance-fixtures.ts";

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));

test("the deterministic report passes, names what it covers, and claims nothing it did not measure", async () => {
  const report = await buildReport({ model: recordedModel(), mode: "recorded" });
  assert.equal(report.passed, true);
  assert.match(report.fixture_revision, /^[0-9a-f]{64}$/u);
  assert.equal(report.versions.catalog, FINANCIAL_CATALOG_VERSION);
  assert.equal(report.golden.passed, report.golden.total);
  assert.deepEqual([report.mutation.baseline_verified, report.mutation.rejected, report.mutation.accepted], [true, report.mutation.total, []]);
  assert.ok(report.declared_gaps.includes("margin-zero-revenue"));
  assert.ok(report.plan_fidelity.mode === "recorded" && report.plan_fidelity.faithful === HELD_OUT_QUESTIONS.length);
  assert.ok(report.plan_fidelity.mode === "recorded" && report.plan_fidelity.latency_ms === null, "latency is reported only when measured live");
  assert.deepEqual(report.plan_fidelity.mode === "recorded" && report.plan_fidelity.pending_review, HELD_OUT_QUESTIONS.map((question) => question.id));
  assert.equal(report.cost, null);
  assert.ok(!/accuracy|percent/iu.test(Object.keys(report).join(" ")), "no universal accuracy figure");
});

test("a plan that answers a different question fails the gate even when its arithmetic would verify", async () => {
  const wrongMetric = { ...RECORDED_DRAFTS, "gross-margin": RECORDED_DRAFTS["revenue-fy"] };
  const report = await buildReport({ model: recordedModel(wrongMetric), mode: "recorded" });
  assert.equal(report.passed, false);
  assert.ok(report.plan_fidelity.mode === "recorded");
  const [entry] = report.plan_fidelity.unfaithful;
  assert.equal(entry?.id, "gross-margin");
  assert.deepEqual(entry?.mismatches, [
    "metrics: intended gross_profit, revenue, planned revenue",
    "operations: intended gross_margin, planned none",
  ]);
});

test("a planner that drops a requested company is never counted as faithful", async () => {
  const onlyAlpha = { ...RECORDED_DRAFTS, "revenue-compare": RECORDED_DRAFTS["revenue-fy"] };
  const report = await buildReport({ model: recordedModel(onlyAlpha), mode: "recorded" });
  assert.ok(report.plan_fidelity.mode === "recorded");
  assert.deepEqual(report.plan_fidelity.unfaithful.map((entry) => [entry.id, entry.outcome]), [["revenue-compare", "needs_clarification"]]);
  assert.equal(report.passed, false);
});

test("without a model, plan fidelity is reported as not measured rather than passed", async () => {
  const report = await buildReport();
  assert.deepEqual(report.plan_fidelity, { mode: "not_measured", reason: "no planning model was provided" });
  assert.ok(report.not_measured.some((entry) => entry.startsWith("plan fidelity")));
});

test("the CLI prints the deterministic report and exits zero when the gate passes", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/verified-finance-eval.ts"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.schema_version, "verified_finance_eval.v1");
  assert.equal(report.plan_fidelity.mode, "recorded");
});
