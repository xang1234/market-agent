import assert from "node:assert/strict";
import test from "node:test";

import type { LlmChatRequest } from "../../llm/src/index.ts";
import { checkAssertions, type Assertion } from "../src/assertions.ts";
import type { EvidencePacket } from "../src/evidence-packet.ts";
import { judgeCases, judgeInferences, judgeMessages, parseVerdicts, verdictsOf, type JudgeCase } from "../src/inference-judge.ts";
import { shownAs } from "../src/verdicts.ts";

const ENV = {
  LLM_CHANNELS: "anthropic",
  LLM_ANTHROPIC_PROTOCOL: "anthropic",
  LLM_ANTHROPIC_API_KEY: "sk-test",
  LLM_ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-haiku-5-5",
  LITELLM_MODEL: "anthropic/claude-sonnet-5-5",
  JUDGE_LITELLM_MODEL: "anthropic/claude-haiku-5-5",
};

const PACKET: EvidencePacket = {
  route: "comparison",
  cutoff: "2026-09-01T00:00:00.000Z",
  companies: ["NVDA", "AMD"],
  figures: [
    { id: "F1", company: "NVDA", metric: "Gross margin", period: "FY2026", value: "74.6%", fact_id: "not-a-uuid-1", source_ids: [] },
    { id: "F2", company: "AMD", metric: "Gross margin", period: "FY2025", value: "49.2%", fact_id: "not-a-uuid-2", source_ids: [] },
  ],
  coverage: [],
  gaps: [],
  query_bounds: {},
  claims: [],
  disagreements: [],
  claims_status: "available",
  claims_truncated: false,
};

const ACCEPTED: ReadonlyArray<Assertion & { index: number }> = [
  { index: 0, kind: "observation", text: "x", evidence: ["F1", "F2"] },
  { index: 1, kind: "comparison", text: "x", evidence: ["F1", "F2"], op: "highest", result: "F1" },
  { index: 2, kind: "analyst_inference", text: "It keeps more of each sale.", evidence: [], supports: [0, 1], subject: "NVDA" },
  { index: 3, kind: "analyst_inference", text: "Its peer trails on margin.", evidence: [], supports: [1], subject: "NVDA" },
];

const CASES = judgeCases(ACCEPTED, PACKET, []);

test("a case is the inference beside its supports as the reader sees them, figures as the packet's values, its checked results, and the answer's other observations and comparisons", () => {
  assert.deepEqual(CASES, [
    {
      index: 2,
      subject: "NVDA",
      text: "It keeps more of each sale.",
      checked: ["NVDA highest on gross margin"],
      supports: [
        "NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025.",
        "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026), AMD 49.2% (FY2025), 25.4 percentage points above AMD.",
      ],
      context: [],
      figures: ["NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025."],
    },
    {
      index: 3,
      subject: "NVDA",
      text: "Its peer trails on margin.",
      checked: ["NVDA highest on gross margin"],
      supports: ["Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026), AMD 49.2% (FY2025), 25.4 percentage points above AMD."],
      context: ["NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025."],
      figures: ["NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025."],
    },
  ]);
  // A one-company answer's inference is about that company.
  const single = judgeCases([ACCEPTED[0]!, { index: 1, kind: "analyst_inference", text: "Margins are high.", evidence: [], supports: [0] }], { ...PACKET, companies: ["NVDA"] }, []);
  assert.deepEqual(single.map(({ subject, checked }) => [subject, checked]), [["NVDA", []]]);
});

test("an inference resting on a management attribution reaches the judge with the claim it quotes (#302)", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["AMD"],
    figures: [PACKET.figures[1]!],
    claims: [{
      id: "C1", text: "Export controls led to about $800 million in inventory charges.", predicate: "kpi.commentary", stance: "supporting",
      company: "AMD", published_at: "2025-08-05T00:00:00.000Z", claim_id: "c1", source_id: "s1",
    }],
  };
  const { accepted } = checkAssertions([
    { kind: "observation", text: "AMD's gross margin was [[F2]] in FY2025.", evidence: ["F2"] },
    { kind: "management_attribution", text: "AMD management said [[C1]]", evidence: ["C1"] },
    { kind: "analyst_inference", text: "The charge weighs on its margin.", supports: [0, 1] },
  ], packet);
  assert.deepEqual(judgeCases(accepted, packet, []).map(({ text, supports }) => [text, supports]), [[
    "The charge weighs on its margin.",
    [
      "AMD's gross margin was 49.2% in FY2025.",
      "According to a source dated Aug 2025 on AMD: Export controls led to about $800 million in inventory charges.",
    ],
  ]]);
});

