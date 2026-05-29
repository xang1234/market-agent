import { useContext } from 'react'

import { EvidenceInspectorContext } from './evidenceInspectorContext.ts'

export function useEvidenceInspector() {
  return useContext(EvidenceInspectorContext)
}
