import { createHash } from "node:crypto";
import {
  createChatSseSequencer,
  type ChatSseEvent,
  type ChatSseWireEventType,
} from "./sse.ts";
import type {
  ChatResolvedSubjectPreResolution,
  ChatSubjectPreResolution,
  ChatSubjectPreResolver,
} from "./subjects.ts";

export type ChatTurnInput = {
  threadId: string;
  runId: string;
  turnId?: string;
  subjectText?: string;
};

export type ChatTurnEmit = (
  type: ChatSseWireEventType,
  payload?: Record<string, unknown>,
) => ChatSseEvent;

export type ChatTurnRunContext = ChatTurnInput & {
  subjectPreResolution?: ChatResolvedSubjectPreResolution;
  emit: ChatTurnEmit;
};

export type ChatTurnRunner = (context: ChatTurnRunContext) => Promise<void> | void;

export type ChatSubjectClarificationRenderInput = {
  threadId: string;
  runId: string;
  turnId: string;
  preResolution: Exclude<ChatSubjectPreResolution, ChatResolvedSubjectPreResolution>;
};

export type ChatSubjectClarificationRenderResult = {
  blocks: ReadonlyArray<Record<string, unknown>>;
  content_hash: string;
  text: string;
  block_id?: string;
  block_kind?: string;
};

export type ChatSubjectClarificationRenderer = (
  input: ChatSubjectClarificationRenderInput,
) => Promise<ChatSubjectClarificationRenderResult> | ChatSubjectClarificationRenderResult;

export type ChatAssistantMessagePersistenceInput = {
  threadId: string;
  runId: string;
  turnId: string;
  role: "assistant";
  blocks: ReadonlyArray<Record<string, unknown>>;
  content_hash: string;
};

export type ChatAssistantMessagePersistenceResult = {
  snapshot_id: string;
  message_id: string;
};

export type ChatAssistantMessagePersistence = (
  input: ChatAssistantMessagePersistenceInput,
) => Promise<ChatAssistantMessagePersistenceResult>;

export type ChatTurnHandle = {
  readonly input: ChatTurnInput;
  readonly completed: Promise<void>;
  readonly events: ReadonlyArray<ChatSseEvent>;
  currentSeq(): number;
  waitForEventCount(count: number): Promise<void>;
  subscribe(listener: (event: ChatSseEvent) => void): () => void;
};

export type ChatCoordinator = {
  getOrCreateTurn(input: ChatTurnInput): ChatTurnHandle;
  getTurn(input: ChatTurnInput): ChatTurnHandle | null;
  stats(): ChatCoordinatorStats;
};

export type ChatCoordinatorOptions = {
  runner?: ChatTurnRunner;
  persistAssistantMessage?: ChatAssistantMessagePersistence;
  preResolveSubject?: ChatSubjectPreResolver;
  renderSubjectClarification?: ChatSubjectClarificationRenderer;
  completedTurnRetentionMs?: number;
  maxCompletedTurns?: number;
  completedTurnTombstoneRetentionMs?: number;
  maxCompletedTurnTombstones?: number;
  now?: () => number;
};

export type ChatCoordinatorStats = {
  queuedThreadCount: number;
  retainedTurnCount: number;
  completedTurnCount: number;
  completedTurnTombstoneCount: number;
};

type EventCountWaiter = {
  count: number;
  resolve(): void;
  reject(error: Error): void;
};

type TurnRecord = {
  handle: MutableChatTurnHandle;
  completedAt: number | null;
};

type NormalizedChatTurnInput = ChatTurnInput & {
  turnId: string;
};

const DEFAULT_COMPLETED_TURN_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_COMPLETED_TURNS = 1000;
const DEFAULT_COMPLETED_TURN_TOMBSTONE_RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_MAX_COMPLETED_TURN_TOMBSTONES = 10000;

export class ChatTurnUnavailableError extends Error {
  constructor(message = "chat turn history is not available") {
    super(message);
    this.name = "ChatTurnUnavailableError";
  }
}

export class ChatTurnInputMismatchError extends Error {
  constructor(message = "chat turn input does not match the existing turn") {
    super(message);
    this.name = "ChatTurnInputMismatchError";
  }
}

