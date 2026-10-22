import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatCoordinator,
  type ChatAnalystToolRuntime,
  type ChatCoordinatorOptions,
  type ChatTurnRunContext,
} from "../src/coordinator.ts";
import type { CompanyChange } from "../src/research-scope.ts";
import { proposeScope } from "../src/scope-proposal.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { readMessage } from "./read-message-fixture.ts";
import { proposal } from "./scope-fixtures.ts";

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
const reads = (companies: CompanyChange) => ({ readQuestion: async () => proposal({ companies }) });
const asNamed = (...names: string[]) => reads({ kind: "as_named", names });
const compare = (...add: string[]) => reads({ kind: "compare", add });
const drop = (names: string[], add: string[] = []) => reads({ kind: "drop", drop: names, add });

test("a message naming two companies resolves both, in the order written", async () => {
  const { tickers, primary } = await subjectsForTurn("Compare NVDA and AMD");
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
  assert.equal(primary, "NVDA");
});

test("a comparative follow-up keeps the previous answer's companies and adds the new one", async () => {
  const { tickers, primary } = await subjectsForTurn("Compare it with AMD", { loadPriorSubjects: priorOf("NVDA"), ...compare("AMD") });
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
  const { tickers } = await subjectsForTurn("Analyze AAPL and its margins", { loadPriorSubjects: priorOf("NVDA"), ...asNamed("AAPL") });
  assert.deepEqual(tickers, ["AAPL"]);
});

