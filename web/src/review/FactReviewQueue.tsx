import { useRef, useState } from 'react'
import { SeverityBadge } from '../blocks/SeverityBadge.tsx'
import { isStaleItem, severityForItem, tallySeverities, type ReviewSeverity } from './severity.ts'
import { confidenceDistribution, type ConfidenceDistribution } from './queueStats.ts'
import { severityFillClass } from '../blocks/severityTone.ts'
import { StackedBar, StackedBarLegend, type StackedSegment } from '../symbol/StackedBar.tsx'

export type FactReviewCandidate = Record<string, unknown>

export type FactReviewQueueItem = {
  review_id: string
  candidate: FactReviewCandidate
  reason: string
  source_id: string | null
  metric_id: string | null
  confidence: number
  threshold: number
  created_at: string
  age_seconds?: number
  stale_after_seconds?: number
}

export type FactReviewQueueAction = {
  review_id: string
  candidate: FactReviewCandidate
  notes: string | null
}

export type FactReviewQueueRejectAction = {
  review_id: string
  notes: string | null
}

export type FactReviewQueueProps = {
  items: ReadonlyArray<FactReviewQueueItem>
  onApprove: (action: FactReviewQueueAction) => void | Promise<void>
  onEdit: (action: FactReviewQueueAction) => void | Promise<void>
  onReject: (action: FactReviewQueueRejectAction) => void | Promise<void>
  // Optional bulk action: approve every low-severity candidate as-is. Surfaced
  // as a header affordance only when the owner supplies it and lows exist.
  onApproveAllLow?: () => void | Promise<void>
}

type DecoratedItem = {
  item: FactReviewQueueItem
  severity: ReviewSeverity
  isStale: boolean
}

function decorateItem(item: FactReviewQueueItem): DecoratedItem {
  return { item, isStale: isStaleItem(item), severity: severityForItem(item) }
}

type DraftState = {
  candidateJson: string
  notes: string
}

type DraftRefs = {
  candidate: HTMLTextAreaElement | null
  notes: HTMLTextAreaElement | null
}

type PendingReviewIds = Record<string, true>

export function FactReviewQueue({ items, onApprove, onEdit, onReject, onApproveAllLow }: FactReviewQueueProps) {
  const queueKey = items.map((item) => `${item.review_id}:${JSON.stringify(item.candidate)}`).join('|')
  return (
    <FactReviewQueueContent
      key={queueKey}
      items={items}
      onApprove={onApprove}
      onEdit={onEdit}
      onReject={onReject}
      onApproveAllLow={onApproveAllLow}
    />
  )
}

