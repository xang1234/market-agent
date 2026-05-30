import { createContext } from 'react'

import type { EvidenceBlockInspection, EvidenceInspectionRef } from './inspectionTypes.ts'

export type EvidenceInspectorContextValue = {
  openInspection(input: { snapshotId: string; ref: EvidenceInspectionRef }): void
  openBlockInspection(inspection: EvidenceBlockInspection): void
  closeInspection(): void
}

export const EvidenceInspectorContext = createContext<EvidenceInspectorContextValue | null>(null)
