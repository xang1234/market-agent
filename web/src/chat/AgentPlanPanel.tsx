import { Circle, CircleCheck, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useCallback, useState, type ReactElement } from 'react'

import type { StreamPlanStep, StreamPlanStepStatus } from './streamPlan.ts'

type AgentPlanPanelProps = {
  steps: ReadonlyArray<StreamPlanStep>
}

type StatusView = { Icon: LucideIcon; icon: string; row: string; label: string }

const STATUS_VIEW: Readonly<Record<StreamPlanStepStatus, StatusView>> = {
  waiting: { Icon: Circle, icon: 'text-faint', row: 'text-faint', label: 'text-faint' },
  running: { Icon: LoaderCircle, icon: 'text-accent motion-safe:animate-spin', row: 'text-fg', label: 'text-fg live-shine' },
  done: { Icon: CircleCheck, icon: 'text-positive', row: 'text-fg-soft', label: 'text-fg' },
  error: { Icon: CircleX, icon: 'text-negative', row: 'text-negative', label: 'text-fg' },
}

export function AgentPlanPanel({ steps }: AgentPlanPanelProps): ReactElement | null {
  // ponytail: the stream events carry no timestamps, so the clock starts when the turn's view mounts.
  const [startedAt] = useState(() => Date.now())
  const working = !steps.some((step) => step.status === 'error') && !steps.every((step) => step.status === 'done')
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
        <span ref={tick} />
      </h3>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => {
          const view = STATUS_VIEW[step.status]
          return (
            <li key={step.step_id} className={`flex gap-2 text-sm ${view.row}`}>
              <view.Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${view.icon}`} />
              <div className="min-w-0">
                <strong className={`font-semibold ${view.label}`}>{step.label}</strong>
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

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
