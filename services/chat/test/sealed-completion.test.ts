// turn.completed carries the sealed message whenever a turn wrote one (#331):
// the persistence hook's read message, on every path that persists.
import assert from "node:assert/strict";
import test from "node:test";

import { createChatCoordinator, type ChatAnalystToolRuntime, type ChatCoordinatorOptions } from "../src/coordinator.ts";
import type { ChatFinancialRuntime, ChatFinancialTurn } from "../src/financial-runtime.ts";
import { readMessage } from "./read-message-fixture.ts";

const SEALED = readMessage({
  message_id: "33333333-3333-4333-a333-333333333333",
  snapshot_id: "22222222-2222-4222-a222-222222222222",
  blocks: [{ id: "block-1", kind: "rich_text", segments: [{ type: "text", text: "Sealed." }] }],
  block_proofs: { "block-1": { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" } },
});

const SEALED_WIRE = {
  message_id: "33333333-3333-4333-a333-333333333333",
  thread_id: "thread-1",
  role: "assistant",
  snapshot_id: "22222222-2222-4222-a222-222222222222",
  blocks: [{ id: "block-1", kind: "rich_text", segments: [{ type: "text", text: "Sealed." }] }],
  content_hash: "sha256:fixture",
  created_at: "2026-05-06T00:00:00.000Z",
  answered_by: null,
  block_proofs: { "block-1": { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" } },
};

const verifiedRuntime: ChatAnalystToolRuntime = async (context) => ({
  snapshot_id: "11111111-1111-4111-a111-111111111111",
  verification: { ok: true, failures: [] },
  tool_calls: [],
  blocks: [{
    id: "block-1",
    kind: "rich_text",
    snapshot_id: "11111111-1111-4111-a111-111111111111",
    data_ref: { kind: "chat_turn", id: context.turnId ?? context.runId },
    source_refs: [],
    as_of: "2026-05-06T00:00:00.000Z",
    segments: [{ type: "text", text: "Sealed." }],
  }],
});

function financialRuntime(turn: ChatFinancialTurn): ChatFinancialRuntime {
  return { answers: () => true, run: async () => turn, assertReady: async () => {} };
}

const ambiguous: ChatCoordinatorOptions["preResolveSubject"] = async ({ text }) => ({
  status: "needs_clarification",
  input_text: text,
  normalized_input: "GOOG",
  ambiguity_axis: "multiple_listings",
  message: "Which GOOG do you mean?",
  candidates: [
    { subject_ref: { kind: "listing", id: "11111111-1111-4111-a111-111111111111" }, display_name: "GOOG (Class C)", confidence: 0.55 },
    { subject_ref: { kind: "listing", id: "22222222-2222-4222-a222-222222222222" }, display_name: "GOOGL (Class A)", confidence: 0.45 },
  ],
});

async function completion(options: ChatCoordinatorOptions) {
  const turn = createChatCoordinator(options).getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Analyze GOOG" });
  await turn.completed;
  const events = turn.events as ReadonlyArray<Record<string, unknown> & { type: string }>;
  const completed = events.find((event) => event.type === "turn.completed");
  assert.ok(completed, `no turn.completed; events: ${events.map((event) => event.type).join(", ")}`);
  return { completed, events };
}

const persistSealed = async () => SEALED;

const PERSISTED_PATHS: ReadonlyArray<[string, ChatCoordinatorOptions]> = [
  ["a verified answer", { analystToolRuntime: verifiedRuntime }],
  ["a subject clarification", { analystToolRuntime: verifiedRuntime, preResolveSubject: ambiguous }],
  ["a financial clarification", {
    analystToolRuntime: verifiedRuntime,
    financialRuntime: financialRuntime({
      kind: "clarification",
      clarification: { clarification_id: "c1", kind: "subject", question: "Which company?", choices: [] } as never,
    }),
  }],
  ["a financial gap", {
    analystToolRuntime: verifiedRuntime,
    financialRuntime: financialRuntime({ kind: "gap", reason_code: "run_failed", text: "The calculation could not be completed." }),
  }],
];

for (const [path, options] of PERSISTED_PATHS) {
  test(`${path}'s turn.completed carries the message the hook persisted`, async () => {
    const { completed, events } = await completion({ ...options, persistAssistantMessage: persistSealed });
    assert.equal(completed.message_id, "33333333-3333-4333-a333-333333333333");
    assert.deepEqual(JSON.parse(JSON.stringify(completed.message)), SEALED_WIRE);
    assert.deepEqual(
      events.filter((event) => event.type === "snapshot.sealed").map((event) => event.snapshot_id),
      ["22222222-2222-4222-a222-222222222222"],
    );
  });
}

// #332 relies on this: until a turn's answer is saved, its stream carries no
// answer block, so a client attached from a messages read that already holds the
// answer never shows it twice.
const ANSWER_EVENTS = new Set(["block.began", "block.delta", "block.completed", "turn.completed"]);

// The turn's event types when `commit` ran, and its answer events at the end.
async function eventsAtCommit(build: (commit: () => void) => ChatCoordinatorOptions) {
  let atCommit: string[] | null = null;
  const coordinator = createChatCoordinator(build(() => {
    atCommit = turn.events.map((event) => event.type);
  }));
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Analyze GOOG" });
  await turn.completed;
  return { atCommit: atCommit as string[] | null, after: turn.events.map((event) => event.type).filter((type) => ANSWER_EVENTS.has(type)) };
}

for (const [path, options] of PERSISTED_PATHS) {
  test(`${path} saves its answer before it emits any answer block`, async () => {
    const { atCommit, after } = await eventsAtCommit((commit) => ({
      ...options,
      persistAssistantMessage: async () => (commit(), SEALED),
    }));
    assert.ok(atCommit, "the answer was saved");
    assert.deepEqual(atCommit.filter((type) => ANSWER_EVENTS.has(type)), []);
    assert.equal(after.at(-1), "turn.completed");
    assert.ok(after.includes("block.began"));
  });
}

test("a published financial answer is committed before it emits any answer block", async () => {
  const published = readMessage({ message_id: "44444444-4444-4444-a444-444444444444", snapshot_id: "55555555-5555-4555-a555-555555555555", blocks: [{ id: "financial-block-1", kind: "financial_answer" }] });
  const { atCommit, after } = await eventsAtCommit((commit) => ({
    analystToolRuntime: verifiedRuntime,
    financialRuntime: {
      answers: () => true,
      assertReady: async () => {},
      run: async () => (commit(), { kind: "published", run_id: "run-9", message_id: "44444444-4444-4444-a444-444444444444", message: published }),
    },
  }));
  assert.deepEqual(atCommit, ["turn.started"]);
  assert.deepEqual(after, ["block.began", "block.completed", "turn.completed"]);
});

test("a financial answer published in its own transaction completes with that message", async () => {
  const published = readMessage({
    message_id: "44444444-4444-4444-a444-444444444444",
    snapshot_id: "55555555-5555-4555-a555-555555555555",
    blocks: [{ id: "financial-block-1", kind: "financial_answer" }],
    block_proofs: { "financial-block-1": { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" } },
  });
  const { completed, events } = await completion({
    analystToolRuntime: verifiedRuntime,
    financialRuntime: financialRuntime({ kind: "published", run_id: "run-9", message_id: "44444444-4444-4444-a444-444444444444", message: published }),
    persistAssistantMessage: async () => assert.fail("the publication transaction already wrote the message"),
  });

  assert.deepEqual(completed.message, published);
  assert.equal(completed.message_id, "44444444-4444-4444-a444-444444444444");
  assert.deepEqual(completed.financial, { run_id: "run-9" });
  assert.deepEqual(
    events.filter((event) => event.type !== "turn.started" && event.type !== "turn.completed").map((event) => [event.type, event.snapshot_id ?? event.block_id]),
    [["snapshot.sealed", "55555555-5555-4555-a555-555555555555"], ["block.began", "financial-block-1"], ["block.completed", "financial-block-1"]],
  );
});

test("a coordinator without persistence completes with its own message id and no message", async () => {
  const { completed } = await completion({ analystToolRuntime: verifiedRuntime });
  assert.equal(completed.message_id, "c1e13554-66f8-43f9-8f14-73fa76ded5e4");
  assert.equal("message" in completed, false);

  const { completed: gap } = await completion({
    analystToolRuntime: verifiedRuntime,
    financialRuntime: financialRuntime({ kind: "gap", reason_code: "run_failed", text: "The calculation could not be completed." }),
  });
  assert.equal(gap.message_id, "3480e4c6-be0f-4ea0-8676-fa438d9ccda4");
  assert.equal("message" in gap, false);
});

test("a persistence hook that resolves to another thread's message, or a user message, fails the turn on its contract", async () => {
  const errors = await Promise.all([
    { thread_id: "thread-2" },
    { role: "user" as const },
  ].map(async (wrong) => {
    const turn = createChatCoordinator({ analystToolRuntime: verifiedRuntime, persistAssistantMessage: async () => ({ ...SEALED, ...wrong }) })
      .getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Analyze GOOG" });
    await turn.completed;
    const last = turn.events.at(-1) as Record<string, unknown> & { type: string };
    return [last.type, last.error_code, last.message];
  }));
  assert.deepEqual(errors, [
    ["turn.error", "ChatPersistenceContractError", "persistAssistantMessage must resolve to the assistant message it saved in thread thread-1; it returned role \"assistant\" in thread thread-2"],
    ["turn.error", "ChatPersistenceContractError", "persistAssistantMessage must resolve to the assistant message it saved in thread thread-1; it returned role \"user\" in thread thread-1"],
  ]);
});
