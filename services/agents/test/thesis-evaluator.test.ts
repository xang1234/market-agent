import assert from "node:assert/strict";
import test from "node:test";

import { draftThesisConditions, evaluateThesis, type ThesisLlm } from "../src/thesis-evaluator.ts";
import { ThesisValidationError, type ConditionAssessment, type ThesisCondition, type ThesisVersion } from "../src/thesis-types.ts";

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

test("evaluateThesis lets evidence support and challenge opposing narrative conditions", async () => {
  const guardedLlm: ThesisLlm = {
    async complete(request) {
      const policy = request.messages[0]?.content ?? "";
      assert.match(policy, /falsifier/i);
      assert.match(policy, /counterevidence/i);
      assert.match(policy, /horizon/i);
      assert.match(policy, /stale, mixed, or insufficient/i);
      assert.match(policy, /untrusted data/i);
      assert.match(policy, /numerical claims/i);
      return {
        text: JSON.stringify({
          results: [
            { condition_id: BULL_ID, status: "challenged", reason: "Growth slowed.", claim_refs: [CLAIM_ID] },
            { condition_id: BEAR_ID, status: "supported", reason: "Growth slowed.", claim_refs: [CLAIM_ID] },
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
    claims: [{ claim_id: CLAIM_ID, text_canonical: "Enterprise growth slowed to 8 percent." }],
    metric_results: [],
    as_of: AS_OF,
    llm: guardedLlm,
  });

  assert.deepEqual(result, {
    results: [
      { condition_id: BULL_ID, status: "challenged", reason: "Growth slowed.", claim_refs: [CLAIM_ID], fact_refs: [], method: "model" },
      { condition_id: BEAR_ID, status: "supported", reason: "Growth slowed.", claim_refs: [CLAIM_ID], fact_refs: [], method: "model" },
    ],
    model_version: "primary:model-42",
  });
});

test("evaluateThesis returns unresolved narrative conditions without invoking a model when claims are empty", async () => {
  const llm: ThesisLlm = {
    async complete() {
      throw new Error("must not be invoked");
    },
  };
  const result = await evaluateThesis({
    thesis: thesis([condition(BULL_ID)]),
    claims: [],
    metric_results: [],
    as_of: AS_OF,
    llm,
  });

  assert.deepEqual(result, {
    results: [{
      condition_id: BULL_ID,
      status: "unresolved",
      reason: "No eligible narrative evidence was available.",
      claim_refs: [],
      fact_refs: [],
      method: "no_evidence",
    }],
    model_version: null,
  });
});

test("evaluateThesis requires a model when narrative claims are available", async () => {
  await assert.rejects(
    evaluateThesis({
      thesis: thesis([condition(BULL_ID)]),
      claims: [{ claim_id: CLAIM_ID, text_canonical: "Demand slowed." }],
      metric_results: [],
      as_of: AS_OF,
      llm: null,
    }),
    /model.*unavailable/i,
  );
});

test("evaluateThesis rejects foreign citations, missing rows, duplicate rows, and uncited conclusions", async () => {
  const cases: Array<[string, unknown]> = [
    ["foreign citation", { results: [{ condition_id: BULL_ID, status: "supported", reason: "Evidence.", claim_refs: [FACT_ID] }] }],
    ["missing row", { results: [] }],
    ["duplicate row", { results: [
      { condition_id: BULL_ID, status: "supported", reason: "Evidence.", claim_refs: [CLAIM_ID] },
      { condition_id: BULL_ID, status: "challenged", reason: "Evidence.", claim_refs: [CLAIM_ID] },
    ] }],
    ["uncited conclusion", { results: [{ condition_id: BULL_ID, status: "supported", reason: "Evidence.", claim_refs: [] }] }],
  ];

  for (const [name, response] of cases) {
    await assert.rejects(
      evaluateThesis({
        thesis: thesis([condition(BULL_ID)]),
        claims: [{ claim_id: CLAIM_ID, text_canonical: "Demand slowed." }],
        metric_results: [],
        as_of: AS_OF,
        llm: llmResponse(response),
      }),
      ThesisValidationError,
      name,
    );
  }
});

test("evaluateThesis takes each metric condition's result from the engine verbatim and requires one", async () => {
  const metric = condition(METRIC_ID, {
    metric: { metric_key: "revenue", unit: "currency", period_kind: "fiscal_y", operator: "gt", threshold: "1", max_age_days: 730 },
  });
  const engine: ConditionAssessment = {
    condition_id: METRIC_ID, status: "supported", reason: "The verified calculation at the assessment cutoff meets the saved threshold.",
    claim_refs: [], fact_refs: [FACT_ID], method: "metric",
  };
  const result = await evaluateThesis({ thesis: thesis([metric, condition(BULL_ID)]), claims: [], as_of: AS_OF, llm: null, metric_results: [engine] });
  assert.deepEqual(result.results, [
    engine,
    { condition_id: BULL_ID, status: "unresolved", reason: "No eligible narrative evidence was available.", claim_refs: [], fact_refs: [], method: "no_evidence" },
  ]);
  await assert.rejects(
    evaluateThesis({ thesis: thesis([metric]), claims: [], as_of: AS_OF, llm: null, metric_results: [] }),
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
    claims: [{ claim_id: CLAIM_ID, text_canonical: 'Demand slowed.' }], metric_results: [], as_of: AS_OF, llm,
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

test('relative narrative horizons retain the saved version date across later assessments', async () => {
  const saved = thesis([condition(BULL_ID,{horizon:'Next quarter'})]);
  const llm:ThesisLlm = {async complete(request) {
    assert.match(request.messages[0].content,/relative horizons.*thesis_created_at/i);
    const packet=JSON.parse(request.messages[1].content);
    assert.equal(packet.thesis_created_at,saved.created_at);
    return {text:JSON.stringify({results:[{condition_id:BULL_ID,status:'unresolved',reason:'The horizon has not been established by evidence.',claim_refs:[]}]})};
  }};
  for (const as_of of ['2026-09-06T00:00:00.000Z',AS_OF]) {
    await evaluateThesis({thesis:saved,claims:[{claim_id:CLAIM_ID,text_canonical:'Demand slowed.'}],metric_results:[],as_of,llm});
  }
});

test('narrative reasons normalize whitespace and reject values that cannot be persisted', async () => {
  const input={thesis:thesis([condition(BULL_ID)]),claims:[{claim_id:CLAIM_ID,text_canonical:'Demand slowed.'}],metric_results:[],as_of:AS_OF};
  const response=(reason:string)=>llmResponse({results:[{condition_id:BULL_ID,status:'challenged',reason,claim_refs:[CLAIM_ID]}]});
  const normalized=await evaluateThesis({...input,llm:response('  Demand slowed.  ')});
  assert.equal(normalized.results[0].reason,'Demand slowed.');
  await assert.rejects(evaluateThesis({...input,llm:response('x'.repeat(2001))}),ThesisValidationError);
});
