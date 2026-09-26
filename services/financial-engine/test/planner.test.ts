import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeAuthority, planSemanticHash } from "../../financial-core/src/index.ts";
import {
  buildDeterministicPlan,
  ClarificationError,
  planFinancialRequest,
  planningModelFromRouter,
  resolveClarification,
  type PlanningContext,
  type PlanningModel,
  type RequestedSubject,
} from "../src/planner.ts";

const IDS = ["51111111-1111-4111-8111-111111111111", "52222222-2222-4222-8222-222222222222", "53333333-3333-4333-8333-333333333333", "54444444-4444-4444-8444-444444444444"];
const NAMES = ["Apple", "Microsoft", "Alphabet", "Amazon"];

function resolved(index: number): RequestedSubject {
  return { mention: NAMES[index]!, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: IDS[index]! }, label: `${NAMES[index]} Inc.` } };
}

function context(overrides: Partial<PlanningContext> = {}): PlanningContext {
  return {
    plan_id: "5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    origin: { kind: "chat_request", ref: "chat:turn:9" },
    knowledge_cutoff: "2024-03-01T23:59:59.999-05:00",
    cutoff_timezone: "America/New_York",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority: createRuntimeAuthority({
      owner_user_id: "5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      egress_channel: "chat",
      parent: { kind: "chat_thread", id: "5ccccccc-cccc-4ccc-8ccc-cccccccccccc", version: "3" },
      allowed_source_classes: ["sec_filing"],
      feature: { surface: "chat", capability: "financial-answer", mode: "shadow" },
      approval_state: "not_required",
      lease: null,
    }),
    parent_limits: {},
    max_model_calls: 2,
    requested_subjects: [0, 1, 2, 3].map(resolved),
    publication_unit_kind: "chat_section",
    ...overrides,
  };
}

function revenueProposal(slots: number[], extra: Record<string, unknown> = {}) {
  const letters = ["a", "b", "c", "d"];
  return {
    outcome: "ready",
    subjects: slots.map((index) => ({ slot_id: letters[index], mention: NAMES[index] })),
    operations: slots.map((index) => ({
      node_id: `${letters[index]}_rev`,
      operation: "reported_metric",
      subject_slot: letters[index],
      metric_key: "revenue",
      period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" },
    })),
    outputs: slots.map((index) => ({ output_id: `${letters[index]}_out`, node_id: `${letters[index]}_rev` })),
    thresholds: [],
    ...extra,
  };
}

function scripted(...responses: unknown[]): PlanningModel & { calls: string[][] } {
  const calls: string[][] = [];
  const model = (async (request: { messages: ReadonlyArray<{ role: string; content: string }> }) => {
    calls.push(request.messages.map((message) => message.content));
    const next = responses[calls.length - 1];
    if (next === undefined) throw new Error("unexpected model call");
    return { text: typeof next === "string" ? next : JSON.stringify(next), model: "stub-model" };
  }) as PlanningModel & { calls: string[][] };
  model.calls = calls;
  return model;
}

test("a four-company request plans all four subjects", async () => {
  const model = scripted(revenueProposal([0, 1, 2, 3]));
  const result = await planFinancialRequest(context(), "Compare FY2023 revenue for Apple, Microsoft, Alphabet and Amazon", model);
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.equal(result.plan.subjects.members.length, 4);
  assert.deepEqual(result.plan.subjects.members.map((member) => member.subject_ref.id), IDS);
  assert.equal(result.plan.planner.kind, "model");
  assert.equal(result.plan.planner.model, "stub-model");
  assert.deepEqual(result.plan.metric_definitions, [{ metric_key: "revenue", definition_version: "revenue.v1" }]);
  assert.equal(result.plan.operations[0]!.operation_version, "reported_metric.v1");
  assert.equal(result.model_calls, 1);
});

test("a model that drops a requested company is repaired once, then asked to clarify, never narrowed silently", async () => {
  const repaired = await planFinancialRequest(context(), "Compare revenue", scripted(revenueProposal([0]), revenueProposal([0, 1, 2, 3])));
  assert.equal(repaired.outcome, "ready");
  assert.equal(repaired.model_calls, 2);

  const stubborn = scripted(revenueProposal([0]), revenueProposal([0, 1]));
  const result = await planFinancialRequest(context(), "Compare revenue", stubborn);
  assert.equal(result.outcome, "needs_clarification");
  assert.match(result.outcome === "needs_clarification" ? result.clarification.question : "", /Alphabet|Amazon/u);
  assert.match(stubborn.calls[1]!.join("\n"), /subject_not_planned/u, "the repair call names the problem");
});

