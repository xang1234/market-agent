import { contentHashForText, stableUuid } from "./chat-ids.ts";
import { DEFAULT_BUNDLE_ID, chooseBundleIdForSubjectKind } from "./bundle-routing.ts";
import { COMPARATIVE, companyKey, extractSubjectMentions } from "./subject-extraction.ts";
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
import type {
  RunActivityInput,
  RunActivityScope,
  RunActivityStage,
  SubjectRefJson,
} from "../../observability/src/run-activity.ts";
import {
  createTurnToolPolicy,
  interceptToolCall,
  loadToolRegistry,
  type JsonValue,
  type ToolCallBudgetDecision,
  type ToolDefinition,
  type ToolRegistry,
} from "../../tools/src/index.ts";

import type { ChatClarificationAnswer, ChatFinancialRuntime } from "./financial-runtime.ts";
import { ChatSnapshotSealError } from "./messages.ts";
import { financialAwareRunner } from "./financial-turn.ts";
import type { ResearchScope } from "./research-scope.ts";

export type ChatTurnInput = {
  threadId: string;
  runId: string;
  turnId?: string;
  subjectText?: string;
  userIntent?: string;
  userId?: string;
  /** The user's pick for a financial clarification offered by an earlier turn. */
  clarificationAnswer?: ChatClarificationAnswer;
};

export type ChatTurnEmit = (
  type: ChatSseWireEventType,
  payload?: Record<string, unknown>,
) => ChatSseEvent;

export type ChatTurnRunContext = ChatTurnInput & {
  // The turn's primary company (the first of subjectPreResolutions).
  subjectPreResolution?: ChatResolvedSubjectPreResolution;
  // Every company the turn covers, primary first (see resolveTurnSubjects).
  subjectPreResolutions?: ReadonlyArray<ChatResolvedSubjectPreResolution>;
  // Companies a comparison named that could not be found; the answer says so.
  unresolvedMentions?: ReadonlyArray<string>;
  // The turn refers back to the previous answer's companies, so it keeps that
  // answer's research scope where it does not change it (research-scope.ts).
  followUp?: boolean;
  // Analyst prompt-template bundle selected for this turn. Derived from the
  // resolved subject's kind via chooseBundleIdForSubjectKind; falls back to
  // DEFAULT_BUNDLE_ID when no subject was provided. Same routing function
  // for ticker, theme, screen, and macro subjects — no per-kind branch
  // (fra-95e contract).
  bundleId: string;
  emit: ChatTurnEmit;
};

export type ChatTurnRunner = (context: ChatTurnRunContext) => Promise<void> | void;

export type ChatAnalystToolRuntimeInput = ChatTurnRunContext;

export type ChatAnalystToolRuntimeToolCall = {
  tool_call_id: string;
  tool_name: string;
  status: string;
  bundle_id: string;
  arguments?: JsonValue;
  result?: JsonValue;
  approval_required?: boolean;
  pending_action?: JsonValue;
};

export type ChatAnalystToolRuntimeVerification = {
  ok: boolean;
  failures?: ReadonlyArray<Record<string, unknown>>;
};

export type ChatAnalystToolRuntimeResult = {
  snapshot_id: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
  verification: ChatAnalystToolRuntimeVerification;
  tool_calls?: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  // Narrative sentences the guard dropped for quoting figures it could not
  // attribute; reported on turn.completed so evals can count them (#144).
  narrative_removed?: ReadonlyArray<string>;
  // The deployment (channel/model) that wrote the narrative; absent when no
  // model answered (#183).
  answered_by?: string;
  // The research scope the answer covered (research-scope.ts), saved with it so
  // a follow-up keeps what it does not change (#206).
  research_scope?: ResearchScope;
  // The answer call's token usage, reported on turn.completed so evals can
  // measure it (#181); not saved.
  answer_usage?: { input_tokens: number; output_tokens: number; reasoning_tokens?: number };
};

export type ChatAnalystToolRuntime = (
  input: ChatAnalystToolRuntimeInput,
) => Promise<ChatAnalystToolRuntimeResult> | ChatAnalystToolRuntimeResult;

export type ChatAnalystToolExecutor = (input: {
  tool: ToolDefinition;
  bundleId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, JsonValue>;
  idempotencyKey: string;
}) => Promise<JsonValue> | JsonValue;

export type ChatRunActivityReporter = {
  agentId: string;
  report(input: RunActivityInput, scope: RunActivityScope): Promise<void> | void;
  onError?: (error: unknown, input: RunActivityInput, scope: RunActivityScope) => void;
};

export type ChatThreadTitleGenerationInput = {
  threadId: string;
  runId: string;
  turnId: string;
  userId?: string;
  userIntent?: string;
  assistantText: string;
};

