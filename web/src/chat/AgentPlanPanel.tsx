import { Circle, CircleCheck, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useCallback, useRef, useState, type ReactElement } from 'react'

import type { StreamPlanStep, StreamPlanStepStatus } from './streamPlan.ts'
import { formatElapsed } from './workSummary.ts'

type AgentPlanPanelProps = {
  steps: ReadonlyArray<StreamPlanStep>
  // False once the turn has ended (failed, or shown unverified): a step still
  // marked running never finished, so it reads as an error and the clock stops.
  active: boolean
}

type StatusView = { Icon: LucideIcon; icon: string; row: string; label: string }

const STATUS_VIEW: Readonly<Record<StreamPlanStepStatus, StatusView>> = {
  waiting: { Icon: Circle, icon: 'text-faint', row: 'text-faint', label: 'text-faint' },
  running: { Icon: LoaderCircle, icon: 'text-accent motion-safe:animate-spin', row: 'text-fg', label: 'text-fg live-shine' },
  done: { Icon: CircleCheck, icon: 'text-positive', row: 'text-fg-soft', label: 'text-fg' },
  error: { Icon: CircleX, icon: 'text-negative', row: 'text-negative', label: 'text-fg' },
}

export function AgentPlanPanel({ steps: streamed, active }: AgentPlanPanelProps): ReactElement | null {
  // ponytail: the stream events carry no timestamps, so the clock starts when the turn's view mounts.
  const [startedAt] = useState(() => Date.now())
  // Each step's clock, by step_id: from the first render that shows it running to the first that shows it ended.
  const stepTimes = useRef(new Map<string, StepTime>())
  const steps = active ? streamed : streamed.map((step) => step.status === 'running' ? { ...step, status: 'error' as const } : step)
  const working = active && !steps.some((step) => step.status === 'error') && !steps.every((step) => step.status === 'done')
  const tick = useCallback((node: HTMLElement | null) => {
    if (node === null) return
    const write = () => { node.textContent = formatElapsed(Date.now() - startedAt) }
    write()
    if (!working) return
    const id = setInterval(write, 1000)
    return () => clearInterval(id)
  }, [startedAt, working])

  if (steps.length === 0) return null

  return (
    <section
      data-testid="agent-plan-panel"
      aria-label="Agent plan"
      className="rounded-xl border border-line bg-surface p-4 shadow-sm"
    >
      <h3 className="text-xs font-semibold text-muted tabular-nums">
        {working ? 'Working · ' : 'Worked for '}
        {/* Inside the turn's live region: a ticking second is not news. */}
        <span ref={tick} aria-hidden="true" />
      </h3>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => {
          const view = STATUS_VIEW[step.status]
          return (
            <li key={step.step_id} className={`flex gap-2 text-sm ${view.row}`}>
              <view.Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${view.icon}`} />
              <div className="min-w-0">
                <strong className={`font-semibold ${view.label}`}>{step.label}</strong>
                <span
                  data-testid="step-time"
                  className="ml-2 text-xs text-muted tabular-nums"
                  ref={(node) => { if (node !== null) node.textContent = stepTime(stepTimes.current, step, Date.now()) }}
                />
                <span className="sr-only"> {step.status}</span>
                <p className="mt-0.5">{step.detail}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

type StepTime = { start?: number; end?: number }

function stepTime(times: Map<string, StepTime>, step: StreamPlanStep, now: number): string {
  const time = times.get(step.step_id) ?? {}
  times.set(step.step_id, time)
  if (step.status === 'running') time.start ??= now
  else if (step.status !== 'waiting' && time.start !== undefined) time.end ??= now
  return time.start === undefined || time.end === undefined ? '' : formatElapsed(time.end - time.start)
}
