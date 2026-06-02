import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'
import { INSET_SURFACE_CLASS, PANEL_CLASS } from '../symbol/surfaceStyles.ts'
import { useNavigate } from 'react-router-dom'
import {
  ProtectedActionType,
  SCREEN_NAME_MAX_LENGTH,
} from '../shell/authInterruptState.ts'
import { useAuth } from '../shell/useAuth.ts'
import {
  useRequestProtectedAction,
  useResumedProtectedAction,
} from '../shell/useAuthInterrupt.ts'
import {
  formatCompactCurrency,
  formatCompactNumber,
  formatCurrency2,
  formatIsoTimestamp,
} from '../symbol/format.ts'
import { symbolDetailPathForSubject } from '../symbol/search.ts'
import { ChangePill } from '../symbol/ChangePill.tsx'
import { signedDirection, type SignedDirection } from '../symbol/signedColor.ts'
import {
  FUNDAMENTALS_NUMERIC_FIELDS,
  MARKET_NUMERIC_FIELDS,
  SCREENER_LIMIT_MAX,
  SCREENER_LIMIT_MIN,
  SORTABLE_FIELDS,
  UNIVERSE_ENUM_FIELDS,
  type ScreenerQuery,
  type ScreenerResponse,
  type ScreenerResultRow,
  type SortDirection,
} from './contracts.ts'
import { QUERY_TEMPLATES, type QueryTemplate } from './queryTemplates.ts'
import {
  createDefaultQueryDraft,
  draftToQuery,
  emptyNumericRange,
  queryToDraft,
  setLimit,
  setNumericRange,
  setOffset,
  setSort,
  setUniverseSelection,
  type QueryDraft,
} from './queryDraft.ts'
import {
  deleteSavedScreen,
  listSavedScreens,
  saveScreen,
  type ScreenSubject,
} from './savedScreens.ts'
import { ScreenerFetchError } from './screenerFetch.ts'
import { searchScreener } from './searchScreener.ts'

type Status = 'loading' | 'error' | 'ready'

