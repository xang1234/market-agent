import { useMemo, useRef, useState, type ReactNode } from 'react'

import { HttpJsonError } from '../http/authFetch.ts'
import { useAuth } from '../shell/useAuth.ts'
import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from './evidenceInspectorContext.ts'
import { EvidenceInspectorDrawer, type EvidenceInspectorState } from './EvidenceInspectorDrawer.tsx'
import { fetchEvidenceInspection } from './inspectionClient.ts'
import { fetchFinancialResultInspection } from '../blocks/financialInspection.ts'

const EVIDENCE_INSPECTION_UNAVAILABLE_MESSAGE = 'Evidence is not available for this artifact.'

export function EvidenceInspectorProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [state, setState] = useState<EvidenceInspectorState>({ kind: 'closed' })
  const requestSeqRef = useRef(0)

  const value = useMemo<EvidenceInspectorContextValue>(
    () => ({
      openInspection({ snapshotId, ref }) {
        if (!session) {
          setState({ kind: 'error', snapshotId, ref, message: 'Sign in to inspect evidence.' })
          return
        }

        const requestSeq = requestSeqRef.current + 1
        requestSeqRef.current = requestSeq
        setState({ kind: 'loading', snapshotId, ref })
        fetchEvidenceInspection({ userId: session.userId, snapshotId, ref })
          .then((inspection) => {
            if (requestSeqRef.current === requestSeq) setState({ kind: 'ready', inspection })
          })
          .catch((error) => {
            if (requestSeqRef.current !== requestSeq) return
            setState({
              kind: 'error',
              snapshotId,
              ref,
              message: inspectionErrorMessage(error),
            })
          })
      },
      openBlockInspection(inspection) {
        requestSeqRef.current += 1
        setState({ kind: 'block', inspection })
      },
      openFinancialResult(resultId) {
        if (!session) {
          setState({ kind: 'financial', load: { kind: 'error', resultId, message: 'Sign in to inspect this calculation.' } })
          return
        }
        const requestSeq = requestSeqRef.current + 1
        requestSeqRef.current = requestSeq
        setState({ kind: 'financial', load: { kind: 'loading', resultId } })
        fetchFinancialResultInspection({ userId: session.userId, resultId })
          .then((inspection) => {
            if (requestSeqRef.current === requestSeq) setState({ kind: 'financial', load: { kind: 'ready', inspection } })
          })
          .catch((error) => {
            if (requestSeqRef.current !== requestSeq) return
            const message = error instanceof HttpJsonError && error.status === 404
              ? 'This calculation is not available to inspect.'
              : 'The calculation could not be loaded. Try again.'
            setState({ kind: 'financial', load: { kind: 'error', resultId, message } })
          })
      },
      closeInspection() {
        requestSeqRef.current += 1
        setState({ kind: 'closed' })
      },
    }),
    [session],
  )

  return (
    <EvidenceInspectorContext.Provider value={value}>
      {children}
      <EvidenceInspectorDrawer state={state} onClose={value.closeInspection} />
    </EvidenceInspectorContext.Provider>
  )
}

function inspectionErrorMessage(error: unknown): string {
  if (error instanceof HttpJsonError && error.status === 404) return EVIDENCE_INSPECTION_UNAVAILABLE_MESSAGE
  const message = error instanceof Error ? error.message : String(error)
  return message
}
