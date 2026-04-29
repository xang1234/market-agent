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
