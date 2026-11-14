import type { FinancialResultShown } from '../blocks/financialInspection.ts'
import type { FinancialInspectorLoad } from '../blocks/renderers/FinancialResultInspector.tsx'
import type { EvidenceBlockInspection, EvidenceInspection, EvidenceInspectionRef } from './inspectionTypes.ts'

export type EvidenceLoad =
  | { kind: 'loading' }
  | { kind: 'ready'; inspection: EvidenceInspection }
  | { kind: 'error'; message: string }

export type InspectorPage =
  | { kind: 'evidence'; request: number; snapshotId: string; ref: EvidenceInspectionRef; shownAs?: string; load: EvidenceLoad }
  | { kind: 'block'; inspection: EvidenceBlockInspection }
  | { kind: 'financial'; request: number; shown?: FinancialResultShown; load: FinancialInspectorLoad }

/** Pages the inspector has walked through. Empty means closed; the last page is shown. */
export type InspectorStack = ReadonlyArray<InspectorPage>

export type InspectorSettlement =
  | { kind: 'evidence'; load: EvidenceLoad }
  | { kind: 'financial'; load: FinancialInspectorLoad }

export type InspectorAction =
  | { type: 'open'; page: InspectorPage }
  | { type: 'push'; page: InspectorPage }
  /** Returns to the page at index `to`, or to the previous page. The first page is never popped. */
  | { type: 'back'; to?: number }
  | { type: 'close' }
  | { type: 'settled'; request: number; settlement: InspectorSettlement }

export const CLOSED: InspectorStack = []

export function inspectorStackReducer(stack: InspectorStack, action: InspectorAction): InspectorStack {
  switch (action.type) {
    case 'open':
      return [action.page]
    case 'push':
      return [...stack, action.page]
    case 'back': {
      const to = Math.max(0, Math.min(action.to ?? stack.length - 2, stack.length - 1))
      return to === stack.length - 1 ? stack : stack.slice(0, to + 1)
    }
    case 'close':
      return CLOSED
    case 'settled': {
      const { request, settlement } = action
      if (!stack.some((page) => page.kind !== 'block' && page.request === request)) return stack
      return stack.map((page): InspectorPage => {
        if (page.kind === 'evidence' && settlement.kind === 'evidence' && page.request === request) {
          return { ...page, load: settlement.load }
        }
        if (page.kind === 'financial' && settlement.kind === 'financial' && page.request === request) {
          return { ...page, load: settlement.load }
        }
        return page
      })
    }
  }
}
