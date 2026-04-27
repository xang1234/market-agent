import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  analyzeIntentLabel,
  parseAnalyzeQuery,
  subjectFromAnalyzeEntry,
  type AnalyzeIntent,
} from '../analyze/analyzeEntry'
import { subjectDisplayName } from '../symbol/quote'
import { symbolDetailPathForSubject, type ResolvedSubject } from '../symbol/search'

export function AnalyzePage() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const query = parseAnalyzeQuery(searchParams)
  const subject = subjectFromAnalyzeEntry(query, location.state)

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Analyze</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Template-driven memo workflow. Top-level workspace; accepts deep-linked SubjectRef
          context from symbol detail. Full surface ships with P4.2.
        </p>
      </header>
      {subject ? (
        <CarriedSubjectContext subject={subject} intent={query.intent} />
      ) : (
        <EmptyEntryState />
      )}
    </div>
  )
}

function CarriedSubjectContext({
  subject,
  intent,
}: {
  subject: ResolvedSubject
  intent: AnalyzeIntent | null
}) {
  const displayName = subjectDisplayName(subject)
  return (
    <section
      data-testid="analyze-carried-subject"
      aria-labelledby="analyze-carried-subject-heading"
      className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Carried subject
          </span>
          <h2
            id="analyze-carried-subject-heading"
            className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
          >
            {displayName}
          </h2>
          <span
            data-testid="analyze-carried-subject-ref"
            className="font-mono text-xs text-neutral-500 dark:text-neutral-400"
          >
            {subject.subject_ref.kind}:{subject.subject_ref.id}
          </span>
        </div>
        {intent !== null && (
          <span
            data-testid="analyze-intent-badge"
            className="shrink-0 rounded border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            Intent · {analyzeIntentLabel(intent)}
          </span>
        )}
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Subject identity is canonical (SubjectRef from the handoff) — Analyze did not
        re-resolve from raw text. Template picker and memo canvas ship with P4.2 (template
        system) and consume this carried context plus any subjects added inside Analyze.
      </p>
      <div>
        <Link
          to={symbolDetailPathForSubject(subject.subject_ref)}
          state={{ subject }}
          data-testid="analyze-back-to-symbol"
          className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 underline-offset-2 hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-neutral-50"
        >
          ← Back to {displayName}
        </Link>
      </div>
    </section>
  )
}

function EmptyEntryState() {
  return (
    <div
      data-testid="analyze-empty-entry"
      className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      Open Analyze with a subject from symbol detail (the Analyze button on any subject
      header) to prefill canonical context. The template picker + memo canvas ship with P4.2.
    </div>
  )
}
