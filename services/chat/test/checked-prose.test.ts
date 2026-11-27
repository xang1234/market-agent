// The checked-prose lane (#800) on scripted models: every call's reply is given here,
// keyed by its prompt's opening sentence, and every request is kept for the tests to read.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { FinancialAnswerContent } from "../../financial-core/src/index.ts";
import type { LlmChatRequest, LlmChatResult } from "../../llm/src/index.ts";
import { checkedProse, checkedProseModels, proseSegments, type CheckedProse, type ProseSegment } from "../src/checked-prose.ts";
import { enginePacket, type EvidencePacket, type PacketClaim } from "../src/evidence-packet.ts";
import { createSealer } from "../src/prose-refs.ts";

// NVIDIA's latest-quarter answer on the golden data, recorded from a real stack with
// DEV_CAPTURE_FILE (services/app/src/dev.ts).
type Message = { blocks?: Array<{ kind: string; financial?: FinancialAnswerContent }> };
const REPLAY = JSON.parse(readFileSync(new URL("../../app/fixtures/golden-conversation.replay.json", import.meta.url), "utf8")) as { exchanges: Array<{ body: string }> };
const ANSWER = REPLAY.exchanges
  .flatMap(({ body }) => (body.startsWith("{") ? ((JSON.parse(body) as { messages?: Message[] }).messages ?? []) : []))
  .flatMap((message) => message.blocks ?? [])
  .find((block) => block.kind === "financial_answer")!.financial!;

const CLAIM: PacketClaim = {
  id: "C1",
  text: "Data center revenue was a record $51.2 billion, up 66% from a year ago.",
  predicate: "business.products",
  stance: "neutral",
  claim_id: "5c000000-0000-4000-8000-000000000001",
  source_id: "5c000000-0000-4000-8000-000000000002",
};
const PACKET: EvidencePacket = { ...enginePacket(ANSWER, new Map(), null), claims: [CLAIM] };
const idOf = (metric: string, period: string) => PACKET.figures.find((figure) => figure.metric === metric && figure.period?.startsWith(period))!.id;
const REVENUE = idOf("Revenue", "Q4 FY2026");
const YEAR_AGO = idOf("Revenue", "Q4 FY2025");
const GROSS_MARGIN = idOf("Gross margin (gross profit / revenue)", "Q4 FY2026");
const resultSource = (id: string) => {
  const figure = PACKET.figures.find((entry) => entry.id === id)!;
  return { ref_kind: "result", ref_id: figure.result_id, format: figure.value, period: figure.period };
};

const ENV = {
  LLM_CHANNELS: "anthropic",
  LLM_ANTHROPIC_PROTOCOL: "anthropic",
  LLM_ANTHROPIC_API_KEY: "sk-test",
  LLM_ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-opus-5-5",
  LITELLM_MODEL: "anthropic/claude-sonnet-5-5",
  CHECK_LITELLM_MODEL: "anthropic/claude-opus-5-5",
};

const reported = (source: string) => ({ basis: "reported", source, sign: null, scale: null });
const derived = (derivation: string, ...operands: string[][]) => ({ basis: "derived", derivation, operands: operands.map((add) => ({ add, subtract: [], over: null })), sign: null, scale: null });

type RewriteSentence = { id: string; text: string; problems: string[] };
type Script = {
  draft: string;
  // Each figure's label by the text it is marked with; any other marked number is a name.
  labels?: Readonly<Record<string, object>> | Error;
  findings?: ReadonlyArray<object> | Error;
  edits?: ((sentences: RewriteSentence[]) => ReadonlyArray<object>) | Error;
  // The replies to the second label and relation calls, when they differ from the first.
  recheck?: Pick<Script, "labels" | "findings">;
};
type Call = { kind: "draft" | "label" | "relation" | "rewrite"; model: string; request: LlmChatRequest };

