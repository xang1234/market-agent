import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatTurnUnavailableError,
  createChatCoordinator,
  type ChatTurnRunner,
} from "../src/coordinator.ts";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

test("per-thread coordinator serializes concurrent turns for the same thread", async () => {
  const firstTurnCanComplete = deferred();
  const secondTurnStarted = deferred();
  const startedRuns: string[] = [];

  const runner: ChatTurnRunner = async ({ runId, emit }) => {
    startedRuns.push(runId);
    emit("turn.started", { stub: true });
    if (runId === "run-1") {
      await firstTurnCanComplete.promise;
    } else {
      secondTurnStarted.resolve();
    }
    emit("turn.completed", { message_id: `message-${runId}` });
  };

  const coordinator = createChatCoordinator({ runner });

  const first = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  const second = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-2" });

  await first.waitForEventCount(1);
  assert.deepEqual(startedRuns, ["run-1"]);
  assert.equal(second.currentSeq(), 0);

  firstTurnCanComplete.resolve();
  await secondTurnStarted.promise;
  await Promise.all([first.completed, second.completed]);

  assert.deepEqual(startedRuns, ["run-1", "run-2"]);
  assert.deepEqual(first.events.map((event) => event.type), ["turn.started", "turn.completed"]);
  assert.deepEqual(second.events.map((event) => event.type), ["turn.started", "turn.completed"]);
});

test("per-thread coordinator drops idle thread queues after completion", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: "message-1" });
    },
  });

  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(coordinator.stats().queuedThreadCount, 0);
});

test("per-thread coordinator bounds completed turn history retention", async () => {
  const completedRuns: string[] = [];
  const coordinator = createChatCoordinator({
    maxCompletedTurns: 1,
    runner: ({ runId, emit }) => {
      completedRuns.push(runId);
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: `message-${runId}` });
    },
  });

  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" }).completed;
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-2" }).completed;

  assert.equal(coordinator.stats().retainedTurnCount, 1);

  assert.throws(
    () => coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" }),
    ChatTurnUnavailableError,
  );
  assert.equal(coordinator.stats().completedTurnTombstoneCount, 1);
  assert.deepEqual(completedRuns, ["run-1", "run-2"]);
});

test("per-thread coordinator keeps distinct turn ids under the same run id separate", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit, turnId }) => {
      emit("turn.started", { label: turnId });
      emit("turn.completed", { message_id: `message-${turnId}` });
    },
  });

  const first = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
  });
  const second = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-2",
  });
  await Promise.all([first.completed, second.completed]);

  assert.notEqual(first, second);
  assert.equal(first.events[0].turn_id, "turn-1");
  assert.equal(second.events[0].turn_id, "turn-2");
});

test("per-thread coordinator normalizes omitted turn id to run id", async () => {
  const startedRuns: string[] = [];
  const coordinator = createChatCoordinator({
    runner: ({ runId, emit }) => {
      startedRuns.push(runId);
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: `message-${runId}` });
    },
  });

  const implicit = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  const explicit = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "run-1",
  });
  await implicit.completed;

  assert.equal(implicit, explicit);
  assert.deepEqual(startedRuns, ["run-1"]);
  assert.equal(implicit.events[0].turn_id, "run-1");
});

test("per-thread coordinator keys NUL-containing identities without collisions", async () => {
  const startedTurns: string[] = [];
  const coordinator = createChatCoordinator({
    runner: ({ runId, turnId, emit }) => {
      startedTurns.push(`${runId}:${turnId}`);
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: `message-${startedTurns.length}` });
    },
  });

  const first = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-a\0turn-b",
  });
  const second = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1\0turn-a",
    turnId: "turn-b",
  });
  await Promise.all([first.completed, second.completed]);

  assert.notEqual(first, second);
  assert.deepEqual(startedTurns, ["run-1:turn-a\0turn-b", "run-1\0turn-a:turn-b"]);
});