test("the same company named twice or also carried forward is covered once", async () => {
  const { tickers } = await subjectsForTurn("Compare NVDA vs NVDA and AMD", { loadPriorSubjects: priorOf("NVDA"), ...compare("NVDA", "NVDA", "AMD") });
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

test("a follow-up after a five-company answer asks which to keep before adding one", async () => {
  const { tickers, context } = await subjectsForTurn("Compare it with AAPL", {
    loadPriorSubjects: priorOf("NVDA", "AMD", "MSFT", "GOOG", "META"),
    ...compare("AAPL"),
  });
  assert.deepEqual([tickers, context], [[], null]);
});

test("an ambiguous company in a comparison asks which one instead of answering partially", async () => {
  let ran = false;
  const turn = createChatCoordinator({
    preResolveSubject,
    ...compare("GOOGL", "NVDA"),
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
  const turn = createChatCoordinator({ preResolveSubject, analystToolRuntime: runtime, ...compare("NVDA", "XYZQ") })
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
  const { tickers, primary } = await subjectsForTurn("Compare with AMD", compare("AMD"), "NVDA");
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
  assert.equal(primary, "NVDA");
});

test("an explicit subject with a non-comparative message covers that subject only", async () => {
  const { tickers } = await subjectsForTurn("Summarize the quarter for AMD", reads({ kind: "as_named", names: [] }), "NVDA");
  assert.deepEqual(tickers, ["NVDA"]);
});

test("an explicit subject named again in the comparison is covered once, and the cap still holds", async () => {
  assert.deepEqual((await subjectsForTurn("Compare NVDA with AMD", compare("NVDA", "AMD"), "NVDA")).tickers, ["NVDA", "AMD"]);
  const capped = await subjectsForTurn("Compare with AMD AAPL MSFT GOOG META", compare("AMD", "AAPL", "MSFT", "GOOG", "META"), "NVDA");
  assert.deepEqual(capped.tickers, ["NVDA", "AMD", "AAPL", "MSFT", "GOOG"]);
});

test("an explicit subject's comparison asks about an ambiguous company and names one not found", async () => {
  let ran = false;
  const turn = createChatCoordinator({ preResolveSubject, ...compare("GOOGL"), runner: () => { ran = true; } })
    .getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare with GOOGL", subjectText: "NVDA" });
  await turn.completed;
  assert.equal(ran, false);
  assert.match(JSON.stringify(turn.events), /Which Alphabet share class do you mean\?/);

  const { tickers, context } = await subjectsForTurn("Compare with XYZQ", compare("XYZQ"), "NVDA");
  assert.deepEqual(tickers, ["NVDA"]);
  assert.deepEqual(context?.unresolvedMentions, ["XYZQ"]);
});

// #206: a follow-up changes the compared companies only as it says.
test("a follow-up that adds a company keeps the previous ones", async () => {
  const { tickers, primary } = await subjectsForTurn("Add AAPL", { loadPriorSubjects: priorOf("NVDA", "AMD"), ...compare("AAPL") });
  assert.deepEqual(tickers, ["NVDA", "AMD", "AAPL"]);
  assert.equal(primary, "NVDA");
});

test("a follow-up that drops a company keeps the others", async () => {
  const three = { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL") };
  for (const question of ["Drop AMD", "Remove AMD from the comparison", "Compare them without AMD", "Same table, but leave out AMD"]) {
    const { tickers } = await subjectsForTurn(question, { ...three, ...drop(["AMD"]) });
    assert.deepEqual(tickers, ["NVDA", "AAPL"], question);
  }
  // A company named beside the one dropped is added.
  const swapped = await subjectsForTurn("Drop AMD and add TSLA", { ...three, ...drop(["AMD"], ["TSLA"]) });
  assert.deepEqual(swapped.tickers, ["NVDA", "AAPL", "TSLA"]);
  for (const question of ["Drop AMD and AAPL", "Drop AMD, AAPL", "Remove AMD and AAPL from the table"]) {
    const { tickers } = await subjectsForTurn(question, { ...three, ...drop(["AMD", "AAPL"]) });
    assert.deepEqual(tickers, ["NVDA"], question);
  }
  // A company added beside a removal that cannot be found is named, not dropped silently.
  const unfound = await subjectsForTurn("Drop AMD and add XYZQ", { ...three, ...drop(["AMD"], ["XYZQ"]) });
  assert.deepEqual(unfound.tickers, ["NVDA", "AAPL"]);
  assert.deepEqual(unfound.context?.unresolvedMentions, ["XYZQ"]);
  // An addition beside a removal takes the slot it frees.
  const full = await subjectsForTurn("Drop AMD and add TSLA", { loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL", "MSFT", "GOOG"), ...drop(["AMD"], ["TSLA"]) });
  assert.deepEqual(full.tickers, ["NVDA", "AAPL", "MSFT", "GOOG", "TSLA"]);
  // Turning a facet off names no company, so the companies are kept.
  const { tickers } = await subjectsForTurn("Drop the segments", { loadPriorSubjects: priorOf("NVDA", "AMD"), ...asNamed() });
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
});

test("an ambiguous company added beside a removal is asked about", async () => {
  let ran = false;
  const turn = createChatCoordinator({
    preResolveSubject,
    loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL"),
    ...drop(["AMD"], ["GOOGL"]),
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
    ...reads({ kind: "unclear", names: ["AAPL"] }),
    persistAssistantMessage: async (input) => {
      persisted.push(input);
      return readMessage({ snapshot_id: "snapshot-1", message_id: "message-1" });
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
    ...compare("GOOGL", "NVDA"),
    persistAssistantMessage: async (input) => {
      persisted.push(input);
      return readMessage({ snapshot_id: "snapshot-1", message_id: "message-1" });
    },
    runner: () => {},
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare GOOGL and NVDA" });
  await turn.completed;
  const block = (persisted[0]!.blocks as Array<{ id: string; data_ref: unknown }>)[0]!;
  assert.deepEqual(block.data_ref, { kind: "rich_text", id: block.id });
});

test("the reply to that question, or a clear switch, is answered", async () => {
  const two = { loadPriorSubjects: priorOf("NVDA", "AMD") };
  const only = reads({ kind: "only", names: ["AAPL"] });
  assert.deepEqual((await subjectsForTurn("add AAPL", { ...two, ...compare("AAPL") })).tickers, ["NVDA", "AMD", "AAPL"]);
  assert.deepEqual((await subjectsForTurn("just AAPL", { ...two, ...only })).tickers, ["AAPL"]);
  assert.deepEqual((await subjectsForTurn("What about just AAPL?", { ...two, ...only })).tickers, ["AAPL"]);
  // After one company there is no comparison to keep: the new one replaces it.
  const aapl = reads({ kind: "unclear", names: ["AAPL"] });
  assert.deepEqual((await subjectsForTurn("What about AAPL?", { loadPriorSubjects: priorOf("NVDA"), ...aapl })).tickers, ["AAPL"]);
  // A company already compared is not a new one.
  assert.deepEqual((await subjectsForTurn("And what about AMD?", { ...two, ...reads({ kind: "unclear", names: ["AMD"] }) })).tickers, ["AMD"]);
  // One that cannot be found keeps the comparison, and is named.
  const xyzq = await subjectsForTurn("Just XYZQ", { ...two, ...reads({ kind: "only", names: ["XYZQ"] }) });
  assert.deepEqual([xyzq.tickers, xyzq.context?.unresolvedMentions], [["NVDA", "AMD"], ["XYZQ"]]);
});

test("dropping a company the comparison does not have, or every company, is asked about", async () => {
  const ask = async (userIntent: string, reading: ReturnType<typeof reads>) => {
    let ran = false;
    const turn = createChatCoordinator({
      preResolveSubject,
      loadPriorSubjects: priorOf("NVDA", "AMD"),
      ...reading,
      runner: () => {
        ran = true;
      },
    }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent });
    await turn.completed;
    assert.equal(ran, false, userIntent);
    return JSON.stringify(turn.events);
  };
  assert.match(await ask("drop AAPL", drop(["AAPL"])), /AAPL is not in the NVDA and AMD comparison/);
  assert.match(await ask("Drop NVDA and AMD", drop(["NVDA", "AMD"])), /Dropping NVDA and AMD leaves no company/);
});

test("dropping a company that cannot be found, or is ambiguous, is asked about", async () => {
  const run = async (userIntent: string, reading: ReturnType<typeof reads>) => {
    let ran = false;
    const turn = createChatCoordinator({
      preResolveSubject,
      loadPriorSubjects: priorOf("NVDA", "AMD"),
      ...reading,
      runner: () => {
        ran = true;
      },
    }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent });
    await turn.completed;
    return { ran, events: JSON.stringify(turn.events) };
  };
  const unknown = await run("drop XYZQ", drop(["XYZQ"]));
  assert.equal(unknown.ran, false);
  assert.match(unknown.events, /XYZQ was not found, so nothing was dropped from the NVDA and AMD comparison/);
  const ambiguous = await run("drop GOOGL", drop(["GOOGL"]));
  assert.equal(ambiguous.ran, false);
  assert.match(ambiguous.events, /Which Alphabet share class do you mean\?/);
  // A metric or facet in capitals is not a company to drop.
  assert.equal((await run("Drop the FCF", asNamed())).ran, true);
  const fragment = await run("Drop NET", drop(["NET"]));
  assert.equal(fragment.ran, false);
  assert.match(fragment.events, /NET was not found, so nothing was dropped from the NVDA and AMD comparison/);
});

test("a metric named in capitals is dropped as the metric, not asked about as a company (#378 review)", async () => {
  const comparison = { loadPriorSubjects: priorOf("NVDA", "AMD") };
  assert.deepEqual((await subjectsForTurn("Drop BALANCE SHEET", { ...comparison, ...asNamed() })).tickers, ["NVDA", "AMD"]);
  assert.deepEqual((await subjectsForTurn("Drop FREE CASH FLOW", { ...comparison, ...asNamed() })).tickers, ["NVDA", "AMD"]);
  assert.deepEqual((await subjectsForTurn("Drop AMD and the FREE CASH FLOW", { ...comparison, ...drop(["AMD"]) })).tickers, ["NVDA"]);
  const { tickers, context } = await subjectsForTurn("Drop NET", { ...comparison, ...drop(["NET"]) });
  assert.deepEqual([tickers, context], [[], null]);
});

test("a ticker inside a metric's name is the metric, unless the comparison covers that company (#382)", async () => {
  // CASH is a real ticker (Pathward), so the production resolver resolves it.
  const withCash = async ({ text }: { text: string }) => (text === "CASH" ? { ...resolved("NOW"), input_text: text } : preResolveSubject({ text }));
  const comparison = { preResolveSubject: withCash, loadPriorSubjects: priorOf("NVDA", "AMD") };
  assert.deepEqual((await subjectsForTurn("Drop FREE CASH FLOW", { ...comparison, ...asNamed() })).tickers, ["NVDA", "AMD"]);
  assert.deepEqual((await subjectsForTurn("Drop AMD and the FREE CASH FLOW", { ...comparison, ...drop(["AMD"]) })).tickers, ["NVDA"]);
  assert.deepEqual((await subjectsForTurn("Drop FREE CASH FLOW and add TSLA", { ...comparison, ...compare("TSLA") })).tickers, ["NVDA", "AMD", "TSLA"]);
  // Nor are the metric's other words companies the answer could not find.
  assert.deepEqual((await subjectsForTurn("Drop FREE CASH FLOW", { ...comparison, ...asNamed() })).context?.unresolvedMentions, []);
  assert.deepEqual((await subjectsForTurn("Drop AMD and the FREE CASH FLOW", { ...comparison, ...drop(["AMD"]) })).context?.unresolvedMentions, []);
  // With no comparison before, the turn is not about Pathward.
  const fresh = { preResolveSubject: withCash, loadPriorSubjects: priorOf() };
  assert.deepEqual((await subjectsForTurn("Drop FREE CASH FLOW", { ...fresh, ...asNamed() })).tickers, []);
  // With no reading too: CASH, FREE and FLOW lie in the metric's name, so none is looked up or noted.
  const unread = await subjectsForTurn("Drop FREE CASH FLOW", { ...comparison, readQuestion: async () => null });
  assert.deepEqual([unread.tickers, unread.context?.unresolvedMentions], [["NVDA", "AMD"], []]);
  const covered = { preResolveSubject: withCash, loadPriorSubjects: priorOf("NVDA", "NOW") };
  assert.deepEqual((await subjectsForTurn("Drop CASH", { ...covered, ...drop(["CASH"]) })).tickers, ["NVDA"]);
});

test("a question naming a company with no word about earlier ones answers it alone", async () => {
  const { tickers } = await subjectsForTurn("What is AAPL's revenue?", { loadPriorSubjects: priorOf("NVDA"), ...asNamed("AAPL") });
  assert.deepEqual(tickers, ["AAPL"]);
  const { tickers: kept } = await subjectsForTurn("Why?", { loadPriorSubjects: priorOf("NVDA", "AMD"), ...asNamed() });
  assert.deepEqual(kept, ["NVDA", "AMD"]);
});

test("a company that cannot be found is asked about when the removal also names a facet (#275)", async () => {
  let ran = false;
  const turn = createChatCoordinator({
    preResolveSubject,
    loadPriorSubjects: priorOf("NVDA", "AMD", "AAPL"),
    ...drop(["AMD", "XYZQ"]),
    runner: () => {
      ran = true;
    },
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "drop AMD, XYZQ, and margins" });
  await turn.completed;
  assert.equal(ran, false);
  assert.match(JSON.stringify(turn.events), /XYZQ was not found, so nothing was dropped from the NVDA, AMD and AAPL comparison\./);
});

// The events of a turn that asks instead of answering.
async function askedFor(userIntent: string, options: Partial<ChatCoordinatorOptions> = {}): Promise<string> {
  let ran = false;
  const turn = createChatCoordinator({ preResolveSubject, ...options, runner: () => { ran = true; } })
    .getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent });
  await turn.completed;
  assert.equal(ran, false, `answered: ${userIntent}`);
  return JSON.stringify(turn.events);
}

test("with no reading, a follow-up keeps the previous companies unless it names a new one", async () => {
  const two = { loadPriorSubjects: priorOf("NVDA", "AMD") };
  assert.deepEqual((await subjectsForTurn("Why?", two)).tickers, ["NVDA", "AMD"], "naming none");
  assert.deepEqual((await subjectsForTurn("Drop AMD", two)).tickers, ["NVDA", "AMD"], "naming only the previous ones");
  const fresh = await subjectsForTurn("Compare NVDA and XYZQ", { loadPriorSubjects: priorOf() });
  assert.deepEqual([fresh.tickers, fresh.context?.unresolvedMentions], [["NVDA"], ["XYZQ"]], "a fresh question names the one not found");
  assert.deepEqual((await subjectsForTurn("Compare with AMD", {}, "NVDA")).tickers, ["NVDA"], "the page's company alone");
  const failing = { readQuestion: async () => { throw new Error("provider down"); } };
  assert.deepEqual((await subjectsForTurn("Drop AMD", { ...two, ...failing })).tickers, ["NVDA", "AMD"], "a reading that failed");
});

test("with no reading, a new company named after any previous answer is asked about, never added, dropped or switched to", async () => {
  assert.match(await askedFor("Compare it with AAPL", { loadPriorSubjects: priorOf("NVDA", "AMD") }), /Add AAPL to the NVDA and AMD comparison, or look at AAPL alone\?/);
  const one = { loadPriorSubjects: priorOf("NVDA") };
  for (const [question, named] of [["Drop AMD", "AMD"], ["Compare it with AMD", "AMD"], ["add TSLA", "TSLA"]]) {
    assert.match(await askedFor(question!, one), new RegExp(`Add ${named} to NVDA, or look at ${named} alone\\? Say \\\\"add ${named}\\\\" or \\\\"just ${named}\\\\"`), question);
  }
  // CASH is a real ticker (Pathward), but written only inside a metric's name it is the metric.
  const withCash = async ({ text }: { text: string }) => (text === "CASH" ? { ...resolved("NOW"), input_text: text } : preResolveSubject({ text }));
  assert.deepEqual((await subjectsForTurn("Drop FREE CASH FLOW", { ...one, preResolveSubject: withCash })).tickers, ["NVDA"]);
});

test("with no reading, an ambiguous company in a fresh question is asked about", async () => {
  assert.match(await askedFor("Compare GOOGL and NVDA", { loadPriorSubjects: priorOf() }), /Which Alphabet share class do you mean\?/);
});

test("adding companies past the cap asks which to keep, instead of dropping one silently", async () => {
  const cap = /An answer covers at most 5 companies/;
  const two = { loadPriorSubjects: priorOf("NVDA", "AMD") };
  assert.match(await askedFor("Compare it with AAPL MSFT GOOG META TSLA", { ...two, ...compare("AAPL", "MSFT", "GOOG", "META", "TSLA") }), cap);
  const five = { loadPriorSubjects: priorOf("NVDA", "AMD", "MSFT", "GOOG", "META") };
  assert.match(await askedFor("Compare it with AAPL", { ...five, ...compare("AAPL") }), /An answer covers at most 5 companies, and NVDA, AMD, MSFT, GOOG, META and AAPL are 6\./);
  assert.match(await askedFor("Drop AMD and add AAPL and TSLA", { ...five, ...drop(["AMD"], ["AAPL", "TSLA"]) }), cap);
  // Five in all is not past it.
  assert.deepEqual((await subjectsForTurn("Drop AMD and add AAPL", { ...five, ...drop(["AMD"], ["AAPL"]) })).tickers, ["NVDA", "MSFT", "GOOG", "META", "AAPL"]);
});

test("a drop read with no previous answer asks, as there is nothing to drop from", async () => {
  // XYZQ is not found, so the turn waits on its reading.
  const reading = drop(["AMD", "XYZQ"]);
  assert.match(await askedFor("Drop AMD and XYZQ", { loadPriorSubjects: priorOf(), ...reading }), /There is no previous answer to drop AMD and XYZQ from\./);
  assert.match(await askedFor("Drop AMD and XYZQ", reading), /There is no previous answer to drop AMD and XYZQ from\./);
});

test("dropping the only company while adding another answers the one added", async () => {
  assert.deepEqual((await subjectsForTurn("Drop AMD and add TSLA", { loadPriorSubjects: priorOf("AMD"), ...drop(["AMD"], ["TSLA"]) })).tickers, ["TSLA"]);
});

test("dropping and adding the same company asks which", async () => {
  assert.match(await askedFor("Drop AMD and add AMD", { loadPriorSubjects: priorOf("NVDA", "AMD"), ...drop(["AMD"], ["AMD"]) }), /AMD is both dropped and added, so nothing was changed\./);
});

test("a turn reads its question once, and a fresh question whose names all resolve does not wait on it", async () => {
  const questions: string[] = [];
  const counted = (companies: CompanyChange) => ({ readQuestion: async (question: string) => {
    questions.push(question);
    return proposal({ companies });
  } });
  const lanes = (context: ChatTurnRunContext) => Promise.all([context.reading?.(), context.reading?.()]);
  let seen: unknown;
  const coordinator = createChatCoordinator({
    preResolveSubject,
    loadPriorSubjects: priorOf("NVDA"),
    ...counted({ kind: "compare", add: ["AMD"] }),
    runner: async (context) => {
      seen = (await lanes(context)).map((reading) => reading?.companies);
      context.emit("turn.completed", { message_id: "message-1" });
    },
  });
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Compare it with AMD" }).completed;
  assert.deepEqual([questions, seen], [["Compare it with AMD"], [{ kind: "compare", add: ["AMD"] }, { kind: "compare", add: ["AMD"] }]]);

  questions.length = 0;
  const fresh = await subjectsForTurn("Compare NVDA and AMD", { loadPriorSubjects: priorOf(), ...counted({ kind: "only", names: ["AMD"] }) });
  assert.deepEqual([fresh.tickers, questions], [["NVDA", "AMD"], []]);
});

test("a reading slower than its deadline is no reading: one model call, and the follow-up keeps its companies", async (t) => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  const slow = () => async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { text: "{}" };
  };
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1" };
  const readQuestion = (question: string) => proposeScope({ question, env, createClient: slow, deadlines: { attemptMs: 40, totalMs: 50 } });
  let seen: { tickers: string[]; reading: unknown; at: number } | undefined;
  const started = performance.now();
  const turn = createChatCoordinator({
    preResolveSubject,
    loadPriorSubjects: priorOf("NVDA", "AMD"),
    readQuestion,
    runner: async (context) => {
      seen = { tickers: (context.subjectPreResolutions ?? []).map((subject) => subject.input_text), reading: await context.reading?.(), at: performance.now() - started };
      context.emit("turn.completed", { message_id: "message-1" });
    },
  }).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Drop AMD" });
  await turn.completed;
  assert.deepEqual([seen?.tickers, seen?.reading, calls], [["NVDA", "AMD"], null, 1]);
  assert.ok(seen!.at < 300, `the turn went on at the deadline, not the reply: ${seen!.at} ms`);
});