test("the rest of the answer a case carries is its other observations and comparisons only: no management attribution, unknown cause or other inference", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    companies: ["AMD"],
    figures: [
      { id: "F2", company: "AMD", metric: "Gross margin", period: "FY2025", value: "49.2%", fact_id: "not-a-uuid-2", source_ids: [] },
      { id: "F3", company: "AMD", metric: "Gross margin", period: "FY2024", value: "53.1%", fact_id: "not-a-uuid-3", source_ids: [] },
    ],
    claims: [{
      id: "C1", text: "Export controls led to about $800 million in inventory charges.", predicate: "kpi.commentary", stance: "supporting",
      company: "AMD", published_at: "2025-08-05T00:00:00.000Z", claim_id: "c1", source_id: "s1",
    }],
  };
  const { accepted } = checkAssertions([
    { kind: "observation", text: "AMD's gross margin was [[F2]] in FY2025.", evidence: ["F2"] },
    { kind: "comparison", text: "Gross margin fell.", evidence: ["F3", "F2"], op: "trend", result: "fell" },
    { kind: "management_attribution", text: "AMD management said [[C1]]", evidence: ["C1"] },
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F2"] },
    { kind: "analyst_inference", text: "The charge weighs on its margin.", supports: [2] },
    { kind: "analyst_inference", text: "Its margin is lower than it was.", supports: [1] },
  ], packet);
  assert.deepEqual(judgeCases(accepted, packet, []).map(({ index, context }) => [index, context]), [
    [4, ["AMD's gross margin was 49.2% in FY2025.", "AMD's gross margin fell from 53.1% in FY2024 to 49.2% in FY2025."]],
    [5, ["AMD's gross margin was 49.2% in FY2025."]],
  ]);
});

test("every case carries the figures the page's tables and charts show, a line per table in packet order, as the reader sees them", () => {
  const packet: EvidencePacket = {
    ...PACKET,
    figures: [
      { ...PACKET.figures[0]!, shown_in: "Gross margin" },
      { id: "F2", company: "NVDA", metric: "Revenue", period: "FY2026", value: "$130.5B", fact_id: "not-a-uuid-3", source_ids: [], shown_in: "Revenue" },
      { ...PACKET.figures[1]!, id: "F3", shown_in: "Gross margin" },
      { id: "F4", company: "AMD", metric: "Revenue", period: "FY2025", value: "$25.8B", fact_id: "not-a-uuid-4", source_ids: [] },
    ],
  };
  const accepted: ReadonlyArray<Assertion & { index: number }> = [
    { index: 0, kind: "analyst_inference", text: "It keeps more of each sale.", evidence: [], supports: [], subject: "NVDA" },
    { index: 1, kind: "analyst_inference", text: "Its peer is smaller.", evidence: [], supports: [], subject: "NVDA" },
  ];
  const figures = [
    "Gross margin: NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025.",
    "Revenue: NVDA's revenue was $130.5B in FY2026.",
    "AMD's revenue was $25.8B in FY2025.",
  ];
  assert.deepEqual(judgeCases(accepted, packet, []).map((judged) => judged.figures), [figures, figures]);
  // A turn whose blocks show no figure answers from values no table shows: none is on the page.
  const unshown: EvidencePacket = { ...PACKET, figures: PACKET.figures.map((figure) => ({ ...figure, displayed: false as const })) };
  assert.deepEqual(judgeCases(accepted, unshown, []).map((judged) => judged.figures), [[], []]);
});

