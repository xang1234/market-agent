import { createContext } from 'react'

import type { EvidenceBlockInspection, EvidenceInspectionRef } from './inspectionTypes.ts'

export type EvidenceInspectorContextValue = {
  openInspection(input: { snapshotId: string; ref: EvidenceInspectionRef }): void
  openBlockInspection(inspection: EvidenceBlockInspection): void
  /** Opens the shared inspector for one certified financial result. Absent where the host cannot fetch one. */
  openFinancialResult?(resultId: string): void
  closeInspection(): void
}

export const EvidenceInspectorContext = createContext<EvidenceInspectorContextValue | null>(null)
