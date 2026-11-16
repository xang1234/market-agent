import assert from "node:assert/strict";
import test from "node:test";

import { draftThesisConditions, evaluateThesis, NOT_ENOUGH_EVIDENCE, UNCHECKED_REPLY, type ThesisEvidence, type ThesisLlm } from "../src/thesis-evaluator.ts";
import { ThesisValidationError, type ConditionAssessment, type ConditionFigureRef, type ThesisCondition, type ThesisVersion } from "../src/thesis-types.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const BULL_ID = "33333333-3333-4333-8333-333333333333";
const BEAR_ID = "44444444-4444-4444-8444-444444444444";
const METRIC_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "66666666-6666-4666-8666-666666666666";
const FACT_ID = "77777777-7777-4777-8777-777777777777";
const AS_OF = "2026-09-08T00:00:00.000Z";

function condition(
  conditionId: string,
  overrides: Partial<ThesisCondition> = {},
): ThesisCondition {
  return {
    condition_id: conditionId,
    statement: "Revenue growth remains above the peer group.",
    falsifier: "Reported growth falls below the peer median.",
    horizon: "12 months",
    ...overrides,
  };
}

function thesis(conditions: ThesisCondition[]): ThesisVersion {
  return {
    thesis_version_id: VERSION_ID,
    agent_id: "99999999-9999-4999-8999-999999999999",
    version: 1,
    thesis: "Demand remains durable while execution improves.",
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    conditions,
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

function llmResponse(value: unknown, deployment?: { channel: string; model: string }): ThesisLlm {
  return {
    async complete() {
      return { text: JSON.stringify(value), ...(deployment ? { deployment } : {}) };
    },
  };
}

function evidence(refs: Record<string, { claim_refs?: string[]; fact_refs?: string[]; figure_refs?: ConditionFigureRef[] }>): ThesisEvidence {
  return {
    packet: {
      figures: Object.keys(refs).filter((id) => id.startsWith("F")).map((id) => ({ id, metric: "Revenue", period: "FY2026", value: "$130.5B" })),
      claims: Object.keys(refs).filter((id) => id.startsWith("C")).map((id) => ({ id, predicate: "business.products", text: "Our products include data center platforms." })),
    },
    refs: Object.fromEntries(Object.entries(refs).map(([id, ref]) => [id, { claim_refs: ref.claim_refs ?? [], fact_refs: ref.fact_refs ?? [], figure_refs: ref.figure_refs ?? [] }])),
  };
}
const EVIDENCE = evidence({ F1: { fact_refs: [FACT_ID] }, C1: { claim_refs: [CLAIM_ID] } });
const NO_EVIDENCE = evidence({});
const unreachable: ThesisLlm = { async complete() { throw new Error("must not be invoked"); } };

test("evaluateThesis lets evidence support and challenge opposing narrative conditions", async () => {
  const guardedLlm: ThesisLlm = {
    async complete(request) {
      const policy = request.messages[0]?.content ?? "";
      assert.match(policy, /falsifier/i);
      assert.match(policy, /counterevidence/i);
      assert.match(policy, /horizon/i);
      assert.match(policy, /stale, mixed, or insufficient/i);
      assert.match(policy, /untrusted data/i);
      assert.match(policy, /never use knowledge from outside the evidence/i);
      assert.deepEqual(JSON.parse(request.messages[1]!.content).evidence, EVIDENCE.packet);
      return {
        text: JSON.stringify({
          results: [
            { condition_id: BULL_ID, status: "challenged", refs: ["C1"] },
            { condition_id: BEAR_ID, status: "supported", refs: ["C1", "F1"] },
          ],
        }),
        deployment: { channel: "primary", model: "model-42" },
      };
    },
  };
  const result = await evaluateThesis({
    thesis: thesis([
      condition(BULL_ID, {
        statement: "Enterprise demand will continue accelerating.",
        falsifier: "Enterprise demand growth decelerates materially.",
      }),
      condition(BEAR_ID, {
        statement: "Enterprise demand growth will decelerate materially.",
        falsifier: "Enterprise demand continues accelerating.",
      }),
    ]),
    evidence: EVIDENCE,
    known_results: [],
    as_of: AS_OF,
    llm: guardedLlm,
  });

  assert.deepEqual(result, {
    results: [
      { condition_id: BULL_ID, status: "challenged", reason: "The cited stored sources challenge this condition.", claim_refs: [CLAIM_ID], fact_refs: [], method: "model" },
      { condition_id: BEAR_ID, status: "supported", reason: "The cited stored sources support this condition.", claim_refs: [CLAIM_ID], fact_refs: [FACT_ID], method: "model" },
    ],
    model_version: "primary:model-42",
  });
});

test("a condition backed by a business claim stores its C id, and one no entry bears on is not enough evidence", async () => {
  const products = condition(BULL_ID, { statement: "Data center platforms remain the core product line.", falsifier: "The 10-K stops naming data center platforms." });
  const uncovered = condition(BEAR_ID, { statement: "The company opens a chain of coffee shops.", falsifier: "No coffee shop opens." });
  const result = await evaluateThesis({
    thesis: thesis([products, uncovered]),
    evidence: EVIDENCE,
    known_results: [],
    as_of: AS_OF,
    llm: llmResponse({ results: [
      { condition_id: BULL_ID, status: "supported", refs: ["C1"] },
      { condition_id: BEAR_ID, status: "unresolved", refs: [], reason: "From what I know, the company never sells coffee." },
    ] }),
  });
  assert.deepEqual(result.results, [
    { condition_id: BULL_ID, status: "supported", reason: "The cited stored sources support this condition.", claim_refs: [CLAIM_ID], fact_refs: [], method: "model" },
    { condition_id: BEAR_ID, status: "unresolved", reason: NOT_ENOUGH_EVIDENCE, claim_refs: [], fact_refs: [], method: "no_evidence" },
  ]);
});

test("an assessment keeps none of the model's words, a stance included", async () => {
  const { results } = await evaluateThesis({
    thesis: thesis([condition(BULL_ID)]),
    evidence: EVIDENCE,
    known_results: [],
    as_of: AS_OF,
    llm: llmResponse({ results: [{ condition_id: BULL_ID, status: "supported", refs: ["F1"], reason: "This is a buy with a raised price target of $200." }] }),
  });
  assert.deepEqual(results, [
    { condition_id: BULL_ID, status: "supported", reason: "The cited stored sources support this condition.", claim_refs: [], fact_refs: [FACT_ID], method: "model" },
  ]);
});

test("evaluateThesis assesses every narrative condition as not enough evidence without a model when no entry is citable", async () => {
  const result = await evaluateThesis({
    thesis: thesis([condition(BULL_ID)]),
    evidence: NO_EVIDENCE,
    known_results: [],
    as_of: AS_OF,
    llm: unreachable,
  });

  assert.deepEqual(result, {
    results: [{
      condition_id: BULL_ID,
      status: "unresolved",
      reason: "Not enough evidence: no stored source covers this condition.",
      claim_refs: [],
      fact_refs: [],
      method: "no_evidence",
    }],
    model_version: null,
  });
});

test("evaluateThesis requires a model when narrative evidence is available", async () => {
  await assert.rejects(
    evaluateThesis({
      thesis: thesis([condition(BULL_ID)]),
      evidence: EVIDENCE,
      known_results: [],
      as_of: AS_OF,
      llm: null,
    }),
    /model.*unavailable/i,
  );
});

test("a reply row that is missing, repeated, null, or names no supplied condition leaves only that condition unchecked, and a reply with no usable row fails", async () => {
  const unchecked = { condition_id: BULL_ID, status: "unresolved", reason: UNCHECKED_REPLY, claim_refs: [], fact_refs: [], method: "unchecked_reply" };
  const bear = { condition_id: BEAR_ID, status: "challenged", refs: ["C1"] };
  const cases: Array<[string, unknown[]]> = [
    ["missing row", [bear]],
    ["null row", [null, bear]],
    ["duplicate row", [{ condition_id: BULL_ID, status: "supported", refs: ["C1"] }, { condition_id: BULL_ID, status: "challenged", refs: ["C1"] }, bear]],
    ["unknown condition", [{ condition_id: METRIC_ID, status: "supported", refs: ["C1"] }, bear]],
    ["no condition id", [{ status: "supported", refs: ["C1"] }, bear]],
  ];
  for (const [name, rows] of cases) {
    const { results } = await evaluateThesis({
      thesis: thesis([condition(BULL_ID), condition(BEAR_ID)]),
      evidence: EVIDENCE,
      known_results: [],
      as_of: AS_OF,
      llm: llmResponse({ results: rows }),
    });
    assert.deepEqual(results, [
      unchecked,
      { condition_id: BEAR_ID, status: "challenged", reason: "The cited stored sources challenge this condition.", claim_refs: [CLAIM_ID], fact_refs: [], method: "model" },
    ], name);
  }
  const unusable: Array<[unknown, string]> = [
    [{ results: null }, "assessment response results must be an array"],
    [{ results: [] }, "assessment response names none of the supplied conditions"],
    [{ results: [{ id: BULL_ID, status: "supported", refs: ["C1"] }, null] }, "assessment response names none of the supplied conditions"],
  ];
  for (const [reply, message] of unusable) {
    await assert.rejects(
      evaluateThesis({ thesis: thesis([condition(BULL_ID), condition(BEAR_ID)]), evidence: EVIDENCE, known_results: [], as_of: AS_OF, llm: llmResponse(reply) }),
      new ThesisValidationError(message),
      "a reply with no usable row fails the run rather than reading as not enough evidence",
    );
  }
});

test("an assessment reply that is not one JSON object is asked for once more, then fails the run", async () => {
  const valid = { results: [{ condition_id: BULL_ID, status: "challenged", refs: ["C1"] }] };
  // claude-sonnet-5-5 returned this shape live on 2026-11-16, an object with more text after it.
  const replies = [`${JSON.stringify({ results: [{ condition_id: BULL_ID, status: "supported", refs: ["C1"] }] })}\n\nCorrection, the condition is challenged:\n${JSON.stringify(valid)}`, JSON.stringify(valid)];
  let calls = 0;
  const run = (llm: ThesisLlm) => evaluateThesis({ thesis: thesis([condition(BULL_ID)]), evidence: EVIDENCE, known_results: [], as_of: AS_OF, llm });
  const { results } = await run({ async complete() { calls += 1; return { text: replies.shift()! }; } });
  assert.deepEqual(results.map((result) => result.status), ["challenged"]);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(run({ async complete() { calls += 1; return { text: "not json" }; } }), ThesisValidationError);
  assert.equal(calls, 2, "a second unusable reply fails the run");
});

test("a condition whose status the reply cannot back is not enough evidence, says why, and the other conditions keep theirs", async () => {
  const rows: Array<[string, Record<string, unknown>]> = [
    ["uncited conclusion", { status: "supported", refs: [] }],
    ["uncited challenge", { status: "challenged", refs: [] }],
    ["unsupplied ref", { status: "supported", refs: ["C1", "C9"] }],
    ["stored id as a ref", { status: "supported", refs: [CLAIM_ID] }],
    ["refs missing", { status: "unresolved" }],
    ["unknown status", { status: "likely", refs: ["C1"] }],
  ];
  for (const [name, row] of rows) {
    const { results } = await evaluateThesis({
      thesis: thesis([condition(BULL_ID), condition(BEAR_ID)]),
      evidence: EVIDENCE,
      known_results: [],
      as_of: AS_OF,
      llm: llmResponse({ results: [{ condition_id: BULL_ID, ...row }, { condition_id: BEAR_ID, status: "challenged", refs: ["C1"] }] }),
    });
    assert.deepEqual(results, [
      { condition_id: BULL_ID, status: "unresolved", reason: UNCHECKED_REPLY, claim_refs: [], fact_refs: [], method: "unchecked_reply" },
      { condition_id: BEAR_ID, status: "challenged", reason: "The cited stored sources challenge this condition.", claim_refs: [CLAIM_ID], fact_refs: [], method: "model" },
    ], name);
  }
});

test("a cited figure stores its certified result beside the facts it was computed from", async () => {
  const REVENUE_FACT = "88888888-8888-4888-8888-888888888888";
  const MARGIN_RESULT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const REVENUE_RESULT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const margin = { result_id: MARGIN_RESULT, measure: "Gross margin (gross profit / revenue)", period: "FY2025 (ended 2025-12-31)", value: "74.99%" };
  const revenue = { result_id: REVENUE_RESULT, measure: "Revenue", period: "FY2025 (ended 2025-12-31)", value: "$130.5B" };
  const { results } = await evaluateThesis({
    thesis: thesis([condition(BULL_ID)]),
    evidence: evidence({
      F1: { fact_refs: [REVENUE_FACT], figure_refs: [revenue] },
      F3: { fact_refs: [FACT_ID, REVENUE_FACT], figure_refs: [margin] },
    }),
    known_results: [],
    as_of: AS_OF,
    llm: llmResponse({ results: [{ condition_id: BULL_ID, status: "supported", refs: ["F3", "F1"] }] }),
  });
  assert.deepEqual(results, [{
    condition_id: BULL_ID,
    status: "supported",
    reason: "The cited stored sources support this condition.",
    claim_refs: [],
    fact_refs: [FACT_ID, REVENUE_FACT],
    method: "model",
    figure_refs: [margin, revenue],
  }]);
});

test("evaluateThesis takes each metric condition's result from the engine verbatim and requires one", async () => {
  const metric = condition(METRIC_ID, {
    metric: { metric_key: "revenue", unit: "currency", period_kind: "fiscal_y", operator: "gt", threshold: "1", max_age_days: 730 },
  });
  const engine: ConditionAssessment = {
    condition_id: METRIC_ID, status: "supported", reason: "The verified calculation at the assessment cutoff meets the saved threshold.",
    claim_refs: [], fact_refs: [FACT_ID], method: "metric",
  };
  const result = await evaluateThesis({ thesis: thesis([metric, condition(BULL_ID)]), evidence: NO_EVIDENCE, as_of: AS_OF, llm: null, known_results: [engine] });
  assert.deepEqual(result.results, [
    engine,
    { condition_id: BULL_ID, status: "unresolved", reason: NOT_ENOUGH_EVIDENCE, claim_refs: [], fact_refs: [], method: "no_evidence" },
  ]);
  await assert.rejects(
    evaluateThesis({ thesis: thesis([metric]), evidence: NO_EVIDENCE, as_of: AS_OF, llm: null, known_results: [] }),
    new ThesisValidationError(`assessment is missing condition ${METRIC_ID}`),
  );
});

test('draftThesisConditions rejects out-of-bounds text before calling a model', async () => {
  const llm: ThesisLlm = { async complete() { throw new Error('invalid thesis reached the model'); } };
  for (const thesis of ['x'.repeat(7), 'x'.repeat(4001)]) {
    await assert.rejects(draftThesisConditions(llm, thesis), ThesisValidationError);
  }
});

test('evaluateThesis rejects an invalid stored thesis before calling a model', async () => {
  const llm: ThesisLlm = { async complete() { throw new Error('invalid stored thesis reached the model'); } };
  await assert.rejects(evaluateThesis({
    thesis: { ...thesis([condition(BULL_ID)]), thesis: 'x'.repeat(4001) },
    evidence: EVIDENCE, known_results: [], as_of: AS_OF, llm,
  }), ThesisValidationError);
});

test("draftThesisConditions creates exactly three narrative conditions with server-generated IDs", async () => {
  const conditions = await draftThesisConditions(
    llmResponse({ conditions: [
      { statement: "Enterprise demand continues to accelerate.", falsifier: "Enterprise demand growth slows materially.", horizon: "12 months" },
      { statement: "Operating margins expand with greater scale.", falsifier: "Operating margins contract for two quarters.", horizon: "18 months" },
      { statement: "Customer retention remains consistently strong.", falsifier: "Net retention falls below prior-year levels.", horizon: "6 months" },
    ] }),
    "Demand remains durable while execution improves.",
  );

  assert.equal(conditions.length, 3);
  assert.equal(new Set(conditions.map((item) => item.condition_id)).size, 3);
  for (const item of conditions) {
    assert.match(item.condition_id, /^[0-9a-f-]{36}$/i);
    assert.equal(item.metric, undefined);
  }
});

test("draftThesisConditions rejects responses that do not contain exactly three valid suggestions", async () => {
  await assert.rejects(
    draftThesisConditions(llmResponse({ conditions: [
      { statement: "Enterprise demand continues to accelerate.", falsifier: "Enterprise demand growth slows materially.", horizon: "12 months" },
    ] }), "Demand remains durable while execution improves."),
    ThesisValidationError,
  );
});

test("draftThesisConditions asks again when a reply corrects itself in prose, and keeps none of the first reply", async () => {
  const suggestion = (statement: string) => ({ statement, falsifier: "Customers move production workloads to rival accelerators.", horizon: "Next 2-4 years" });
  // claude-sonnet-5-5 returned this shape on 2 of 15 calls on 2026-11-16, an object, a correction in prose, then a second object.
  const selfCorrected = JSON.stringify({ conditions: [suggestion("Platform software keeps customers on the stack."), { conditions: null, ...suggestion("Demand stays broad across buyers.") }, suggestion("Product cadence outpaces rivals.")] }) +
    "\n\nWait, I need to correct a formatting error in the second item. Here is the valid JSON:\n\n" +
    JSON.stringify({ conditions: [suggestion("Platform software keeps customers on the stack."), suggestion("Demand stays broad across buyers."), suggestion("Product cadence outpaces rivals.")] });
  const replies = [selfCorrected, JSON.stringify({ conditions: [suggestion("Networking revenue keeps growing."), suggestion("Software attach rises."), suggestion("Supply keeps pace with orders.")] })];
  const conditions = await draftThesisConditions({ async complete() { return { text: replies.shift()! }; } }, "Demand remains durable while execution improves.");
  assert.deepEqual(conditions.map((item) => item.statement), ["Networking revenue keeps growing.", "Software attach rises.", "Supply keeps pace with orders."]);
});

test("draftThesisConditions leaves room for thinking, which counts against the token budget", async () => {
  // Captured from claude-sonnet-5-5 on 2026-11-04: up to 711 thinking tokens, then about 750 of JSON.
  const llm: ThesisLlm = {
    async complete({ maxTokens }) {
      const answer = JSON.stringify({ conditions: [
        { statement: "Enterprise demand continues to accelerate.", falsifier: "Enterprise demand growth slows materially.", horizon: "12 months" },
        { statement: "Operating margins expand with greater scale.", falsifier: "Operating margins contract for two quarters.", horizon: "18 months" },
        { statement: "Customer retention remains consistently strong.", falsifier: "Net retention falls below prior-year levels.", horizon: "6 months" },
      ] });
      return (maxTokens ?? 0) >= 711 + 750 ? { text: answer } : { text: answer.slice(0, 200), truncated: true };
    },
  };
  assert.deepEqual(
    (await draftThesisConditions(llm, "Demand remains durable while execution improves.")).map((item) => item.horizon),
    ["12 months", "18 months", "6 months"],
  );
});

test("draftThesisConditions tells the model the limits its conditions are validated against", async () => {
  let system = "";
  await draftThesisConditions({
    async complete({ messages }) {
      system = messages[0].content;
      return { text: JSON.stringify({ conditions: Array.from({ length: 3 }, () => ({ statement: "Enterprise demand keeps growing.", falsifier: "Enterprise demand stops growing.", horizon: "12 months" })) }) };
    },
  }, "Demand remains durable while execution improves.");
  assert.match(system, /statement and falsifier under 500 characters/);
  assert.match(system, /horizon .*under 120 characters/);
  assert.match(system, /never the share price or a view on the stock/, "statesStance misses price targets and upside, so the prompt keeps drafts off the stock");
});

test("draftThesisConditions names the model and the cause when a reply is unusable", async () => {
  const deployment = { channel: "anthropic", model: "claude-sonnet-5-5" };
  const thesis = "Demand remains durable while execution improves.";
  let calls = 0;
  await assert.rejects(draftThesisConditions({ async complete() { calls += 1; return { text: "not json", deployment }; } }, thesis), ThesisValidationError);
  assert.equal(calls, 2, "an unusable reply is asked for once more, then fails");
  await assert.rejects(
    draftThesisConditions({ async complete() { return { text: '```json\n{"conditions":[{"statement":"Cut', truncated: true, deployment }; } }, thesis),
    new ThesisValidationError("draft response from anthropic/claude-sonnet-5-5 was cut off at the 4096-token limit"),
  );
  await assert.rejects(
    draftThesisConditions({ async complete() { return { text: 'Here are three conditions: {"conditions":[]}', deployment }; } }, thesis),
    { name: "ThesisValidationError", message: /^draft response from anthropic\/claude-sonnet-5-5 must be valid JSON: / },
  );
  await assert.rejects(
    draftThesisConditions({ async complete() { return { text: '{"conditions":[]}', deployment }; } }, thesis),
    new ThesisValidationError("draft response from anthropic/claude-sonnet-5-5 must contain exactly three conditions, not 0"),
  );
});

test("evaluateThesis names the model and the cause when a reply is unusable", async () => {
  const deployment = { channel: "anthropic", model: "claude-sonnet-5-5" };
  const input = { thesis: thesis([condition(BULL_ID)]), evidence: EVIDENCE, known_results: [], as_of: AS_OF };
  await assert.rejects(
    evaluateThesis({ ...input, llm: { async complete() { return { text: '{"results":[{"condition_id":"', truncated: true, deployment }; } } }),
    new ThesisValidationError("assessment response from anthropic/claude-sonnet-5-5 was cut off at the 6000-token limit"),
  );
  await assert.rejects(
    evaluateThesis({ ...input, llm: { async complete() { return { text: "Here is my assessment.", deployment }; } } }),
    { name: "ThesisValidationError", message: /^assessment response from anthropic\/claude-sonnet-5-5 must be valid JSON: / },
  );
});

test('relative narrative horizons retain the saved version date across later assessments', async () => {
  const saved = thesis([condition(BULL_ID,{horizon:'Next quarter'})]);
  const llm:ThesisLlm = {async complete(request) {
    assert.match(request.messages[0].content,/relative horizons.*thesis_created_at/i);
    const packet=JSON.parse(request.messages[1].content);
    assert.equal(packet.thesis_created_at,saved.created_at);
    return {text:JSON.stringify({results:[{condition_id:BULL_ID,status:'unresolved',refs:['C1']}]})};
  }};
  for (const as_of of ['2026-09-06T00:00:00.000Z',AS_OF]) {
    await evaluateThesis({thesis:saved,evidence:EVIDENCE,known_results:[],as_of,llm});
  }
});
