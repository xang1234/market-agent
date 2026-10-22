import assert from "node:assert/strict";
import test from "node:test";

import { answerMessageId } from "../src/chat-ids.ts";
import {
  createChatCoordinator,
  type ChatAnalystToolRuntime,
  type ChatAssistantMessagePersistenceInput,
  type ChatCoordinatorOptions,
} from "../src/coordinator.ts";
import { ChatSnapshotSealError } from "../src/messages.ts";
import type { ChatSseEvent } from "../src/sse.ts";
import { readMessage } from "./read-message-fixture.ts";

const SNAPSHOT = "11111111-1111-4111-a111-111111111111";
const SEALED_SNAPSHOT = "22222222-2222-4222-a222-222222222222";
const FACT = "33333333-3333-4333-a333-333333333333";
const PROOFS = { "block-answer": { evidence: "linked" as const, calculation: "not_verified" as const, public_by_cutoff: "unknown" as const } };

const answer = (segments: ReadonlyArray<Record<string, unknown>>) => ({
  id: "block-answer",
  kind: "rich_text",
  snapshot_id: SNAPSHOT,
  data_ref: { kind: "rich_text", id: "block-answer" },
  source_refs: ["s-1"],
  as_of: "2026-05-06T00:00:00.000Z",
  segments,
});
const FIGURE = { type: "ref", ref_kind: "fact", ref_id: FACT, format: "$55.2B" };
const PENDING = { type: "text", text: "> _Checking an analyst inference against the figures it rests on…_" };
const CONCENTRATED = { type: "text", text: "> **Analyst inference:** Revenue is concentrated in one segment." };
const SHOWN = answer([{ type: "text", text: "Data Center revenue was " }, FIGURE, { type: "text", text: ".\n\n" }, PENDING, { type: "text", text: "\n\n" }, PENDING]);
// The first inference's verdict is in, the second's not yet.
const HALF = answer([{ type: "text", text: "Data Center revenue was " }, FIGURE, { type: "text", text: ".\n\n" }, CONCENTRATED, { type: "text", text: "\n\n" }, PENDING]);
const SAVED = answer([{ type: "text", text: "Data Center revenue was " }, FIGURE, { type: "text", text: ".\n\n" }, CONCENTRATED]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Blocks = ReadonlyArray<Record<string, unknown>>;

// A runtime whose answer waits on the judge: `verdict` settles one inference,
// and `judged` the last.
function judgedRuntime() {
  let current: Blocks = [SHOWN];
  const listeners: Array<(blocks: Blocks) => void> = [];
  const done = deferred<{ blocks: Blocks }>();
  const verdict = (blocks: Blocks) => {
    current = blocks;
    for (const listener of listeners) listener(blocks);
  };
  const runtime: ChatAnalystToolRuntime = async () => ({
    snapshot_id: SNAPSHOT,
    verification: { ok: true, failures: [] },
    tool_calls: [],
    blocks: [SHOWN],
    judging: {
      watch: (listener) => {
        listeners.push(listener);
        listener(current);
      },
      done: done.promise,
    },
  });
  const judged = {
    resolve: (answer: { blocks: Blocks }) => {
      verdict(answer.blocks);
      done.resolve(answer);
    },
  };
  return { runtime, verdict, judged };
}

function start(options: ChatCoordinatorOptions) {
  const coordinator = createChatCoordinator(options);
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userIntent: "Break down NVDA's revenue by segment" });
  const until = (type: string) => new Promise<void>((resolve) => {
    if (turn.events.some((event) => event.type === type)) return resolve();
    const stop = turn.subscribe((event) => {
      if (event.type !== type) return;
      stop();
      resolve();
    });
  });
  return { turn, until };
}

const types = (events: ReadonlyArray<ChatSseEvent>) => events.map((event) => event.type);

