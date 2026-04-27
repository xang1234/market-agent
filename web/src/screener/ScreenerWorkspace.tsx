import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
} from '../symbol/format.ts'
import { symbolDetailPathForSubject } from '../symbol/search.ts'
import { signedTextClass } from '../symbol/signedColor.ts'
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
  const [savedScreens, setSavedScreens] = useState<ScreenSubject[]>([])
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
  }, [])

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
    if (session == null) return
    const controller = new AbortController()
    listSavedScreens({ signal: controller.signal })
      .then((screens) => {
        if (controller.signal.aborted) return
        setSavedScreens(screens)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setSavedMessage(savedErrorMessage(err))
      })
    return () => controller.abort()
  }, [session])

  // Refreshes the list from event-handler contexts (post-save resume
  // and post-delete failure). Async/await is fine here — we're not in
  // an effect body.
  const refreshSavedScreens = useCallback(async () => {
    try {
      const screens = await listSavedScreens()
      setSavedScreens(screens)
    } catch (err) {
      setSavedMessage(savedErrorMessage(err))
    }
  }, [])

  // Resumes the SaveScreen action that the auth interrupt deferred.
  // The action's payload carries the original name + definition the
  // user clicked Save with — sessionStorage round-tripped them
  // through the sign-in flow, satisfying the bead's "preserves
  // current screen definition" verification.
  useResumedProtectedAction(ProtectedActionType.SaveScreen, async (action) => {
    try {
      const result = await saveScreen(action.payload)
      setSavedMessage(null)
      setScreenName('')
      // The POST response already carries the canonical screen, so
      // splice it in locally instead of round-tripping a list GET.
      // Newest-first matches the server's `updated_at` desc order.
      setSavedScreens((current) => [
        result.screen,
        ...current.filter((s) => s.screen_id !== result.screen.screen_id),
      ])
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

  const handleOpenSaved = (screen: ScreenSubject) => {
    const next = queryToDraft(screen.definition)
    setDraft(next)
    setScreenName(screen.name)
    runSearch(next)
  }

  const handleDeleteSaved = async (screen: ScreenSubject) => {
    // Optimistic removal — the panel only renders when authed, so
    // Delete cannot reach this code path without a session and does
    // not need the auth interrupt. On failure we re-fetch instead of
    // restoring a captured snapshot so concurrent Deletes on different
    // rows don't trample each other's state.
    setSavedScreens((current) => current.filter((s) => s.screen_id !== screen.screen_id))
    try {
      await deleteSavedScreen({ screen_id: screen.screen_id })
    } catch (err) {
      setSavedMessage(savedErrorMessage(err))
      void refreshSavedScreens()
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">Screener</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Build, refine, and view one active screen. Saving requires a session.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 lg:grid-cols-3"
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
        <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
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
              className="w-48 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <button
              type="button"
              onClick={handleSaveClick}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Save
            </button>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
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

function UniverseControls({
  draft,
  onChange,
}: {
  draft: QueryDraft
  onChange: (next: QueryDraft) => void
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Universe
      </legend>
      {UNIVERSE_ENUM_FIELDS.map((spec) => {
        const selected = draft.universe[spec.field] ?? []
        return (
          <label key={spec.field} className="flex flex-col gap-1 text-xs">
            <span className="text-neutral-600 dark:text-neutral-300">{spec.label}</span>
            <select
              multiple
              value={selected}
              onChange={(event) => {
                const next = Array.from(event.target.selectedOptions).map((o) => o.value)
                onChange(setUniverseSelection(draft, spec.field, next))
              }}
              className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm text-neutral-800 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
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
    <fieldset className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {legend}
      </legend>
      {fields.map((spec) => {
        const range = bag[spec.field] ?? emptyNumericRange()
        return (
          <div key={spec.field} className="flex flex-col gap-1 text-xs">
            <span className="text-neutral-600 dark:text-neutral-300">
              {spec.label}
              {spec.hint ? (
                <span className="ml-1 text-neutral-400 dark:text-neutral-500">
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
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
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
    <fieldset className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Sort &amp; page
      </legend>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-neutral-600 dark:text-neutral-300">Sort by</span>
        <div className="flex gap-2">
          <select
            value={draft.sort.field}
            onChange={(event) =>
              onChange(setSort(draft, { ...draft.sort, field: event.target.value }))
            }
            className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
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
            className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            aria-label="Sort direction"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-neutral-600 dark:text-neutral-300">Page size</span>
        <input
          type="number"
          min={SCREENER_LIMIT_MIN}
          max={SCREENER_LIMIT_MAX}
          step={1}
          value={draft.limit}
          onChange={(event) => onChange(setLimit(draft, Number(event.target.value)))}
          className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
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
      <span className="text-xs text-red-600 dark:text-red-400" role="status">
        {savedMessage}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="text-xs text-red-600 dark:text-red-400" role="status">
        {errorMessage ?? 'Search failed'}
      </span>
    )
  }
  if (status === 'loading') {
    return (
      <span className="text-xs text-neutral-500 dark:text-neutral-400" role="status">
        Running screen…
      </span>
    )
  }
  return <span className="text-xs text-neutral-400 dark:text-neutral-500">Edit a filter and run.</span>
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
      className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <header className="flex items-center justify-between pb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        <span>Saved screens</span>
        <span className="font-normal normal-case">{screens.length}</span>
      </header>
      {screens.length === 0 ? (
        <p className="px-1 py-2 text-xs text-neutral-500 dark:text-neutral-400">
          No saved screens yet. Build one above and click Save.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {screens.map((screen) => (
            <li
              key={screen.screen_id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {screen.name}
                </div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  Updated {screen.updated_at}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(screen)}
                  className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(screen)}
                  className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-neutral-700 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{message}</p>
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
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
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
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {response.total_count === 0
            ? 'No matches'
            : `Showing ${start}–${end} of ${response.total_count}`}
          <span className="ml-2 text-neutral-400 dark:text-neutral-500">
            as of {response.as_of}
          </span>
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev || status === 'loading'}
            className="rounded-md border border-neutral-200 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext || status === 'loading'}
            className="rounded-md border border-neutral-200 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
          >
            Next
          </button>
        </div>
      </div>
      {response.rows.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          No subjects match this query. Loosen a filter and try again.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
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
                  className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
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
                  <td className="py-2 pr-3 text-right tabular-nums text-neutral-500 dark:text-neutral-400">{row.rank}</td>
                  <td className="py-2 pr-3">
                    <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                      {row.display.ticker ?? row.display.primary}
                    </span>
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                      {row.display.legal_name ?? row.display.primary}
                      {row.display.mic ? ` · ${row.display.mic}` : ''}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{cells.lastPrice}</td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${cells.changeClass}`}
                  >
                    {cells.changePct}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{cells.volume}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{cells.marketCap}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{cells.peRatio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type FormattedCells = {
  lastPrice: string
  changePct: string
  changeClass: string
  volume: string
  marketCap: string
  peRatio: string
}

function formatRowCells(row: ScreenerResultRow): { row: ScreenerResultRow; cells: FormattedCells } {
  const last = row.quote.last_price
  const change = row.quote.change_pct
  const lastPrice = last === null ? '—' : formatCurrency2(last, row.quote.currency)
  const changePct = change === null ? '—' : `${(change * 100).toFixed(2)}%`
  const changeClass = signedTextClass(change ?? 0)
  const volume = row.quote.volume === null ? '—' : formatCompactNumber(row.quote.volume)
  const marketCap =
    row.fundamentals.market_cap === null
      ? '—'
      : formatCompactCurrency(row.fundamentals.market_cap, row.quote.currency)
  const peRatio =
    row.fundamentals.pe_ratio === null ? '—' : row.fundamentals.pe_ratio.toFixed(1)
  return {
    row,
    cells: { lastPrice, changePct, changeClass, volume, marketCap, peRatio },
  }
}

