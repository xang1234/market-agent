import type { JsonValue } from "../../observability/src/types.ts";
import type { ChatTurnEmit, ChatTurnRunner } from "./coordinator.ts";
import type { ChatSseEventType } from "./sse.ts";

// When each plan event of a turn was emitted, in ms from the turn's start, and
// how long the turn took. The client replays the events through the plan it
// streams (web/src/chat/streamPlan.ts), so a saved answer names the same steps
// its live panel showed, and the server keeps no copy of how events map to them.
export type WorkSummary = {
  elapsed_ms: number;
  events: ReadonlyArray<WorkEvent>;
};

export type WorkEvent = { type: ChatSseEventType; at_ms: number } & Partial<Record<(typeof PLAN_FIELDS)[number], JsonValue>>;

export type ChatWorkSummarySave = (input: {
  thread_id: string;
  message_id: string;
  work_summary: WorkSummary;
}) => Promise<void>;

const PLAN_EVENT_TYPES: ReadonlySet<ChatSseEventType> = new Set([
  "turn.started",
  "tool.started",
  "tool.completed",
  "snapshot.staged",
  "snapshot.sealed",
  "block.began",
  "block.completed",
]);

// The payload fields the client's plan reads; the rest (tool arguments and
// results, verification reports) stay out of the saved row.
const PLAN_FIELDS = [
  "bundle_id",
  "subject_resolution",
  "tool_call_id",
  "tool_name",
  "status",
  "resolution_status",
  "snapshot_id",
  "block_id",
  "kind",
] as const;

export function workSummaryRunner(
  runner: ChatTurnRunner,
  options: { save?: ChatWorkSummarySave; now: () => number },
): ChatTurnRunner {
  const { save, now } = options;
  if (!save) return runner;

  return async (context) => {
    const startedAt = now();
    const events: WorkEvent[] = [];
    let saving: Promise<void> | null = null;
    const emit: ChatTurnEmit = (type, payload = {}) => {
      const at_ms = now() - startedAt;
      // As the turn's stream has it: the turn emits its own turn.started before
      // any other event, and drops one that repeats it with nothing new. The
      // first is timed from the turn's start: what the turn does before it
      // emits anything (reading the question) is the planner's work.
      const first = !events.some((event) => event.type === "turn.started");
      if (first && type !== "turn.started") events.push({ type: "turn.started", at_ms: 0 });
      const repeat = type === "turn.started" && !first && Object.keys(payload).length === 0;
      if (PLAN_EVENT_TYPES.has(type) && !repeat) events.push(planEvent(type, first && type === "turn.started" ? 0 : at_ms, payload));
      // An unverified answer is not saved, so there is no message to record on.
      if (type !== "turn.completed" || saving !== null || typeof payload.message_id !== "string" || payload.unverified !== undefined) {
        return context.emit(type, payload);
      }
      const work_summary: WorkSummary = { elapsed_ms: at_ms, events: [...events] };
      saving = save({ thread_id: context.threadId, message_id: payload.message_id, work_summary }).catch((error: unknown) => {
        // The answer is saved and shown; only its "Worked for" line is lost on reload.
        console.error("[chat] saving the turn's work summary failed", error);
      });
      // The completion carries it too, so the answer shows the line before any reload.
      const message = payload.message;
      return context.emit(type, isRecord(message) ? { ...payload, message: { ...message, work_summary } } : payload);
    };
    try {
      await runner({ ...context, emit });
    } finally {
      await saving;
    }
  };
}

function planEvent(type: ChatSseEventType, at_ms: number, payload: Record<string, unknown>): WorkEvent {
  const event: WorkEvent = { type, at_ms };
  for (const field of PLAN_FIELDS) {
    // A payload is JSON: it goes out on the stream as it is.
    if (payload[field] !== undefined) event[field] = payload[field] as JsonValue;
  }
  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
