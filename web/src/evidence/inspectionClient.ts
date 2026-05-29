import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'
import type { EvidenceInspection, EvidenceInspectionRef } from './inspectionTypes.ts'

export async function fetchEvidenceInspection(input: {
  userId: string
  snapshotId: string
  ref: EvidenceInspectionRef
  fetchImpl?: FetchImpl
}): Promise<EvidenceInspection> {
  return authenticatedJson<EvidenceInspection>('/v1/evidence/inspect', {
    method: 'POST',
    userId: input.userId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      snapshot_id: input.snapshotId,
      ref: input.ref,
    }),
    fetchImpl: input.fetchImpl,
  })
}
