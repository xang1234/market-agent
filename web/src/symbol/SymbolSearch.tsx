import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { announce } from '../ui/announcer.ts'
import { candidateName } from './quote.ts'
import {
  candidateListingLabel,
  clearSymbolTypeaheadForQueryChange,
  createSymbolTypeaheadState,
  moveSymbolTypeaheadHighlight,
  planSymbolResolution,
  resolveSubjects,
  selectedSymbolCandidate,
  symbolDetailPathForSubject,
  type ResolvedSubject,
  type SymbolTypeaheadState,
} from './search.ts'

type SymbolSearchPlacement = 'topbar' | 'watchlist'

type SymbolSearchProps = {
  placement?: SymbolSearchPlacement
  placeholder?: string
  onResolvedSubject?: (subject: ResolvedSubject) => void
}

type SearchStatus = 'idle' | 'loading' | 'resolving' | 'error'

const DEBOUNCE_MS = 150
const SEARCH_FAILED = "Couldn't search. Try again."

export function SymbolSearch({
  placement = 'topbar',
  placeholder = 'Search ticker, company, theme...',
  onResolvedSubject,
}: SymbolSearchProps) {
  const navigate = useNavigate()
  const inputId = useId()
  const listboxId = `${inputId}-results`
  const [query, setQuery] = useState('')
  const [typeahead, setTypeahead] = useState<SymbolTypeaheadState>(
    createSymbolTypeaheadState([]),
  )
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const resolveControllerRef = useRef<AbortController | null>(null)
  const trimmedQuery = query.trim()

  // Withdrawn when the message changes first, so a reader hears only the search that stood.
  useEffect(() => (message ? announce(message) : undefined), [message])

  useEffect(() => {
    return () => {
      resolveControllerRef.current?.abort()
      resolveControllerRef.current = null
    }
  }, [])

  const hasCandidates = typeahead.candidates.length > 0
  const activeDescendant =
    typeahead.highlightedIndex >= 0 ? `${listboxId}-${typeahead.highlightedIndex}` : undefined

  useEffect(() => {
    if (!trimmedQuery) {
      return
    }

    const seq = requestSeq.current + 1
    requestSeq.current = seq
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setStatus('loading')
      resolveSubjects({ text: trimmedQuery, signal: controller.signal })
        .then((response) => {
          if (requestSeq.current !== seq) return
          setStatus('idle')
          setTypeahead(createSymbolTypeaheadState(response.subjects))
          setMessage(
            response.subjects.length === 0
              ? `No match for "${response.unresolved[0] ?? trimmedQuery}".`
              : null,
          )
        })
        .catch(() => {
          if (controller.signal.aborted || requestSeq.current !== seq) return
          setStatus('error')
          setMessage(SEARCH_FAILED)
        })
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [trimmedQuery])

  const rootClassName = useMemo(
    () =>
      placement === 'topbar'
        ? 'relative min-w-0 flex-1'
        : 'relative w-full',
    [placement],
  )

  const inputClassName = useMemo(
    () =>
      [
        'w-full rounded-md border border-line bg-surface-2 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft',
        placement === 'topbar' ? 'py-2 pl-3 pr-12' : 'px-3 py-1.5',
      ].join(' '),
    [placement],
  )

  // A box that hands the subject to its owner (the watchlist's Add symbol)
  // stays on the page and empties for the next symbol; a plain search opens it.
  const enterSubject = (subject: ResolvedSubject) => {
    if (onResolvedSubject) {
      onResolvedSubject(subject)
      setQuery('')
    } else {
      navigate(symbolDetailPathForSubject(subject.subject_ref), {
        state: { subject },
      })
    }
    setTypeahead(createSymbolTypeaheadState([]))
    setMessage(null)
  }

  const resolveAndPlan = async (candidate?: ResolvedSubject) => {
    if (!trimmedQuery) return
    const seq = requestSeq.current + 1
    requestSeq.current = seq
    resolveControllerRef.current?.abort()
    const controller = new AbortController()
    resolveControllerRef.current = controller
    setStatus('resolving')
    setMessage(null)

    try {
      const response = await resolveSubjects({
        text: trimmedQuery,
        signal: controller.signal,
        ...(candidate ? { choice: { subject_ref: candidate.subject_ref } } : {}),
      })
      if (requestSeq.current !== seq) return
      const plan = planSymbolResolution(response)

      if (plan.state === 'enter_subject') {
        enterSubject(plan.subject)
        return
      }

      if (plan.state === 'needs_choice') {
        setTypeahead(createSymbolTypeaheadState(plan.candidates))
        setMessage('Choose a listing to continue.')
        return
      }

      setTypeahead(createSymbolTypeaheadState([]))
      setMessage(`No match for "${plan.unresolved || trimmedQuery}".`)
    } catch {
      if (controller.signal.aborted || requestSeq.current !== seq) return
      setMessage(SEARCH_FAILED)
      setStatus('error')
      return
    } finally {
      if (resolveControllerRef.current === controller) {
        resolveControllerRef.current = null
      }
      if (requestSeq.current === seq) {
        setStatus((current) => (current === 'error' ? current : 'idle'))
      }
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const selected = selectedSymbolCandidate(typeahead)
    void resolveAndPlan(typeahead.candidates.length > 1 ? selected ?? undefined : undefined)
  }

  const handleQueryChange = (nextQuery: string) => {
    requestSeq.current += 1
    setQuery(nextQuery)
    setTypeahead((current) => clearSymbolTypeaheadForQueryChange(current, nextQuery))
    setMessage(null)
    setStatus('idle')
  }

  return (
    <form className={rootClassName} role="search" onSubmit={handleSubmit}>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setTypeahead((current) => moveSymbolTypeaheadHighlight(current, 'next'))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setTypeahead((current) => moveSymbolTypeaheadHighlight(current, 'previous'))
          } else if (event.key === 'Escape') {
            setTypeahead(createSymbolTypeaheadState([]))
            setMessage(null)
          }
        }}
        placeholder={placeholder}
        aria-label="Search symbols"
        aria-autocomplete="list"
        aria-expanded={hasCandidates}
        aria-controls={hasCandidates ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        data-search-input={placement === 'topbar' ? 'topbar' : undefined}
        className={inputClassName}
      />
      {placement === 'topbar' && (
        <kbd
          aria-hidden="true"
          className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-faint"
        >
          ⌘K
        </kbd>
      )}
      {hasCandidates ? (
        <div
          id={listboxId}
          role="listbox"
          className={[
            'absolute z-30 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-lg',
            placement === 'topbar' ? 'left-0 right-0' : 'left-0 w-72',
          ].join(' ')}
        >
          {typeahead.candidates.map((candidate, index) => {
            const name = candidateName(candidate, index)
            const listing = candidateListingLabel(candidate)
            return (
              <button
                key={`${candidate.subject_ref.kind}:${candidate.subject_ref.id}`}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === typeahead.highlightedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void resolveAndPlan(candidate)}
                className={[
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                  index === typeahead.highlightedIndex
                    ? 'bg-surface-2 text-fg'
                    : 'text-fg hover:bg-surface-2',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {name}
                  </span>
                  {listing !== null && listing !== name ? (
                    <span className="block truncate text-xs text-muted">
                      {listing}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs num text-muted">
                  {Math.round(candidate.confidence * 100)}%
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
      {message ? (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted shadow-lg">
          {message}
        </div>
      ) : null}
      {status === 'loading' || status === 'resolving' ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-faint">
          Resolving
        </span>
      ) : null}
    </form>
  )
}