const OPENINGS = {
  draft: "Write a concise investment research answer for the chat user in Markdown",
  label: "You label every marked number in an equity research answer",
  relation: "You check the comparisons, trends and causes an equity research answer states",
  rewrite: "You correct the listed sentences of an equity research answer",
} as const;

const fence = (name: string, value: unknown) => `\`\`\`${name}\n${JSON.stringify(value)}\n\`\`\``;
const marked = (request: LlmChatRequest) => [...request.messages[1]!.content.matchAll(/⟦(n\d+):([^⟧]*)⟧/gu)].map((match) => [match[1]!, match[2]!] as const);

function scripted(script: Script) {
  const calls: Call[] = [];
  const createClient = () => async (deployment: { channel: string; model: string }, request: LlmChatRequest): Promise<LlmChatResult> => {
    const kind = (Object.keys(OPENINGS) as Array<keyof typeof OPENINGS>).find((name) => request.messages[0]!.content.startsWith(OPENINGS[name]));
    assert.ok(kind, `no script for ${request.messages[0]!.content.slice(0, 80)}`);
    const again = calls.some((call) => call.kind === kind);
    calls.push({ kind, model: deployment.model, request });
    const { labels, findings } = again && script.recheck ? { ...script, ...script.recheck } : script;
    const failed = (reply: unknown) => {
      if (reply instanceof Error) throw reply;
    };
    switch (kind) {
      case "draft":
        return { text: script.draft };
      case "label": {
        failed(labels);
        const table = (labels ?? {}) as Record<string, object>;
        const numbers = marked(request);
        return { text: fence("labels", {
          labels: numbers.filter(([, text]) => !(text in table)).map(([id]) => id),
          figures: numbers.filter(([, text]) => text in table).map(([id, text]) => ({ id, ...table[text] })),
        }) };
      }
      case "relation":
        failed(findings);
        return { text: fence("findings", findings ?? []) };
      case "rewrite": {
        failed(script.edits);
        const sentences = (JSON.parse(request.messages[1]!.content) as { sentences: RewriteSentence[] }).sentences;
        return { text: fence("edits", (script.edits as (sentences: RewriteSentence[]) => ReadonlyArray<object>)(sentences)) };
      }
    }
  };
  return { calls, kinds: () => calls.map((call) => call.kind), models: checkedProseModels(ENV, createClient) };
}

async function lane(script: Script, options: { remainingMs?: number } = {}) {
  const { calls, kinds, models } = scripted(script);
  const steps: string[] = [];
  const checked = await checkedProse(
    { question: "How did NVIDIA do last quarter?", conversation: [], packet: PACKET, remainingMs: () => options.remainingMs ?? 120_000 },
    models,
    async (_tool, label, run) => {
      steps.push(label);
      return run();
    },
  );
  assert.ok(checked, "the draft was written");
  return { checked, calls, kinds, steps, segments: proseSegments(checked, PACKET, createSealer([])) };
}

// The segments as a reader sees them: a figure in braces, a struck one with its reason.
const shown = (segments: ReadonlyArray<ProseSegment>) => segments.map((segment) => {
  switch (segment.type) {
    case "text":
      return segment.text;
    case "ref":
      return `“${segment.format}”`;
    case "figure":
      return `{${segment.text}${segment.near ? "~" : ""}}`;
    case "struck":
      return `~~${segment.text}~~ (${segment.reason})`;
  }
}).join("");
const figures = (segments: ReadonlyArray<ProseSegment>) => segments.filter((segment) => segment.type === "figure");
const sentenceTexts = (checked: CheckedProse) => checked.final.map((version) => version.text);

