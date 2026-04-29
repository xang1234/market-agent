export const CHAT_SSE_EVENT_TYPES = [
  "turn.started",
  "tool.started",
  "tool.completed",
  "snapshot.staged",
  "snapshot.sealed",
  "block.began",
  "block.delta",
  "block.completed",
  "turn.completed",
  "turn.error",
] as const;

export type ChatSseEventType = (typeof CHAT_SSE_EVENT_TYPES)[number];
export type ChatSseWireEventType = ChatSseEventType;

export type ChatSseContext = {
  threadId: string;
  runId: string;
  turnId?: string;
};

export type ChatSseEvent = {
  type: ChatSseWireEventType;
  seq: number;
  thread_id: string;
  run_id: string;
  turn_id: string;
} & Record<string, unknown>;

const BLOCK_EVENT_TYPES = new Set<ChatSseWireEventType>([
  "block.began",
  "block.delta",
  "block.completed",
]);

const TOOL_EVENT_TYPES = new Set<ChatSseWireEventType>(["tool.started", "tool.completed"]);
const SNAPSHOT_EVENT_TYPES = new Set<ChatSseWireEventType>(["snapshot.staged", "snapshot.sealed"]);

export function createChatSseSequencer(context: ChatSseContext, initialSeq = 0) {
  let seq = initialSeq;

  return {
    next(type: ChatSseWireEventType, payload: Record<string, unknown> = {}): ChatSseEvent {
      seq += 1;
      return createChatSseEvent(context, type, seq, payload);
    },
    currentSeq(): number {
      return seq;
    },
  };
}

export function createChatSseEvent(
  context: ChatSseContext,
  type: ChatSseWireEventType,
  seq: number,
  payload: Record<string, unknown> = {},
): ChatSseEvent {
  assertPositiveSeq(seq);
  assertCorrelationFields(type, payload);

  return {
    ...payload,
    type,
    seq,
    thread_id: context.threadId,
    run_id: context.runId,
    turn_id: context.turnId ?? context.runId,
  };
}

export function stubSuccessEvents(
  sequencer: ReturnType<typeof createChatSseSequencer>,
): ChatSseEvent[] {
  return [
    sequencer.next("turn.started", { stub: true }),
    sequencer.next("tool.started", {
      stub: true,
      tool_call_id: "tool-call-1",
      tool_name: "resolve_subjects",
    }),
    sequencer.next("tool.completed", {
      stub: true,
      tool_call_id: "tool-call-1",
      tool_name: "resolve_subjects",
      status: "ok",
    }),
    sequencer.next("snapshot.staged", {
      stub: true,
      snapshot_id: "snapshot-1",
      status: "staged",
    }),
    sequencer.next("snapshot.sealed", {
      stub: true,
      snapshot_id: "snapshot-1",
      status: "sealed",
    }),
    sequencer.next("block.began", {
      stub: true,
      block_id: "block-1",
      kind: "rich_text",
    }),
    sequencer.next("block.delta", {
      stub: true,
      block_id: "block-1",
      delta: {
        segment: {
          type: "text",
          text: "Stub research stream ready.",
        },
      },
    }),
    sequencer.next("block.completed", {
      stub: true,
      block_id: "block-1",
      content_hash: "stub-block-1",
    }),
    sequencer.next("turn.completed", {
      stub: true,
      message_id: "message-1",
    }),
  ];
}

function assertPositiveSeq(seq: number) {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error("chat SSE event seq must be a positive integer");
  }
}

function assertCorrelationFields(type: ChatSseWireEventType, payload: Record<string, unknown>) {
  if (BLOCK_EVENT_TYPES.has(type)) {
    assertNonEmptyString(payload.block_id, `${type}.block_id`);
  }

  if (TOOL_EVENT_TYPES.has(type)) {
    assertNonEmptyString(payload.tool_call_id, `${type}.tool_call_id`);
  }

  if (SNAPSHOT_EVENT_TYPES.has(type)) {
    assertNonEmptyString(payload.snapshot_id, `${type}.snapshot_id`);
  }
}

function assertNonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`chat SSE event ${label} is required`);
  }
}