// One workspace flow: query controls and result rows live in the same
// surface, never split across routes (parent bead fra-cw0.8). Refining a
// filter triggers a re-run that mutates only the rows region — the URL
// stays at /screener throughout. State lives entirely in component state
// for that reason; promoting it to the URL would force a route change
// per refinement, the exact split this surface exists to avoid.
export function ScreenerWorkspace() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const requestProtectedAction = useRequestProtectedAction()
  const sessionUserId = session?.userId
  const [draft, setDraft] = useState<QueryDraft>(() => createDefaultQueryDraft())
  const [response, setResponse] = useState<ScreenerResponse | null>(null)
  // Status starts as 'loading' because the mount effect kicks off the
  // initial run immediately — initializing to 'loading' lets the effect
  // body skip a synchronous setStatus call (which the React 19 lint
  // rule react-hooks/set-state-in-effect rejects) without losing the
  // visible "running initial screen" affordance.
  const [status, setStatus] = useState<Status>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [screenName, setScreenName] = useState('')
  const [savedScreensState, setSavedScreensState] = useState<{
    userId: string | undefined
    screens: ScreenSubject[]
  }>(() => ({ userId: undefined, screens: [] }))
  const savedScreens =
    savedScreensState.userId === sessionUserId ? savedScreensState.screens : []
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  // Each run gets a fresh AbortController so an in-flight fetch is
  // dropped when a faster refinement supersedes it. AbortError flows
  // into .catch and is filtered out via signal.aborted there.
  const controllerRef = useRef<AbortController | null>(null)

  const performSearch = (
    query: ScreenerQuery,
    controller: AbortController,
  ): Promise<void> => {
    return searchScreener({ query, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setResponse(result)
        setErrorMessage(null)
        setStatus('ready')
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setStatus('error')
        setErrorMessage(
          err instanceof ScreenerFetchError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Screener search failed',
        )
      })
  }

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    void performSearch(draftToQuery(draft), controller)
    return () => {
      controller.abort()
      if (controllerRef.current === controller) controllerRef.current = null
    }
    // Mount-only: draft here is the initial useState value and never
    // re-fires this effect — refinements run through `runSearch`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId])

  // Synchronous setStatus is fine here — this runs in an event
  // handler, not an effect, so react-hooks/set-state-in-effect doesn't
  // apply.
  const runSearch = (nextDraft: QueryDraft) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('loading')
    setErrorMessage(null)
    void performSearch(draftToQuery(nextDraft), controller)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    runSearch(draft)
  }

  const goToOffset = (nextOffset: number) => {
    const next = setOffset(draft, nextOffset)
    setDraft(next)
    runSearch(next)
  }

  // Saved-screens list is user-owned per spec §6.7 — only fetch when
  // the user is authed. The list reloads on session change so a
  // sign-in (including via the auth interrupt) populates it. The
  // panel below is conditionally rendered on `session`, so a stale
  // post-sign-out value never reaches the DOM. Inline .then/.catch
  // (matching `useManualWatchlist`) keeps setState off the synchronous
  // effect-body path, satisfying react-hooks/set-state-in-effect.
  useEffect(() => {
    if (sessionUserId == null) return
    const controller = new AbortController()
    listSavedScreens({ userId: sessionUserId, signal: controller.signal })
      .then((screens) => {
        if (controller.signal.aborted) return
        setSavedScreensState({ userId: sessionUserId, screens })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setSavedMessage(savedErrorMessage(err))
      })
    return () => controller.abort()
  }, [sessionUserId])

  // Refreshes the list from event-handler contexts (post-save resume
  // and post-delete failure). Async/await is fine here — we're not in
  // an effect body.
  const refreshSavedScreens = useCallback(async () => {
    if (sessionUserId == null) return
    try {
      const screens = await listSavedScreens({ userId: sessionUserId })
      setSavedScreensState({ userId: sessionUserId, screens })
    } catch (err) {
      setSavedMessage(savedErrorMessage(err))
    }
  }, [sessionUserId])

  // Resumes the SaveScreen action that the auth interrupt deferred.
  // The action's payload carries the original name + definition the
  // user clicked Save with — sessionStorage round-tripped them
  // through the sign-in flow, satisfying the bead's "preserves
  // current screen definition" verification.
  useResumedProtectedAction(ProtectedActionType.SaveScreen, async (action) => {
    if (sessionUserId == null) return
    try {
      const result = await saveScreen({ ...action.payload, userId: sessionUserId })
      setSavedMessage(null)
      setScreenName('')
      // The POST response already carries the canonical screen, so
      // splice it in locally instead of round-tripping a list GET.
      // Newest-first matches the server's `updated_at` desc order.
      setSavedScreensState((current) => ({
        userId: sessionUserId,
        screens: [
          result.screen,
          ...(current.userId === sessionUserId ? current.screens : []).filter(
            (s) => s.screen_id !== result.screen.screen_id,
          ),
        ],
      }))
    } catch (err) {
      setSavedMessage(savedErrorMessage(err))
    }
  })

  const handleSaveClick = () => {
    const name = screenName.trim()
    if (name.length === 0) {
      setSavedMessage('Name a screen before saving.')
      return
    }
    if (name.length > SCREEN_NAME_MAX_LENGTH) {
      setSavedMessage(`Name must be ≤ ${SCREEN_NAME_MAX_LENGTH} characters.`)
      return
    }
    setSavedMessage(null)
    requestProtectedAction({
      title: 'Sign in to save this screen',
      description: 'Saved screens are tied to your account so you can reopen them later.',
      action: {
        actionType: ProtectedActionType.SaveScreen,
        payload: { name, definition: draftToQuery(draft) },
      },
    })
  }

  // Load a query into the workspace and run it immediately — shared by
  // reopening a saved screen and applying a starter template, which differ only
  // in the name they restore (a template is unsaved, so its name is blank).
  const loadDraft = (query: ScreenerQuery, name: string) => {
    const next = queryToDraft(query)
    setDraft(next)
    setScreenName(name)
    // RunStatus shows savedMessage with priority over run state, so clear any
    // lingering save/delete feedback — it no longer reflects the loaded screen.
    setSavedMessage(null)
    runSearch(next)
  }

  const handleOpenSaved = (screen: ScreenSubject) => loadDraft(screen.definition, screen.name)

  const handleApplyTemplate = (template: QueryTemplate) => loadDraft(template.query, '')

  const handleDeleteSaved = async (screen: ScreenSubject) => {
    if (sessionUserId == null) return
    // Optimistic removal — the panel only renders when authed, so
    // Delete cannot reach this code path without a session and does
    // not need the auth interrupt. On failure we re-fetch instead of
    // restoring a captured snapshot so concurrent Deletes on different
    // rows don't trample each other's state.
    setSavedScreensState((current) => ({
      userId: sessionUserId,
      screens:
        current.userId === sessionUserId
          ? current.screens.filter((s) => s.screen_id !== screen.screen_id)
          : [],
    }))
    try {
      await deleteSavedScreen({ screen_id: screen.screen_id, userId: sessionUserId })
    } catch (err) {
      setSavedMessage(savedErrorMessage(err))
      void refreshSavedScreens()
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">Screener</h1>
        <p className="mt-1 text-sm text-muted">
          Build, refine, and view one active screen. Saving requires a session.
        </p>
      </header>

      <QueryTemplates onApply={handleApplyTemplate} />

      <form
        onSubmit={handleSubmit}
        className={`grid gap-4 ${PANEL_CLASS} p-4 lg:grid-cols-3`}
        aria-label="Screener query controls"
      >
        <UniverseControls draft={draft} onChange={setDraft} />
        <NumericRangeControls
          legend="Market"
          dimension="market"
          fields={MARKET_NUMERIC_FIELDS}
          draft={draft}
          onChange={setDraft}
        />
        <NumericRangeControls
          legend="Fundamentals"
          dimension="fundamentals"
          fields={FUNDAMENTALS_NUMERIC_FIELDS}
          draft={draft}
          onChange={setDraft}
        />
        <SortLimitControls draft={draft} onChange={setDraft} />
        <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <RunStatus status={status} errorMessage={errorMessage} savedMessage={savedMessage} />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={screenName}
              onChange={(event) => {
                setScreenName(event.target.value)
                // The validation message ("Name a screen before saving")
                // becomes stale the moment the user starts typing — clear
                // it here so the toolbar slot reverts to its run-state hint.
                if (savedMessage) setSavedMessage(null)
              }}
              placeholder="Name this screen"
              aria-label="Screen name"
              maxLength={SCREEN_NAME_MAX_LENGTH}
              className={`w-48 ${INSET_SURFACE_CLASS} px-2 py-2 text-sm`}
            />
            <button
              type="button"
              onClick={handleSaveClick}
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-fg shadow-sm hover:bg-surface-2"
            >
              Save
            </button>
            <button
              type="submit"
              className={`${PRIMARY_BUTTON_CLASS} shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50`}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>
      </form>

      {session != null ? (
        <SavedScreensPanel
          screens={savedScreens}
          message={savedMessage}
          onOpen={handleOpenSaved}
          onDelete={handleDeleteSaved}
        />
      ) : null}

      <ScreenerResults
        response={response}
        status={status}
        onRowSelect={(row) => navigate(symbolDetailPathForSubject(row.subject_ref))}
        onPrev={() => {
          if (!response) return
          const offset = response.page.offset ?? 0
          goToOffset(Math.max(0, offset - response.page.limit))
        }}
        onNext={() => {
          if (!response) return
          const offset = response.page.offset ?? 0
          goToOffset(offset + response.page.limit)
        }}
      />
    </div>
  )
}