test("per-thread coordinator isolates subscriber failures from shared turn execution", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: "message-1" });
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  const observedByHealthySubscriber: string[] = [];

  turn.subscribe(() => {
    throw new Error("client write failed");
  });
  turn.subscribe((event) => {
    observedByHealthySubscriber.push(event.type);
  });

  await turn.completed;

  assert.deepEqual(
    turn.events.map((event) => event.type),
    ["turn.started", "turn.completed"],
  );
  assert.deepEqual(observedByHealthySubscriber, ["turn.started", "turn.completed"]);
});

test("per-thread coordinator exposes event history as a defensive copy", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: "message-1" });
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;

  (turn.events as ChatTurnEventMutation[]).pop();

  assert.equal(turn.currentSeq(), 2);
  assert.deepEqual(
    turn.events.map((event) => event.type),
    ["turn.started", "turn.completed"],
  );
});

test("per-thread coordinator protects stored events from caller mutation", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: "message-1" });
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;

  assert.throws(() => {
    (turn.events[0] as { seq: number }).seq = 999;
  });

  assert.equal(turn.currentSeq(), 2);
  assert.equal(turn.events[0].seq, 1);
});

test("per-thread coordinator shields later subscribers from event mutation", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: "message-1" });
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  const observedSeqs: number[] = [];

  turn.subscribe((event) => {
    (event as { seq: number }).seq = 999;
  });
  turn.subscribe((event) => {
    observedSeqs.push(event.seq);
  });

  await turn.completed;

  assert.deepEqual(observedSeqs, [1, 2]);
  assert.equal(turn.currentSeq(), 2);
});

test("per-thread coordinator clones nested payloads before freezing retained events", async () => {
  const delta = { segment: { type: "text", text: "original" } };
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("block.delta", {
        block_id: "block-1",
        delta,
      });
      delta.segment.text = "mutated-after-emit";
      emit("turn.completed", { message_id: "message-1" });
    },
  });

  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;

  assert.equal(delta.segment.text, "mutated-after-emit");
  assert.deepEqual((turn.events[0].delta as typeof delta).segment, {
    type: "text",
    text: "original",
  });
  assert.deepEqual(
    turn.events.map((event) => event.type),
    ["block.delta", "turn.completed"],
  );
});

test("default turn runner persists assistant message before snapshot.sealed", async () => {
  const steps: string[] = [];
  const coordinator = createChatCoordinator({
    persistAssistantMessage: async ({ threadId, role, blocks, content_hash }) => {
      steps.push(`persist:${threadId}:${role}:${content_hash}:${blocks.length}`);
      return {
        snapshot_id: "22222222-2222-4222-a222-222222222222",
        message_id: "33333333-3333-4333-a333-333333333333",
      };
    },
  });

  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;

  assert.deepEqual(steps, ["persist:thread-1:assistant:stub-block-1:1"]);
  assert.deepEqual(
    turn.events.map((event) => event.type),
    [
      "turn.started",
      "tool.started",
      "tool.completed",
      "snapshot.staged",
      "snapshot.sealed",
      "block.began",
      "block.delta",
      "block.completed",
      "turn.completed",
    ],
  );
  assert.equal(turn.events[4].snapshot_id, "22222222-2222-4222-a222-222222222222");
  assert.equal(turn.events[8].message_id, "33333333-3333-4333-a333-333333333333");
});

test("default turn runner emits turn.error when assistant message persistence fails", async () => {
  const coordinator = createChatCoordinator({
    persistAssistantMessage: async () => {
      throw new Error("snapshot seal failed");
    },
  });

  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;

  assert.deepEqual(
    turn.events.map((event) => event.type),
    ["turn.started", "tool.started", "tool.completed", "snapshot.staged", "turn.error"],
  );
  assert.equal(turn.events[4].error_code, "Error");
});

type ChatTurnEventMutation = {
  type: string;
  seq: number;
};