export type ChatThreadTitleGenerator = (
  input: ChatThreadTitleGenerationInput,
) => Promise<void> | void;

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
  answered_by?: string;
  research_scope?: ResearchScope;
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

// strict (default): an answer that fails verification is a turn.error and nothing
// is shown. display_unverified (development only): the blocks are shown, labelled
// unverified with the failure reasons, and never persisted.
export type ChatVerificationMode = "strict" | "display_unverified";

// The companies the thread's previous answer covered, re-hydrated, so a
// follow-up ("compare it with AMD") can refer back to them.
export type ChatPriorSubjectsLoader = (input: {
  threadId: string;
  userId?: string;
}) => Promise<ReadonlyArray<ChatResolvedSubjectPreResolution>>;

export type ChatCoordinatorOptions = {
  runner?: ChatTurnRunner;
  loadPriorSubjects?: ChatPriorSubjectsLoader;
  verificationMode?: ChatVerificationMode;
  financialRuntime?: ChatFinancialRuntime;
  analystToolRuntime?: ChatAnalystToolRuntime;
  allowSyntheticAnalystFallback?: boolean;
  persistAssistantMessage?: ChatAssistantMessagePersistence;
  preResolveSubject?: ChatSubjectPreResolver;
  renderSubjectClarification?: ChatSubjectClarificationRenderer;
  runActivity?: ChatRunActivityReporter;
  generateThreadTitle?: ChatThreadTitleGenerator;
  onThreadTitleGenerationError?: (
    error: unknown,
    input: ChatThreadTitleGenerationInput,
  ) => void;
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
  const analystToolRuntime = options.analystToolRuntime;
  const baseRunner = options.runner ?? (analystToolRuntime
    ? ((context) => toolBackedAnalystTurnRunner(context, {
      persistAssistantMessage,
      runtime: analystToolRuntime,
      verificationMode: options.verificationMode ?? "strict",
    }))
    : options.allowSyntheticAnalystFallback
    ? ((context) => syntheticAnalystTurnRunner(context, persistAssistantMessage))
    : missingAnalystToolRuntimeRunner);
  const runner = threadTitleGenerationRunner(runActivityReportingRunner(financialAwareRunner(subjectAwareRunner(baseRunner, {
    persistAssistantMessage,
    preResolveSubject,
    loadPriorSubjects: options.loadPriorSubjects,
    renderSubjectClarification: options.renderSubjectClarification,
  }), { financialRuntime: options.financialRuntime, persistAssistantMessage }), options.runActivity), {
    generateThreadTitle: options.generateThreadTitle,
    onThreadTitleGenerationError: options.onThreadTitleGenerationError,
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

function runActivityReportingRunner(
  runner: ChatTurnRunner,
  reporter: ChatRunActivityReporter | undefined,
): ChatTurnRunner {
  if (!reporter) return runner;

  return async (context) => {
    const scope = context.userId ? { userId: context.userId } : null;
    const report = (
      stage: RunActivityStage,
      summary: string,
      payload: Record<string, unknown>,
    ) => {
      if (!scope) return;
      const input = {
        agent_id: reporter.agentId,
        stage,
        subject_refs: subjectRefsFromPayload(context, payload),
        source_refs: sourceRefsFromPayload(payload),
        summary,
      };
      try {
        const result = reporter.report(input, scope);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            reporter.onError?.(error, input, scope);
          });
        }
      } catch (error) {
        // Run activity is user-facing telemetry; reporter failures must not
        // fail the chat turn itself.
        reporter.onError?.(error, input, scope);
      }
    };
    const emit: ChatTurnEmit = (type, payload = {}) => {
      const event = context.emit(type, payload);
      switch (type) {
        case "turn.started":
          report("reading", "Reading run inputs.", payload);
          break;
        case "tool.started":
          report("investigating", `Running ${toolNameFromPayload(payload)}.`, payload);
          break;
        case "turn.completed":
          report("found", "Completed run output.", payload);
          break;
        case "turn.error":
          report("dismissed", "Dismissed failed run output.", payload);
          break;
        default:
          break;
      }
      return event;
    };

    try {
      await runner({ ...context, emit });
    } catch (error) {
      report("dismissed", "Dismissed failed run output.", {});
      throw error;
    }
  };
}

