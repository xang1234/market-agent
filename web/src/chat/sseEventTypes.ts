// Frontend mirror of services/chat/src/sse.ts. Drift-tested against the
// backend so a wire-format change can't ship without an explicit frontend
// update.
export const CHAT_SSE_EVENT_TYPES = [
  'turn.started',
  'tool.started',
  'tool.completed',
  'snapshot.staged',
  'snapshot.sealed',
  'answer.shown',
  'block.began',
  'block.delta',
  'block.completed',
  'turn.completed',
  'turn.error',
  'turn.stopped',
] as const

export type ChatSseEventType = (typeof CHAT_SSE_EVENT_TYPES)[number]

export type ChatSseEvent = {
  type: ChatSseEventType
  seq: number
  thread_id: string
  run_id: string
  turn_id: string
} & Record<string, unknown>