test("a figure labelled at its result links to that result, and the labeller never sees an entry's value", async () => {
  const { segments, kinds, calls, steps } = await lane({ draft: "Revenue reached $62.1B in the quarter.", labels: { "$62.1B": reported(REVENUE) } });
  assert.equal(shown(segments), "Revenue reached {$62.1B} in the quarter.");
  assert.deepEqual(figures(segments), [{ type: "figure", text: "$62.1B", sources: [resultSource(REVENUE)] }]);
  assert.deepEqual(kinds(), ["draft", "label", "relation"]);
  assert.deepEqual(calls.map((call) => [call.kind, call.model]), [["draft", "claude-sonnet-5-5"], ["label", "claude-opus-5-5"], ["relation", "claude-opus-5-5"]]);
  const entries = calls[1]!.request.messages[1]!.content.split("Evidence entries")[1]!;
  assert.match(entries, new RegExp(`${REVENUE}: NVIDIA Corporation, Revenue, Q4 FY2026`, "u"));
  assert.doesNotMatch(entries, /\$62\.1B|\$46\.2B|74\.40%/u, "no figure's value");
  assert.match(entries, /C1: "Data center revenue was a record \$51\.2 billion, up 66% from a year ago\." Its figures: C1\.1 "\$51\.2 billion", C1\.2 "66%"/u);
  assert.deepEqual(steps, ["Writing the answer", "Checking 1 figure and the comparisons"]);
});

test("a wrong figure goes back once, naming the data at the answer's precision, and its corrected sentence links", async () => {
  const { segments, kinds, calls, steps } = await lane({
    draft: "Revenue reached $72.1B in the quarter. Demand stayed strong.",
    labels: { "$72.1B": reported(REVENUE), "$62.1B": reported(REVENUE) },
    edits: () => [{ sentence: "s1", text: "Revenue reached $62.1B in the quarter." }],
  });
  assert.deepEqual(kinds(), ["draft", "label", "relation", "rewrite", "label", "relation"]);
  const sent = JSON.parse(calls[3]!.request.messages[1]!.content) as { sentences: RewriteSentence[] };
  assert.deepEqual(sent.sentences, [{ id: "s1", text: "Revenue reached $72.1B in the quarter.", problems: ["$72.1B is not what the sources give: they give $62.1B."] }]);
  assert.deepEqual(marked(calls[4]!.request), [["n1", "$62.1B"]], "only the corrected sentence is labelled again");
  assert.equal(shown(segments), "Revenue reached {$62.1B} in the quarter. Demand stayed strong.");
  assert.deepEqual(steps, ["Writing the answer", "Checking 1 figure and the comparisons", "Correcting 1 sentence", "Checking the corrections"]);
});

// #812: a change between two percents is in points, so a percent there goes back named in
// points; a share of revenue labelled as a margin over amounts stays a percent and links.
test("a gap between two margins stated as a percent goes back in points, and a share of revenue links", async () => {
  const OPERATING_MARGIN = idOf("Operating margin (operating income / revenue)", "Q4 FY2026");
  const [GROSS_PROFIT, OPERATING_INCOME] = [idOf("Gross profit", "Q4 FY2026"), idOf("Operating income", "Q4 FY2026")];
  const costs = { basis: "derived", derivation: "margin", operands: [{ add: [GROSS_PROFIT], subtract: [OPERATING_INCOME], over: null }, { add: [REVENUE], subtract: [], over: null }], sign: null, scale: null };
  const { segments, calls } = await lane({
    draft: "Gross margin ran 9.5% above operating margin.",
    labels: { "9.5%": derived("difference", [GROSS_MARGIN], [OPERATING_MARGIN]), "9.5 percentage points": derived("difference", [GROSS_MARGIN], [OPERATING_MARGIN]) },
    edits: () => [{ sentence: "s1", text: "Gross margin ran 9.5 percentage points above operating margin." }],
  });
  const sent = JSON.parse(calls[3]!.request.messages[1]!.content) as { sentences: RewriteSentence[] };
  assert.deepEqual(sent.sentences.map((sentence) => [sentence.id, sentence.problems]), [["s1", ["9.5% is not what the sources give: they give 9.5 percentage points."]]]);
  assert.equal(shown(segments), "Gross margin ran {9.5 percentage points} above operating margin.");
  const share = await lane({ draft: "Operating costs were 9.5% of revenue.", labels: { "9.5%": costs } });
  assert.equal(shown(share.segments), "Operating costs were {9.5%} of revenue.");
});

