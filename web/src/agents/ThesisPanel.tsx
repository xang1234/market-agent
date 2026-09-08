import { useEffect, useRef, useState, type FormEvent } from 'react'

import { InspectableRef } from '../evidence/InspectableRef.tsx'
import type { FetchImpl } from '../http/authFetch.ts'
import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'
import { draftAgentThesisConditions, fetchThesisHistory, saveAgentThesis } from './thesisClient.ts'
import type {
  ConditionAssessment,
  ThesisAssessment,
  ThesisCondition,
  ThesisHistoryResponse,
  ThesisMetricCheck,
  ThesisMetricOption,
  ThesisPeriodKind,
  ThesisVersion,
} from './thesisTypes.ts'

type ThesisPanelProps = {
  userId: string
  agentId: string
  initialThesis: string
  refreshKey: number
  fetchImpl?: FetchImpl
  onSaved(thesis: ThesisVersion): void
  onStructuredChange?: (agentId: string, hasStructuredThesis: boolean) => void
}

type PanelPhase = 'loading' | 'ready' | 'saving' | 'drafting' | 'error'

const FIELD_CLASS = 'rounded-md border border-line-strong bg-surface px-3 py-2 text-sm'
const SECONDARY_BUTTON_CLASS = 'rounded-md border border-line-strong px-3 py-2 text-sm font-medium disabled:opacity-50'

const PERIOD_LABELS: Readonly<Record<ThesisPeriodKind, string>> = {
  point: 'point in time',
  fiscal_q: 'fiscal quarter',
  fiscal_y: 'fiscal year',
  ttm: 'trailing twelve months',
}

const METHOD_LABELS: Readonly<Record<ConditionAssessment['method'], string>> = {
  metric: 'Checked an authoritative numeric fact against this threshold.',
  model: 'Compared the condition with the cited evidence using the assessment model.',
  no_evidence: 'No eligible evidence was available, so the condition remains unresolved.',
}

export function ThesisPanel(props: ThesisPanelProps) {
  return <ThesisPanelContent key={`${props.userId}:${props.agentId}:${props.refreshKey}`} {...props} />
}

function ThesisPanelContent({
  userId,
  agentId,
  initialThesis,
  refreshKey,
  fetchImpl,
  onSaved,
  onStructuredChange,
}: ThesisPanelProps) {
  const [phase, setPhase] = useState<PanelPhase>('loading')
  const [history, setHistory] = useState<ThesisHistoryResponse | null>(null)
  const [thesisText, setThesisText] = useState('')
  const [conditions, setConditions] = useState<ThesisCondition[]>([])
  const [message, setMessage] = useState('Loading thesis conditions')
  const mountedRef = useRef(true)

  useEffect(() => () => {
    mountedRef.current = false
  }, [])
  useEffect(() => {
    let ignore = false
    const controller = new AbortController()
    fetchThesisHistory({ userId, agentId, signal: controller.signal, fetchImpl })
      .then((body) => {
        if (ignore) return
        const normalized = { ...body, metrics: body.metrics ?? [] }
        setHistory(normalized)
        setThesisText(body.thesis?.thesis ?? initialThesis)
        setConditions(body.thesis?.conditions.map(copyCondition) ?? [])
        setPhase('ready')
        setMessage(body.thesis ? `Editing thesis version ${body.thesis.version}` : 'Add one to five conditions, then save the first version.')
        onStructuredChange?.(agentId, body.thesis !== null)
      })
      .catch((error) => {
        if (ignore || controller.signal.aborted) return
        setPhase('error')
        setMessage(errorMessage(error))
      })
    return () => {
      ignore = true
      controller.abort()
    }
  }, [userId, agentId, initialThesis, refreshKey, fetchImpl, onStructuredChange])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!history || phase === 'saving') return
    const normalizedThesis = thesisText.trim()
    const normalizedConditions = conditions.map(normalizeCondition)
    if (normalizedThesis.length < 8 || normalizedThesis.length > 4000) {
      setMessage('Thesis must be 8–4000 characters.')
      return
    }
    if (normalizedConditions.length < 1 || normalizedConditions.length > 5) {
      setMessage('Add between one and five conditions before saving.')
      return
    }
    setPhase('saving')
    setMessage('Saving a new thesis version')
    try {
      const saved = await saveAgentThesis({
        userId,
        agentId,
        thesis: {
          expected_version: history.thesis?.version ?? 0,
          thesis: normalizedThesis,
          conditions: normalizedConditions,
        },
        fetchImpl,
      })
      if (!mountedRef.current) return
      setHistory((current) => current === null ? current : {
        ...current,
        thesis: saved,
        versions: [saved, ...current.versions.filter((version) => version.thesis_version_id !== saved.thesis_version_id)].slice(0, 20),
      })
      setThesisText(saved.thesis)
      setConditions(saved.conditions.map(copyCondition))
      setPhase('ready')
      setMessage(`Thesis version ${saved.version} saved`)
      onStructuredChange?.(agentId, true)
      onSaved(saved)
    } catch (error) {
      if (!mountedRef.current) return
      setPhase('ready')
      setMessage(errorMessage(error))
    }
  }

  const draft = async () => {
    if (phase === 'drafting' || phase === 'saving') return
    const normalizedThesis = thesisText.trim()
    if (normalizedThesis.length < 8 || normalizedThesis.length > 4000) {
      setMessage('Write an 8–4000 character thesis before requesting suggestions.')
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

  if (phase === 'loading') {
    return <PanelFrame><p className="text-sm text-muted">Loading thesis conditions…</p></PanelFrame>
  }
  if (phase === 'error' || history === null) {
    return (
      <PanelFrame>
        <p className="text-sm font-medium text-negative">Thesis conditions are unavailable.</p>
        <p className="mt-1 text-sm text-fg-soft">{message}</p>
      </PanelFrame>
    )
  }

  const metrics = history.metrics ?? []
  return (
    <PanelFrame>
      <form onSubmit={save} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium text-fg">
          Investment thesis
          <textarea
            name="thesis-text"
            value={thesisText}
            onChange={(event) => setThesisText(event.currentTarget.value)}
            disabled={phase === 'saving'}
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
            onClick={() => setConditions((current) => current.length >= 5 ? current : [...current, blankCondition()])}
            disabled={phase !== 'ready' || conditions.length >= 5}
            className={SECONDARY_BUTTON_CLASS}
          >
            Add condition
          </button>
          <span className="text-xs text-muted">{conditions.length}/5 conditions</span>
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
      <AssessmentHistory history={history} />
      <VersionHistory versions={history.versions} currentVersion={history.thesis?.version ?? 0} />
    </PanelFrame>
  )
}

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="thesis-panel-heading" className="rounded-md border border-line bg-surface p-5">
      <h2 id="thesis-panel-heading" className="text-lg font-semibold text-fg">Thesis conditions</h2>
      <p className="mt-1 text-sm text-muted">
        Turn the investment view into explicit beliefs, disconfirming evidence, and review horizons.
      </p>
      {children}
    </section>
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

function AssessmentHistory({ history }: { history: ThesisHistoryResponse }) {
  if (history.assessments.length === 0) {
    return (
      <section className="mt-6 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-fg">Assessment history</h3>
        <p className="mt-2 text-sm text-muted">Run this agent after saving conditions to assess them against fresh evidence.</p>
      </section>
    )
  }
  const versions = new Map(history.versions.map((version) => [version.thesis_version_id, version]))
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-fg">Assessment history</h3>
      <ol className="mt-3 flex flex-col gap-3">
        {history.assessments.map((assessment) => (
          <AssessmentCard
            key={assessment.assessment_id}
            assessment={assessment}
            version={versions.get(assessment.thesis_version_id)}
            currentVersion={history.thesis?.version ?? null}
          />
        ))}
      </ol>
    </section>
  )
}

