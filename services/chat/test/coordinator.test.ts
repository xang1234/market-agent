import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatTurnInputMismatchError,
  ChatTurnUnavailableError,
  createChatCoordinator,
  type ChatTurnRunContext,
  type ChatTurnRunner,
} from "../src/coordinator.ts";
import type { ChatResolvedSubjectPreResolution } from "../src/subjects.ts";

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

test("per-thread coordinator retains runner turn.started payloads", async () => {
  const observedPayloads: unknown[] = [];
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.started", { subject_resolution: true });
      emit("turn.completed", { message_id: "message-1" });
    },
  });

  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  turn.subscribe((event) => {
    if (event.type === "turn.started") {
      observedPayloads.push(event.subject_resolution);
    }
  });
  await turn.completed;

  assert.equal(turn.events[0].type, "turn.started");
  assert.equal(turn.events[0].subject_resolution, true);
  assert.deepEqual(observedPayloads, [true]);
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

test("per-thread coordinator schedules thread title generation after first assistant exchange", async () => {
  const generated: unknown[] = [];
  const titleJobFinished = deferred();
  const coordinator = createChatCoordinator({
    generateThreadTitle: async (input) => {
      generated.push(input);
      titleJobFinished.resolve();
    },
    runner: ({ emit }) => {
      emit("turn.started", { stub: true });
      emit("block.delta", {
        block_id: "block-1",
        delta: {
          segment: {
            type: "text",
            text: "Apple shares rallied after earnings.",
          },
        },
      });
      emit("turn.completed", { message_id: "message-1" });
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    userIntent: "what happened to Apple after earnings?",
  });
  await turn.completed;
  await titleJobFinished.promise;

  assert.deepEqual(generated, [
    {
      threadId: "thread-1",
      runId: "run-1",
      turnId: "run-1",
      userId: "user-1",
      userIntent: "what happened to Apple after earnings?",
      assistantText: "Apple shares rallied after earnings.",
    },
  ]);
});

test("per-thread coordinator skips thread title generation for clarification turns", async () => {
  const generated: unknown[] = [];
  const coordinator = createChatCoordinator({
    generateThreadTitle: async (input) => {
      generated.push(input);
    },
    runner: ({ emit }) => {
      emit("block.delta", {
        block_id: "block-1",
        delta: {
          segment: {
            type: "text",
            text: "Which share class did you mean?",
          },
        },
      });
      emit("turn.completed", { message_id: "message-1", clarification: true });
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    userIntent: "GOOG",
  });
  await turn.completed;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(generated, []);
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
  assert.deepEqual((turn.events[1].delta as typeof delta).segment, {
    type: "text",
    text: "original",
  });
  assert.deepEqual(
    turn.events.map((event) => event.type),
    ["turn.started", "block.delta", "turn.completed"],
  );
});

test("per-thread coordinator rejects turn reuse with changed subject input", async () => {
  const coordinator = createChatCoordinator({
    runner: ({ emit }) => {
      emit("turn.completed", { message_id: "message-1" });
    },
  });

  const original = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: " AAPL ",
  });
  await original.completed;

  assert.equal(
    coordinator.getOrCreateTurn({
      threadId: "thread-1",
      runId: "run-1",
      subjectText: "AAPL",
    }),
    original,
  );
  assert.throws(
    () =>
      coordinator.getOrCreateTurn({
        threadId: "thread-1",
        runId: "run-1",
        subjectText: "GOOG",
      }),
    ChatTurnInputMismatchError,
  );
  assert.throws(
    () =>
      coordinator.getTurn({
        threadId: "thread-1",
        runId: "run-1",
        subjectText: "GOOG",
      }),
    ChatTurnInputMismatchError,
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
  assert.equal(turn.events[3].snapshot_id, turn.events[4].snapshot_id);
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
    ["turn.started", "tool.started", "tool.completed", "turn.error"],
  );
  assert.equal(turn.events[3].error_code, "Error");
});