test("a near figure, a last digit off or hedged, is linked as near and never sent back", async () => {
  const { segments, kinds } = await lane({ draft: "Revenue reached $62.2B, or about $62B.", labels: { "$62.2B": reported(REVENUE), "$62B": reported(REVENUE) } });
  assert.deepEqual(kinds(), ["draft", "label", "relation"]);
  assert.equal(shown(segments), "Revenue reached {$62.2B~}, or about {$62B~}.");
});

test("a figure still wrong after the rewrite is struck, naming the data and linking it", async () => {
  const { segments, kinds } = await lane({
    draft: "Revenue reached $72.1B.",
    labels: { "$72.1B": reported(REVENUE) },
    edits: () => [{ sentence: "s1", text: "Revenue reached $72.1B." }],
  });
  assert.equal(kinds().filter((kind) => kind === "rewrite").length, 1);
  assert.equal(shown(segments), "Revenue reached ~~$72.1B~~ (the sources give $62.1B).");
  assert.deepEqual(segments.find((segment) => segment.type === "struck"), { type: "struck", text: "$72.1B", reason: "the sources give $62.1B", sources: [resultSource(REVENUE)] });
});

test("a rewritten sentence worse than the draft's is reverted, and a tie keeps the rewrite", async () => {
  const worse = await lane({
    draft: "Revenue reached $72.1B.",
    labels: { "$72.1B": reported(REVENUE), "$82.1B": reported(REVENUE), "99%": derived("growth", [YEAR_AGO], [REVENUE]) },
    edits: () => [{ sentence: "s1", text: "Revenue reached $82.1B, up 99%." }],
  });
  assert.equal(shown(worse.segments), "Revenue reached ~~$72.1B~~ (the sources give $62.1B).");
  const tie = await lane({
    draft: "Revenue reached $72.1B.",
    labels: { "$72.1B": reported(REVENUE), "$82.1B": reported(REVENUE) },
    edits: () => [{ sentence: "s1", text: "Revenue came to $82.1B." }],
  });
  assert.equal(shown(tie.segments), "Revenue came to ~~$82.1B~~ (the sources give $62.1B).");
});

test("unedited sentences stay byte for byte, their figures linked as first labelled", async () => {
  const draft = "Revenue reached $62.1B, up 58% from $39.3B a year ago.\n\n- Gross margin was 84.4%.";
  const { checked, segments, calls } = await lane({
    draft,
    labels: { "$62.1B": reported(REVENUE), "58%": derived("growth", [YEAR_AGO], [REVENUE]), "$39.3B": reported(YEAR_AGO), "84.4%": reported(GROSS_MARGIN), "74.4%": reported(GROSS_MARGIN) },
    edits: (sentences) => sentences.map((sentence) => ({ sentence: sentence.id, text: "- Gross margin was 74.4%." })),
  });
  assert.deepEqual(sentenceTexts(checked), ["Revenue reached $62.1B, up 58% from $39.3B a year ago.", "- Gross margin was 74.4%."]);
  assert.deepEqual(marked(calls[4]!.request), [["n1", "74.4%"]]);
  assert.equal(shown(segments), "Revenue reached {$62.1B}, up {58%} from {$39.3B} a year ago.\n\n- Gross margin was {74.4%}.");
  assert.deepEqual(figures(segments)[1], {
    type: "figure",
    text: "58%",
    sources: [resultSource(YEAR_AGO), resultSource(REVENUE)],
    derivation: "growth",
    operands: [{ add: [0], subtract: [], over: null }, { add: [1], subtract: [], over: null }],
  });
});