test("an ambiguous or unknown company asks before any model call", async () => {
  const model = scripted();
  const ambiguous: RequestedSubject = {
    mention: "Alpha",
    resolution: {
      status: "ambiguous",
      options: [
        { subject_ref: { kind: "issuer", id: IDS[2]! }, label: "Alphabet Inc." },
        { subject_ref: { kind: "issuer", id: IDS[3]! }, label: "Alpha Metallurgical" },
      ],
    },
  };
  const result = await planFinancialRequest(context({ requested_subjects: [resolved(0), ambiguous] }), "Apple vs Alpha revenue", model);
  assert.equal(result.outcome, "needs_clarification");
  if (result.outcome !== "needs_clarification") return;
  assert.equal(result.clarification.kind, "subject");
  assert.deepEqual(result.clarification.choices.map((choice) => choice.label), ["Alphabet Inc.", "Alpha Metallurgical"]);
  assert.equal(model.calls.length, 0);

  const missing = await planFinancialRequest(context({ requested_subjects: [{ mention: "Zzzz Corp", resolution: { status: "not_found" } }] }), "Zzzz revenue", model);
  assert.equal(missing.outcome, "needs_clarification");
  assert.equal(model.calls.length, 0);
});

test("an unrecognized metric definition asks for a choice instead of guessing", async () => {
  const proposal = revenueProposal([0]);
  (proposal.operations[0] as Record<string, unknown>).metric_key = "ebitda";
  const result = await planFinancialRequest(context({ requested_subjects: [resolved(0)] }), "Apple EBITDA", scripted(proposal));
  assert.equal(result.outcome, "needs_clarification");
  if (result.outcome !== "needs_clarification") return;
  assert.equal(result.clarification.kind, "metric");
  assert.ok(result.clarification.choices.some((choice) => choice.choice_id === "operating_income"));
  assert.match(result.clarification.question, /ebitda/u);
});

