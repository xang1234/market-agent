import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
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
              ? `No subject found for ${response.unresolved[0] ?? trimmedQuery}`
              : null,
          )
        })
        .catch((error) => {
          if (controller.signal.aborted || requestSeq.current !== seq) return
          setStatus('error')
          setMessage(error instanceof Error ? error.message : 'Subject resolve failed')
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
        'w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500 dark:focus:bg-neutral-900 dark:focus:ring-neutral-700',
        placement === 'topbar' ? 'py-2' : 'py-1.5',
      ].join(' '),
    [placement],
  )

  const enterSubject = (subject: ResolvedSubject) => {
    onResolvedSubject?.(subject)
    navigate(symbolDetailPathForSubject(subject.subject_ref), {
      state: { subject },
    })
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
      setMessage(`No subject found for ${plan.unresolved || trimmedQuery}`)
    } catch (error) {
      if (controller.signal.aborted || requestSeq.current !== seq) return
      setMessage(error instanceof Error ? error.message : 'Subject resolve failed')
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
        className={inputClassName}
      />
      {hasCandidates ? (
        <div
          id={listboxId}
          role="listbox"
          className={[
            'absolute z-30 mt-1 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900',
            placement === 'topbar' ? 'left-0 right-0' : 'left-0 w-72',
          ].join(' ')}
        >
          {typeahead.candidates.map((candidate, index) => (
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
                  ? 'bg-neutral-100 text-neutral-950 dark:bg-neutral-800 dark:text-neutral-50'
                  : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800',
              ].join(' ')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {candidate.display_labels?.primary ?? candidate.display_name}
                </span>
                <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {candidateListingLabel(candidate)}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                {Math.round(candidate.confidence * 100)}%
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {message ? (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {message}
        </div>
      ) : null}
      {status === 'loading' || status === 'resolving' ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
          Resolving
        </span>
      ) : null}
    </form>
  )
}
