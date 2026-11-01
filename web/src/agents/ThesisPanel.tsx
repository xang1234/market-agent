import { useEffect, useRef, useState } from 'react'
import type { FetchImpl } from '../http/authFetch.ts'
import { fetchThesisHistory } from './thesisClient.ts'
import { ThesisEditor } from './ThesisEditor.tsx'
import { AssessmentHistory, VersionHistory } from './ThesisHistory.tsx'
import { FailureNotice } from '../ui/FailureNotice.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import type { ThesisHistoryResponse, ThesisVersion } from '../../../services/agents/src/thesis-types.ts'
import { PAGE_PANEL_CLASS, PANEL_TITLE_CLASS } from '../ui/pageStyles.ts'

type ThesisPanelProps = {
  userId: string
  agentId: string
  initialThesis: string
  refreshKey: number
  fetchImpl?: FetchImpl
  onSaved(thesis: ThesisVersion): void
  onStructuredChange?: (agentId: string, hasStructuredThesis: boolean) => void
}

export function ThesisPanel(props: ThesisPanelProps) {
  return <ThesisPanelContent key={`${props.userId}:${props.agentId}`} {...props} />
}

function ThesisPanelContent({ userId, agentId, initialThesis, refreshKey, fetchImpl, onSaved, onStructuredChange }: ThesisPanelProps) {
  const [history, setHistory] = useState<ThesisHistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    fetchThesisHistory({ userId, agentId, signal: controller.signal, fetchImpl })
      .then((body) => {
        if (controller.signal.aborted) return
        setHistory(body)
        setError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [userId, agentId, refreshKey, fetchImpl, attempt])

  function retry() {
    setError(null)
    setAttempt((current) => current + 1)
  }

  const hasStructuredThesis = history === null ? null : history.thesis !== null
  useEffect(() => {
    if (hasStructuredThesis !== null) onStructuredChange?.(agentId, hasStructuredThesis)
  }, [agentId, hasStructuredThesis, onStructuredChange])

  function recordSaved(saved: ThesisVersion) {
    // A GET started before this save cannot replace the newly saved resource.
    request.current?.abort()
    setHistory((current) => current === null ? current : {
      ...current,
      thesis: saved,
      versions: [saved, ...current.versions.filter((version) => version.thesis_version_id !== saved.thesis_version_id)].slice(0, 20),
    })
    setError(null)
    onSaved(saved)
  }

  const failure = error === null ? null : history === null ? "Couldn't load the thesis conditions." : "Couldn't refresh the assessment history."
  return (
    <PanelFrame>
      {failure !== null ? (
        <div className="mt-2">
          <FailureNotice message={failure} detail={error ?? ''} onRetry={retry} />
        </div>
      ) : null}
      {history === null ? (
        !error && <Skeleton label="Loading thesis conditions" className="h-40" />
      ) : (
        <>
          <ThesisEditor userId={userId} agentId={agentId} initialThesis={initialThesis} savedThesis={history.thesis} metrics={history.metrics ?? []} fetchImpl={fetchImpl} onSaved={recordSaved} />
          <AssessmentHistory history={history} />
          <VersionHistory versions={history.versions} currentVersion={history.thesis?.version ?? 0} />
        </>
      )}
    </PanelFrame>
  )
}

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="thesis-panel-heading" className={PAGE_PANEL_CLASS}>
      <h2 id="thesis-panel-heading" className={PANEL_TITLE_CLASS}>Thesis conditions</h2>
      <p className="mt-1 text-sm text-muted">
        Turn the investment view into explicit beliefs, disconfirming evidence, and review horizons.
      </p>
      {children}
    </section>
  )
}