test("subject pre-resolution short-circuits ambiguous subjects before custom runners", async () => {
  let runnerCalls = 0;
  const coordinator = createChatCoordinator({
    preResolveSubject: async ({ text }) => ({
      status: "needs_clarification",
      input_text: text,
      normalized_input: "GOOG",
      ambiguity_axis: "multiple_listings",
      candidates: [
        {
          subject_ref: { kind: "listing", id: "11111111-1111-4111-a111-111111111111" },
          display_name: "GOOG (Class C)",
          confidence: 0.55,
        },
        {
          subject_ref: { kind: "listing", id: "22222222-2222-4222-a222-222222222222" },
          display_name: "GOOGL (Class A)",
          confidence: 0.45,
        },
      ],
      message: "Which share class did you mean for GOOG: GOOG (Class C) or GOOGL (Class A)?",
    }),
    runner: ({ emit }) => {
      runnerCalls += 1;
      emit("turn.completed", { message_id: "model-message" });
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "GOOG",
  });
  await turn.completed;

  assert.equal(runnerCalls, 0);
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
  assert.equal(turn.events[2].resolution_status, "needs_clarification");
  assert.equal("subject_ref" in turn.events[2], false);
  assert.match(
    ((turn.events[6].delta as Record<string, unknown>).segment as Record<string, unknown>).text as string,
    /Which share class did you mean for GOOG/,
  );
});

test("subject pre-resolution passes hydrated context and subject text to custom runners", async () => {
  let observedContext: ChatTurnRunContext | null = null;
  const coordinator = createChatCoordinator({
    preResolveSubject: async () => resolvedAaplPreResolution(),
    runner: (context) => {
      observedContext = context;
      context.emit("turn.completed", {
        message_id: "message-1",
        subject_ref: context.subjectPreResolution?.subject_ref,
      });
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "AAPL",
  });
  await turn.completed;

  assert.equal(observedContext?.subjectText, "AAPL");
  assert.equal(observedContext?.subjectPreResolution?.status, "resolved");
  assert.deepEqual(observedContext?.subjectPreResolution?.subject_ref, {
    kind: "listing",
    id: "11111111-1111-4111-a111-111111111111",
  });
  assert.equal(observedContext?.subjectPreResolution?.handoff.context.listing?.ticker, "AAPL");
  assert.deepEqual(turn.events.map((event) => event.type), [
    "turn.started",
    "tool.started",
    "tool.completed",
    "turn.completed",
  ]);
  assert.equal(turn.events[2].resolution_status, "resolved");
  assert.equal((turn.events[2].handoff as Record<string, unknown>).display_label, "AAPL · XNAS — Apple Inc.");
});

test("subject pre-resolution emits resolved handoff before custom runner failures", async () => {
  const coordinator = createChatCoordinator({
    preResolveSubject: async () => resolvedAaplPreResolution(),
    runner: () => {
      throw new Error("model failed before first emit");
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "AAPL",
  });
  await turn.completed;

  assert.deepEqual(turn.events.map((event) => event.type), [
    "turn.started",
    "tool.started",
    "tool.completed",
    "turn.error",
  ]);
  assert.equal(turn.events[2].resolution_status, "resolved");
  assert.equal((turn.events[2].handoff as Record<string, unknown>).display_label, "AAPL · XNAS — Apple Inc.");
  assert.equal(turn.events[3].message, "model failed before first emit");
});

test("subject clarification turns use the injected renderer before persistence", async () => {
  const persisted: string[] = [];
  const coordinator = createChatCoordinator({
    preResolveSubject: async ({ text }) => ({
      status: "not_found",
      input_text: text,
      normalized_input: "NOTREAL",
      reason: "no_candidates",
      message: 'I could not resolve "NOTREAL" to a known subject.',
    }),
    renderSubjectClarification: ({ preResolution }) => ({
      blocks: [{ type: "text", text: `Custom: ${preResolution.message}` }],
      content_hash: "sha256:custom-clarification",
      text: `Custom: ${preResolution.message}`,
      block_id: "custom-block",
    }),
    persistAssistantMessage: async ({ blocks, content_hash }) => {
      persisted.push(`${content_hash}:${blocks[0].text}`);
      return {
        snapshot_id: "22222222-2222-4222-a222-222222222222",
        message_id: "33333333-3333-4333-a333-333333333333",
      };
    },
    runner: ({ emit }) => {
      emit("turn.completed", { message_id: "model-message" });
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "NOTREAL",
  });
  await turn.completed;

  assert.deepEqual(persisted, [
    'sha256:custom-clarification:Custom: I could not resolve "NOTREAL" to a known subject.',
  ]);
  assert.equal(turn.events[5].block_id, "custom-block");
  assert.equal(
    ((turn.events[6].delta as Record<string, unknown>).segment as Record<string, unknown>).text,
    'Custom: I could not resolve "NOTREAL" to a known subject.',
  );
  assert.equal(turn.events[8].message_id, "33333333-3333-4333-a333-333333333333");
});

test("subject clarification emits resolver result before renderer failures", async () => {
  const coordinator = createChatCoordinator({
    preResolveSubject: async ({ text }) => ({
      status: "not_found",
      input_text: text,
      normalized_input: "NOTREAL",
      reason: "no_candidates",
      message: 'I could not resolve "NOTREAL" to a known subject.',
    }),
    renderSubjectClarification: () => {
      throw new Error("renderer failed");
    },
    runner: ({ emit }) => {
      emit("turn.completed", { message_id: "model-message" });
    },
  });

  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "NOTREAL",
  });
  await turn.completed;

  assert.deepEqual(turn.events.map((event) => event.type), [
    "turn.started",
    "tool.started",
    "tool.completed",
    "turn.error",
  ]);
  assert.equal(turn.events[2].resolution_status, "not_found");
  assert.equal(turn.events[3].message, "renderer failed");
});

test("bundleId is single_subject_analysis when the resolved subject is a ticker (fra-95e contract)", async () => {
  let observedContext: ChatTurnRunContext | null = null;
  const coordinator = createChatCoordinator({
    preResolveSubject: async () => resolvedAaplPreResolution(),
    runner: (context) => {
      observedContext = context;
      context.emit("turn.completed", { message_id: "m" });
    },
  });
  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "AAPL",
  });
  await turn.completed;
  assert.equal(observedContext?.bundleId, "single_subject_analysis");
});

