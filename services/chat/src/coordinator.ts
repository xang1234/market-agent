import {
  createChatSseSequencer,
  type ChatSseEvent,
  type ChatSseWireEventType,
} from "./sse.ts";

export type ChatTurnInput = {
  threadId: string;
  runId: string;
  turnId?: string;
};

export type ChatTurnEmit = (
  type: ChatSseWireEventType,
  payload?: Record<string, unknown>,
) => ChatSseEvent;

export type ChatTurnRunContext = ChatTurnInput & {
  emit: ChatTurnEmit;
};

export type ChatTurnRunner = (context: ChatTurnRunContext) => Promise<void> | void;

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

export function createChatCoordinator(
  options: ChatCoordinatorOptions = {},
): ChatCoordinator {
  const persistAssistantMessage = options.persistAssistantMessage;
  const runner = options.runner ?? ((context) => stubChatTurnRunner(context, persistAssistantMessage));
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
      return turns.get(turnKey(normalizeTurnInput(input)))?.handle ?? null;
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
  return {
    ...input,
    turnId: input.turnId ?? input.runId,
  };
}

function turnKey(input: NormalizedChatTurnInput): string {
  return JSON.stringify([input.threadId, input.runId, input.turnId]);
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

    const emit: ChatTurnEmit = (type, payload = {}) => {
      const event = sequencer.next(type, payload);
      return this.append(event);
    };

    try {
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

async function stubChatTurnRunner(
  context: ChatTurnRunContext,
  persistAssistantMessage?: ChatAssistantMessagePersistence,
) {
  const { emit } = context;
  const assistantBlocks = Object.freeze([
    Object.freeze({ type: "text", text: "Stub research stream ready." }),
  ]);
  const contentHash = "stub-block-1";
  let snapshotId = "snapshot-1";
  let messageId = "message-1";

  emit("turn.started", { stub: true });
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
  emit("snapshot.staged", {
    stub: true,
    snapshot_id: snapshotId,
    status: "staged",
  });
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
  });
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