test("one judge call per answer, on JUDGE_LITELLM_MODEL, carries every inference with its supports' text; its reply is kept raw and read per inference", async () => {
  const requests: Array<{ model: string; request: LlmChatRequest }> = [];
  const reply = 'Here you go:\n{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false},{"id":2,"verdict":"unsupported","worded_amount":false,"reason":"no figure shows what it keeps of a sale."}]}';
  const record = await judgeInferences({
    cases: CASES,
    companies: PACKET.companies,
    env: ENV,
    createClient: () => async (deployment, request) => {
      requests.push({ model: `${deployment.channel}/${deployment.model}`, request });
      return { text: reply, usage: { inputTokens: 900, outputTokens: 60, totalTokens: 960 } };
    },
  });
  assert.equal(record.outcome, "replied");
  assert.deepEqual(record.outcome === "replied" && { ...record.exchange, latency_ms: typeof record.exchange.latency_ms }, {
    messages: judgeMessages(CASES, PACKET.companies),
    text: reply,
    truncated: false,
    deployment: "anthropic/claude-haiku-5-5",
    latency_ms: "number",
    usage: { input_tokens: 900, output_tokens: 60 },
  });
  assert.deepEqual(verdictsOf(CASES, record), [
    { index: 2, verdict: "unsupported", worded_amount: false, reason: "no figure shows what it keeps of a sale." },
    { index: 3, verdict: "entailed", worded_amount: false },
  ]);
  assert.deepEqual(requests.map(({ model }) => model), ["anthropic/claude-haiku-5-5"]);
  const [{ request }] = requests as [typeof requests[number]];
  assert.deepEqual([request.temperature, request.reasoning, request.messages.map((message) => message.role)], [undefined, "low", ["system", "user"]]);
  assert.deepEqual(JSON.parse(request.messages[1]!.content), {
    companies: ["NVDA", "AMD"],
    inferences: [
      {
        id: 2,
        subject: "NVDA",
        text: "It keeps more of each sale.",
        checked_results: ["NVDA highest on gross margin"],
        supports: [
          "NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025.",
          "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026), AMD 49.2% (FY2025), 25.4 percentage points above AMD.",
        ],
        rest_of_answer: [],
        figures_shown: ["NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025."],
      },
      {
        id: 3,
        subject: "NVDA",
        text: "Its peer trails on margin.",
        checked_results: ["NVDA highest on gross margin"],
        supports: ["Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026), AMD 49.2% (FY2025), 25.4 percentage points above AMD."],
        rest_of_answer: ["NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025."],
        figures_shown: ["NVDA's gross margin was 74.6% in FY2026; AMD's gross margin was 49.2% in FY2025."],
      },
    ],
  });
});

test("a malformed reply is an error for every inference, never entailed; a bad verdict is an error for its own", () => {
  const two: JudgeCase[] = [...CASES];
  for (const reply of ["entailed", '{"verdicts":"entailed"}', '{"verdicts":[{"id":2,"verdict":"entailed","worded_amount":false}', ""]) {
    assert.deepEqual(parseVerdicts(reply, two), [
      { index: 2, verdict: "error", reason: "the judge's reply is not a verdict list" },
      { index: 3, verdict: "error", reason: "the judge's reply is not a verdict list" },
    ]);
  }
  // A reply that corrects itself is read by its last list.
  const corrected = [
    '{"verdicts":[{"id":2,"verdict":"unsupported","worded_amount":false,"reason":"no figure shows \\"its peer\\"."},{"id":3,"verdict":"entailed","worded_amount":false}]}',
    "Correction: the comparison shows its peer trails. Final:",
    '```json\n{"verdicts":[{"id":2,"verdict":"entailed","worded_amount":false},{"id":3,"verdict":"contradicted","worded_amount":false,"reason":"NVDA is highest."}]}\n```',
  ].join("\n\n");
  assert.deepEqual(parseVerdicts(corrected, two), [
    { index: 2, verdict: "entailed", worded_amount: false },
    { index: 3, verdict: "contradicted", worded_amount: false, reason: "NVDA is highest." },
  ]);
  assert.deepEqual(parseVerdicts('{"verdicts":[{"id":2,"verdict":"probably","worded_amount":false}]}', two), [
    { index: 2, verdict: "error", reason: 'unknown verdict "probably"' },
    { index: 3, verdict: "error", reason: "no verdict for this inference" },
  ]);
  assert.deepEqual(parseVerdicts('{"verdicts":[{"id":2,"verdict":"entailed","worded_amount":false},{"id":2,"verdict":"unsupported","worded_amount":false},{"id":"3","verdict":"entailed","worded_amount":false}]}', two), [
    { index: 2, verdict: "error", reason: "more than one verdict for this inference" },
    { index: 3, verdict: "error", reason: "no verdict for this inference" },
  ]);
});