function threadTitleGenerationRunner(
  runner: ChatTurnRunner,
  options: {
    generateThreadTitle?: ChatThreadTitleGenerator;
    onThreadTitleGenerationError?: (
      error: unknown,
      input: ChatThreadTitleGenerationInput,
    ) => void;
  },
): ChatTurnRunner {
  const generateThreadTitle = options.generateThreadTitle;
  if (!generateThreadTitle) return runner;

  return async (context) => {
    const assistantTextParts: string[] = [];
    let completed = false;
    let clarification = false;
    const emit: ChatTurnEmit = (type, payload = {}) => {
      if (type === "block.delta") {
        const text = textFromBlockDeltaPayload(payload);
        if (text) assistantTextParts.push(text);
      }
      if (type === "turn.completed") {
        completed = true;
        // Unverified answers (display_unverified mode) are not saved, so they don't title the thread.
        clarification = payload.clarification === true || payload.unverified !== undefined;
      }
      return context.emit(type, payload);
    };

    await runner({ ...context, emit });

    const assistantText = assistantTextParts.join("").trim();
    if (!completed || clarification || assistantText.length === 0) return;

    const input: ChatThreadTitleGenerationInput = {
      threadId: context.threadId,
      runId: context.runId,
      turnId: context.turnId ?? context.runId,
      ...(context.userId ? { userId: context.userId } : {}),
      ...(context.userIntent ? { userIntent: context.userIntent } : {}),
      assistantText,
    };

    try {
      const result = generateThreadTitle(input);
      if (result && typeof result.then === "function") {
        result.catch((error) => {
          options.onThreadTitleGenerationError?.(error, input);
        });
      }
    } catch (error) {
      options.onThreadTitleGenerationError?.(error, input);
    }
  };
}

function textFromBlockDeltaPayload(payload: Record<string, unknown>): string | null {
  const delta = payload.delta;
  if (delta === null || typeof delta !== "object") return null;
  const segment = (delta as { segment?: unknown }).segment;
  if (segment === null || typeof segment !== "object") return null;
  const text = (segment as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function toolNameFromPayload(payload: Record<string, unknown>): string {
  return typeof payload.tool_name === "string" && payload.tool_name.trim() !== ""
    ? payload.tool_name
    : "tool";
}

function sourceRefsFromPayload(payload: Record<string, unknown>): string[] {
  const sourceRefs = payload.source_refs;
  if (!Array.isArray(sourceRefs)) return [];
  return sourceRefs.filter((sourceRef): sourceRef is string =>
    typeof sourceRef === "string" && sourceRef.trim() !== ""
  );
}

function subjectRefsFromPayload(
  context: ChatTurnRunContext,
  payload: Record<string, unknown>,
): SubjectRefJson[] {
  const payloadSubjectRefs = payload.subject_refs;
  if (Array.isArray(payloadSubjectRefs)) {
    return payloadSubjectRefs.filter(isSubjectRefJson);
  }
  if (isSubjectRefJson(payload.subject_ref)) {
    return [payload.subject_ref];
  }
  const preResolution = context.subjectPreResolution;
  return preResolution?.status === "resolved" ? [preResolution.subject_ref] : [];
}

function isSubjectRefJson(value: unknown): value is SubjectRefJson {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { kind: string }).kind.trim() !== "" &&
    (value as { id: string }).id.trim() !== ""
  );
}

function normalizeTurnInput(input: ChatTurnInput): NormalizedChatTurnInput {
  const subjectText = nonEmptySubjectText(input.subjectText);
  const userIntent = nonEmptySubjectText(input.userIntent);
  return {
    threadId: input.threadId,
    runId: input.runId,
    turnId: input.turnId ?? input.runId,
    ...(subjectText ? { subjectText } : {}),
    ...(userIntent ? { userIntent } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.clarificationAnswer ? { clarificationAnswer: { ...input.clarificationAnswer } } : {}),
  };
}

function turnKey(input: NormalizedChatTurnInput): string {
  return JSON.stringify([input.userId ?? null, input.threadId, input.runId, input.turnId]);
}