function QueryTemplates({ onApply }: { onApply: (template: QueryTemplate) => void }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Starter screens">
      {QUERY_TEMPLATES.map((template) => (
        <button
          key={template.name}
          type="button"
          onClick={() => onApply(template)}
          className={`min-w-[180px] flex-1 rounded-lg border border-line bg-surface p-3 text-left shadow-sm transition-colors hover:border-accent-border hover:bg-surface-hover`}
        >
          <span className="block text-sm font-semibold text-fg">{template.name}</span>
          <span className="mt-0.5 block text-xs text-muted">{template.description}</span>
        </button>
      ))}
    </div>
  )
}

function UniverseControls({
  draft,
  onChange,
}: {
  draft: QueryDraft
  onChange: (next: QueryDraft) => void
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Universe
      </legend>
      {UNIVERSE_ENUM_FIELDS.map((spec) => {
        const selected = draft.universe[spec.field] ?? []
        return (
          <label key={spec.field} className="flex flex-col gap-1 text-xs">
            <span className="text-fg-soft">{spec.label}</span>
            <select
              multiple
              value={selected}
              onChange={(event) => {
                const next = Array.from(event.target.selectedOptions).map((o) => o.value)
                onChange(setUniverseSelection(draft, spec.field, next))
              }}
              className={`${INSET_SURFACE_CLASS} px-2 py-1 text-sm text-fg outline-none focus:border-accent`}
              size={Math.min(spec.options.length, 4)}
            >
              {spec.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </fieldset>
  )
}

function NumericRangeControls({
  legend,
  dimension,
  fields,
  draft,
  onChange,
}: {
  legend: string
  dimension: 'market' | 'fundamentals'
  fields: ReadonlyArray<{ field: string; label: string; hint?: string; step?: string }>
  draft: QueryDraft
  onChange: (next: QueryDraft) => void
}) {
  const bag = dimension === 'market' ? draft.marketNumeric : draft.fundamentalsNumeric
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {legend}
      </legend>
      {fields.map((spec) => {
        const range = bag[spec.field] ?? emptyNumericRange()
        return (
          <div key={spec.field} className="flex flex-col gap-1 text-xs">
            <span className="text-fg-soft">
              {spec.label}
              {spec.hint ? (
                <span className="ml-1 text-faint">
                  ({spec.hint})
                </span>
              ) : null}
            </span>
            <div className="flex gap-2">
              {(['min', 'max'] as const).map((bound) => (
                <input
                  key={bound}
                  type="number"
                  inputMode="decimal"
                  step={spec.step ?? 'any'}
                  placeholder={bound}
                  value={range[bound]}
                  onChange={(event) =>
                    onChange(
                      setNumericRange(draft, dimension, spec.field, {
                        ...range,
                        [bound]: event.target.value,
                      }),
                    )
                  }
                  aria-label={`${spec.label} ${bound}`}
                  className={`min-w-0 flex-1 ${INSET_SURFACE_CLASS} px-2 py-1 text-sm num`}
                />
              ))}
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}

function SortLimitControls({
  draft,
  onChange,
}: {
  draft: QueryDraft
  onChange: (next: QueryDraft) => void
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Sort &amp; page
      </legend>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-soft">Sort by</span>
        <div className="flex gap-2">
          <select
            value={draft.sort.field}
            onChange={(event) =>
              onChange(setSort(draft, { ...draft.sort, field: event.target.value }))
            }
            className={`min-w-0 flex-1 ${INSET_SURFACE_CLASS} px-2 py-1 text-sm`}
          >
            {SORTABLE_FIELDS.map((spec) => (
              <option key={spec.field} value={spec.field}>
                {spec.label}
              </option>
            ))}
          </select>
          <select
            value={draft.sort.direction}
            onChange={(event) =>
              onChange(
                setSort(draft, {
                  ...draft.sort,
                  direction: event.target.value as SortDirection,
                }),
              )
            }
            className={`${INSET_SURFACE_CLASS} px-2 py-1 text-sm`}
            aria-label="Sort direction"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-soft">Page size</span>
        <input
          type="number"
          min={SCREENER_LIMIT_MIN}
          max={SCREENER_LIMIT_MAX}
          step={1}
          value={draft.limit}
          onChange={(event) => onChange(setLimit(draft, Number(event.target.value)))}
          className={`${INSET_SURFACE_CLASS} px-2 py-1 text-sm num`}
        />
      </label>
    </fieldset>
  )
}

function RunStatus({
  status,
  errorMessage,
  savedMessage,
}: {
  status: Status
  errorMessage: string | null
  savedMessage: string | null
}) {
  // The savedMessage takes priority over the run state because it's
  // a direct response to the user's last action (Save click); the run
  // hint underneath is a steady-state affordance and can wait.
  if (savedMessage) {
    return (
      <span className="text-xs text-negative" role="status">
        {savedMessage}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="text-xs text-negative" role="status">
        {errorMessage ?? 'Search failed'}
      </span>
    )
  }
  if (status === 'loading') {
    return (
      <span className="text-xs text-muted" role="status">
        Running screen…
      </span>
    )
  }
  return <span className="text-xs text-faint">Edit a filter and run.</span>
}

function SavedScreensPanel({
  screens,
  message,
  onOpen,
  onDelete,
}: {
  screens: ScreenSubject[]
  message: string | null
  onOpen: (screen: ScreenSubject) => void
  onDelete: (screen: ScreenSubject) => void
}) {
  return (
    <section
      aria-label="Saved screens"
      className={`${PANEL_CLASS} p-3`}
    >
      <header className="flex items-center justify-between pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span>Saved screens</span>
        <span className="font-normal normal-case">{screens.length}</span>
      </header>
      {screens.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted">
          No saved screens yet. Build one above and click Save.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {screens.map((screen) => (
            <li
              key={screen.screen_id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-fg">
                  {screen.name}
                </div>
                <div className="text-xs text-muted">
                  Updated {formatIsoTimestamp(screen.updated_at)}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(screen)}
                  className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(screen)}
                  className="rounded-md border border-line px-2 py-1 text-xs text-negative hover:bg-negative-soft"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <p className="mt-2 text-xs text-negative">{message}</p>
      ) : null}
    </section>
  )
}

function savedErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Saved-screen request failed'
}

function ScreenerResults({
  response,
  status,
  onRowSelect,
  onPrev,
  onNext,
}: {
  response: ScreenerResponse | null
  status: Status
  onRowSelect: (row: ScreenerResultRow) => void
  onPrev: () => void
  onNext: () => void
}) {
  // Why memoize: ScreenerResultRow is a frozen wire object; mapping it
  // every render would not change identity but the table can grow to
  // 500 rows (LIMIT_MAX) and the formatting calls are not free.
  const formattedRows = useMemo(() => response?.rows.map(formatRowCells) ?? [], [response])

  if (!response && status === 'loading') {
    return (
      <div className={`${PANEL_CLASS} p-6 text-sm text-muted`}>
        Running initial screen…
      </div>
    )
  }
  if (!response) {
    return null
  }

  const offset = response.page.offset ?? 0
  const start = response.rows.length === 0 ? 0 : offset + 1
  const end = offset + response.rows.length
  const hasNext = end < response.total_count
  const hasPrev = offset > 0

  return (
    <section className={`flex flex-col gap-3 ${PANEL_CLASS} p-3`}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {response.total_count === 0
            ? 'No matches'
            : `Showing ${start}–${end} of ${response.total_count}`}
          <span className="ml-2 text-faint">
            as of {response.as_of}
          </span>
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev || status === 'loading'}
            className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext || status === 'loading'}
            className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
      {response.rows.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted">
          No subjects match this query. Loosen a filter and try again.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 text-right">#</th>
                <th scope="col" className="py-2 pr-3">Subject</th>
                <th scope="col" className="py-2 pr-3 text-right">Last</th>
                <th scope="col" className="py-2 pr-3 text-right">Change %</th>
                <th scope="col" className="py-2 pr-3 text-right">Volume</th>
                <th scope="col" className="py-2 pr-3 text-right">Market cap</th>
                <th scope="col" className="py-2 pr-3 text-right">P/E</th>
              </tr>
            </thead>
            <tbody>
              {formattedRows.map(({ row, cells }) => (
                <tr
                  key={`${row.subject_ref.kind}:${row.subject_ref.id}`}
                  className="cursor-pointer border-t border-line hover:bg-surface-2/60"
                  onClick={() => onRowSelect(row)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRowSelect(row)
                    }
                  }}
                >
                  <td className="py-2 pr-3 text-right num text-muted">{row.rank}</td>
                  <td className="py-2 pr-3">
                    <span className="block font-medium text-fg">
                      {row.display.ticker ?? row.display.primary}
                    </span>
                    <span className="block text-xs text-muted">
                      {row.display.legal_name ?? row.display.primary}
                      {row.display.mic ? ` · ${row.display.mic}` : ''}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right num">{cells.lastPrice}</td>
                  <td className="py-2 pr-3 text-right">
                    {cells.change === null ? (
                      <span className="num text-muted">—</span>
                    ) : (
                      <ChangePill direction={cells.change.direction}>
                        {cells.change.text}
                      </ChangePill>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right num">{cells.volume}</td>
                  <td className="py-2 pr-3 text-right num">{cells.marketCap}</td>
                  <td className="py-2 pr-3 text-right num">{cells.peRatio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type ChangeCell = { direction: SignedDirection; text: string }

type FormattedCells = {
  lastPrice: string
  // null when the quote carries no change — rendered as a plain em-dash rather
  // than a (misleadingly neutral) pill.
  change: ChangeCell | null
  volume: string
  marketCap: string
  peRatio: string
}

function formatRowCells(row: ScreenerResultRow): { row: ScreenerResultRow; cells: FormattedCells } {
  const last = row.quote.last_price
  const change = row.quote.change_pct
  const lastPrice = last === null ? '—' : formatCurrency2(last, row.quote.currency)
  // The pill's arrow carries the sign, so the text shows the unsigned magnitude.
  const changeCell: ChangeCell | null =
    change === null
      ? null
      : { direction: signedDirection(change), text: `${(Math.abs(change) * 100).toFixed(2)}%` }
  const volume = row.quote.volume === null ? '—' : formatCompactNumber(row.quote.volume)
  const marketCap =
    row.fundamentals.market_cap === null
      ? '—'
      : formatCompactCurrency(row.fundamentals.market_cap, row.quote.currency)
  const peRatio =
    row.fundamentals.pe_ratio === null ? '—' : row.fundamentals.pe_ratio.toFixed(1)
  return {
    row,
    cells: { lastPrice, change: changeCell, volume, marketCap, peRatio },
  }
}