test("a labeller failure leaves every figure plain under a note, and relation findings still go back", async () => {
  const { segments, kinds } = await lane({
    draft: "Revenue reached $62.1B and fell from a year ago.",
    labels: new Error("labeller down"),
    findings: [{ quote: "fell from a year ago", problem: "revenue rose 58% from a year ago", correction: "rose from a year ago" }],
    edits: () => [{ sentence: "s1", text: "Revenue reached $62.1B and rose from a year ago." }],
  });
  assert.deepEqual(kinds(), ["draft", "label", "relation", "rewrite", "relation"]);
  assert.equal(shown(segments), "Revenue reached $62.1B and rose from a year ago.\n\n_The figures in this text could not be checked against the sources just now._");
});

test("a relation failure leaves figures linked under a note", async () => {
  const { segments } = await lane({ draft: "Revenue reached $62.1B.", labels: { "$62.1B": reported(REVENUE) }, findings: new Error("relation down") });
  assert.equal(shown(segments), "Revenue reached {$62.1B}.\n\n_Comparisons in this text were not checked._");
});

test("a relation quote the text does not hold is dropped; one it holds goes back, and is struck with its correction if it stands", async () => {
  const absent = await lane({ draft: "Revenue reached $62.1B.", labels: { "$62.1B": reported(REVENUE) }, findings: [{ quote: "revenue fell", problem: "it rose", correction: "revenue rose" }] });
  assert.deepEqual(absent.kinds(), ["draft", "label", "relation"]);
  const standing = await lane({
    draft: "Revenue reached $62.1B, below a year ago.",
    labels: { "$62.1B": reported(REVENUE) },
    findings: [{ quote: "below a year ago", problem: "revenue was higher than a year ago", correction: "above a year ago" }],
    edits: new Error("rewrite down"),
  });
  assert.equal(JSON.parse(standing.calls[3]!.request.messages[1]!.content).sentences[0].problems[0], "below a year ago: revenue was higher than a year ago. Say instead: above a year ago.");
  assert.equal(shown(standing.segments), "Revenue reached {$62.1B}, ~~below a year ago~~ (above a year ago).");
});

// Codex on #814: a correction whose check failed is unchecked, not clean, so the draft stays.
test("a correction whose labelling or relation check fails keeps the checked draft", async () => {
  for (const recheck of [{ labels: new Error("labeller down") }, { findings: new Error("relation down") }]) {
    const { segments, kinds } = await lane({
      draft: "Revenue reached $72.1B.",
      labels: { "$72.1B": reported(REVENUE), "$62.1B": reported(REVENUE) },
      edits: () => [{ sentence: "s1", text: "Revenue reached $62.1B." }],
      recheck,
    });
    assert.deepEqual(kinds(), ["draft", "label", "relation", "rewrite", "label", "relation"]);
    assert.equal(shown(segments), "Revenue reached ~~$72.1B~~ (the sources give $62.1B).", Object.keys(recheck)[0]);
  }
});

// Codex on #814: a contradicted comparison is struck whole, over a figure inside its quote.
test("a standing relation quote that holds a linked figure is still struck with its correction", async () => {
  const { segments } = await lane({
    draft: "Revenue reached $62.1B, below a year ago.",
    labels: { "$62.1B": reported(REVENUE) },
    findings: [{ quote: "Revenue reached $62.1B, below a year ago", problem: "revenue was higher than a year ago", correction: "Revenue reached $62.1B, above a year ago" }],
    edits: new Error("rewrite down"),
  });
  assert.equal(shown(segments), "~~Revenue reached $62.1B, below a year ago~~ (Revenue reached $62.1B, above a year ago).");
});