test("model JSON cannot carry ownership, budgets, verification, or executable content", async () => {
  for (const [label, extra] of [
    ["owner", { user_id: "5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["verified", { verified: true }],
    ["budget", { limits: { max_subjects: 1000 } }],
    ["mode", { mode: "enforce" }],
  ] as const) {
    const model = scripted(revenueProposal([0], extra), revenueProposal([0], extra));
    const result = await planFinancialRequest(context({ requested_subjects: [resolved(0)] }), "Apple revenue", model);
    assert.equal(result.outcome, "unsupported", label);
    assert.equal(model.calls.length, 2, `${label}: one repair, then stop`);
  }
  const sql = revenueProposal([0]);
  (sql.operations[0] as Record<string, unknown>).sql = "select * from facts";
  const result = await planFinancialRequest(context({ requested_subjects: [resolved(0)] }), "Apple revenue", scripted(sql, sql));
  assert.equal(result.outcome, "unsupported");
  assert.equal(await planFinancialRequest(context({ requested_subjects: [resolved(0)] }), "x", scripted("not json", "still not json")).then((r) => r.outcome), "unsupported");
});

test("the schema repair stays within the parent's model budget", async () => {
  const model = scripted(revenueProposal([0], { verified: true }));
  const result = await planFinancialRequest(context({ requested_subjects: [resolved(0)], max_model_calls: 1 }), "Apple revenue", model);
  assert.equal(result.outcome, "unsupported");
  assert.equal(model.calls.length, 1);
  const none = await planFinancialRequest(context({ requested_subjects: [resolved(0)], max_model_calls: 0 }), "Apple revenue", scripted());
  assert.equal(none.outcome, "unsupported");
});

test("parent limits and feature mode are enforced from server authority", async () => {
  const tooMany = await planFinancialRequest(context({ parent_limits: { max_subjects: 2 } }), "Compare revenue", scripted(revenueProposal([0, 1, 2, 3])));
  assert.equal(tooMany.outcome, "unsupported");
  assert.match(tooMany.outcome === "unsupported" ? tooMany.reason : "", /scope_limit_exceeded/u);
  const off = context();
  const disabled = await planFinancialRequest(
    { ...off, authority: createRuntimeAuthority({ ...off.authority, feature: { ...off.authority.feature, mode: "off" } }) },
    "Compare revenue",
    scripted(revenueProposal([0, 1, 2, 3])),
  );
  assert.equal(disabled.outcome, "unsupported");
});

test("deterministic plans need no model and match an equivalent model plan semantically", async () => {
  const draft = revenueProposal([0, 1, 2, 3]);
  const deterministic = buildDeterministicPlan(context(), draft);
  assert.equal(deterministic.outcome, "ready");
  const viaModel = await planFinancialRequest(context(), "Compare revenue", scripted(draft));
  assert.ok(deterministic.outcome === "ready" && viaModel.outcome === "ready");
  if (deterministic.outcome !== "ready" || viaModel.outcome !== "ready") return;
  assert.equal(deterministic.plan.planner.kind, "deterministic");
  assert.equal(deterministic.model_calls, 0);
  assert.equal(planSemanticHash(deterministic.plan), planSemanticHash(viaModel.plan));
  // Background ambiguity cannot wait for a user: it becomes configuration-needed.
  const ambiguous = buildDeterministicPlan(context({ requested_subjects: [{ mention: "Alpha", resolution: { status: "not_found" } }] }), draft);
  assert.equal(ambiguous.outcome, "configuration_needed");
});

test("the surface's mode is server-owned: a model draft cannot carry one", async () => {
  const draft = { ...revenueProposal([0, 1, 2, 3]), mode: "enforce", feature: { surface: "chat", capability: "financial-answer", mode: "enforce" } };
  const result = await planFinancialRequest(context(), "Compare revenue", scripted(draft, draft));
  assert.equal(result.outcome, "unsupported");
  assert.ok(result.outcome === "unsupported" && result.issues.some((issue) => issue.code === "unknown_field"));
  assert.equal(buildDeterministicPlan(context(), draft).outcome, "unsupported");
});

test("clarification answers are bound to the clarification they answer", async () => {
  const result = await planFinancialRequest(context({ requested_subjects: [{ mention: "Zzzz", resolution: { status: "ambiguous", options: [{ subject_ref: { kind: "issuer", id: IDS[0]! }, label: "Apple Inc." }] } }] }), "x", scripted());
  assert.ok(result.outcome === "needs_clarification");
  if (result.outcome !== "needs_clarification") return;
  const choice = result.clarification.choices[0]!;
  assert.deepEqual(resolveClarification(result.clarification, { clarification_id: result.clarification.clarification_id, choice_id: choice.choice_id }), choice);
  assert.throws(() => resolveClarification(result.clarification, { clarification_id: "0".repeat(64), choice_id: choice.choice_id }), ClarificationError);
  assert.throws(() => resolveClarification(result.clarification, { clarification_id: result.clarification.clarification_id, choice_id: "invented" }), ClarificationError);
});

test("thresholds from the request are attributed configuration, and the interpretation describes the validated plan", async () => {
  const proposal = revenueProposal([0], {
    thresholds: [{ threshold_id: "floor", value: "100000000000", unit: { kind: "currency", currency: "USD" } }],
  });
  proposal.operations.push({ node_id: "check", operation: "threshold", subject: "a_rev", threshold_id: "floor", comparison: "gte" } as never);
  proposal.outputs.push({ output_id: "check_out", node_id: "check" });
  const result = await planFinancialRequest(context({ requested_subjects: [resolved(0)] }), "Is Apple revenue above 100bn?", scripted(proposal));
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.deepEqual(result.plan.thresholds[0]!.attribution, { kind: "user_request", ref: "chat:turn:9" });
  const text = result.plan.interpretation?.text ?? "";
  for (const fragment of ["Apple Inc.", "revenue (revenue.v1)", "FY 2023", "as originally reported", "2024-03-01T23:59:59.999-05:00", "America/New_York", "threshold check", "100000000000 currency USD"]) {
    assert.ok(text.includes(fragment), `${fragment} in ${text}`);
  }
});

test("the planner runs on the existing model router's complete() with deterministic settings", async () => {
  const requests: unknown[] = [];
  const model = planningModelFromRouter({
    async complete(request) {
      requests.push(request);
      return { text: JSON.stringify(revenueProposal([0])), deployment: { model: "router-model" } };
    },
  });
  const result = await planFinancialRequest(context({ requested_subjects: [resolved(0)] }), "Apple revenue", model);
  assert.equal(result.outcome === "ready" && result.plan.planner.model, "router-model");
  assert.equal((requests[0] as { temperature: number }).temperature, 0);
});