function assertSameTurnInput(existing: ChatTurnInput, incoming: ChatTurnInput) {
  if (
    existing.threadId !== incoming.threadId ||
    existing.runId !== incoming.runId ||
    existing.turnId !== incoming.turnId ||
    existing.subjectText !== incoming.subjectText ||
    existing.userIntent !== incoming.userIntent ||
    existing.userId !== incoming.userId ||
    existing.clarificationAnswer?.clarification_id !== incoming.clarificationAnswer?.clarification_id ||
    existing.clarificationAnswer?.choice_id !== incoming.clarificationAnswer?.choice_id
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
        if (Object.keys(payload).length === 0) {
          return startedEvent;
        }
        const event = sequencer.next(type, payload);
        startedEvent = event;
        return this.append(event);
      }
      if (type !== "turn.started" && startedEvent === null) {
        startedEvent = this.append(sequencer.next("turn.started"));
      }
      const event = sequencer.next(type, payload);
      if (type === "turn.started") {
        startedEvent = event;
      }
      return this.append(event);
    };

    try {
      // bundleId is a placeholder here — subjectAwareRunner (always the
      // outermost wrapper, see createChatCoordinator) overwrites it on
      // every path before invoking the inner runner.
      await this.#runner({ ...this.input, emit, bundleId: DEFAULT_BUNDLE_ID });
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
    loadPriorSubjects?: ChatPriorSubjectsLoader;
    renderSubjectClarification?: ChatSubjectClarificationRenderer;
  } = {},
): ChatTurnRunner {
  return async (context) => {
    const explicitSubject = nonEmptySubjectText(context.subjectText);

    // An explicit subject (e.g. a thread opened from a ticker page) must resolve;
    // an unresolved one is a clarification, not a silent fallback.
    if (explicitSubject) {
      if (!options.preResolveSubject) {
        throw new Error("subject pre-resolver is not configured");
      }
      const preResolution = await options.preResolveSubject({ text: explicitSubject });
      if (preResolution.status !== "resolved") {
        await emitSubjectClarificationTurn(context, preResolution, {
          persistAssistantMessage: options.persistAssistantMessage,
          renderSubjectClarification: options.renderSubjectClarification,
        });
        return;
      }
      // A comparison adds the companies the message names, with the explicit
      // subject kept primary ("Compare with AMD" from the NVDA page).
      const text = nonEmptySubjectText(context.userIntent);
      if (text && COMPARATIVE.test(text)) {
        const named = await resolveNamedSubjects(text, options.preResolveSubject);
        const ambiguous = named.unresolved.find((resolution) => resolution.status === "needs_clarification");
        if (ambiguous) {
          await emitSubjectClarificationTurn(context, ambiguous, {
            persistAssistantMessage: options.persistAssistantMessage,
            renderSubjectClarification: options.renderSubjectClarification,
          });
          return;
        }
        const subjects = distinctCompanies([preResolution, ...named.resolved]).slice(0, MAX_TURN_SUBJECTS);
        const unresolvedMentions = named.unresolved.map((resolution) => resolution.input_text);
        await runResolvedSubjectTurn(runner, { ...context, unresolvedMentions }, subjects);
        return;
      }
      await runResolvedSubjectTurn(runner, context, [preResolution]);
      return;
    }

    // The chat UI attaches no subject, so ground the turn in the companies the
    // message names ("compare NVDA and AMD"), or the ones a follow-up refers
    // back to ("compare it with AMD"). Messages with no company fall through to
    // the default analyst bundle, without nagging for clarification.
    if (options.preResolveSubject) {
      const turn = await resolveTurnSubjects(context, options.preResolveSubject, options.loadPriorSubjects);
      // A comparison must cover every company it names: ask about an ambiguous one
      // rather than answering about the rest.
      if (turn.ambiguous) {
        await emitSubjectClarificationTurn(context, turn.ambiguous, {
          persistAssistantMessage: options.persistAssistantMessage,
          renderSubjectClarification: options.renderSubjectClarification,
        });
        return;
      }
      if (turn.subjects.length > 0) {
        await runResolvedSubjectTurn(runner, { ...context, unresolvedMentions: turn.notFound, followUp: turn.followUp }, turn.subjects);
        return;
      }
    }

    await runner({ ...context, bundleId: DEFAULT_BUNDLE_ID });
  };
}

const MAX_TURN_SUBJECTS = 5;

type TurnSubjects = {
  subjects: ReadonlyArray<ChatResolvedSubjectPreResolution>;
  // Set only for comparisons: a named company to ask about, or ones not found.
  ambiguous?: Exclude<ChatSubjectPreResolution, ChatResolvedSubjectPreResolution>;
  notFound: ReadonlyArray<string>;
  // Some companies were carried forward from the previous answer.
  followUp?: boolean;
};

async function resolveTurnSubjects(
  context: ChatTurnRunContext,
  preResolve: ChatSubjectPreResolver,
  loadPriorSubjects: ChatPriorSubjectsLoader | undefined,
): Promise<TurnSubjects> {
  const text = nonEmptySubjectText(context.userIntent);
  const comparative = COMPARATIVE.test(text ?? "");
  const named = text ? await resolveNamedSubjects(text, preResolve) : { resolved: [], unresolved: [] };
  // Outside comparisons an unresolved token is usually an acronym, not a company,
  // so it is ignored as before.
  if (comparative) {
    const ambiguous = named.unresolved.find((resolution) => resolution.status === "needs_clarification");
    if (ambiguous) return { subjects: [], ambiguous, notFound: [] };
  }
  const notFound = comparative ? named.unresolved.map((resolution) => resolution.input_text) : [];

  const carryForward = loadPriorSubjects !== undefined && (named.resolved.length === 0 || comparative);
  const prior = carryForward
    ? await loadPriorSubjects({ threadId: context.threadId, ...(context.userId ? { userId: context.userId } : {}) })
    : [];
  // Newly named companies get the capped slots first; carried-forward ones fill
  // the rest and stay listed first.
  const newlyNamed = distinctCompanies(named.resolved).slice(0, MAX_TURN_SUBJECTS);
  const namedKeys = new Set(newlyNamed.map(companyKey));
  const carried = distinctCompanies(prior)
    .filter((subject) => !namedKeys.has(companyKey(subject)))
    .slice(0, MAX_TURN_SUBJECTS - newlyNamed.length);
  return { subjects: [...carried, ...newlyNamed], notFound, followUp: carried.length > 0 };
}

