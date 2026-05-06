import { useRef, useState } from 'react'

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

export function FactReviewQueue({ items, onApprove, onEdit, onReject }: FactReviewQueueProps) {
  const queueKey = items.map((item) => `${item.review_id}:${JSON.stringify(item.candidate)}`).join('|')
  return (
    <FactReviewQueueContent
      key={queueKey}
      items={items}
      onApprove={onApprove}
      onEdit={onEdit}
      onReject={onReject}
    />
  )
}

function FactReviewQueueContent({ items, onApprove, onEdit, onReject }: FactReviewQueueProps) {
  const draftRefs = useRef<Record<string, DraftRefs>>({})
  const [validationErrors, setValidationErrors] = useState<Record<string, string | null>>({})
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({})
  const [pendingReviewIds, setPendingReviewIds] = useState<PendingReviewIds>({})

  if (items.length === 0) {
    return (
      <section className="rounded-md border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Reviewer queue</h2>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No candidate facts need review.</p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Reviewer queue</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Oldest queued candidates are first.
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const draft = draftFromItem(item)
          const validationError = validationErrors[item.review_id] ?? null
          const actionError = actionErrors[item.review_id] ?? null
          const isPending = pendingReviewIds[item.review_id] === true
          const isStale = item.age_seconds != null && item.stale_after_seconds != null && item.age_seconds >= item.stale_after_seconds
          return (
            <li
              key={item.review_id}
              className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {item.reason.replaceAll('_', ' ')}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                    <span className="tabular-nums">Confidence {formatPercent(item.confidence)}</span>
                    <span className="tabular-nums">Threshold {formatPercent(item.threshold)}</span>
                    {isStale ? (
                      <span className="font-medium text-amber-700 dark:text-amber-300">
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
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
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
                    className="rounded-md border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="rounded-md border border-rose-700 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-950/40"
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
                <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  Candidate
                  <textarea
                    data-role="candidate"
                    className="min-h-40 resize-y rounded-md border border-neutral-300 bg-white p-2 font-mono text-xs text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                    defaultValue={draft.candidateJson}
                    ref={(node) => {
                      setDraftCandidateRef(draftRefs.current, item.review_id, node)
                    }}
                  />
                </label>
                <div className="flex min-w-0 flex-col gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Notes
                    <textarea
                      data-role="notes"
                      className="min-h-24 resize-y rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                      defaultValue={draft.notes}
                      ref={(node) => {
                        setDraftNotesRef(draftRefs.current, item.review_id, node)
                      }}
                    />
                  </label>
                  <dl className="grid gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                    <MetaRow label="Source" value={item.source_id ?? 'none'} />
                    <MetaRow label="Metric" value={item.metric_id ?? 'none'} />
                  </dl>
                  {validationError ? <p className="text-xs text-rose-600 dark:text-rose-300">{validationError}</p> : null}
                  {actionError ? <p className="text-xs text-rose-600 dark:text-rose-300">{actionError}</p> : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
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