test("a verdict is entailed, unsupported or contradicted, beside whether the inference states an amount in words; a verdict outside the three, or no yes-or-no on the amount, is an error", () => {
  const cases = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({ ...CASES[0]!, index }));
  const reply = JSON.stringify({ verdicts: [
    { id: 1, verdict: "entailed", worded_amount: false },
    { id: 2, verdict: "unsupported", worded_amount: false, reason: "a forecast the figures do not show." },
    { id: 3, verdict: "contradicted", worded_amount: false, reason: "NVDA is highest, not its peer." },
    { id: 4, verdict: "unsupported", worded_amount: true, reason: "a forecast of hundreds of millions in savings." },
    { id: 5, verdict: "entailed", worded_amount: true, reason: "it says the margin doubled." },
    { id: 6, verdict: "unsupported", reason: "a forecast the figures do not show." },
    { id: 7, verdict: "entailed", worded_amount: "no" },
    { id: 8, verdict: "worded_amount", reason: "it says the margin doubled." },
  ] });
  assert.deepEqual(parseVerdicts(reply, cases), [
    { index: 1, verdict: "entailed", worded_amount: false },
    { index: 2, verdict: "unsupported", worded_amount: false, reason: "a forecast the figures do not show." },
    { index: 3, verdict: "contradicted", worded_amount: false, reason: "NVDA is highest, not its peer." },
    { index: 4, verdict: "unsupported", worded_amount: true, reason: "a forecast of hundreds of millions in savings." },
    { index: 5, verdict: "entailed", worded_amount: true, reason: "it says the margin doubled." },
    { index: 6, verdict: "error", reason: "no worded_amount for this inference" },
    { index: 7, verdict: "error", reason: "no worded_amount for this inference" },
    { index: 8, verdict: "error", reason: 'unknown verdict "worded_amount"' },
  ]);
  assert.deepEqual(parseVerdicts(reply, cases).map(shownAs), ["shown", "unverified", "hidden", "hidden", "hidden", "hidden", "hidden", "hidden"]);
});

test("a failed or cut-off judge call is an error for every inference; with no inference no call is made", async (t) => {
  t.mock.method(console, "warn", () => {});
  const thrown = await judgeInferences({
    cases: CASES,
    companies: PACKET.companies,
    env: ENV,
    createClient: () => async () => {
      throw new Error("provider down");
    },
  });
  assert.equal(thrown.outcome, "failed");
  assert.deepEqual(verdictsOf(CASES, thrown).map(({ verdict }) => verdict), ["error", "error"]);
  assert.match(verdictsOf(CASES, thrown)[0]!.reason!, /^judge call failed: /);
  const cut = await judgeInferences({
    cases: CASES.slice(0, 1),
    companies: PACKET.companies,
    env: ENV,
    createClient: () => async () => ({ text: '{"verdicts":[{"id":2,"verdict":"entailed"}]}', truncated: true }),
  });
  assert.deepEqual(verdictsOf(CASES.slice(0, 1), cut), [{ index: 2, verdict: "error", reason: "the judge's reply was cut off" }]);
  const unbuilt = await judgeInferences({
    cases: CASES.slice(0, 1),
    companies: PACKET.companies,
    env: ENV,
    createClient: () => {
      throw new Error("no such replay file");
    },
  });
  assert.deepEqual(verdictsOf(CASES.slice(0, 1), unbuilt), [{ index: 2, verdict: "error", reason: "judge model could not be configured: no such replay file" }]);
  const unconfigured = await judgeInferences({ cases: CASES.slice(0, 1), companies: PACKET.companies, env: {} });
  assert.deepEqual(verdictsOf(CASES.slice(0, 1), unconfigured), [{ index: 2, verdict: "error", reason: "no judge model is configured" }]);
  let called = false;
  const none = await judgeInferences({
    cases: [],
    companies: PACKET.companies,
    env: ENV,
    createClient: () => async () => {
      called = true;
      return { text: "" };
    },
  });
  assert.deepEqual([none, called], [{ outcome: "not_called", reason: "no inference to judge" }, false]);
});