test("bundleId is theme_research when the resolved subject is a theme (fra-95e contract)", async () => {
  let observedContext: ChatTurnRunContext | null = null;
  const coordinator = createChatCoordinator({
    preResolveSubject: async () => resolvedThemePreResolution(),
    runner: (context) => {
      observedContext = context;
      context.emit("turn.completed", { message_id: "m" });
    },
  });
  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
    subjectText: "AI Chips Alpha",
  });
  await turn.completed;
  assert.equal(observedContext?.bundleId, "theme_research");
});

test("bundleId falls back to DEFAULT_BUNDLE_ID when the turn has no subjectText (brand-new thread)", async () => {
  let observedContext: ChatTurnRunContext | null = null;
  const coordinator = createChatCoordinator({
    runner: (context) => {
      observedContext = context;
      context.emit("turn.completed", { message_id: "m" });
    },
  });
  const turn = coordinator.getOrCreateTurn({
    threadId: "thread-1",
    runId: "run-1",
  });
  await turn.completed;
  assert.equal(observedContext?.bundleId, "single_subject_analysis");
});

test("ticker chat and theme chat traverse the same coordinator path — only the bundleId differs", async () => {
  // The fra-95e structural contract: there are no per-kind branches in the
  // coordinator. Two turns that differ only in the resolved subject's kind
  // must produce the same event sequence (modulo the bundle id and
  // subject_ref payload fields).
  const tickerEvents: string[] = [];
  const themeEvents: string[] = [];
  const ticker = createChatCoordinator({
    preResolveSubject: async () => resolvedAaplPreResolution(),
  });
  const theme = createChatCoordinator({
    preResolveSubject: async () => resolvedThemePreResolution(),
  });
  const tickerTurn = ticker.getOrCreateTurn({ threadId: "t", runId: "r", subjectText: "AAPL" });
  const themeTurn = theme.getOrCreateTurn({ threadId: "t", runId: "r", subjectText: "AI Chips" });
  await Promise.all([tickerTurn.completed, themeTurn.completed]);
  for (const event of tickerTurn.events) tickerEvents.push(event.type);
  for (const event of themeTurn.events) themeEvents.push(event.type);
  assert.deepEqual(tickerEvents, themeEvents, "ticker and theme must traverse identical event sequences");
  // The bundle id is the only kind-dependent payload at the coordinator level.
  const tickerCompleted = tickerTurn.events.at(-1)!;
  const themeCompleted = themeTurn.events.at(-1)!;
  assert.equal(tickerCompleted.bundle_id, "single_subject_analysis");
  assert.equal(themeCompleted.bundle_id, "theme_research");
});