test("a sentence stating a stance goes back, and one still stating it after the rewrite is left out", async () => {
  const { segments, calls } = await lane({
    draft: "Revenue reached $62.1B. We rate the shares a buy.",
    labels: { "$62.1B": reported(REVENUE) },
    edits: () => [{ sentence: "s2", text: "It is a strong buy." }],
  });
  assert.deepEqual(JSON.parse(calls[3]!.request.messages[1]!.content).sentences.map((sentence: RewriteSentence) => sentence.problems), [["It states a rating or recommendation, which the answer never gives."]]);
  assert.equal(shown(segments), "Revenue reached {$62.1B}.");
});

test("the rewrite is skipped when less than 35 s of the turn remain, and a wrong figure is struck", async () => {
  const { segments, kinds } = await lane({ draft: "Revenue reached $72.1B.", labels: { "$72.1B": reported(REVENUE) } }, { remainingMs: 30_000 });
  assert.deepEqual(kinds(), ["draft", "label", "relation"]);
  assert.equal(shown(segments), "Revenue reached ~~$72.1B~~ (the sources give $62.1B).");
});

test("a claim marker quotes the claim, a figure it states links to it, and the digits of a marker are never labelled", async () => {
  const { segments, calls } = await lane({
    draft: "Management said [C1] So data center revenue was $51.2B.",
    labels: { "$51.2B": reported("C1.1") },
  });
  assert.deepEqual(marked(calls[1]!.request).map(([, text]) => text), ["$51.2B"]);
  assert.equal(shown(segments), `Management said “${CLAIM.text}” So data center revenue was {$51.2B}.`);
  assert.deepEqual(figures(segments), [{ type: "figure", text: "$51.2B", sources: [{ ref_kind: "claim", ref_id: CLAIM.claim_id, format: CLAIM.text, numeral: 1 }] }]);
});

test("a figure the sources do not hold, or that no sealed ref can show, stays plain and is counted in one note", async () => {
  const { segments, calls } = await lane({
    draft: "Revenue reached $62.1B, and the backlog was $500B.",
    labels: { "$62.1B": reported(REVENUE), "$500B": { basis: "reported", source: null, what: "backlog" } },
    edits: () => [{ sentence: "s1", text: "Revenue reached $62.1B, and the backlog was $500B." }],
  });
  assert.equal(JSON.parse(calls[3]!.request.messages[1]!.content).sentences[0].problems[0], "$500B is not in the sources read (backlog): state only what they give, or leave it out.");
  assert.equal(shown(segments), "Revenue reached {$62.1B}, and the backlog was $500B.\n\n_1 figure could not be traced to the sources read._");
});

test("a figure that holds only by its table's scale stays plain, since the seal reads no scale and would refuse it", async () => {
  const { segments, kinds } = await lane({ draft: "| Revenue ($M) | 62,100 |", labels: { "62,100": { ...reported(REVENUE), scale: "millions" } } });
  assert.deepEqual(kinds(), ["draft", "label", "relation"], "it matched, so nothing goes back");
  assert.equal(shown(segments), "| Revenue ($M) | 62,100 |\n\n_1 figure could not be traced to the sources read._");
});

test("a sentence quoting a claim the seal left out is left out, and a figure on that claim is plain", async () => {
  const { checked } = await lane({ draft: "Management said: [C1]\nRevenue reached $62.1B.", labels: { "$62.1B": reported(REVENUE) } });
  const dropped = proseSegments(checked, PACKET, createSealer([]), { withdrawn: [CLAIM.claim_id], unchecked: [] });
  assert.equal(shown(dropped), "Revenue reached {$62.1B}.\n\n_A claim this answer quoted is no longer citable, so it is left out._");
});

test("a draft the model could not write is no answer", async () => {
  const createClient = () => async (): Promise<LlmChatResult> => {
    throw new Error("down");
  };
  assert.equal(await checkedProse({ question: "q", conversation: [], packet: PACKET, remainingMs: () => 120_000 }, checkedProseModels(ENV, createClient), (_tool, _label, run) => run()), null);
});
