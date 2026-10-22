import assert from "node:assert/strict";
import test from "node:test";
import { createChatCoordinator, type ChatTurnRunContext } from "../src/coordinator.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";

const LISTING: Record<string, string> = {
  NVDA: "62000000-0000-4000-8000-000000000001",
  AMD: "62000000-0000-4000-8000-000000000002",
  AAPL: "62000000-0000-4000-8000-000000000003",
  T: "62000000-0000-4000-8000-000000000004",
};
const resolved = (ticker: string) => ({
  status: "resolved", input_text: ticker, normalized_input: ticker, subject_ref: { kind: "listing", id: LISTING[ticker] }, identity_level: "listing", display_label: ticker,
  resolution_path: "auto_advanced", confidence: 0.95,
  handoff: { subject_ref: { kind: "listing", id: LISTING[ticker] }, identity_level: "listing", display_label: ticker, display_labels: { primary: ticker }, normalized_input: ticker, resolution_path: "auto_advanced", confidence: 0.95, context: {} },
}) as unknown as ChatSubjectPreResolution;
const preResolveSubject = async ({ text }: { text: string }): Promise<ChatSubjectPreResolution> =>
  LISTING[text] ? resolved(text) : ({ status: "not_found", input_text: text, normalized_input: text, message: "no" } as ChatSubjectPreResolution);

async function covered(userIntent: string, prior: string[] = []) {
  let observed: ChatTurnRunContext | null = null;
  const turn = createChatCoordinator({
    preResolveSubject,
    runner: (context) => {
      observed = context;
      context.emit("turn.completed", { message_id: "m" });
    },
    readQuestion: async () => null,
    loadPriorSubjects: async () => prior.map(resolved) as never,
  }).getOrCreateTurn({ threadId: "thread-1", runId: `run-${Math.random()}`, userIntent });
  await turn.completed;
  const context = observed as ChatTurnRunContext | null;
  return { tickers: (context?.subjectPreResolutions ?? []).map((subject) => subject.input_text), notFound: context?.unresolvedMentions ?? [] };
}

test("a ticker written inside a longer token is still a company the message names", async () => {
  for (const question of ["Compare $NVDA and $AMD", "Compare NVDA/AMD revenue", "Compare **NVDA** and **AMD**", "Compare [NVDA] and [AMD]", "Compare NVDA-AMD", "Compare NYSE:NVDA and AMD", "Compare #NVDA and AMD", "Compare NVDA vs.AMD"]) {
    assert.deepEqual((await covered(question)).tickers, ["NVDA", "AMD"], question);
  }
  assert.deepEqual((await covered("Compare NVDA/AMD revenue", ["AAPL"])).tickers, [], "after an AAPL answer it asks, never answers AAPL alone");
});

test("a dotted or ampersand ticker is resolved or noted, never dropped silently", async () => {
  assert.deepEqual(await covered("Compare BRK.B and NVDA"), { tickers: ["NVDA"], notFound: ["BRK", "B"] });
  assert.deepEqual((await covered("Compare AT&T and NVDA")).tickers, ["T", "NVDA"]);
});
