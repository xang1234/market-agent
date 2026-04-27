import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
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
  setLimit,
  setNumericRange,
  setOffset,
  setSort,
  setUniverseSelection,
  type QueryDraft,
} from './queryDraft.ts'
import { searchScreener, ScreenerFetchError } from './searchScreener.ts'

type Status = 'loading' | 'error' | 'ready'

// One workspace flow: query controls and result rows live in the same
// surface, never split across routes (parent bead fra-cw0.8). Refining a
// filter triggers a re-run that mutates only the rows region — the URL
// stays at /screener throughout. State lives entirely in component state
// for that reason; promoting it to the URL would force a route change
// per refinement, the exact split this surface exists to avoid.
export function ScreenerWorkspace() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<QueryDraft>(() => createDefaultQueryDraft())
  const [response, setResponse] = useState<ScreenerResponse | null>(null)
  // Status starts as 'loading' because the mount effect kicks off the
  // initial run immediately — initializing to 'loading' lets the effect
  // body skip a synchronous setStatus call (which the React 19 lint
  // rule react-hooks/set-state-in-effect rejects) without losing the
  // visible "running initial screen" affordance.
  const [status, setStatus] = useState<Status>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
        <div className="lg:col-span-3 flex items-center justify-between gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <RunStatus status={status} errorMessage={errorMessage} />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Running…' : 'Run'}
          </button>
        </div>
      </form>

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
}: {
  status: Status
  errorMessage: string | null
}) {
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