export function createChatCoordinator(
  options: ChatCoordinatorOptions = {},
): ChatCoordinator {
  const persistAssistantMessage = options.persistAssistantMessage;
  const preResolveSubject = options.preResolveSubject;
  const baseRunner = options.runner ?? ((context) =>
    stubChatTurnRunner(context, persistAssistantMessage)
  );
  const runner = subjectAwareRunner(baseRunner, {
    persistAssistantMessage,
    preResolveSubject,
    renderSubjectClarification: options.renderSubjectClarification,
  });
  const completedTurnRetentionMs = nonNegativeFiniteNumber(
    options.completedTurnRetentionMs ?? DEFAULT_COMPLETED_TURN_RETENTION_MS,
    "completedTurnRetentionMs",
  );
  const maxCompletedTurns = nonNegativeInteger(
    options.maxCompletedTurns ?? DEFAULT_MAX_COMPLETED_TURNS,
    "maxCompletedTurns",
  );
  const completedTurnTombstoneRetentionMs = nonNegativeFiniteNumber(
    options.completedTurnTombstoneRetentionMs ?? DEFAULT_COMPLETED_TURN_TOMBSTONE_RETENTION_MS,
    "completedTurnTombstoneRetentionMs",
  );
  const maxCompletedTurnTombstones = nonNegativeInteger(
    options.maxCompletedTurnTombstones ?? DEFAULT_MAX_COMPLETED_TURN_TOMBSTONES,
    "maxCompletedTurnTombstones",
  );
  const now = options.now ?? Date.now;
  const threadQueues = new Map<string, Promise<void>>();
  const turns = new Map<string, TurnRecord>();
  const completedTurnTombstones = new Map<string, number>();

  const pruneCompletedTurnTombstones = (currentTime = now()) => {
    const cutoff = currentTime - completedTurnTombstoneRetentionMs;
    for (const [key, tombstonedAt] of completedTurnTombstones) {
      if (tombstonedAt < cutoff) {
        completedTurnTombstones.delete(key);
      }
    }

    const tombstones = [...completedTurnTombstones.entries()].sort((left, right) => left[1] - right[1]);
    while (tombstones.length > maxCompletedTurnTombstones) {
      const [oldestKey] = tombstones.shift()!;
      completedTurnTombstones.delete(oldestKey);
    }
  };

  const rememberEvictedCompletedTurn = (key: string, currentTime = now()) => {
    completedTurnTombstones.set(key, currentTime);
    pruneCompletedTurnTombstones(currentTime);
  };

  const pruneCompletedTurns = () => {
    const currentTime = now();
    pruneCompletedTurnTombstones(currentTime);
    const cutoff = currentTime - completedTurnRetentionMs;
    for (const [key, record] of turns) {
      if (record.completedAt !== null && record.completedAt < cutoff) {
        rememberEvictedCompletedTurn(key, currentTime);
        turns.delete(key);
      }
    }

    const completed = [...turns.entries()]
      .filter((entry): entry is [string, TurnRecord & { completedAt: number }] => entry[1].completedAt !== null)
      .sort((left, right) => left[1].completedAt - right[1].completedAt);

    while (completed.length > maxCompletedTurns) {
      const [oldestKey] = completed.shift()!;
      rememberEvictedCompletedTurn(oldestKey);
      turns.delete(oldestKey);
    }
  };

  return {
    getOrCreateTurn(input) {
      pruneCompletedTurns();
      const normalizedInput = normalizeTurnInput(input);
      const key = turnKey(normalizedInput);
      if (completedTurnTombstones.has(key)) {
        throw new ChatTurnUnavailableError();
      }
      const existing = turns.get(key)?.handle;
      if (existing) {
        assertSameTurnInput(existing.input, normalizedInput);
        return existing;
      }

      const handle = new MutableChatTurnHandle(normalizedInput, runner);
      const record: TurnRecord = { handle, completedAt: null };
      turns.set(key, record);
      handle.completed.then(() => {
        record.completedAt = now();
        pruneCompletedTurns();
      });

      const previous = threadQueues.get(normalizedInput.threadId) ?? Promise.resolve();
      const queued = previous
        .catch(() => undefined)
        .then(() => handle.run());

      let queueEntry!: Promise<void>;
      queueEntry = queued.finally(() => {
        if (threadQueues.get(normalizedInput.threadId) === queueEntry) {
          threadQueues.delete(normalizedInput.threadId);
        }
      });
      threadQueues.set(normalizedInput.threadId, queueEntry);

      return handle;
    },
    getTurn(input) {
      pruneCompletedTurns();
      const normalizedInput = normalizeTurnInput(input);
      const handle = turns.get(turnKey(normalizedInput))?.handle ?? null;
      if (handle) {
        assertSameTurnInput(handle.input, normalizedInput);
      }
      return handle;
    },
    stats() {
      pruneCompletedTurns();
      let completedTurnCount = 0;
      for (const record of turns.values()) {
        if (record.completedAt !== null) {
          completedTurnCount += 1;
        }
      }
      return {
        queuedThreadCount: threadQueues.size,
        retainedTurnCount: turns.size,
        completedTurnCount,
        completedTurnTombstoneCount: completedTurnTombstones.size,
      };
    },
  };
}

