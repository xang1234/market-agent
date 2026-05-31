import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  analyzeIntentLabel,
  parseAnalyzeQuery,
  subjectFromAnalyzeEntry,
  type AnalyzeIntent,
} from '../analyze/analyzeEntry'
import { fetchAnalyzePlaybooks, type AnalyzePlaybook } from '../analyze/playbooks.ts'
import {
  diffAnalyzeRuns,
  fetchAnalyzeRun,
  fetchAnalyzeRuns,
  isRerunnableRun,
  rerunAnalyzeRun,
  type AnalyzeRunDetail,
  type AnalyzeRunHistoryItem,
} from '../analyze/runHistory.ts'
import { shareAnalyzeRunToChat, type AnalyzeRun } from '../analyze/shareToChat.ts'
import { BlockView, type Block } from '../blocks'
import { authenticatedJson } from '../http/authFetch.ts'
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

const DEFAULT_TEMPLATES: ReadonlyArray<AnalyzeTemplate> = [
  {
    template_id: '11111111-1111-4111-8111-111111111111',
    name: 'Earnings template',
    prompt_template: 'Assess revenue quality, margins, cash conversion, and management commentary.',
    source_categories: ['filings', 'transcripts', 'news'],
    version: 1,
  },
  {
    template_id: '22222222-2222-4222-8222-222222222222',
    name: 'Variant view',
    prompt_template: 'Compare the market narrative with evidence-backed counterpoints.',
    source_categories: ['filings', 'news', 'transcripts'],
    version: 1,
  },
]

