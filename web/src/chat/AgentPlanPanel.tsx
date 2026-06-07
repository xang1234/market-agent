import type { ReactElement } from 'react'

import type { StreamPlanStep, StreamPlanStepStatus } from './streamPlan.ts'

type AgentPlanPanelProps = {
  steps: ReadonlyArray<StreamPlanStep>
}

const STATUS_CLASS: Readonly<Record<StreamPlanStepStatus, string>> = {
  waiting: 'border-line-strong bg-surface-2',
  running: 'border-accent bg-accent',
  done: 'border-positive bg-positive',
  error: 'border-negative bg-negative',
}

const ROW_TEXT_CLASS: Readonly<Record<StreamPlanStepStatus, string>> = {
  waiting: 'text-faint',
  running: 'text-fg',
  done: 'text-fg-soft',
  error: 'text-negative',
}

export function AgentPlanPanel({ steps }: AgentPlanPanelProps): ReactElement | null {
  if (steps.length === 0) return null

  return (
    <section
      data-testid="agent-plan-panel"
      aria-label="Agent plan"
      className="rounded-xl border border-line bg-surface p-4 shadow-sm"
    >
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
        Agent plan · {steps.length} {steps.length === 1 ? 'step' : 'steps'}
      </h3>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.step_id} className={`flex gap-2 text-sm ${ROW_TEXT_CLASS[step.status]}`}>
            <span
              aria-hidden="true"
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${STATUS_CLASS[step.status]}`}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className={step.status === 'waiting' ? 'font-semibold text-faint' : 'font-semibold text-fg'}>
                  {step.label}
                </strong>
                <span className="text-xs uppercase tracking-wide">{step.status}</span>
              </div>
              <p className="mt-0.5">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