function normalizeTurnInput(input: ChatTurnInput): NormalizedChatTurnInput {
  const subjectText = nonEmptySubjectText(input.subjectText);
  return {
    threadId: input.threadId,
    runId: input.runId,
    turnId: input.turnId ?? input.runId,
    ...(subjectText ? { subjectText } : {}),
  };
}

function turnKey(input: NormalizedChatTurnInput): string {
  return JSON.stringify([input.threadId, input.runId, input.turnId]);
}

function assertSameTurnInput(existing: ChatTurnInput, incoming: ChatTurnInput) {
  if (
    existing.threadId !== incoming.threadId ||
    existing.runId !== incoming.runId ||
    existing.turnId !== incoming.turnId ||
    existing.subjectText !== incoming.subjectText
  ) {
    throw new ChatTurnInputMismatchError();
  }
}

class MutableChatTurnHandle implements ChatTurnHandle {
  readonly input: ChatTurnInput;
  readonly completed: Promise<void>;

  #events: ChatSseEvent[] = [];
  #listeners = new Set<(event: ChatSseEvent) => void>();
  #waiters: EventCountWaiter[] = [];
  #completedResolve!: () => void;
  #settled = false;
  #runner: ChatTurnRunner;

  constructor(
    input: ChatTurnInput,
    runner: ChatTurnRunner,
  ) {
    this.input = Object.freeze({ ...input });
    this.#runner = runner;
    this.completed = new Promise<void>((resolve) => {
      this.#completedResolve = resolve;
    });
  }