function AssessmentCard({
  assessment,
  version,
  currentVersion,
}: {
  assessment: ThesisAssessment
  version: ThesisVersion | undefined
  currentVersion: number | null
}) {
  const conditions = new Map(version?.conditions.map((condition) => [condition.condition_id, condition]))
  const outsideRecentHistory = version === undefined
  const older = version !== undefined && currentVersion !== null && version.version !== currentVersion
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {outsideRecentHistory
            ? 'Older thesis version · details outside recent history'
            : `Thesis v${version.version}${older ? ' · older version' : ''}`}
        </span>
        <time dateTime={assessment.assessed_at}>{formatDate(assessment.assessed_at)}</time>
      </div>
      <p className="mt-1 text-xs text-muted">
        {assessment.model_version ? `Model ${assessment.model_version}` : 'Deterministic assessment'} · Prompt {assessment.prompt_version}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {assessment.results.map((result) => (
          <li key={result.condition_id} className="rounded bg-surface-2 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-fg">
                {conditions.get(result.condition_id)?.statement ?? 'Condition details are outside recent history'}
              </p>
              <StatusBadge status={result.status} />
            </div>
            <p className="mt-2 text-sm text-fg-soft">{result.reason}</p>
            <p className="mt-2 text-xs text-muted">{METHOD_LABELS[result.method]}</p>
            {(result.fact_refs.length > 0 || result.claim_refs.length > 0) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {result.fact_refs.map((id) => (
                  <InspectableRef key={id} snapshotId={assessment.snapshot_id} inspectionRef={{ kind: 'fact', id }} className="text-xs font-medium text-blue-700 underline decoration-dotted dark:text-blue-300">
                    Inspect fact evidence
                  </InspectableRef>
                ))}
                {result.claim_refs.map((id) => (
                  <InspectableRef key={id} snapshotId={assessment.snapshot_id} inspectionRef={{ kind: 'claim', id }} className="text-xs font-medium text-blue-700 underline decoration-dotted dark:text-blue-300">
                    Inspect claim evidence
                  </InspectableRef>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  )
}

function VersionHistory({ versions, currentVersion }: { versions: ReadonlyArray<ThesisVersion>; currentVersion: number }) {
  if (versions.length === 0) return null
  return (
    <details className="mt-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-fg">Thesis version history ({versions.length})</summary>
      <ol className="mt-3 flex flex-col gap-2">
        {versions.map((version) => (
          <li key={version.thesis_version_id} className="rounded border border-line p-3 text-sm text-fg-soft">
            <span className="font-medium text-fg">Version {version.version}</span>
            {version.version !== currentVersion ? <span className="ml-2 text-xs text-muted">Older version</span> : null}
            <p className="mt-1">{version.thesis}</p>
            <p className="mt-1 text-xs text-muted">{version.conditions.length} conditions · {formatDate(version.created_at)}</p>
          </li>
        ))}
      </ol>
    </details>
  )
}

function StatusBadge({ status }: { status: ConditionAssessment['status'] }) {
  const classes = status === 'supported'
    ? 'border-positive/40 bg-positive-soft text-positive'
    : status === 'challenged'
      ? 'border-negative/40 bg-negative-soft text-negative'
      : 'border-line-strong bg-surface text-muted'
  return <span className={`rounded border px-2 py-0.5 text-xs font-medium capitalize ${classes}`}>{status}</span>
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

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