test("stub runner surfaces bundle_id on turn.started for no-subject turns and on turn.completed for resolved turns", async () => {
  // SSE consumers should be able to discover which analyst bundle drove a
  // turn without reading the thread row.
  const noSubject = createChatCoordinator();
  const noSubjectTurn = noSubject.getOrCreateTurn({ threadId: "t", runId: "r" });
  await noSubjectTurn.completed;
  const startedEvent = noSubjectTurn.events.find((e) => e.type === "turn.started")!;
  assert.equal(startedEvent.bundle_id, "single_subject_analysis");

  const themed = createChatCoordinator({ preResolveSubject: async () => resolvedThemePreResolution() });
  const themedTurn = themed.getOrCreateTurn({ threadId: "t", runId: "r", subjectText: "AI Chips" });
  await themedTurn.completed;
  const completedEvent = themedTurn.events.at(-1)!;
  assert.equal(completedEvent.type, "turn.completed");
  assert.equal(completedEvent.bundle_id, "theme_research");
});

test("subject-aware runner emits bundle_id on turn.started before any tool events", async () => {
  // Regression: tool events emitted before turn.started used to trigger
  // an auto-fabricated empty turn.started, which left SSE consumers
  // without a bundle_id at setup time. The subject-aware runner must
  // emit turn.started WITH bundle_id explicitly before the subject
  // resolution tool events fire.
  const themed = createChatCoordinator({ preResolveSubject: async () => resolvedThemePreResolution() });
  const turn = themed.getOrCreateTurn({ threadId: "t", runId: "r", subjectText: "AI Chips" });
  await turn.completed;
  const firstStarted = turn.events.find((e) => e.type === "turn.started")!;
  assert.equal(firstStarted.bundle_id, "theme_research");
  // turn.started must be the first event on the wire — tool events
  // come after.
  const firstEvent = turn.events[0];
  assert.equal(firstEvent.type, "turn.started");
  assert.equal(firstEvent.bundle_id, "theme_research");
});

type ChatTurnEventMutation = {
  type: string;
  seq: number;
};

function resolvedThemePreResolution(): ChatResolvedSubjectPreResolution {
  const subjectRef = {
    kind: "theme" as const,
    id: "44444444-4444-4444-a444-444444444444",
  };
  return {
    status: "resolved",
    input_text: "AI Chips Alpha",
    normalized_input: "ai chips alpha",
    subject_ref: subjectRef,
    identity_level: "theme",
    display_label: "AI Chips Alpha",
    resolution_path: "exact_name",
    confidence: 0.99,
    handoff: {
      subject_ref: subjectRef,
      identity_level: "theme",
      display_label: "AI Chips Alpha",
      display_labels: { primary: "AI Chips Alpha" },
      normalized_input: "ai chips alpha",
      resolution_path: "exact_name",
      confidence: 0.99,
      context: {},
    },
  };
}

function resolvedAaplPreResolution(): ChatResolvedSubjectPreResolution {
  const subjectRef = {
    kind: "listing" as const,
    id: "11111111-1111-4111-a111-111111111111",
  };
  return {
    status: "resolved",
    input_text: "AAPL",
    normalized_input: "AAPL",
    subject_ref: subjectRef,
    identity_level: "listing",
    display_label: "AAPL · XNAS — Apple Inc.",
    resolution_path: "auto_advanced",
    confidence: 0.95,
    handoff: {
      subject_ref: subjectRef,
      identity_level: "listing",
      display_label: "AAPL · XNAS — Apple Inc.",
      display_labels: {
        primary: "AAPL · XNAS — Apple Inc.",
        ticker: "AAPL",
        mic: "XNAS",
      },
      normalized_input: "AAPL",
      resolution_path: "auto_advanced",
      confidence: 0.95,
      context: {
        listing: {
          subject_ref: subjectRef,
          instrument_ref: {
            kind: "instrument",
            id: "22222222-2222-4222-a222-222222222222",
          },
          issuer_ref: {
            kind: "issuer",
            id: "33333333-3333-4333-a333-333333333333",
          },
          mic: "XNAS",
          ticker: "AAPL",
          trading_currency: "USD",
          timezone: "America/New_York",
        },
      },
    },
  };
}
