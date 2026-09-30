import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatCoordinator,
  type ChatAnalystToolRuntime,
  type ChatCoordinatorOptions,
  type ChatTurnRunContext,
} from "../src/coordinator.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";

const LISTING_IDS: Record<string, string> = {
  NVDA: "62000000-0000-4000-8000-000000000001",
  AMD: "62000000-0000-4000-8000-000000000002",
  AAPL: "62000000-0000-4000-8000-000000000003",
  MSFT: "62000000-0000-4000-8000-000000000004",
  GOOG: "62000000-0000-4000-8000-000000000005",
  META: "62000000-0000-4000-8000-000000000006",
  TSLA: "62000000-0000-4000-8000-000000000007",
};

function resolved(ticker: string): ChatResolvedSubjectPreResolution {
  const subjectRef = { kind: "listing" as const, id: LISTING_IDS[ticker] };
  return {
    status: "resolved",
    input_text: ticker,
    normalized_input: ticker,
    subject_ref: subjectRef,
    identity_level: "listing",
    display_label: ticker,
    resolution_path: "auto_advanced",
    confidence: 0.95,
    handoff: {
      subject_ref: subjectRef,
      identity_level: "listing",
      display_label: ticker,
      display_labels: { primary: ticker },
      normalized_input: ticker,
      resolution_path: "auto_advanced",
      confidence: 0.95,
      context: {},
    },
  } as ChatResolvedSubjectPreResolution;
}

async function preResolveSubject({ text }: { text: string }): Promise<ChatSubjectPreResolution> {
  if (LISTING_IDS[text]) return resolved(text);
  if (text === "GOOGL") {
    return {
      status: "needs_clarification",
      input_text: text,
      normalized_input: text,
      candidates: [],
      message: "Which Alphabet share class do you mean?",
    } as ChatSubjectPreResolution;
  }
  return { status: "not_found", input_text: text, normalized_input: text, message: `no ${text}` };
}

async function subjectsForTurn(
  userIntent: string,
  options: Partial<ChatCoordinatorOptions> = {},
  subjectText?: string,
): Promise<{ tickers: string[]; primary: string | undefined; context: ChatTurnRunContext | null }> {
  let observed = null as ChatTurnRunContext | null;
  const coordinator = createChatCoordinator({
    preResolveSubject,
    runner: (context) => {
      observed = context;
      context.emit("turn.completed", { message_id: "message-1" });
    },
    ...options,
  });
  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    userIntent,
    ...(subjectText ? { subjectText } : {}),
  });
  await turn.completed;
  return {
    tickers: (observed?.subjectPreResolutions ?? []).map((subject) => subject.input_text),
    primary: observed?.subjectPreResolution?.input_text,
    context: observed,
  };
}

const priorOf = (...tickers: string[]) => async () => tickers.map(resolved);

test("a message naming two companies resolves both, in the order written", async () => {
  const { tickers, primary } = await subjectsForTurn("Compare NVDA and AMD");
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
  assert.equal(primary, "NVDA");
});

test("a comparative follow-up keeps the previous answer's companies and adds the new one", async () => {
  const { tickers, primary } = await subjectsForTurn("Compare it with AMD", { loadPriorSubjects: priorOf("NVDA") });
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
  assert.equal(primary, "NVDA");
});

test("a follow-up that names no company carries the previous companies forward", async () => {
  const { tickers } = await subjectsForTurn("Explain the differences and show the evidence", {
    loadPriorSubjects: priorOf("NVDA", "AMD"),
  });
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
});

test("naming a new company without comparing replaces the previous ones", async () => {
  const { tickers } = await subjectsForTurn("Analyze AAPL and its margins", { loadPriorSubjects: priorOf("NVDA") });
  assert.deepEqual(tickers, ["AAPL"]);
});

test("the same company named twice or also carried forward is covered once", async () => {
  const { tickers } = await subjectsForTurn("Compare NVDA vs NVDA and AMD", { loadPriorSubjects: priorOf("NVDA") });
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
});

test("a turn covers at most five companies", async () => {
  const { tickers } = await subjectsForTurn("Compare NVDA AMD AAPL MSFT GOOG META TSLA");
  assert.deepEqual(tickers, ["NVDA", "AMD", "AAPL", "MSFT", "GOOG"]);
});

test("with no company named and no previous answer, the turn is ungrounded as before", async () => {
  const { tickers, context } = await subjectsForTurn("What is happening in markets?", { loadPriorSubjects: priorOf() });
  assert.deepEqual(tickers, []);
  assert.equal(context?.subjectPreResolution, undefined);
});