test("an answer whose inferences the judge reads is shown sealed, a line in each one's place, shown again as each verdict settles, and saved once the judge is done with those it shows", async () => {
  const { runtime, verdict, judged } = judgedRuntime();
  const sealed: unknown[] = [];
  const saved: unknown[] = [];
  const { turn, until } = start({
    analystToolRuntime: runtime,
    persistAssistantMessage: async (input: ChatAssistantMessagePersistenceInput) => {
      sealed.push(input.blocks);
      const revealed = await input.reveal!({ snapshot_id: SEALED_SNAPSHOT, block_proofs: PROOFS });
      saved.push(revealed.blocks);
      return readMessage({ message_id: input.message_id, snapshot_id: SEALED_SNAPSHOT, blocks: revealed.blocks as never, block_proofs: PROOFS });
    },
  });

  await until("answer.shown");
  assert.deepEqual(types(turn.events), ["turn.started", "snapshot.staged", "snapshot.sealed", "answer.shown"]);
  const shown = turn.events.at(-1)!;
  assert.deepEqual(
    { message_id: shown.message_id, snapshot_id: shown.snapshot_id, blocks: shown.blocks, block_proofs: shown.block_proofs },
    { message_id: answerMessageId("thread-1", "run-1", "run-1"), snapshot_id: SEALED_SNAPSHOT, blocks: [SHOWN], block_proofs: PROOFS },
  );
  assert.deepEqual(saved, []);

  verdict([HALF]);
  judged.resolve({ blocks: [SAVED] });
  await turn.completed;
  assert.deepEqual(types(turn.events), ["turn.started", "snapshot.staged", "snapshot.sealed", "answer.shown", "answer.shown", "answer.shown", "turn.completed"]);
  assert.deepEqual(
    turn.events.filter((event) => event.type === "answer.shown").map(({ message_id, snapshot_id, blocks, block_proofs }) => ({ message_id, snapshot_id, blocks, block_proofs })),
    [[SHOWN], [HALF], [SAVED]].map((blocks) => ({ message_id: answerMessageId("thread-1", "run-1", "run-1"), snapshot_id: SEALED_SNAPSHOT, blocks, block_proofs: PROOFS })),
  );
  assert.deepEqual([sealed, saved], [[[SHOWN]], [[SAVED]]]);
  const completed = turn.events.at(-1)!;
  assert.deepEqual((completed.message as { blocks: unknown }).blocks, [SAVED]);
  assert.equal(completed.message_id, answerMessageId("thread-1", "run-1", "run-1"));
});

test("a verdict that settles before the seal is in the first answer shown", async () => {
  const { runtime, verdict, judged } = judgedRuntime();
  verdict([HALF]);
  const sealing = deferred<void>();
  const { turn, until } = start({
    analystToolRuntime: runtime,
    persistAssistantMessage: async (input: ChatAssistantMessagePersistenceInput) => {
      await sealing.promise;
      const revealed = await input.reveal!({ snapshot_id: SEALED_SNAPSHOT, block_proofs: PROOFS });
      return readMessage({ message_id: input.message_id, snapshot_id: SEALED_SNAPSHOT, blocks: revealed.blocks as never, block_proofs: PROOFS });
    },
  });
  sealing.resolve();
  await until("answer.shown");
  assert.deepEqual(turn.events.filter((event) => event.type === "answer.shown").map((event) => event.blocks), [[HALF]]);
  judged.resolve({ blocks: [SAVED] });
  await turn.completed;
  assert.deepEqual(turn.events.filter((event) => event.type === "answer.shown").map((event) => event.blocks), [[HALF], [SAVED]]);
});

test("an answer whose inferences the judge reads shows nothing when its seal fails", async () => {
  const { runtime, judged } = judgedRuntime();
  judged.resolve({ blocks: [SAVED] });
  const { turn } = start({
    analystToolRuntime: runtime,
    persistAssistantMessage: async () => {
      throw new ChatSnapshotSealError([{ reason_code: "fact_ref_format_mismatch" }]);
    },
  });
  await turn.completed;
  assert.deepEqual(types(turn.events), ["turn.started", "turn.error"]);
});

test("an answer shown before it is saved ends in turn.error when the save fails", async () => {
  const { runtime, judged } = judgedRuntime();
  judged.resolve({ blocks: [SAVED] });
  const { turn } = start({
    analystToolRuntime: runtime,
    persistAssistantMessage: async (input) => {
      await input.reveal!({ snapshot_id: SEALED_SNAPSHOT, block_proofs: PROOFS });
      throw new Error("connection terminated");
    },
  });
  await turn.completed;
  assert.deepEqual(types(turn.events), ["turn.started", "snapshot.staged", "snapshot.sealed", "answer.shown", "turn.error"]);
});

test("display_unverified shows a failed seal's answer as it would be saved, its inferences judged", async () => {
  const { runtime, judged } = judgedRuntime();
  judged.resolve({ blocks: [SAVED] });
  const { turn } = start({
    analystToolRuntime: runtime,
    verificationMode: "display_unverified",
    persistAssistantMessage: async () => {
      throw new ChatSnapshotSealError([{ reason_code: "fact_ref_format_mismatch" }]);
    },
  });
  await turn.completed;
  const completed = turn.events.at(-1)!;
  assert.equal(completed.type, "turn.completed");
  assert.deepEqual((completed.unverified as { blocks: unknown }).blocks, [SAVED]);
  assert.equal(types(turn.events).includes("answer.shown"), false);
});

test("with nothing to save to, the turn waits for the judge and streams the answer it would have saved", async () => {
  const { runtime, judged } = judgedRuntime();
  judged.resolve({ blocks: [SAVED] });
  const { turn } = start({ analystToolRuntime: runtime });
  await turn.completed;
  assert.deepEqual(types(turn.events), ["turn.started", "snapshot.staged", "snapshot.sealed", "block.began", "block.delta", "block.delta", "block.delta", "block.delta", "block.completed", "turn.completed"]);
  assert.deepEqual(turn.events.filter((event) => event.type === "block.delta").map((event) => (event.delta as { segment: unknown }).segment), SAVED.segments);
});