const DEFAULT_PLAYBOOKS: ReadonlyArray<AnalyzePlaybook> = [
  {
    playbook_id: 'earnings_quality',
    version: 1,
    name: 'Earnings quality',
    description: 'Assess revenue quality, margins, cash conversion, and management commentary.',
    default_instructions: 'Assess revenue quality, margins, cash conversion, and management commentary.',
    default_source_categories: ['filings', 'transcripts', 'news'],
    sections: [
      { section_id: 'summary', title: 'Summary', required: true, block_hint: 'rich_text' },
      { section_id: 'quality_of_revenue', title: 'Quality of revenue', required: true, block_hint: 'metric_row' },
      { section_id: 'margin_bridge', title: 'Margin bridge', required: true, block_hint: 'table' },
      { section_id: 'cash_conversion', title: 'Cash conversion', required: true, block_hint: 'metric_row' },
      { section_id: 'management_tone', title: 'Management tone', required: true, block_hint: 'rich_text' },
      { section_id: 'watch_items', title: 'Watch items', required: true, block_hint: 'table' },
    ],
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
        <p className="mt-1 text-sm text-muted">
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
  const [playbooks, setPlaybooks] = useState<ReadonlyArray<AnalyzePlaybook>>(DEFAULT_PLAYBOOKS)
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(DEFAULT_PLAYBOOKS[0].playbook_id)
  const selectedTemplate = templates.find((template) => template.template_id === selectedTemplateId) ?? templates[0]
  const selectedPlaybook = playbooks.find((playbook) => playbook.playbook_id === selectedPlaybookId) ?? playbooks[0]
  const [instructions, setInstructions] = useState(selectedPlaybook.default_instructions)
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set(selectedPlaybook.default_source_categories))
  const [memoRun, setMemoRun] = useState<AnalyzeRunDetail | null>(null)
  const [runHistory, setRunHistory] = useState<ReadonlyArray<AnalyzeRunHistoryItem>>([])
  const [runHistoryCursor, setRunHistoryCursor] = useState<string | null>(null)
  const [compareRunId, setCompareRunId] = useState('')
  const [openedRunDetails, setOpenedRunDetails] = useState<Record<string, AnalyzeRunDetail>>({})
  const [status, setStatus] = useState('Ready')
  const availableSourceCategories = sourceCategoriesFor(selectedTemplate, selectedPlaybook)
  const compareRunDetail = compareRunId ? openedRunDetails[compareRunId] : null
  const runDiff = memoRun && compareRunDetail ? diffAnalyzeRuns(compareRunDetail, memoRun) : null
  const runDiffDriftLabels = runDiff ? [
    runDiff.summary.evidence_snapshot_changed ? 'Evidence snapshot changed' : null,
    runDiff.summary.template_changed
      ? `Template changed v${runDiff.summary.template_version_before ?? '?'} -> v${runDiff.summary.template_version_after ?? '?'}`
      : null,
    runDiff.summary.playbook_changed
      ? `Playbook changed v${runDiff.summary.playbook_version_before ?? '?'} -> v${runDiff.summary.playbook_version_after ?? '?'}`
      : null,
  ].filter((label): label is string => label !== null) : []

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    const fetchWithSignal: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal })
    Promise.all([
      authenticatedJson<{ templates?: AnalyzeTemplate[] }>('/v1/analyze/templates', {
        userId: session.userId,
        fetchImpl: fetchWithSignal,
      }),
      fetchAnalyzePlaybooks({ userId: session.userId, fetchImpl: fetchWithSignal }),
      fetchAnalyzeRuns({ userId: session.userId, limit: 25, fetchImpl: fetchWithSignal }),
    ])
      .then(([templateBody, nextPlaybooks, nextRunPage]) => {
        if (controller.signal.aborted) return
        if (templateBody.templates?.length) {
          setTemplates(templateBody.templates)
          setSelectedTemplateId(templateBody.templates[0].template_id)
        }
        if (nextPlaybooks.length > 0) {
          const first = nextPlaybooks[0]
          setPlaybooks(nextPlaybooks)
          setSelectedPlaybookId(first.playbook_id)
          setInstructions(first.default_instructions)
          setSources(new Set(first.default_source_categories))
          setMemoRun(null)
          setStatus('Ready')
        }
        setRunHistory(nextRunPage.runs)
        setRunHistoryCursor(nextRunPage.next_cursor)
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

  const generateMemo = async (): Promise<AnalyzeRunDetail | null> => {
    if (!session) {
      setStatus('Sign in to generate a memo')
      return null
    }
    setStatus('Generating memo')
    try {
      const run = await authenticatedJson<AnalyzeRunDetail>('/v1/analyze/runs', {
        userId: session.userId,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          playbook_id: selectedPlaybook?.playbook_id ?? selectedPlaybookId,
          template_id: selectedTemplate.template_id,
          instructions,
          source_categories: [...sources],
          subject_ref: subject?.subject_ref ?? null,
        }),
      })
      setMemoRun(run)
      setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run }))
      setRunHistory((current) => [toAnalyzeRunHistoryItem(run), ...current.filter((item) => item.run_id !== run.run_id)])
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
    const titleSubject = subject ? subjectDisplayName(subject) : 'Research memo'
    try {
      setStatus('Persisting memo in chat')
      const result = await shareAnalyzeRunToChat({
        userId: session.userId,
        sourceKind: 'memo',
        run: run as unknown as AnalyzeRun,
        title: `${run.display_title ?? selectedTemplate.name} - ${titleSubject}`,
        primarySubjectRef: subject?.subject_ref ?? null,
      })
      setStatus(`Added memo ${run.run_id} to chat`)
      navigate(`/chat/${result.thread.thread_id}`)
    } catch (caught) {
      setStatus(`Add to chat failed: ${caught instanceof Error ? caught.message : String(caught)}`)
    }
  }

  const handleOpenRun = async (runId: string) => {
    if (!session) return
    const cached = openedRunDetails[runId]
    const run = cached ?? await fetchAnalyzeRun({ userId: session.userId, runId })
    if (!cached) setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run }))
    setMemoRun(run)
    setStatus(`Opened ${run.display_title}`)
  }

  const handleRerun = async (runId: string) => {
    if (!session) return
    const run = await rerunAnalyzeRun({ userId: session.userId, runId })
    setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run }))
    setRunHistory((current) => [toAnalyzeRunHistoryItem(run), ...current.filter((item) => item.run_id !== run.run_id)])
    setMemoRun(run)
    setStatus(`Reran ${run.display_title}`)
  }

  const handleLoadMoreRuns = async () => {
    if (!session || !runHistoryCursor) return
    const page = await fetchAnalyzeRuns({ userId: session.userId, cursor: runHistoryCursor, limit: 25 })
    setRunHistory((current) => [...current, ...page.runs])
    setRunHistoryCursor(page.next_cursor)
  }

  const handleCompareRunChange = async (runId: string) => {
    setCompareRunId(runId)
    if (!session || runId === '' || openedRunDetails[runId]) return
    const run = await fetchAnalyzeRun({ userId: session.userId, runId })
    setOpenedRunDetails((current) => ({ ...current, [run.run_id]: run }))
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="flex flex-col gap-2 text-sm font-medium text-fg">
            Playbook
            <select
              value={selectedPlaybookId}
              onChange={(event) => {
                const next = playbooks.find((playbook) => playbook.playbook_id === event.currentTarget.value)
                if (!next) return
                setSelectedPlaybookId(next.playbook_id)
                setInstructions(next.default_instructions)
                setSources(new Set(next.default_source_categories))
                setMemoRun(null)
                setStatus('Ready')
              }}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            >
              {playbooks.map((playbook) => (
                <option key={playbook.playbook_id} value={playbook.playbook_id}>
                  {playbook.name} v{playbook.version}
                </option>
              ))}
            </select>
          </label>
          {selectedPlaybook ? (
            <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <h3 className="font-medium text-fg">Sections</h3>
              <ul className="mt-2 flex flex-col gap-1 text-fg-soft">
                {selectedPlaybook.sections.map((section) => (
                  <li key={section.section_id}>{section.title}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <label className="flex flex-col gap-2 text-sm font-medium text-fg">
            Template
            <select
              value={selectedTemplateId}
              onChange={(event) => {
                const next = templates.find((template) => template.template_id === event.currentTarget.value)
                if (!next) return
                setSelectedTemplateId(next.template_id)
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
        <label className="flex flex-col gap-2 text-sm font-medium text-fg">
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
          <legend className="text-sm font-medium text-fg">Source controls</legend>
          {availableSourceCategories.map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm text-fg-soft">
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
            <h2 className="text-lg font-semibold text-fg">Memo canvas</h2>
            <p className="mt-1 text-sm text-muted">
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
        <p className="mt-3 text-xs text-muted">{status}</p>
        <article className="mt-5 flex flex-1 flex-col gap-3 rounded-md border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
          {memoRun ? (
            memoRun.blocks.map((block) => <BlockView key={blockKey(block)} block={block as Block} />)
          ) : (
            <>
              <h3 className="text-sm font-semibold text-fg">{selectedPlaybook?.name ?? selectedTemplate.name}</h3>
              <p className="text-sm leading-6 text-fg">{instructions}</p>
            </>
          )}
        </article>
      </div>
      </section>
      {runHistory.length > 0 ? (
        <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-fg">Run history</h2>
            <label className="flex items-center gap-2 text-xs text-fg-soft">
              Compare
              <select
                value={compareRunId}
                onChange={(event) => void handleCompareRunChange(event.currentTarget.value)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="">None</option>
                {runHistory.map((run) => (
                  <option key={run.run_id} value={run.run_id}>
                    {run.display_title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {runHistory.map((run) => (
              <li key={run.run_id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                <span>{run.display_title} · {run.playbook_version ? `v${run.playbook_version}` : run.template_name} · {run.created_at}</span>
                <div className="flex gap-2">
                  <button type="button" className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => void handleOpenRun(run.run_id)}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
                    disabled={!isRerunnableRun(run)}
                    title={isRerunnableRun(run) ? 'Rerun' : run.rerun_unavailable_reason ?? 'This run cannot be rerun'}
                    onClick={() => void handleRerun(run.run_id)}
                  >
                    Rerun
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {runHistoryCursor ? (
            <button type="button" className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700" onClick={() => void handleLoadMoreRuns()}>
              Load more
            </button>
          ) : null}
          {runDiff ? (
            <section className="mt-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <h3 className="text-sm font-semibold">Run diff</h3>
              {runDiffDriftLabels.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs text-fg-soft">
                  {runDiffDriftLabels.map((label) => (
                    <li key={label} className="rounded border border-neutral-200 px-2 py-1 dark:border-neutral-800">{label}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-2 text-sm">
                {runDiff.rows.map((row) => (
                  <li key={`${row.status}:${row.key}`}>{row.status}: {row.title}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function toAnalyzeRunHistoryItem(run: AnalyzeRunDetail): AnalyzeRunHistoryItem {
  return {
    run_id: run.run_id,
    template_id: run.template_id,
    template_name: run.template_name,
    template_version: run.template_version,
    playbook_id: run.playbook_id,
    playbook_name: run.playbook_name,
    playbook_version: run.playbook_version,
    display_title: run.display_title,
    can_rerun: run.can_rerun,
    rerun_unavailable_reason: run.rerun_unavailable_reason,
    created_at: run.created_at,
    snapshot_id: run.snapshot_id,
  }
}

function sourceCategoriesFor(
  template: AnalyzeTemplate,
  playbook: AnalyzePlaybook | undefined,
): ReadonlyArray<string> {
  return [...new Set([
    ...(playbook?.default_source_categories ?? []),
    ...template.source_categories,
    'filings',
    'transcripts',
    'news',
    'issuer_ir',
  ])]
}

function blockKey(block: Record<string, unknown>): string {
  return typeof block.id === 'string' ? block.id : JSON.stringify(block)
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
          <span className="text-xs uppercase text-muted">Carried subject</span>
          <h2 id="analyze-carried-subject-heading" className="text-lg font-semibold text-fg">
            {displayName}
          </h2>
          <span data-testid="analyze-carried-subject-ref" className="font-mono text-xs text-muted">
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
