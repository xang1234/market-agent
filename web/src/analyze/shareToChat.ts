import type { Block } from '../blocks'

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
  run: AnalyzeRun
  title: string
  primarySubjectRef?: unknown
}): Promise<AnalyzeRunShareResult> {
  const response = await fetch(`/v1/analyze/runs/${encodeURIComponent(input.run.run_id)}/share-to-chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': input.userId,
    },
    body: JSON.stringify({
      source_kind: input.sourceKind,
      title: input.title,
      primary_subject_ref: input.primarySubjectRef ?? null,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as AnalyzeRunShareResult
}