test("turn.completed lists every company the answer covers", async () => {
  const runtime: ChatAnalystToolRuntime = async (context) => ({
    snapshot_id: "11111111-1111-4111-a111-111111111111",
    verification: { ok: true, failures: [] },
    tool_calls: [],
    blocks: [{ id: "b1", kind: "rich_text", segments: [{ type: "text", text: "ok" }], bundle: context.bundleId }],
  });
  const turn = createChatCoordinator({ preResolveSubject, analystToolRuntime: runtime })
    .getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare NVDA and AMD" });
  await turn.completed;
  const completed = turn.events.find((event) => event.type === "turn.completed") as Record<string, unknown> | undefined;
  assert.deepEqual(completed?.subject_ref, { kind: "listing", id: LISTING_IDS.NVDA });
  assert.deepEqual(completed?.subject_refs, [
    { kind: "listing", id: LISTING_IDS.NVDA },
    { kind: "listing", id: LISTING_IDS.AMD },
  ]);
});

test("a follow-up after a five-company answer keeps the newly named company", async () => {
  const { tickers } = await subjectsForTurn("Compare it with AAPL", {
    loadPriorSubjects: priorOf("NVDA", "AMD", "MSFT", "GOOG", "META"),
  });
  assert.deepEqual(tickers, ["NVDA", "AMD", "MSFT", "GOOG", "AAPL"]);
});

test("an ambiguous company in a comparison asks which one instead of answering partially", async () => {
  let ran = false;
  const turn = createChatCoordinator({
    preResolveSubject,
    runner: () => {
      ran = true;
    },
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare GOOGL and NVDA" });
  await turn.completed;

  assert.equal(ran, false, "the analyst must not answer about NVDA alone");
  const completed = turn.events.find((event) => event.type === "turn.completed") as Record<string, unknown> | undefined;
  assert.equal(completed?.clarification, true);
  assert.match(JSON.stringify(turn.events), /Which Alphabet share class do you mean\?/);
});

test("a company that cannot be found in a comparison is named in the answer, not dropped silently", async () => {
  const runtime: ChatAnalystToolRuntime = async () => ({
    snapshot_id: "11111111-1111-4111-a111-111111111111",
    verification: { ok: true, failures: [] },
    tool_calls: [],
    blocks: [{ id: "b1", kind: "rich_text", segments: [{ type: "text", text: "NVIDIA leads." }] }],
  });
  const turn = createChatCoordinator({ preResolveSubject, analystToolRuntime: runtime })
    .getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare NVDA and XYZQ" });
  await turn.completed;

  const completed = turn.events.find((event) => event.type === "turn.completed") as Record<string, unknown> | undefined;
  assert.deepEqual(completed?.subject_refs, [{ kind: "listing", id: LISTING_IDS.NVDA }]);
  const text = turn.events
    .filter((event) => event.type === "block.delta")
    .map((event) => JSON.stringify(event))
    .join(" ");
  assert.match(text, /could not find XYZQ/);
  assert.match(text, /NVIDIA leads\./);
});


// A thread opened from a ticker page arrives with an explicit subject (#138).
test("an explicit subject stays primary and a comparison adds the companies it names", async () => {
  const { tickers, primary } = await subjectsForTurn("Compare with AMD", {}, "NVDA");
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
  assert.equal(primary, "NVDA");
});

test("an explicit subject with a non-comparative message covers that subject only", async () => {
  const { tickers } = await subjectsForTurn("Summarize the quarter for AMD", {}, "NVDA");
  assert.deepEqual(tickers, ["NVDA"]);
});

test("an explicit subject named again in the comparison is covered once, and the cap still holds", async () => {
  assert.deepEqual((await subjectsForTurn("Compare NVDA with AMD", {}, "NVDA")).tickers, ["NVDA", "AMD"]);
  const capped = await subjectsForTurn("Compare with AMD AAPL MSFT GOOG META TSLA", {}, "NVDA");
  assert.deepEqual(capped.tickers, ["NVDA", "AMD", "AAPL", "MSFT", "GOOG"]);
});

test("an explicit subject's comparison asks about an ambiguous company and names one not found", async () => {
  let ran = false;
  const turn = createChatCoordinator({ preResolveSubject, runner: () => { ran = true; } })
    .getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare with GOOGL", subjectText: "NVDA" });
  await turn.completed;
  assert.equal(ran, false);
  assert.match(JSON.stringify(turn.events), /Which Alphabet share class do you mean\?/);

  const { tickers, context } = await subjectsForTurn("Compare with XYZQ", {}, "NVDA");
  assert.deepEqual(tickers, ["NVDA"]);
  assert.deepEqual(context?.unresolvedMentions, ["XYZQ"]);
});
