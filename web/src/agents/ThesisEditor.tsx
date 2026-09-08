import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FetchImpl } from '../http/authFetch.ts'
import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'
import { draftAgentThesisConditions, saveAgentThesis } from './thesisClient.ts'
import { parseThesisText, parseThesisConditions, THESIS_CONDITIONS_MAX } from '../../../services/agents/src/thesis-types.ts'
import type { ThesisCondition, ThesisMetricCheck, ThesisMetricOption, ThesisPeriodKind, ThesisVersion } from '../../../services/agents/src/thesis-types.ts'

const FIELD_CLASS = 'rounded-md border border-line-strong bg-surface px-3 py-2 text-sm'
const SECONDARY_BUTTON_CLASS = 'rounded-md border border-line-strong px-3 py-2 text-sm font-medium disabled:opacity-50'

const PERIOD_LABELS: Readonly<Record<ThesisPeriodKind, string>> = {
  point: 'point in time',
  fiscal_q: 'fiscal quarter',
  fiscal_y: 'fiscal year',
  ttm: 'trailing twelve months',
}

// The editor owns its draft and base version for the lifetime of this agent.
// History updates only become draft updates after an explicit load or save.
export function ThesisEditor({ userId, agentId, initialThesis, savedThesis, metrics, fetchImpl, onSaved }: {
  userId: string
  agentId: string
  initialThesis: string
  savedThesis: ThesisVersion | null
  metrics: ThesisMetricOption[]
  fetchImpl?: FetchImpl
  onSaved(thesis: ThesisVersion): void
}) {
  const [phase, setPhase] = useState<'ready' | 'saving' | 'drafting'>('ready')
  const [baseVersion, setBaseVersion] = useState(savedThesis?.version ?? 0)
  const [thesisText, setThesisText] = useState(savedThesis?.thesis ?? initialThesis)
  const [conditions, setConditions] = useState(() => savedThesis?.conditions.map(copyCondition) ?? [])
  const [message, setMessage] = useState(savedThesis ? `Editing thesis version ${savedThesis.version}` : 'Add one to five conditions, then save the first version.')
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (phase !== 'ready') return
    let normalizedThesis: string
    let normalizedConditions: ThesisCondition[]
    try {
      normalizedThesis = parseThesisText(thesisText)
      normalizedConditions = parseThesisConditions(conditions.map(normalizeCondition))
    } catch (error) {
      setMessage(errorMessage(error))
      return
    }
    setPhase('saving')
    setMessage('Saving a new thesis version')
    try {
      const saved = await saveAgentThesis({
        userId,
        agentId,
        thesis: {
          expected_version: baseVersion,
          thesis: normalizedThesis,
          conditions: normalizedConditions,
        },
        fetchImpl,
      })
      if (!mountedRef.current) return
      setBaseVersion(saved.version)
      setThesisText(saved.thesis)
      setConditions(saved.conditions.map(copyCondition))
      setPhase('ready')
      setMessage(`Thesis version ${saved.version} saved`)
      onSaved(saved)
    } catch (error) {
      if (!mountedRef.current) return
      setPhase('ready')
      setMessage(errorMessage(error))
    }
  }

  const draft = async () => {
    if (phase === 'drafting' || phase === 'saving') return
    let normalizedThesis: string
    try {
      normalizedThesis = parseThesisText(thesisText)
    } catch (error) {
      setMessage(errorMessage(error))
      return
    }
    setPhase('drafting')
    setMessage('Suggesting conditions')
    try {
      const suggested = await draftAgentThesisConditions({ userId, agentId, thesis: normalizedThesis, fetchImpl })
      if (!mountedRef.current) return
      setConditions(suggested.map(copyCondition))
      setPhase('ready')
      setMessage('Review and edit these suggestions before saving. Nothing has been saved yet.')
    } catch (error) {
      if (!mountedRef.current) return
      setPhase('ready')
      setMessage(errorMessage(error))
    }
  }

  return (
    <>
      {(savedThesis?.version ?? 0) !== baseVersion ? (
        <div className="mt-4 rounded-md border border-line p-3 text-sm">
          <p>A newer thesis version is available. Your edits have been kept.</p>
          <button type="button" disabled={phase !== 'ready'} className={SECONDARY_BUTTON_CLASS} onClick={() => {
            setBaseVersion(savedThesis?.version ?? 0)
            setThesisText(savedThesis?.thesis ?? initialThesis)
            setConditions(savedThesis?.conditions.map(copyCondition) ?? [])
            setMessage('Loaded the saved thesis version.')
          }}>Load saved version</button>
        </div>
      ) : null}
      <form onSubmit={save} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium text-fg">
          Investment thesis
          <textarea
            name="thesis-text"
            value={thesisText}
            onChange={(event) => setThesisText(event.currentTarget.value)}
            disabled={phase !== 'ready'}
            rows={4}
            className={`${FIELD_CLASS} disabled:opacity-60`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void draft()} disabled={phase !== 'ready'} className={SECONDARY_BUTTON_CLASS}>
            Suggest conditions
          </button>
          <button
            type="button"
            onClick={() => setConditions((current) => current.length >= THESIS_CONDITIONS_MAX ? current : [...current, blankCondition()])}
            disabled={phase !== 'ready' || conditions.length >= THESIS_CONDITIONS_MAX}
            className={SECONDARY_BUTTON_CLASS}
          >
            Add condition
          </button>
          <span className="text-xs text-muted">{conditions.length}/{THESIS_CONDITIONS_MAX} conditions</span>
        </div>
        {conditions.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-3 text-sm text-muted">
            No conditions yet. Add one yourself or ask for editable suggestions.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {conditions.map((condition, index) => (
              <ConditionEditor
                key={condition.condition_id}
                condition={condition}
                index={index}
                metrics={metrics}
                disabled={phase !== 'ready'}
                onChange={(next) => setConditions((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))}
                onRemove={() => setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              />
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={phase !== 'ready'} className={`${PRIMARY_BUTTON_CLASS} disabled:opacity-50`}>
            Save thesis
          </button>
          <p role="status" className="text-sm text-fg-soft">{message}</p>
        </div>
      </form>

    </>
  )
}

function ConditionEditor({
  condition,
  index,
  metrics,
  disabled,
  onChange,
  onRemove,
}: {
  condition: ThesisCondition
  index: number
  metrics: ReadonlyArray<ThesisMetricOption>
  disabled: boolean
  onChange(condition: ThesisCondition): void
  onRemove(): void
}) {
  const metricOptions = optionsIncludingSaved(metrics, condition.metric)
  return (
    <li className="rounded-md border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">Condition {index + 1}</h3>
        <button type="button" onClick={onRemove} disabled={disabled} className="text-xs font-medium text-negative disabled:opacity-50">
          Remove
        </button>
      </div>
      <div className="mt-3 grid gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg">
          What must remain true
          <textarea
            name={`thesis-condition-${index}-statement`}
            value={condition.statement}
            onChange={(event) => onChange({ ...condition, statement: event.currentTarget.value })}
            rows={2}
            disabled={disabled}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg">
          What would disconfirm it
          <textarea
            name={`thesis-condition-${index}-falsifier`}
            value={condition.falsifier}
            onChange={(event) => onChange({ ...condition, falsifier: event.currentTarget.value })}
            rows={2}
            disabled={disabled}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg">
          Review horizon
          <input
            name={`thesis-condition-${index}-horizon`}
            value={condition.horizon}
            onChange={(event) => onChange({ ...condition, horizon: event.currentTarget.value })}
            disabled={disabled}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg">
          Numerical check (optional)
          <select
            name={`thesis-condition-${index}-metric`}
            value={condition.metric ? metricValue(condition.metric) : ''}
            onChange={(event) => onChange(withSelectedMetric(condition, metricOptions, event.currentTarget.value))}
            disabled={disabled}
            className={FIELD_CLASS}
          >
            <option value="">Narrative evidence only</option>
            {metricOptions.map((option) => (
              <option key={metricOptionKey(option)} value={metricOptionKey(option)}>
                {metricOptionLabel(option)}{option.savedOnly ? ' · saved metric' : ''}
              </option>
            ))}
          </select>
        </label>
        {condition.metric ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-fg">
              Comparison
              <select
                value={condition.metric.operator}
                onChange={(event) => onChange({ ...condition, metric: { ...condition.metric!, operator: event.currentTarget.value as 'gte' | 'lte' } })}
                disabled={disabled}
                className={FIELD_CLASS}
              >
                <option value="gte">At least</option>
                <option value="lte">At most</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg">
              Threshold ({condition.metric.unit})
              <input
                type="number"
                step="any"
                value={condition.metric.threshold}
                onChange={(event) => onChange({ ...condition, metric: { ...condition.metric!, threshold: Number(event.currentTarget.value) } })}
                disabled={disabled}
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-fg">
              Maximum age (days)
              <input
                type="number"
                min={1}
                max={730}
                value={condition.metric.max_age_days}
                onChange={(event) => onChange({ ...condition, metric: { ...condition.metric!, max_age_days: Number(event.currentTarget.value) } })}
                disabled={disabled}
                className={FIELD_CLASS}
              />
            </label>
          </div>
        ) : null}
      </div>
    </li>
  )
}

type DisplayMetricOption = ThesisMetricOption & { savedOnly?: boolean }

function optionsIncludingSaved(
  metrics: ReadonlyArray<ThesisMetricOption>,
  saved: ThesisMetricCheck | undefined,
): DisplayMetricOption[] {
  if (!saved) return metrics.map((metric) => ({ ...metric }))
  const savedOption: ThesisMetricOption = {
    metric_key: saved.metric_key,
    label: humanizeMetricKey(saved.metric_key),
    unit: saved.unit,
    period_kind: saved.period_kind,
  }
  if (metrics.some((metric) => metricOptionKey(metric) === metricOptionKey(savedOption))) {
    return metrics.map((metric) => ({ ...metric }))
  }
  return [{ ...savedOption, savedOnly: true }, ...metrics.map((metric) => ({ ...metric }))]
}

function withSelectedMetric(
  condition: ThesisCondition,
  options: ReadonlyArray<DisplayMetricOption>,
  value: string,
): ThesisCondition {
  if (value === '') {
    const narrative = { ...condition }
    delete narrative.metric
    return narrative
  }
  const selected = options.find((option) => metricOptionKey(option) === value)
  if (!selected) return condition
  const same = condition.metric && metricValue(condition.metric) === value
  return {
    ...condition,
    metric: {
      metric_key: selected.metric_key,
      unit: selected.unit,
      period_kind: selected.period_kind,
      operator: same ? condition.metric!.operator : 'gte',
      threshold: same ? condition.metric!.threshold : 0,
      max_age_days: same ? condition.metric!.max_age_days : 90,
    },
  }
}

function metricOptionKey(metric: Pick<ThesisMetricOption, 'metric_key' | 'unit' | 'period_kind'>): string {
  return `${metric.metric_key}\u0000${metric.unit}\u0000${metric.period_kind}`
}

function metricValue(metric: ThesisMetricCheck): string {
  return metricOptionKey(metric)
}

function metricOptionLabel(metric: ThesisMetricOption): string {
  return `${metric.label} · ${metric.unit} · ${PERIOD_LABELS[metric.period_kind]}`
}

function humanizeMetricKey(metricKey: string): string {
  return metricKey.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function blankCondition(): ThesisCondition {
  return { condition_id: newConditionId(), statement: '', falsifier: '', horizon: '' }
}

function newConditionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16)
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

function copyCondition(condition: ThesisCondition): ThesisCondition {
  return { ...condition, ...(condition.metric ? { metric: { ...condition.metric } } : {}) }
}

function normalizeCondition(condition: ThesisCondition): ThesisCondition {
  return {
    ...condition,
    statement: condition.statement.trim(),
    falsifier: condition.falsifier.trim(),
    horizon: condition.horizon.trim(),
    ...(condition.metric ? { metric: { ...condition.metric } } : {}),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
