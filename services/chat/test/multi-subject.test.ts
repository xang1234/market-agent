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
  NOW: "62000000-0000-4000-8000-000000000008",
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

// #206: a follow-up changes the compared companies only as it says.
test("a follow-up that adds a company keeps the previous ones", async () => {
  const { tickers, primary } = await subjectsForTurn("Add AAPL", { loadPriorSubjects: priorOf("NVDA", "AMD") });
  assert.deepEqual(tickers, ["NVDA", "AMD", "AAPL"]);
  assert.equal(primary, "NVDA");
});

test("a follow-up that drops a company keeps the others", async () => {
  for (const question of ["Drop AMD", "Remove AMD from the comparison", "Compare them without AMD", "Same table, but leave out AMD"]) {
    const { tickers } = await subjectsForTurn(question, { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL") });
    assert.deepEqual(tickers, ["NVDA", "AAPL"], question);
  }
  // A company named beside the one dropped is added.
  const swapped = await subjectsForTurn("Drop AMD and add TSLA", { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL") });
  assert.deepEqual(swapped.tickers, ["NVDA", "AAPL", "TSLA"]);
  // Every company in a list is dropped; a request after it is not part of it.
  for (const question of ["Drop AMD and AAPL", "Drop AMD, AAPL", "Remove AMD and AAPL from the table"]) {
    const { tickers } = await subjectsForTurn(question, { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL") });
    assert.deepEqual(tickers, ["NVDA"], question);
  }
  const dropThenAdd = await subjectsForTurn("Drop AMD, add TSLA", { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL") });
  assert.deepEqual(dropThenAdd.tickers, ["NVDA", "AAPL", "TSLA"]);
  // A company added beside a removal that cannot be found is named, not dropped silently.
  const unfound = await subjectsForTurn("Drop AMD and add XYZQ", { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL") });
  assert.deepEqual(unfound.tickers, ["NVDA", "AAPL"]);
  assert.deepEqual(unfound.context?.unresolvedMentions, ["XYZQ"]);
  // A ticker that is also a word ("NOW") is part of the list, not where it ends.
  const tickerWord = await subjectsForTurn("Drop AMD and NOW", { loadPriorSubjects: priorOf("NVDA", "AMD", "NOW") });
  assert.deepEqual(tickerWord.tickers, ["NVDA"]);
  // An addition beside a removal gets a slot under the cap before carried companies.
  const full = await subjectsForTurn("Drop AMD and add TSLA", { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL", "MSFT", "GOOG", "META") });
  assert.deepEqual(full.tickers, ["NVDA", "AAPL", "MSFT", "GOOG", "TSLA"]);
  // Turning a facet off names no company, so the companies are kept.
  const { tickers } = await subjectsForTurn("Drop the segments", { loadPriorSubjects: priorOf("NVDA", "AMD") });
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
});

test("an ambiguous company added beside a removal is asked about", async () => {
  let ran = false;
  const turn = createChatCoordinator({
    preResolveSubject,
    loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL"),
    runner: () => {
      ran = true;
    },
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Drop AMD and add GOOGL" });
  await turn.completed;
  assert.equal(ran, false);
  assert.match(JSON.stringify(turn.events), /Which Alphabet share class do you mean\?/);
});

test("naming a new company after a comparison, without saying add or replace, asks which", async () => {
  let ran = false;
  const persisted: Array<Record<string, unknown>> = [];
  const turn = createChatCoordinator({
    preResolveSubject,
    loadPriorSubjects: priorOf("NVDA", "AMD"),
    persistAssistantMessage: async (input) => {
      persisted.push(input);
      return { snapshot_id: "snapshot-1", message_id: "message-1" };
    },
    runner: () => {
      ran = true;
    },
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "What about AAPL?" });
  await turn.completed;

  assert.equal(ran, false, "the analyst must not answer about AAPL alone or all three");
  const completed = turn.events.find((event) => event.type === "turn.completed") as Record<string, unknown> | undefined;
  assert.equal(completed?.clarification, true);
  const text = JSON.stringify(turn.events);
  assert.match(text, /Add AAPL to the NVDA and AMD comparison, or look at AAPL alone\?/);
  assert.match(text, /add AAPL/);
  assert.match(text, /just AAPL/);
  // Saved with no research scope, so the reply continues the comparison.
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.research_scope, undefined);
  // A saved answer's text block is bound to itself, as the snapshot verifier requires.
  assert.deepEqual((persisted[0]!.blocks as Array<{ id: string; data_ref: unknown }>).map((block) => block.data_ref), [
    { kind: "rich_text", id: (persisted[0]!.blocks as Array<{ id: string }>)[0]!.id },
  ]);
});

test("an ambiguous company's question is saved as a text block the verifier accepts", async () => {
  const persisted: Array<Record<string, unknown>> = [];
  const turn = createChatCoordinator({
    preResolveSubject,
    persistAssistantMessage: async (input) => {
      persisted.push(input);
      return { snapshot_id: "snapshot-1", message_id: "message-1" };
    },
    runner: () => {},
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare GOOGL and NVDA" });
  await turn.completed;
  const block = (persisted[0]!.blocks as Array<{ id: string; data_ref: unknown }>)[0]!;
  assert.deepEqual(block.data_ref, { kind: "rich_text", id: block.id });
});

test("the reply to that question, or a clear switch, is answered", async () => {
  assert.deepEqual((await subjectsForTurn("add AAPL", { loadPriorSubjects: priorOf("NVDA", "AMD") })).tickers, ["NVDA", "AMD", "AAPL"]);
  assert.deepEqual((await subjectsForTurn("just AAPL", { loadPriorSubjects: priorOf("NVDA", "AMD") })).tickers, ["AAPL"]);
  assert.deepEqual((await subjectsForTurn("What about just AAPL?", { loadPriorSubjects: priorOf("NVDA", "AMD") })).tickers, ["AAPL"]);
  // After one company there is no comparison to keep: the new one replaces it.
  assert.deepEqual((await subjectsForTurn("What about AAPL?", { loadPriorSubjects: priorOf("NVDA") })).tickers, ["AAPL"]);
  // A company already compared is not a new one.
  assert.deepEqual((await subjectsForTurn("And what about AMD?", { loadPriorSubjects: priorOf("NVDA", "AMD") })).tickers, ["AMD"]);
});

test("dropping a company the comparison does not have, or every company, is asked about", async () => {
  const ask = async (userIntent: string) => {
    let ran = false;
    const turn = createChatCoordinator({
      preResolveSubject,
      loadPriorSubjects: priorOf("NVDA", "AMD"),
      runner: () => {
        ran = true;
      },
    }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent });
    await turn.completed;
    assert.equal(ran, false, userIntent);
    return JSON.stringify(turn.events);
  };
  assert.match(await ask("drop AAPL"), /AAPL is not in the NVDA and AMD comparison/);
  assert.match(await ask("Drop NVDA and AMD"), /Dropping NVDA and AMD leaves no company/);
});
