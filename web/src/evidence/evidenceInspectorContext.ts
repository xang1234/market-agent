import { createContext } from 'react'

import type { FinancialResultShown } from '../blocks/financialInspection.ts'
import type { FigureSegment } from '../blocks/types.ts'
import type { EvidenceBlockInspection, EvidenceInspectionRef } from './inspectionTypes.ts'

export type EvidenceInspectorContextValue = {
  /** `shownAs` is the exact text the clicked control displayed; the panel heads with it over the server title. */
  openInspection(input: { snapshotId: string; ref: EvidenceInspectionRef; shownAs?: string }): void
  openBlockInspection(inspection: EvidenceBlockInspection): void
  /** Opens the shared inspector for one certified financial result, headed with what the clicked value showed. Absent where the host cannot fetch one. */
  openFinancialResult?(resultId: string, shown?: FinancialResultShown): void
  /** Opens a page for a figure computed from several sources: its derivation, and each source to open. Absent where the host has no panel. */
  openFigure?(input: { snapshotId: string; figure: FigureSegment }): void
  closeInspection(): void
}

export const EvidenceInspectorContext = createContext<EvidenceInspectorContextValue | null>(null)
