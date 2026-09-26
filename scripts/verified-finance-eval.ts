// The verified-finance release report: golden cases against an independent
// oracle, mutants against the snapshot verifier, and plan fidelity on
// held-out questions. Deterministic by default (recorded plan drafts, no
// provider secrets); `--live` asks the configured model and only then records
// latency. It reports counts, named failures, declared gaps, and what was not
// measured — never a single accuracy percentage.
//
//   node --experimental-strip-types scripts/verified-finance-eval.ts [--live] [--out report.json]
//
// Exits non-zero when the gate fails.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  createRuntimeAuthority,
  evaluateBoundPlan,
  FINANCIAL_CATALOG_VERSION,
  FINANCIAL_PRESENTATION_VERSION,
  NUMERIC_POLICY,
  type FinancialPlanV1,
} from "../services/financial-core/src/index.ts";
import { planFinancialRequest, type PlanningContext, type PlanningModel } from "../services/financial-engine/src/planner.ts";
import { selectInput } from "../services/financial-engine/src/select-inputs.ts";
import { FINANCIAL_PUBLICATION_SCHEMA_VERSION, FINANCIAL_VERIFIER_VERSION, verifyFinancialUnit } from "../services/snapshot/src/financial-verifier.ts";
import { SEAL_CONTEXT } from "../services/snapshot/test/financial-fixtures.ts";
import {
  COMPUTATION_CASES,
  HELD_OUT_QUESTIONS,
  RECORDED_DRAFTS,
  runGoldenCases,
  runMutationSuite,
  SELECTION_CASES,
  type HeldOutQuestion,
  type IntendedPlan,
} from "./verified-finance-fixtures.ts";

const FIXTURES = new URL("./verified-finance-fixtures.ts", import.meta.url);

export type PlanFidelity =
  | Readonly<{ mode: "not_measured"; reason: string }>
  | Readonly<{
      mode: "recorded" | "live";
      model: string | null;
      questions: number;
      faithful: number;
      unfaithful: ReadonlyArray<Readonly<{ id: string; outcome: string; mismatches: ReadonlyArray<string> }>>;
      /** Questions whose intended plan an analyst has not yet reviewed; they cannot show fidelity on their own. */
      pending_review: ReadonlyArray<string>;
      /** Planning latency, only in live mode where it is actually measured. */
      latency_ms: Readonly<{ p50: number; max: number }> | null;
    }>;

export type VerifiedFinanceReport = Readonly<{
  schema_version: "verified_finance_eval.v1";
  fixture_revision: string;
  versions: Readonly<Record<string, string>>;
  golden: Readonly<{ total: number; passed: number; failed: ReadonlyArray<Readonly<{ id: string; mismatches: ReadonlyArray<string> }>>; by_category: Readonly<Record<string, Readonly<{ total: number; passed: number }>>> }>;
  /** Golden cases whose correct answer is a declared gap, never a number. */
  declared_gaps: ReadonlyArray<string>;
  mutation: Readonly<{ baseline_verified: boolean; total: number; rejected: number; accepted: ReadonlyArray<string> }>;
  plan_fidelity: PlanFidelity;
  /** Anything the gate did not run, with why; none of these is a pass. */
  not_measured: ReadonlyArray<string>;
  cost: null;
  passed: boolean;
}>;

export async function buildReport(options: { model?: PlanningModel; mode?: "recorded" | "live" } = {}): Promise<VerifiedFinanceReport> {
  const golden = runGoldenCases({ evaluate: evaluateBoundPlan, select: selectInput });
  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const result of golden) {
    const entry = (byCategory[result.category] ??= { total: 0, passed: 0 });
    entry.total += 1;
    if (result.passed) entry.passed += 1;
  }
  const mutation = runMutationSuite((records) => verifyFinancialUnit(records, "section", SEAL_CONTEXT).ok);
  const fidelity = options.model
    ? await planFidelity(options.model, options.mode ?? "recorded")
    : { mode: "not_measured" as const, reason: "no planning model was provided" };
  const notMeasured = [
    ...(fidelity.mode === "not_measured" ? [`plan fidelity: ${fidelity.reason}`] : []),
    ...(fidelity.mode !== "live" ? ["planning latency: measured only against a live model"] : []),
    "cost: not measured",
  ];
  const goldenPassed = golden.every((result) => result.passed);
  const fidelityPassed = fidelity.mode === "not_measured" || fidelity.unfaithful.length === 0;
  return {
    schema_version: "verified_finance_eval.v1",
    fixture_revision: createHash("sha256").update(readFileSync(FIXTURES)).digest("hex"),
    versions: {
      catalog: FINANCIAL_CATALOG_VERSION,
      numeric_policy: NUMERIC_POLICY.version,
      certificate: FINANCIAL_PUBLICATION_SCHEMA_VERSION,
      verifier: FINANCIAL_VERIFIER_VERSION,
      presentation: FINANCIAL_PRESENTATION_VERSION,
    },
    golden: {
      total: golden.length,
      passed: golden.filter((result) => result.passed).length,
      failed: golden.filter((result) => !result.passed).map((result) => ({ id: result.id, mismatches: result.mismatches })),
      by_category: byCategory,
    },
    declared_gaps: [
      ...COMPUTATION_CASES.filter((golden) => Object.values(golden.expected).some((expected) => expected.kind === "gap")).map((golden) => golden.id),
      ...SELECTION_CASES.filter((golden) => "gap" in golden.expected).map((golden) => golden.id),
    ],
    mutation: {
      baseline_verified: mutation.baseline_verified,
      total: mutation.mutants.length,
      rejected: mutation.mutants.filter((mutant) => mutant.rejected).length,
      accepted: mutation.mutants.filter((mutant) => !mutant.rejected).map((mutant) => mutant.id),
    },
    plan_fidelity: fidelity,
    not_measured: notMeasured,
    cost: null,
    passed: goldenPassed && mutation.passed && fidelityPassed,
  };
}

