import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'

import { HttpJsonError } from '../http/authFetch.ts'
import { useAuth } from '../shell/useAuth.ts'
import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from './evidenceInspectorContext.ts'
import { EvidenceInspectorPanel } from './EvidenceInspectorPanel.tsx'
import { fetchEvidenceInspection } from './inspectionClient.ts'
import type { EvidenceInspectionRef } from './inspectionTypes.ts'
import { CLOSED, inspectorStackReducer, type InspectorPage, type InspectorStack } from './inspectorStack.ts'
import { fetchFinancialResultInspection, type FinancialResultShown } from '../blocks/financialInspection.ts'

const EVIDENCE_INSPECTION_UNAVAILABLE_MESSAGE = 'Evidence is not available for this artifact.'
const INSPECTING_ATTRIBUTE = 'data-inspecting'

type Navigation = 'open' | 'push'

type InspectorControls = {
  /** Opens from the page: replaces the stack and remembers the control that opened it. */
  outside: EvidenceInspectorContextValue
  /** Opens from inside the panel: pushes onto the stack. */
  inside: EvidenceInspectorContextValue
  back(to?: number): void
  close(): void
}

const InspectorDockContext = createContext<{ stack: InspectorStack; controls: InspectorControls } | null>(null)

export function EvidenceInspectorProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [stack, dispatch] = useReducer(inspectorStackReducer, CLOSED)
  const requestSeqRef = useRef(0)
  const originRef = useRef<HTMLElement | null>(null)
  const lastClickedRef = useRef<HTMLElement | null>(null)

  // The control under the current click is the opener. document.activeElement
  // is only the fallback: Safari and Firefox on macOS do not focus a clicked
  // button, so focus may still sit in the panel. The click is forgotten once
  // it has been handled.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      lastClickedRef.current = (event.target as Element | null)?.closest?.<HTMLElement>('button, a, [tabindex]') ?? null
      setTimeout(() => {
        lastClickedRef.current = null
      }, 0)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Evidence fetched for one user is never left docked for the next.
  const userId = session?.userId ?? null
  useEffect(() => {
    dispatch({ type: 'close' })
    originRef.current?.removeAttribute(INSPECTING_ATTRIBUTE)
    originRef.current = null
  }, [userId])

  const controls = useMemo<InspectorControls>(() => {
    function releaseOrigin(): HTMLElement | null {
      const origin = originRef.current
      origin?.removeAttribute(INSPECTING_ATTRIBUTE)
      originRef.current = null
      return origin
    }

    function show(navigation: Navigation, page: InspectorPage) {
      if (navigation === 'open') {
        releaseOrigin()
        const origin = lastClickedRef.current ?? openerElement()
        origin?.setAttribute(INSPECTING_ATTRIBUTE, 'true')
        originRef.current = origin
      }
      dispatch({ type: navigation, page })
    }

    function nextRequest(): number {
      requestSeqRef.current += 1
      return requestSeqRef.current
    }

    function close() {
      dispatch({ type: 'close' })
      const origin = releaseOrigin()
      const target = origin?.isConnected ? origin : document.getElementById('workspace-main')
      target?.focus()
    }

    function openEvidence(navigation: Navigation, { snapshotId, ref, shownAs }: { snapshotId: string; ref: EvidenceInspectionRef; shownAs?: string }) {
      const request = nextRequest()
      if (!session) {
        show(navigation, { kind: 'evidence', request, snapshotId, ref, shownAs, load: { kind: 'error', message: 'Sign in to inspect evidence.' } })
        return
      }
      show(navigation, { kind: 'evidence', request, snapshotId, ref, shownAs, load: { kind: 'loading' } })
      fetchEvidenceInspection({ userId: session.userId, snapshotId, ref })
        .then((inspection) => {
          dispatch({ type: 'settled', request, settlement: { kind: 'evidence', load: { kind: 'ready', inspection } } })
        })
        .catch((error) => {
          dispatch({
            type: 'settled',
            request,
            settlement: { kind: 'evidence', load: { kind: 'error', message: inspectionErrorMessage(error) } },
          })
        })
    }

    function openFinancial(navigation: Navigation, resultId: string, shown?: FinancialResultShown) {
      const request = nextRequest()
      if (!session) {
        show(navigation, { kind: 'financial', request, shown, load: { kind: 'error', resultId, message: 'Sign in to inspect this calculation.' } })
        return
      }
      show(navigation, { kind: 'financial', request, shown, load: { kind: 'loading', resultId } })
      fetchFinancialResultInspection({ userId: session.userId, resultId })
        .then((inspection) => {
          dispatch({ type: 'settled', request, settlement: { kind: 'financial', load: { kind: 'ready', inspection } } })
        })
        .catch((error) => {
          const message = error instanceof HttpJsonError && error.status === 404
            ? 'This calculation is not available to inspect.'
            : 'The calculation could not be loaded. Try again.'
          dispatch({ type: 'settled', request, settlement: { kind: 'financial', load: { kind: 'error', resultId, message } } })
        })
    }

    return {
      outside: {
        openInspection: (input) => openEvidence('open', input),
        openBlockInspection: (inspection) => show('open', { kind: 'block', inspection }),
        openFinancialResult: (resultId, shown) => openFinancial('open', resultId, shown),
        closeInspection: () => close(),
      },
      inside: {
        openInspection: (input) => openEvidence('push', input),
        openBlockInspection: (inspection) => show('push', { kind: 'block', inspection }),
        openFinancialResult: (resultId, shown) => openFinancial('push', resultId, shown),
        closeInspection: () => close(),
      },
      back: (to) => dispatch({ type: 'back', to }),
      close: () => close(),
    }
  }, [session])

  const dock = useMemo(() => ({ stack, controls }), [stack, controls])

  return (
    <EvidenceInspectorContext.Provider value={controls.outside}>
      <InspectorDockContext.Provider value={dock}>{children}</InspectorDockContext.Provider>
    </EvidenceInspectorContext.Provider>
  )
}

/**
 * Where the inspector docks: a column beside the main content. While the
 * inspector is open it takes this slot; otherwise `fallback` renders.
 */
export function EvidenceInspectorDock({ fallback = null }: { fallback?: ReactNode }) {
  const dock = useContext(InspectorDockContext)
  if (dock === null || dock.stack.length === 0) return fallback
  const { stack, controls } = dock
  return (
    <EvidenceInspectorPanel
      stack={stack}
      inspector={controls.inside}
      onBack={controls.back}
      onClose={controls.close}
    />
  )
}

function openerElement(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null
  return active !== null && active !== document.body ? active : null
}

function inspectionErrorMessage(error: unknown): string {
  if (error instanceof HttpJsonError && error.status === 404) return EVIDENCE_INSPECTION_UNAVAILABLE_MESSAGE
  const message = error instanceof Error ? error.message : String(error)
  return message
}
