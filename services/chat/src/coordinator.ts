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
};

export type ChatCoordinatorOptions = {
  runner?: ChatTurnRunner;
};

type EventCountWaiter = {
  count: number;
  resolve(): void;
  reject(error: Error): void;
};

export function createChatCoordinator(
  options: ChatCoordinatorOptions = {},
): ChatCoordinator {
  const runner = options.runner ?? stubChatTurnRunner;
  const threadQueues = new Map<string, Promise<void>>();
  const turns = new Map<string, MutableChatTurnHandle>();

  return {
    getOrCreateTurn(input) {
      const key = turnKey(input);
      const existing = turns.get(key);
      if (existing) {
        return existing;
      }

      const handle = new MutableChatTurnHandle(input, runner);
      turns.set(key, handle);

      const previous = threadQueues.get(input.threadId) ?? Promise.resolve();
      const queued = previous
        .catch(() => undefined)
        .then(() => handle.run());

      threadQueues.set(
        input.threadId,
        queued.finally(() => {
          if (threadQueues.get(input.threadId) === queued) {
            threadQueues.delete(input.threadId);
          }
        }),
      );

      return handle;
    },
  };
}

function turnKey(input: ChatTurnInput): string {
  return `${input.threadId}\0${input.runId}`;
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
    return this.#events;
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
      this.append(event);
      return event;
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

  private append(event: ChatSseEvent) {
    this.#events.push(event);
    for (const listener of this.#listeners) {
      listener(event);
    }
    this.resolveReadyWaiters();
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

function stubChatTurnRunner({ emit }: ChatTurnRunContext) {
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
    snapshot_id: "snapshot-1",
    status: "staged",
  });
  emit("snapshot.sealed", {
    stub: true,
    snapshot_id: "snapshot-1",
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
        text: "Stub research stream ready.",
      },
    },
  });
  emit("block.completed", {
    stub: true,
    block_id: "block-1",
    content_hash: "stub-block-1",
  });
  emit("turn.completed", {
    stub: true,
    message_id: "message-1",
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
