import { useEffect, useRef, useState } from 'react'
import type { FetchImpl } from '../http/authFetch.ts'
import { fetchThesisHistory } from './thesisClient.ts'
import { ThesisEditor } from './ThesisEditor.tsx'
import { AssessmentHistory, VersionHistory } from './ThesisHistory.tsx'
import type { ThesisHistoryResponse, ThesisVersion } from '../../../services/agents/src/thesis-types.ts'

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
  }, [userId, agentId, refreshKey, fetchImpl])

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

  return (
    <PanelFrame>
      {error ? <p role="status" className="mt-2 text-sm text-negative">{history === null ? 'Thesis conditions are unavailable. ' : 'Assessment history could not be refreshed. '}{error}</p> : null}
      {history === null ? (
        !error && <p className="text-sm text-muted">Loading thesis conditions…</p>
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
    <section aria-labelledby="thesis-panel-heading" className="rounded-md border border-line bg-surface p-5">
      <h2 id="thesis-panel-heading" className="text-lg font-semibold text-fg">Thesis conditions</h2>
      <p className="mt-1 text-sm text-muted">
        Turn the investment view into explicit beliefs, disconfirming evidence, and review horizons.
      </p>
      {children}
    </section>
  )
}
