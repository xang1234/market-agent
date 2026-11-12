import type { ChatSseEvent, ChatSseEventType } from './sseEventTypes.ts'
import { applyChatStreamEvent, INITIAL_STREAM_STATE } from './streamReducer.ts'
import type { StreamPlanStepStatus } from './streamPlan.ts'

// Frontend mirror of services/chat/src/work-summary.ts WorkSummary: when each
// plan event of the answer's turn was emitted, in ms from the turn's start.
export type WorkSummary = {
  elapsed_ms: number
  events: ReadonlyArray<{ type: ChatSseEventType; at_ms: number } & Record<string, unknown>>
}

export type WorkStep = {
  step_id: string
  label: string
  status: Extract<StreamPlanStepStatus, 'done' | 'error'>
  elapsed_ms: number
}

export function parseWorkSummary(value: unknown): WorkSummary | null {
  if (typeof value !== 'object' || value === null) return null
  const { elapsed_ms, events } = value as Record<string, unknown>
  if (!isMs(elapsed_ms) || !Array.isArray(events)) return null
  const valid = events.every((event) => typeof event === 'object' && event !== null && typeof event.type === 'string' && isMs(event.at_ms))
  return valid ? { elapsed_ms, events } : null
}

// The steps the turn's live plan showed, each timed from the event that set it
// running to the one that ended it. Its events go through the same reducer the
// stream did, so the steps are the ones the reader watched. A step that never
// ran is left out; one still running when the turn completed ran to its end.
export function workSteps(summary: WorkSummary): ReadonlyArray<WorkStep> {
  const times = new Map<string, { start: number; end?: number }>()
  let state = INITIAL_STREAM_STATE
  for (const event of summary.events) {
    state = applyChatStreamEvent(state, { seq: 0, thread_id: '', run_id: '', turn_id: '', ...event } as ChatSseEvent)
    for (const step of state.plan_steps) {
      if (step.status === 'waiting') continue
      const time = times.get(step.step_id) ?? { start: event.at_ms }
      times.set(step.step_id, time)
      if (step.status !== 'running') time.end ??= event.at_ms
    }
  }
  return state.plan_steps.flatMap((step) => {
    const time = times.get(step.step_id)
    if (time === undefined) return []
    return [{
      step_id: step.step_id,
      label: step.label,
      status: step.status === 'error' ? 'error' : 'done',
      elapsed_ms: (time.end ?? summary.elapsed_ms) - time.start,
    }]
  })
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function isMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
