import { createContext } from 'react'

import type { EvidenceInspectionRef } from './inspectionTypes.ts'

export type EvidenceInspectorContextValue = {
  openInspection(input: { snapshotId: string; ref: EvidenceInspectionRef }): void
  closeInspection(): void
}

export const EvidenceInspectorContext = createContext<EvidenceInspectorContextValue | null>(null)