  get events(): ReadonlyArray<ChatSseEvent> {
    return [...this.#events];
  }

  currentSeq(): number {
    return this.#events.at(-1)?.seq ?? 0;
  }

  async run(): Promise<void> {
    const sequencer = createChatSseSequencer({
      threadId: this.input.threadId,
      runId: this.input.runId,
      turnId: this.input.turnId,
    });

    let startedEvent: ChatSseEvent | null = null;
    const emit: ChatTurnEmit = (type, payload = {}) => {
      if (type === "turn.started" && startedEvent) {
        return startedEvent;
      }
      const event = sequencer.next(type, payload);
      if (type === "turn.started") {
        startedEvent = event;
      }
      return this.append(event);
    };

    try {
      emit("turn.started");
      await this.#runner({ ...this.input, emit });
    } catch (error) {
      emit("turn.error", {
        error_code: errorCode(error),
        message: errorMessage(error),
      });
    } finally {
      this.#settled = true;
      this.rejectUnsatisfiedWaiters();
      this.#completedResolve();
    }
  }

  waitForEventCount(count: number): Promise<void> {
    if (!Number.isInteger(count) || count < 0) {
      return Promise.reject(new Error("waitForEventCount requires a non-negative integer"));
    }
    if (this.#events.length >= count) {
      return Promise.resolve();
    }
    if (this.#settled) {
      return Promise.reject(new Error(`turn completed before ${count} events were emitted`));
    }

    return new Promise<void>((resolve, reject) => {
      this.#waiters.push({ count, resolve, reject });
    });
  }

  subscribe(listener: (event: ChatSseEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  private append(event: ChatSseEvent): ChatSseEvent {
    const immutableEvent = deepFreeze(cloneEvent(event));
    this.#events.push(immutableEvent);
    for (const listener of [...this.#listeners]) {
      try {
        listener(immutableEvent);
      } catch {
        this.#listeners.delete(listener);
      }
    }
    this.resolveReadyWaiters();
    return immutableEvent;
  }

  private resolveReadyWaiters() {
    const pending: EventCountWaiter[] = [];
    for (const waiter of this.#waiters) {
      if (this.#events.length >= waiter.count) {
        waiter.resolve();
      } else {
        pending.push(waiter);
      }
    }
    this.#waiters = pending;
  }

  private rejectUnsatisfiedWaiters() {
    const pending = this.#waiters;
    this.#waiters = [];
    for (const waiter of pending) {
      waiter.reject(new Error(`turn completed before ${waiter.count} events were emitted`));
    }
  }
}

function subjectAwareRunner(
  runner: ChatTurnRunner,
  options: {
    persistAssistantMessage?: ChatAssistantMessagePersistence;
    preResolveSubject?: ChatSubjectPreResolver;
    renderSubjectClarification?: ChatSubjectClarificationRenderer;
  } = {},
): ChatTurnRunner {
  return async (context) => {
    const subjectText = nonEmptySubjectText(context.subjectText);
    if (!subjectText) {
      await runner(context);
      return;
    }

    if (!options.preResolveSubject) {
      throw new Error("subject pre-resolver is not configured");
    }

    const preResolution = await options.preResolveSubject({ text: subjectText });
    if (preResolution.status !== "resolved") {
      await emitSubjectClarificationTurn(context, preResolution, {
        persistAssistantMessage: options.persistAssistantMessage,
        renderSubjectClarification: options.renderSubjectClarification,
      });
      return;
    }

    const { subjectText: _subjectText, ...resolvedContext } = context;
    const toolCallId = subjectResolutionToolCallId(context);
    emitSubjectResolutionToolEvents(resolvedContext.emit, preResolution, toolCallId);

    await runner({
      ...resolvedContext,
      subjectPreResolution: preResolution,
    });
  };
}

async function emitSubjectClarificationTurn(
  context: ChatTurnRunContext,
  preResolution: Exclude<ChatSubjectPreResolution, ChatResolvedSubjectPreResolution>,
  options: {
    persistAssistantMessage?: ChatAssistantMessagePersistence;
    renderSubjectClarification?: ChatSubjectClarificationRenderer;
  } = {},
) {
  const { emit } = context;
  const turnId = context.turnId ?? context.runId;
  emit("turn.started", { subject_resolution: true });
  emitSubjectResolutionToolEvents(emit, preResolution, subjectResolutionToolCallId(context));

  const rendered = await renderSubjectClarification({
    threadId: context.threadId,
    runId: context.runId,
    turnId,
    preResolution,
  }, options.renderSubjectClarification);
  const assistantBlocks = rendered.blocks;
  const contentHash = rendered.content_hash;
  const blockId = rendered.block_id ?? `subject-clarification-${turnId}`;
  let snapshotId = `subject-snapshot-${turnId}`;
  let messageId = `subject-message-${turnId}`;

  if (options.persistAssistantMessage) {
    const persisted = await options.persistAssistantMessage({
      threadId: context.threadId,
      runId: context.runId,
      turnId,
      role: "assistant",
      blocks: assistantBlocks,
      content_hash: contentHash,
    });
    snapshotId = persisted.snapshot_id;
    messageId = persisted.message_id;
  }
  emit("snapshot.staged", {
    snapshot_id: snapshotId,
    status: "staged",
  });
  emit("snapshot.sealed", {
    snapshot_id: snapshotId,
    status: "sealed",
  });
  emit("block.began", {
    block_id: blockId,
    kind: rendered.block_kind ?? "rich_text",
  });
  emit("block.delta", {
    block_id: blockId,
    delta: {
      segment: {
        type: "text",
        text: rendered.text,
      },
    },
  });
  emit("block.completed", {
    block_id: blockId,
    content_hash: contentHash,
  });
  emit("turn.completed", {
    message_id: messageId,
    clarification: true,
  });
}

function emitSubjectResolutionToolEvents(
  emit: ChatTurnEmit,
  preResolution: ChatSubjectPreResolution,
  toolCallId: string,
) {
  emit("tool.started", {
    tool_call_id: toolCallId,
    tool_name: "resolve_subjects",
  });
  emit("tool.completed", subjectToolCompletedPayload(preResolution, toolCallId));
}

async function stubChatTurnRunner(
  context: ChatTurnRunContext,
  persistAssistantMessage?: ChatAssistantMessagePersistence,
) {
  const { emit } = context;
  let assistantText = "Stub research stream ready.";
  let contentHash = "stub-block-1";
  let snapshotId = "snapshot-1";
  let messageId = "message-1";
  const preResolution = context.subjectPreResolution ?? null;

  emit("turn.started", { stub: true });
  if (!preResolution) {
    emit("tool.started", {
      stub: true,
      tool_call_id: "tool-call-1",
      tool_name: "resolve_subjects",
    });
    emit("tool.completed", {
      stub: true,
      tool_call_id: "tool-call-1",
      tool_name: "resolve_subjects",
      status: "ok",
    });
  }

  if (preResolution) {
    assistantText = `Stub research stream ready for ${preResolution.display_label}.`;
    contentHash = contentHashForText(assistantText);
  }

  const assistantBlocks = Object.freeze([
    Object.freeze({ type: "text", text: assistantText }),
  ]);

  if (persistAssistantMessage) {
    const persisted = await persistAssistantMessage({
      threadId: context.threadId,
      runId: context.runId,
      turnId: context.turnId ?? context.runId,
      role: "assistant",
      blocks: assistantBlocks,
      content_hash: contentHash,
    });
    snapshotId = persisted.snapshot_id;
    messageId = persisted.message_id;
  }
  emit("snapshot.staged", {
    stub: true,
    snapshot_id: snapshotId,
    status: "staged",
  });
  emit("snapshot.sealed", {
    stub: true,
    snapshot_id: snapshotId,
    status: "sealed",
  });
  emit("block.began", {
    stub: true,
    block_id: "block-1",
    kind: "rich_text",
  });
  emit("block.delta", {
    stub: true,
    block_id: "block-1",
    delta: {
      segment: {
        type: "text",
        text: assistantBlocks[0].text,
      },
    },
  });
  emit("block.completed", {
    stub: true,
    block_id: "block-1",
    content_hash: contentHash,
  });
  emit("turn.completed", {
    stub: true,
    message_id: messageId,
    ...(preResolution?.status === "resolved" ? { subject_ref: preResolution.subject_ref } : {}),
    ...(preResolution !== null && preResolution.status !== "resolved" ? { clarification: true } : {}),
  });
}

function subjectToolCompletedPayload(
  preResolution: ChatSubjectPreResolution,
  toolCallId = "tool-call-1",
): Record<string, unknown> {
  const base = {
    tool_call_id: toolCallId,
    tool_name: "resolve_subjects",
    status: preResolution.status === "resolved" ? "ok" : preResolution.status,
    resolution_status: preResolution.status,
    normalized_input: preResolution.normalized_input,
  };

  if (preResolution.status === "resolved") {
    return {
      ...base,
      subject_ref: preResolution.subject_ref,
      identity_level: preResolution.identity_level,
      display_label: preResolution.display_label,
      display_labels: preResolution.handoff.display_labels,
      context: preResolution.handoff.context,
      handoff: preResolution.handoff,
      resolution_path: preResolution.resolution_path,
      confidence: preResolution.confidence,
    };
  }

  if (preResolution.status === "needs_clarification") {
    return {
      ...base,
      candidates: preResolution.candidates,
      ...(preResolution.ambiguity_axis ? { ambiguity_axis: preResolution.ambiguity_axis } : {}),
    };
  }

  return {
    ...base,
    ...(preResolution.reason ? { reason: preResolution.reason } : {}),
  };
}

function subjectResolutionToolCallId(context: ChatTurnInput): string {
  return `resolve-subjects-${context.turnId ?? context.runId}`;
}

function nonEmptySubjectText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function renderSubjectClarification(
  input: ChatSubjectClarificationRenderInput,
  renderer?: ChatSubjectClarificationRenderer,
): Promise<ChatSubjectClarificationRenderResult> {
  const rendered = renderer ? await renderer(input) : defaultSubjectClarificationRenderer(input);
  if (rendered.blocks.length === 0) {
    throw new Error("subject clarification renderer must return at least one block");
  }
  return Object.freeze({
    ...rendered,
    blocks: Object.freeze([...rendered.blocks]),
  });
}

function defaultSubjectClarificationRenderer(
  input: ChatSubjectClarificationRenderInput,
): ChatSubjectClarificationRenderResult {
  return {
    blocks: Object.freeze([
      Object.freeze({ type: "text", text: input.preResolution.message }),
    ]),
    content_hash: contentHashForText(input.preResolution.message),
    text: input.preResolution.message,
  };
}

function contentHashForText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  return "TURN_ERROR";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "turn failed";
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function nonNegativeFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function cloneEvent(event: ChatSseEvent): ChatSseEvent {
  return structuredClone(event) as ChatSseEvent;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}