/** A model that answers each held-out question with its recorded draft. */
export function recordedModel(drafts: Readonly<Record<string, unknown>> = RECORDED_DRAFTS): PlanningModel {
  return async (request) => {
    const prompt = request.messages.map((message) => message.content).join("\n");
    const question = HELD_OUT_QUESTIONS.find((candidate) => prompt.includes(candidate.question));
    if (!question || !(question.id in drafts)) throw new Error("no recorded draft for this question");
    return { text: JSON.stringify(drafts[question.id]), model: "recorded-drafts" };
  };
}

async function planFidelity(model: PlanningModel, mode: "recorded" | "live"): Promise<PlanFidelity> {
  const unfaithful: Array<{ id: string; outcome: string; mismatches: string[] }> = [];
  const latencies: number[] = [];
  let modelName: string | null = null;
  const observed: PlanningModel = async (request) => {
    const response = await model(request);
    modelName = response.model;
    return response;
  };
  for (const question of HELD_OUT_QUESTIONS) {
    const started = performance.now();
    const planned = await planFinancialRequest(planningContext(question), question.question, observed).catch(() => null);
    latencies.push(performance.now() - started);
    if (planned?.outcome !== "ready") {
      unfaithful.push({ id: question.id, outcome: planned?.outcome ?? "planner_error", mismatches: [] });
      continue;
    }
    const mismatches = compareIntent(question, planned.plan);
    if (mismatches.length > 0) unfaithful.push({ id: question.id, outcome: "ready", mismatches });
  }
  const sorted = [...latencies].sort((left, right) => left - right);
  return {
    mode,
    model: modelName,
    questions: HELD_OUT_QUESTIONS.length,
    faithful: HELD_OUT_QUESTIONS.length - unfaithful.length,
    unfaithful,
    pending_review: HELD_OUT_QUESTIONS.filter((question) => question.review.status !== "reviewed").map((question) => question.id),
    latency_ms: mode === "live" && sorted.length > 0 ? { p50: Math.round(sorted[Math.floor(sorted.length / 2)]!), max: Math.round(sorted.at(-1)!) } : null,
  };
}

function planningContext(question: HeldOutQuestion): PlanningContext {
  const authority = createRuntimeAuthority({
    owner_user_id: "00000000-0000-4000-8000-000000000001",
    egress_channel: "chat",
    parent: { kind: "chat_thread", id: "00000000-0000-4000-8000-000000000002", version: "eval" },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
  return {
    plan_id: "00000000-0000-4000-8000-000000000003",
    origin: { kind: "chat_request", ref: `eval:${question.id}` },
    knowledge_cutoff: "2024-03-01T00:00:00.000Z",
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 2,
    requested_subjects: question.subjects.map((subject) => ({
      mention: subject.mention,
      resolution: { status: "resolved", subject_ref: { kind: "issuer", id: subject.id }, label: subject.label },
    })),
    publication_unit_kind: "chat_section",
  };
}

/** Where the validated plan differs from the question's stated intent: companies, metrics, periods, operations. */
export function compareIntent(question: HeldOutQuestion, plan: FinancialPlanV1): string[] {
  const mentions = new Map(question.subjects.map((subject) => [subject.id, subject.mention]));
  const reported = plan.operations.filter((node) => node.operation === "reported_metric");
  const actual: IntendedPlan = {
    subjects: plan.subjects.members.map((member) => mentions.get(member.subject_ref.id) ?? member.subject_ref.id),
    metrics: reported.map((node) => node.metric_key),
    periods: reported.map((node) => node.period.kind === "latest"
      ? `latest:${node.period.period_type}:${node.period.offset}`
      : `${node.period.fiscal_period}${node.period.fiscal_year}`),
    operations: plan.operations.filter((node) => node.operation !== "reported_metric").map((node) => node.operation),
  };
  const same = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
  return (["subjects", "metrics", "periods", "operations"] as const)
    .filter((field) => !same(question.intended[field], actual[field]))
    .map((field) => `${field}: intended ${[...question.intended[field]].sort().join(", ") || "none"}, planned ${[...new Set(actual[field])].sort().join(", ") || "none"}`);
}

async function liveModel(): Promise<PlanningModel> {
  const { createLlmRouterFromEnv } = await import("../services/llm/src/index.ts");
  const { planningModelFromRouter } = await import("../services/financial-engine/src/planner.ts");
  const router = await createLlmRouterFromEnv(process.env);
  if (!router) throw new Error("--live needs a configured LLM router (see .env.dev.example)");
  return planningModelFromRouter(router);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
  const report = await buildReport({ model: live ? await liveModel() : recordedModel(), mode: live ? "live" : "recorded" });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  process.exitCode = report.passed ? 0 : 1;
}
