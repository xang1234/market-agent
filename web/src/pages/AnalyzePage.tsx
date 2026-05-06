import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  analyzeIntentLabel,
  parseAnalyzeQuery,
  subjectFromAnalyzeEntry,
  type AnalyzeIntent,
} from '../analyze/analyzeEntry'
import { BlockView, type Block } from '../blocks'
import { subjectDisplayName } from '../symbol/quote'
import { symbolDetailPathForSubject, type ResolvedSubject } from '../symbol/search'
import { useAuth } from '../shell/useAuth.ts'

type AnalyzeTemplate = {
  template_id: string
  name: string
  prompt_template: string
  source_categories: ReadonlyArray<string>
  version: number
}

type AnalyzeRun = {
  run_id: string
  template_id: string
  template_version: number
  snapshot_id: string
  blocks: ReadonlyArray<Block>
  created_at: string
}

type ChatThread = {
  thread_id: string
  title: string | null
  updated_at: string
}

const DEFAULT_TEMPLATES: ReadonlyArray<AnalyzeTemplate> = [
  {
    template_id: 'earnings-quality',
    name: 'Earnings quality',
    prompt_template: 'Assess revenue quality, margins, cash conversion, and management commentary.',
    source_categories: ['filings', 'transcripts', 'news'],
    version: 1,
  },
  {
    template_id: 'variant-view',
    name: 'Variant view',
    prompt_template: 'Compare the market narrative with evidence-backed counterpoints.',
    source_categories: ['filings', 'news', 'social'],
    version: 1,
  },
]

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
          Template-driven memo workflow with editable instructions, source controls, and
          chat handoff.
        </p>
      </header>
      {subject ? <CarriedSubjectContext subject={subject} intent={query.intent} /> : null}
      <AnalyzeWorkspace subject={subject} />
    </div>
  )
}

function AnalyzeWorkspace({ subject }: { subject: ResolvedSubject | null }) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<ReadonlyArray<AnalyzeTemplate>>(DEFAULT_TEMPLATES)
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATES[0].template_id)
  const selectedTemplate = templates.find((template) => template.template_id === selectedTemplateId) ?? templates[0]
  const [instructions, setInstructions] = useState(selectedTemplate.prompt_template)
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set(selectedTemplate.source_categories))
  const [memoRun, setMemoRun] = useState<AnalyzeRun | null>(null)
  const [status, setStatus] = useState('Ready')

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    fetch('/v1/analyze/templates', {
      headers: { 'x-user-id': session.userId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { templates?: AnalyzeTemplate[] }
      })
      .then((body) => {
        if (body?.templates?.length) {
          setTemplates(body.templates)
          setSelectedTemplateId(body.templates[0].template_id)
          setInstructions(body.templates[0].prompt_template)
          setSources(new Set(body.templates[0].source_categories))
          setMemoRun(null)
          setStatus('Ready')
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [session])

  const toggleSource = (category: string) => {
    setSources((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
    setMemoRun(null)
    setStatus('Ready')
  }

  const generateMemo = async (): Promise<AnalyzeRun | null> => {
    if (!session) {
      setStatus('Sign in to generate a memo')
      return null
    }
    setStatus('Generating memo')
    try {
      const response = await fetch('/v1/analyze/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': session.userId,
        },
        body: JSON.stringify({
          template_id: selectedTemplate.template_id,
          instructions,
          source_categories: [...sources],
          subject_ref: subject?.subject_ref ?? null,
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const run = (await response.json()) as AnalyzeRun
      setMemoRun(run)
      setStatus('Memo generated')
      return run
    } catch (caught) {
      setStatus(`Generate failed: ${caught instanceof Error ? caught.message : String(caught)}`)
      return null
    }
  }

  const addToChat = async () => {
    if (!session) {
      setStatus('Sign in to add this memo to chat')
      return
    }
    const run = memoRun ?? (await generateMemo())
    if (!run) return
    setStatus('Creating chat thread')
    const titleSubject = subject ? subjectDisplayName(subject) : 'Research memo'
    try {
      const response = await fetch('/v1/chat/threads', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': session.userId,
        },
        body: JSON.stringify({
          title: `${selectedTemplate.name} - ${titleSubject}`,
          primary_subject_ref: subject?.subject_ref ?? undefined,
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const thread = (await response.json()) as ChatThread
      setStatus(`Added memo ${run.run_id} to chat`)
      navigate(`/chat/${thread.thread_id}`, {
        state: {
          importedMemo: {
            run_id: run.run_id,
            snapshot_id: run.snapshot_id,
            blocks: run.blocks,
          },
        },
      })
    } catch (caught) {
      setStatus(`Add to chat failed: ${caught instanceof Error ? caught.message : String(caught)}`)
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Template
          <select
            value={selectedTemplateId}
            onChange={(event) => {
              const next = templates.find((template) => template.template_id === event.currentTarget.value)
              if (!next) return
              setSelectedTemplateId(next.template_id)
              setInstructions(next.prompt_template)
              setSources(new Set(next.source_categories))
              setMemoRun(null)
              setStatus('Ready')
            }}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {templates.map((template) => (
              <option key={template.template_id} value={template.template_id}>
                {template.name} v{template.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Instructions
          <textarea
            value={instructions}
            onChange={(event) => {
              setInstructions(event.currentTarget.value)
              setMemoRun(null)
              setStatus('Ready')
            }}
            rows={6}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Source controls</legend>
          {['filings', 'transcripts', 'news', 'social', 'uploads'].map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={sources.has(category)}
                onChange={() => toggleSource(category)}
              />
              {category}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex min-h-[420px] flex-col rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Memo canvas</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {subject ? subjectDisplayName(subject) : 'No subject selected'} · {[...sources].join(', ') || 'no sources'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void generateMemo()}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
            >
              Generate memo
            </button>
            <button
              type="button"
              onClick={() => void addToChat()}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Add to chat
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">{status}</p>
        <article className="mt-5 flex flex-1 flex-col gap-3 rounded-md border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
          {memoRun ? (
            memoRun.blocks.map((block) => <BlockView key={block.id} block={block} />)
          ) : (
            <>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{selectedTemplate.name}</h3>
              <p className="text-sm leading-6 text-neutral-700 dark:text-neutral-200">{instructions}</p>
            </>
          )}
        </article>
      </div>
    </section>
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
          <span className="text-xs uppercase text-neutral-500 dark:text-neutral-400">Carried subject</span>
          <h2 id="analyze-carried-subject-heading" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {displayName}
          </h2>
          <span data-testid="analyze-carried-subject-ref" className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {subject.subject_ref.kind}:{subject.subject_ref.id}
          </span>
        </div>
        {intent !== null && (
          <span data-testid="analyze-intent-badge" className="rounded border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            Intent · {analyzeIntentLabel(intent)}
          </span>
        )}
      </div>
      <div>
        <Link
          to={symbolDetailPathForSubject(subject.subject_ref)}
          state={{ subject }}
          data-testid="analyze-back-to-symbol"
          className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 underline-offset-2 hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-neutral-50"
        >
          Back to {displayName}
        </Link>
      </div>
    </section>
  )
}