function FactReviewQueueContent({ items, onApprove, onEdit, onReject, onApproveAllLow }: FactReviewQueueProps) {
  const draftRefs = useRef<Record<string, DraftRefs>>({})
  const [validationErrors, setValidationErrors] = useState<Record<string, string | null>>({})
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({})
  const [pendingReviewIds, setPendingReviewIds] = useState<PendingReviewIds>({})

  if (items.length === 0) {
    return (
      <section className="rounded-md border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-fg">Reviewer queue</h2>
        <p className="mt-2 text-sm text-muted">No candidate facts need review.</p>
      </section>
    )
  }

  const decorated = items.map(decorateItem)

  return (
    <section className="flex flex-col gap-3">
      <QueueSummary items={items} onApproveAllLow={onApproveAllLow} />
      <ul className="flex flex-col gap-3">
        {decorated.map(({ item, severity, isStale }) => {
          const draft = draftFromItem(item)
          const validationError = validationErrors[item.review_id] ?? null
          const actionError = actionErrors[item.review_id] ?? null
          const isPending = pendingReviewIds[item.review_id] === true
          return (
            <li
              key={item.review_id}
              className="rounded-md border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={severity} />
                    <span className="text-sm font-medium text-fg">
                      {item.reason.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <ConfidenceChip label="Confidence" value={item.confidence} />
                    <ConfidenceChip label="Threshold" value={item.threshold} />
                    {isStale ? (
                      <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">
                        Stale {formatDuration(item.age_seconds!)}
                      </span>
                    ) : null}
                    <span>{item.created_at}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      void submitCandidateAction(item.review_id, readDraft(item.review_id, draftRefs.current), onEdit, {
                        setValidationErrors,
                        setActionErrors,
                        setPendingReviewIds,
                      })
                    }
                  >
                    Save edit
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    className="rounded-md border border-positive bg-positive px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      void submitCandidateAction(item.review_id, readDraft(item.review_id, draftRefs.current), onApprove, {
                        setValidationErrors,
                        setActionErrors,
                        setPendingReviewIds,
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    className="rounded-md border border-negative px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative-soft disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      void submitRejectAction(item.review_id, readDraft(item.review_id, draftRefs.current), onReject, {
                        setActionErrors,
                        setPendingReviewIds,
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
                <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-fg-soft">
                  Candidate
                  <textarea
                    data-role="candidate"
                    className="min-h-40 resize-y rounded-md border border-line-strong bg-surface p-2 font-mono text-xs text-fg outline-none focus:border-accent"
                    defaultValue={draft.candidateJson}
                    ref={(node) => {
                      setDraftCandidateRef(draftRefs.current, item.review_id, node)
                    }}
                  />
                </label>
                <div className="flex min-w-0 flex-col gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-fg-soft">
                    Notes
                    <textarea
                      data-role="notes"
                      className="min-h-24 resize-y rounded-md border border-line-strong bg-surface p-2 text-sm text-fg outline-none focus:border-accent"
                      defaultValue={draft.notes}
                      ref={(node) => {
                        setDraftNotesRef(draftRefs.current, item.review_id, node)
                      }}
                    />
                  </label>
                  <dl className="grid gap-1 text-xs text-muted">
                    <MetaRow label="Source" value={item.source_id ?? 'none'} />
                    <MetaRow label="Metric" value={item.metric_id ?? 'none'} />
                  </dl>
                  {validationError ? <p className="text-xs text-negative">{validationError}</p> : null}
                  {actionError ? <p className="text-xs text-negative">{actionError}</p> : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Charts-first queue header: the backlog's shape at a glance — a severity
// stacked bar and a confidence-vs-threshold distribution — replacing a row of
// count badges (and the rail that used to restate them). The detail item cards
// follow below.
function QueueSummary({
  items,
  onApproveAllLow,
}: {
  items: ReadonlyArray<FactReviewQueueItem>
  onApproveAllLow?: () => void | Promise<void>
}) {
  const counts = tallySeverities(items)
  const dist = confidenceDistribution(items)
  const stale = items.filter(isStaleItem).length
  const total = items.length
  return (
    <header className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-fg">
          <span className="num">{total}</span> {total === 1 ? 'claim' : 'claims'} awaiting review
        </span>
        {stale > 0 ? <span className="num text-xs text-warning">{stale} stale</span> : null}
        {onApproveAllLow && counts.low > 0 ? (
          <button
            type="button"
            onClick={() => void onApproveAllLow()}
            className="ml-auto rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2"
          >
            Approve all low
          </button>
        ) : null}
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <SeverityBar counts={counts} />
        <ConfidenceHistogram dist={dist} />
      </div>
    </header>
  )
}

const REVIEW_SEVERITY_LABEL: ReadonlyArray<{ key: ReviewSeverity; label: string }> = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Med' },
  { key: 'low', label: 'Low' },
]

function SeverityBar({ counts }: { counts: Record<ReviewSeverity, number> }) {
  const segments: StackedSegment[] = REVIEW_SEVERITY_LABEL.map(({ key, label }) => ({
    key,
    label,
    value: counts[key],
    className: severityFillClass(key),
  }))
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted">By severity</span>
      <StackedBar
        segments={segments}
        ariaLabel={`${counts.high} high, ${counts.medium} medium, ${counts.low} low`}
      />
      <StackedBarLegend segments={segments} />
    </div>
  )
}

// Confidence distribution with the median approval threshold marked. Bars left
// of the marker (below the bar) shade warning→negative by how far short they
// fall; bars at/above shade positive — the shortfall story the severity model
// already grades each item on, shown as a shape rather than three counts.
function ConfidenceHistogram({ dist }: { dist: ConfidenceDistribution }) {
  const marker = dist.thresholdMarker
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted">Confidence vs threshold</span>
      <div className="relative">
        <div
          className="flex h-12 items-end gap-0.5"
          role="img"
          aria-label="Distribution of candidate confidence across the queue"
        >
          {dist.bins.map((bin, i) => {
            const center = (bin.from + bin.to) / 2
            const fill =
              marker === null
                ? 'bg-accent'
                : center >= marker
                  ? 'bg-positive'
                  : center >= marker - 0.15
                    ? 'bg-warning'
                    : 'bg-negative'
            return (
              <span
                key={i}
                title={`${formatPercent(bin.from)}–${formatPercent(bin.to)}: ${bin.count}`}
                className={`flex-1 rounded-t-sm ${dist.max === 0 ? '' : fill}`}
                style={{
                  height: `${dist.max === 0 ? 0 : Math.max(bin.count === 0 ? 0 : 8, (bin.count / dist.max) * 100)}%`,
                }}
              />
            )
          })}
        </div>
        {marker !== null ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 border-l border-dashed border-negative"
            style={{ left: `${marker * 100}%` }}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-[10px] num text-faint">
        <span>0</span>
        {marker !== null ? <span className="text-negative">thr {formatPercent(marker)}</span> : null}
        <span>100%</span>
      </div>
    </div>
  )
}

function ConfidenceChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5">
      {label} <span className="num text-fg-soft">{formatPercent(value)}</span>
    </span>
  )
}

function draftFromItem(item: FactReviewQueueItem): DraftState {
  return {
    candidateJson: JSON.stringify(item.candidate, null, 2),
    notes: '',
  }
}

function refsForReview(refs: Record<string, DraftRefs>, reviewId: string): DraftRefs {
  refs[reviewId] ??= { candidate: null, notes: null }
  return refs[reviewId]
}

function setDraftCandidateRef(
  refs: Record<string, DraftRefs>,
  reviewId: string,
  node: HTMLTextAreaElement | null,
): void {
  refsForReview(refs, reviewId).candidate = node
}

function setDraftNotesRef(
  refs: Record<string, DraftRefs>,
  reviewId: string,
  node: HTMLTextAreaElement | null,
): void {
  refsForReview(refs, reviewId).notes = node
}

function readDraft(reviewId: string, refs: Record<string, DraftRefs>): DraftState {
  const rowRefs = refs[reviewId]
  return {
    candidateJson: rowRefs?.candidate?.value ?? '',
    notes: rowRefs?.notes?.value ?? '',
  }
}

async function submitCandidateAction(
  reviewId: string,
  draft: DraftState,
  callback: (action: FactReviewQueueAction) => void | Promise<void>,
  state: {
    setValidationErrors: (updater: (errors: Record<string, string | null>) => Record<string, string | null>) => void
    setActionErrors: (updater: (errors: Record<string, string | null>) => Record<string, string | null>) => void
    setPendingReviewIds: (updater: (pending: PendingReviewIds) => PendingReviewIds) => void
  },
) {
  const parsed = parseCandidateJson(draft.candidateJson)
  if (!parsed.ok) {
    state.setValidationErrors((errors) => ({ ...errors, [reviewId]: parsed.error }))
    return
  }
  state.setPendingReviewIds((pending) => ({ ...pending, [reviewId]: true }))
  state.setValidationErrors((errors) => ({ ...errors, [reviewId]: null }))
  state.setActionErrors((errors) => ({ ...errors, [reviewId]: null }))
  try {
    await callback({
      review_id: reviewId,
      candidate: parsed.candidate,
      notes: normalizeNotes(draft.notes),
    })
  } catch (error) {
    state.setActionErrors((errors) => ({
      ...errors,
      [reviewId]: error instanceof Error ? error.message : String(error),
    }))
  } finally {
    state.setPendingReviewIds((pending) => withoutPendingReviewId(pending, reviewId))
  }
}

async function submitRejectAction(
  reviewId: string,
  draft: DraftState,
  callback: (action: FactReviewQueueRejectAction) => void | Promise<void>,
  state: {
    setActionErrors: (updater: (errors: Record<string, string | null>) => Record<string, string | null>) => void
    setPendingReviewIds: (updater: (pending: PendingReviewIds) => PendingReviewIds) => void
  },
) {
  state.setPendingReviewIds((pending) => ({ ...pending, [reviewId]: true }))
  state.setActionErrors((errors) => ({ ...errors, [reviewId]: null }))
  try {
    await callback({
      review_id: reviewId,
      notes: normalizeNotes(draft.notes),
    })
  } catch (error) {
    state.setActionErrors((errors) => ({
      ...errors,
      [reviewId]: error instanceof Error ? error.message : String(error),
    }))
  } finally {
    state.setPendingReviewIds((pending) => withoutPendingReviewId(pending, reviewId))
  }
}

function withoutPendingReviewId(pending: PendingReviewIds, reviewId: string): PendingReviewIds {
  const next = { ...pending }
  delete next[reviewId]
  return next
}

function parseCandidateJson(value: string): { ok: true; candidate: FactReviewCandidate } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Candidate must be a JSON object.' }
    }
    return { ok: true, candidate: parsed as FactReviewCandidate }
  } catch {
    return { ok: false, error: 'Candidate JSON is invalid.' }
  }
}

function normalizeNotes(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDuration(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`
  return `${Math.max(0, Math.floor(seconds))}s`
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
      <dt>{label}</dt>
      <dd className="truncate font-mono" title={value}>{value}</dd>
    </div>
  )
}
