import type { Block } from '../blocks'
import { authenticatedJson } from '../http/authFetch.ts'

export type AnalyzeRun = {
  run_id: string
  template_id: string
  template_version: number
  snapshot_id: string
  blocks: ReadonlyArray<Block>
  created_at: string
}

export type AnalyzeRunShareResult = {
  thread: {
    thread_id: string
    title: string | null
    updated_at: string
  }
}

export async function shareAnalyzeRunToChat(input: {
  userId: string
  sourceKind: 'memo'
  run: Pick<AnalyzeRun, 'run_id'>
  title: string
  primarySubjectRef?: unknown
}): Promise<AnalyzeRunShareResult> {
  return authenticatedJson<AnalyzeRunShareResult>(`/v1/analyze/runs/${encodeURIComponent(input.run.run_id)}/share-to-chat`, {
    userId: input.userId,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source_kind: input.sourceKind,
      title: input.title,
      primary_subject_ref: input.primarySubjectRef ?? null,
    }),
  })
}