async function resolveNamedSubjects(
  text: string,
  preResolve: ChatSubjectPreResolver,
): Promise<{ resolved: ChatResolvedSubjectPreResolution[]; unresolved: Exclude<ChatSubjectPreResolution, ChatResolvedSubjectPreResolution>[] }> {
  // The whole message first, so a bare ticker, a company name, or a theme
  // resolves exactly as before; otherwise every ticker it mentions, in order.
  const whole = await preResolve({ text });
  if (whole.status === "resolved") return { resolved: [whole], unresolved: [] };
  const resolutions = await Promise.all(extractSubjectMentions(text).map((mention) => preResolve({ text: mention })));
  return {
    resolved: resolutions.filter((resolution) => resolution.status === "resolved"),
    unresolved: resolutions.filter((resolution) => resolution.status !== "resolved"),
  };
}

// One entry per company: two listings of the same issuer collapse.
function distinctCompanies(
  subjects: ReadonlyArray<ChatResolvedSubjectPreResolution>,
): ChatResolvedSubjectPreResolution[] {
  const seen = new Set<string>();
  return subjects.filter((subject) => {
    const key = companyKey(subject);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


async function runResolvedSubjectTurn(
  runner: ChatTurnRunner,
  context: ChatTurnRunContext,
  subjects: ReadonlyArray<ChatResolvedSubjectPreResolution>,
): Promise<void> {
  const preResolution = subjects[0];
  const bundleId = chooseBundleIdForSubjectKind(preResolution.subject_ref.kind);
  // Emit turn.started with the resolved bundle_id BEFORE any tool events. The
  // runner's emit wrapper auto-fabricates an empty turn.started on the first
  // non-turn.started emit; if tool events fired first, that fabricated event
  // would land on the SSE stream without a bundle_id, breaking consumers that
  // key setup off turn.started.
  context.emit("turn.started", { bundle_id: bundleId });

  const toolCallId = subjectResolutionToolCallId(context);
  emitSubjectResolutionToolEvents(context.emit, preResolution, toolCallId);

  await runner({
    ...context,
    subjectPreResolution: preResolution,
    subjectPreResolutions: subjects,
    bundleId,
  });
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

async function toolBackedAnalystTurnRunner(
  context: ChatTurnRunContext,
  options: {
    persistAssistantMessage?: ChatAssistantMessagePersistence;
    runtime: ChatAnalystToolRuntime;
    verificationMode: ChatVerificationMode;
  },
) {
  const { emit } = context;
  const preResolution = context.subjectPreResolution ?? null;
  const coveredRefs = context.subjectPreResolutions?.map((subject) => subject.subject_ref) ?? [];
  const subjectRef = {
    ...(preResolution?.status === "resolved" ? { subject_ref: preResolution.subject_ref } : {}),
    ...(coveredRefs.length > 0 ? { subject_refs: coveredRefs } : {}),
  };
  const turnId = context.turnId ?? context.runId;
  if (!preResolution) {
    emit("turn.started", { bundle_id: context.bundleId });
  }

  const result = await options.runtime(context);
  const toolCalls = result.tool_calls ?? [];
  for (const toolCall of toolCalls) {
    emit("tool.started", {
      tool_call_id: toolCall.tool_call_id,
      tool_name: toolCall.tool_name,
      bundle_id: toolCall.bundle_id,
      ...(toolCall.arguments === undefined ? {} : { arguments: toolCall.arguments }),
    });
    emit("tool.completed", {
      ...toolCall,
    });
  }

  const assistantBlocks = Object.freeze(
    withUnresolvedNote(result.blocks, context.unresolvedMentions ?? []).map((block) => Object.freeze({ ...block })),
  );
  const contentHash = contentHashForText(JSON.stringify(assistantBlocks));
  // The guard's drops, on every completion that shows the answer (#144).
  const narrativeRemoved = result.narrative_removed?.length ? { narrative_removed: result.narrative_removed } : {};
  // Which model answered, on the completion and the saved message (#183).
  const answeredBy = result.answered_by ? { answered_by: result.answered_by } : {};
  const answerUsage = result.answer_usage ? { answer_usage: result.answer_usage } : {};

  // display_unverified: show what failed verification, labelled, and save nothing.
  // turn.completed carries the full blocks because there is no message to reload.
  const showUnverified = (failures: ReadonlyArray<unknown>) => {
    emit("snapshot.staged", {
      snapshot_id: result.snapshot_id,
      status: "staged",
      verification: { ok: false, failures },
    });
    emitAssistantBlocks(emit, assistantBlocks, contentHash);
    emit("turn.completed", {
      bundle_id: context.bundleId,
      ...subjectRef,
      ...narrativeRemoved,
      ...answeredBy,
      ...answerUsage,
      unverified: { persisted: false, failures, blocks: assistantBlocks },
    });
  };

  if (!result.verification.ok) {
    const failures = result.verification.failures ?? [];
    if (options.verificationMode === "display_unverified") {
      showUnverified(failures);
      return;
    }
    emit("snapshot.staged", {
      snapshot_id: result.snapshot_id,
      status: "staged",
      verification: result.verification,
    });
    emit("turn.error", {
      error_code: "snapshot_verification_failed",
      message: "snapshot verification failed",
      failures,
    });
    return;
  }

  let snapshotId = result.snapshot_id;
  let messageId = stableUuid(`message:${context.threadId}:${context.runId}:${turnId}`);

  if (options.persistAssistantMessage) {
    let persisted: Awaited<ReturnType<ChatAssistantMessagePersistence>>;
    try {
      persisted = await options.persistAssistantMessage({
        threadId: context.threadId,
        runId: context.runId,
        turnId,
        role: "assistant",
        blocks: assistantBlocks,
        content_hash: contentHash,
        ...answeredBy,
        ...(result.research_scope ? { research_scope: result.research_scope } : {}),
      });
    } catch (error) {
      if (options.verificationMode === "display_unverified" && error instanceof ChatSnapshotSealError) {
        showUnverified(error.failures);
        return;
      }
      throw error;
    }
    snapshotId = persisted.snapshot_id;
    messageId = persisted.message_id;
  }

  emit("snapshot.staged", {
    snapshot_id: snapshotId,
    status: "staged",
    verification: result.verification,
  });
  emit("snapshot.sealed", {
    snapshot_id: snapshotId,
    status: "sealed",
    verification: result.verification,
  });
  emitAssistantBlocks(emit, assistantBlocks, contentHash);
  emit("turn.completed", {
    message_id: messageId,
    bundle_id: context.bundleId,
    ...subjectRef,
    ...narrativeRemoved,
    ...answeredBy,
    ...answerUsage,
  });
}

// Names the companies a comparison asked for but that could not be found, at
// the start of the narrative, so a partial answer never looks complete.
function withUnresolvedNote(
  blocks: ReadonlyArray<Record<string, unknown>>,
  mentions: ReadonlyArray<string>,
): ReadonlyArray<Record<string, unknown>> {
  if (mentions.length === 0) return blocks;
  const note = `I could not find ${mentions.join(", ")}, so this answer leaves ${mentions.length === 1 ? "it" : "them"} out. `;
  const index = blocks.findIndex((block) => block.kind === "rich_text" && Array.isArray(block.segments));
  if (index === -1) return blocks;
  const block = blocks[index];
  const segments = [{ type: "text", text: note }, ...(block.segments as ReadonlyArray<unknown>)];
  return blocks.map((candidate, i) => (i === index ? { ...block, segments } : candidate));
}

function emitAssistantBlocks(
  emit: ChatTurnEmit,
  blocks: ReadonlyArray<Record<string, unknown>>,
  contentHash: string,
): void {
  for (const block of blocks) {
    const blockId = nonEmptyString((block as { id?: unknown }).id) ?? stableUuid(`block:${contentHash}`);
    emit("block.began", {
      block_id: blockId,
      kind: nonEmptyString((block as { kind?: unknown }).kind) ?? "rich_text",
    });
    emit("block.delta", {
      block_id: blockId,
      delta: {
        segment: {
          type: "text",
          text: textFromBlock(block),
        },
      },
    });
    emit("block.completed", {
      block_id: blockId,
      content_hash: contentHash,
    });
  }
}

async function missingAnalystToolRuntimeRunner(context: ChatTurnRunContext) {
  if (!context.subjectPreResolution) {
    context.emit("turn.started", { bundle_id: context.bundleId });
  }
  context.emit("turn.error", {
    error_code: "analyst_tool_runtime_not_configured",
    message: "analyst tool runtime is not configured",
  });
}

async function syntheticAnalystTurnRunner(
  context: ChatTurnRunContext,
  persistAssistantMessage?: ChatAssistantMessagePersistence,
) {
  const { emit } = context;
  const preResolution = context.subjectPreResolution ?? null;
  const assistantText = defaultAnalystText(context, preResolution);
  const snapshotSeed = stableUuid(`snapshot:${context.threadId}:${context.runId}:${context.turnId ?? context.runId}`);
  const blockId = stableUuid(`block:${context.threadId}:${context.runId}:${assistantText}`);
  const assistantBlocks = Object.freeze([
    createRichTextBlock({
      id: blockId,
      snapshotId: snapshotSeed,
      text: assistantText,
      title: preResolution?.display_label ?? "Research note",
    }),
  ]);
  const contentHash = contentHashForText(JSON.stringify(assistantBlocks));
  let snapshotId = snapshotSeed;
  let messageId = stableUuid(`message:${context.threadId}:${context.runId}:${context.turnId ?? context.runId}`);

  if (!preResolution) {
    emit("turn.started", { bundle_id: context.bundleId });
    emit("tool.started", {
      tool_call_id: "compose-analyst-blocks",
      tool_name: "compose_analyst_blocks",
    });
    emit("tool.completed", {
      tool_call_id: "compose-analyst-blocks",
      tool_name: "compose_analyst_blocks",
      status: "ok",
      bundle_id: context.bundleId,
    });
  }

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
    snapshot_id: snapshotId,
    status: "staged",
  });
  emit("snapshot.sealed", {
    snapshot_id: snapshotId,
    status: "sealed",
  });
  emit("block.began", {
    block_id: blockId,
    kind: "rich_text",
  });
  emit("block.delta", {
    block_id: blockId,
    delta: {
      segment: {
        type: "text",
        text: assistantText,
      },
    },
  });
  emit("block.completed", {
    block_id: blockId,
    content_hash: contentHash,
  });
  emit("turn.completed", {
    message_id: messageId,
    bundle_id: context.bundleId,
    ...(preResolution?.status === "resolved" ? { subject_ref: preResolution.subject_ref } : {}),
    ...(preResolution !== null && preResolution.status !== "resolved" ? { clarification: true } : {}),
  });
}

function defaultAnalystText(
  context: ChatTurnRunContext,
  preResolution: ChatResolvedSubjectPreResolution | null,
): string {
  const intent = context.userIntent?.trim();
  const focus = intent && intent.length > 0 ? intent : "Start a research thread";
  if (preResolution) {
    return `${preResolution.display_label}: ${focus}. I will ground the memo in sealed snapshot blocks and cite structured facts, claims, and events as they are loaded.`;
  }
  return `${focus}. I will use the ${context.bundleId} bundle and return typed research blocks pinned to a snapshot.`;
}

export function createRegistryBackedAnalystToolRuntime(options: {
  registry?: ToolRegistry;
  preferredToolName?: string;
  executeTool?: ChatAnalystToolExecutor;
} = {}): ChatAnalystToolRuntime {
  const registry = options.registry ?? loadToolRegistry();
  return async (context) => {
    const turnId = context.turnId ?? context.runId;
    const policy = createTurnToolPolicy({
      registry,
      audience: "analyst",
      classification: {
        bundle_id: context.bundleId,
        reason: "chat_coordinator",
      },
      resolved_context: context.subjectPreResolution
        ? context.subjectPreResolution.handoff as JsonValue
        : undefined,
      user_turn: context.userIntent,
    });
    if (!policy.ok) {
      throw new Error(policy.message);
    }

    const selectedTool = options.preferredToolName
      ? registry.getTool(options.preferredToolName)
      : policy.selection.tools.find((tool) =>
        !tool.name.startsWith("resolve_") && tool.read_only && !tool.approval_required
      )
        ?? policy.selection.tools[0];
    if (!selectedTool) {
      throw new Error(`No analyst tools are registered for bundle "${context.bundleId}"`);
    }

    const toolArguments = {
      query: nonEmptyString(context.userIntent) ?? "Start a research thread",
      ...(context.subjectPreResolution
        ? { subject_ref: context.subjectPreResolution.subject_ref }
        : {}),
    } satisfies Record<string, JsonValue>;
    const decision = policy.checkToolCall({
      tool_name: selectedTool.name,
      arguments: toolArguments,
    });
    const toolCallId = stableUuid(`tool:${context.threadId}:${turnId}:${selectedTool.name}`);
    const toolCall = await runtimeToolCallFromDecision({
      registry,
      bundleId: policy.bundle_id,
      toolCallId,
      toolName: selectedTool.name,
      arguments: toolArguments,
      decision,
      idempotencyKey: `${context.threadId}:${turnId}:${selectedTool.name}`,
      executeTool: options.executeTool,
    });
    const snapshotId = stableUuid(`snapshot:${context.threadId}:${turnId}:${context.bundleId}:${toolCall.status}`);
    const noteText = toolCall.status === "pending_approval"
      ? `Approval is required before ${selectedTool.name} can run.`
      : toolCall.status === "skipped"
      ? `${selectedTool.name} was selected for the ${context.bundleId} bundle, but no executor is configured for this registry-backed runtime.`
      : `${toolArguments.query}. Used ${selectedTool.name} from the ${context.bundleId} bundle and produced snapshot-backed research blocks.`;
    const verification = toolCall.status === "ok" || toolCall.status === "pending_approval"
      ? { ok: true, failures: [] }
      : {
          ok: false,
          failures: [
            {
              reason_code: "tool_execution_unavailable",
              tool_name: selectedTool.name,
              status: toolCall.status,
            },
          ],
        };
    return {
      snapshot_id: snapshotId,
      verification,
      tool_calls: [toolCall],
      blocks: [
        createRichTextBlock({
          id: stableUuid(`block:${context.threadId}:${turnId}:${selectedTool.name}`),
          snapshotId,
          title: policy.selection.prompt_template.bundle_id,
          text: noteText,
        }),
      ],
    };
  };
}

async function runtimeToolCallFromDecision(input: {
  registry: ToolRegistry;
  bundleId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, JsonValue>;
  decision: ToolCallBudgetDecision;
  idempotencyKey: string;
  executeTool?: ChatAnalystToolExecutor;
}): Promise<ChatAnalystToolRuntimeToolCall> {
  if (!input.decision.ok) {
    return {
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      status: "action" in input.decision && input.decision.action === "partial_answer" ? "skipped" : "rejected",
      bundle_id: input.bundleId,
      arguments: input.arguments,
      result: input.decision as unknown as JsonValue,
    };
  }

  const approval = interceptToolCall({
    registry: input.registry,
    bundle_id: input.bundleId,
    audience: "analyst",
    tool_name: input.toolName,
    arguments: input.arguments,
    idempotency_key: input.idempotencyKey,
  });
  if (!approval.ok) {
    return {
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      status: "rejected",
      bundle_id: input.bundleId,
      arguments: input.arguments,
      result: approval as unknown as JsonValue,
    };
  }
  if (approval.action === "pending_approval") {
    return {
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      status: "pending_approval",
      bundle_id: input.bundleId,
      arguments: input.arguments,
      approval_required: true,
      pending_action: approval.pending_action as unknown as JsonValue,
    };
  }
  if (!input.executeTool) {
    return {
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      status: "skipped",
      bundle_id: input.bundleId,
      arguments: input.arguments,
      result: {
        kind: "tool_execution_unavailable",
        tool_name: input.toolName,
        status: "skipped",
        note: "Tool runtime selected and authorized this call, but no executor was configured.",
      },
    };
  }
  return {
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    status: "ok",
    bundle_id: input.bundleId,
    arguments: input.arguments,
    result: await input.executeTool({
      tool: approval.tool,
      bundleId: input.bundleId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      arguments: input.arguments,
      idempotencyKey: input.idempotencyKey,
    }),
  };
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

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function textFromBlock(block: Record<string, unknown>): string {
  const segments = Array.isArray(block.segments) ? block.segments : [];
  const text = segments
    .map((segment) => {
      if (segment === null || typeof segment !== "object") return "";
      const value = (segment as Record<string, unknown>).text;
      return typeof value === "string" ? value : "";
    })
    .filter((value) => value.length > 0)
    .join("");
  return text.length > 0 ? text : JSON.stringify(block);
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
  const snapshotId = stableUuid(`subject-snapshot:${input.threadId}:${input.turnId}`);
  const blockId = stableUuid(`subject-clarification:${input.threadId}:${input.turnId}`);
  return {
    blocks: Object.freeze([
      createRichTextBlock({
        id: blockId,
        snapshotId,
        text: input.preResolution.message,
        title: "Clarify subject",
      }),
    ]),
    content_hash: contentHashForText(input.preResolution.message),
    text: input.preResolution.message,
    block_id: blockId,
  };
}

function createRichTextBlock(input: {
  id: string;
  snapshotId: string;
  text: string;
  title: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: input.id,
    kind: "rich_text",
    snapshot_id: input.snapshotId,
    data_ref: Object.freeze({
      kind: "chat_turn",
      id: input.id,
    }),
    source_refs: Object.freeze([]),
    as_of: new Date(0).toISOString(),
    title: input.title,
    segments: Object.freeze([
      Object.freeze({
        type: "text",
        text: input.text,
      }),
    ]),
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
