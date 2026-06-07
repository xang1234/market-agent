import type { ChatSseEvent } from './sseEventTypes.ts'

export type StreamPlanStepStatus = 'waiting' | 'running' | 'done' | 'error'

export type StreamPlanStep = {
  step_id: string
  label: string
  detail: string
  status: StreamPlanStepStatus
}

export function planStepsForTurnStarted(event: ChatSseEvent): ReadonlyArray<StreamPlanStep> {
  return Object.freeze([
    Object.freeze({
      step_id: 'planner',
      label: 'Planner',
      detail: turnStartedDetail(event),
      status: 'running',
    }),
    Object.freeze({
      step_id: 'composer',
      label: 'Composer',
      detail: 'Awaiting evidence.',
      status: 'waiting',
    }),
  ])
}

export function planStepsForToolStarted(
  steps: ReadonlyArray<StreamPlanStep>,
  event: ChatSseEvent,
): ReadonlyArray<StreamPlanStep> {
  const toolCallId = readString(event.tool_call_id)
  if (toolCallId === null) return steps
  const toolName = readString(event.tool_name) ?? toolCallId
  return upsertPlanStep(steps, planStepForTool(toolCallId, toolName, 'running', event))
}

export function planStepsForToolCompleted(
  steps: ReadonlyArray<StreamPlanStep>,
  event: ChatSseEvent,
): ReadonlyArray<StreamPlanStep> {
  const toolCallId = readString(event.tool_call_id)
  if (toolCallId === null) return steps
  const toolName = readString(event.tool_name) ?? toolCallId
  return upsertPlanStep(steps, planStepForTool(toolCallId, toolName, toolStatus(event), event))
}

export function planStepsForSnapshotStaged(
  steps: ReadonlyArray<StreamPlanStep>,
  event: ChatSseEvent,
): ReadonlyArray<StreamPlanStep> {
  const snapshotId = readString(event.snapshot_id)
  if (snapshotId === null) return steps
  return upsertPlanStep(markAllRunningStepsDone(steps), {
    step_id: 'snapshot',
    label: 'Snapshot',
    detail: 'Staging verified evidence.',
    status: 'running',
  })
}

export function planStepsForSnapshotSealed(
  steps: ReadonlyArray<StreamPlanStep>,
  event: ChatSseEvent,
): ReadonlyArray<StreamPlanStep> {
  const snapshotId = readString(event.snapshot_id)
  if (snapshotId === null) return steps
  return upsertPlanStep(steps, {
    step_id: 'snapshot',
    label: 'Snapshot',
    detail: 'Evidence snapshot sealed.',
    status: 'done',
  })
}

export function planStepsForBlockBegan(
  steps: ReadonlyArray<StreamPlanStep>,
): ReadonlyArray<StreamPlanStep> {
  return upsertPlanStep(markPlanStepDone(steps, 'snapshot'), {
    step_id: 'composer',
    label: 'Composer',
    detail: 'Rendering the answer.',
    status: 'running',
  })
}

export function markPlanStepDone(
  steps: ReadonlyArray<StreamPlanStep>,
  stepId: string,
): ReadonlyArray<StreamPlanStep> {
  return updatePlanStepStatus(steps, stepId, 'done')
}

export function markRunningPlanStepsError(
  steps: ReadonlyArray<StreamPlanStep>,
): ReadonlyArray<StreamPlanStep> {
  return Object.freeze(steps.map((step) =>
    step.status === 'running' ? Object.freeze({ ...step, status: 'error' }) : step,
  ))
}

function planStepForTool(
  toolCallId: string,
  toolName: string,
  status: StreamPlanStepStatus,
  event: ChatSseEvent,
): StreamPlanStep {
  const label = toolStepLabel(toolName)
  return Object.freeze({
    step_id: label === 'Planner' ? 'planner' : `tool:${toolCallId}`,
    label,
    detail: toolStepDetail(toolName, event, status),
    status,
  })
}

function toolStepLabel(toolName: string): string {
  if (toolName === 'resolve_subjects') return 'Planner'
  if (
    toolName === 'compose_analyst_blocks' ||
    toolName === 'resolve_period' ||
    toolName === 'get_quote' ||
    toolName === 'get_statement_facts' ||
    toolName === 'get_segment_facts' ||
    toolName.includes('consensus') ||
    toolName.includes('estimate') ||
    toolName.includes('peer')
  ) {
    return 'Fundamentals'
  }
  if (
    toolName.includes('filing') ||
    toolName.includes('document') ||
    toolName.includes('claim') ||
    toolName.includes('event') ||
    toolName.includes('news')
  ) {
    return 'News / Filings'
  }
  if (toolName === 'create_agent' || toolName === 'create_alert') return 'Agent setup'
  return titleizeToolName(toolName)
}

function toolStepDetail(toolName: string, event: ChatSseEvent, status: StreamPlanStepStatus): string {
  const statusText = status === 'running' ? 'Running' : status === 'error' ? 'Failed' : 'Completed'
  const resolutionStatus = readString(event.resolution_status)
  if (toolName === 'resolve_subjects' && resolutionStatus !== null) {
    return `${statusText} subject resolution: ${resolutionStatus}.`
  }
  const toolStatusText = readString(event.status)
  if (toolStatusText !== null && status !== 'running') {
    return `${statusText} ${humanizeIdentifier(toolName)}: ${toolStatusText}.`
  }
  return `${statusText} ${humanizeIdentifier(toolName)}.`
}

function turnStartedDetail(event: ChatSseEvent): string {
  const bundleId = readString(event.bundle_id)
  if (bundleId !== null) return `Planning ${humanizeIdentifier(bundleId)}.`
  if (event.subject_resolution === true) return 'Resolving the subject.'
  return 'Planning the research turn.'
}

function toolStatus(event: ChatSseEvent): StreamPlanStepStatus {
  const status = readString(event.status)
  if (status === 'error' || status === 'failed') return 'error'
  return 'done'
}

function upsertPlanStep(
  steps: ReadonlyArray<StreamPlanStep>,
  step: StreamPlanStep,
): ReadonlyArray<StreamPlanStep> {
  const frozenStep = Object.freeze({ ...step })
  const index = steps.findIndex((existing) => existing.step_id === step.step_id)
  if (index === -1) return Object.freeze([...steps, frozenStep])
  const next = [...steps]
  next[index] = frozenStep
  return Object.freeze(next)
}

function markAllRunningStepsDone(steps: ReadonlyArray<StreamPlanStep>): ReadonlyArray<StreamPlanStep> {
  return Object.freeze(steps.map((step) =>
    step.status === 'running' ? Object.freeze({ ...step, status: 'done' }) : step,
  ))
}

function updatePlanStepStatus(
  steps: ReadonlyArray<StreamPlanStep>,
  stepId: string,
  status: StreamPlanStepStatus,
): ReadonlyArray<StreamPlanStep> {
  let changed = false
  const next = steps.map((step) => {
    if (step.step_id !== stepId || step.status === status) return step
    changed = true
    return Object.freeze({ ...step, status })
  })
  return changed ? Object.freeze(next) : steps
}

function titleizeToolName(value: string): string {
  const words = humanizeIdentifier(value)
  return words.length === 0 ? 'Tool' : words.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim()
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
