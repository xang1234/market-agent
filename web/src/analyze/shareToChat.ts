import type { Block } from '../blocks'

export type AnalyzeRun = {
  run_id: string
  template_id: string
  template_version: number
  snapshot_id: string
  blocks: ReadonlyArray<Block>
  created_at: string
}

export async function shareAnalyzeRunToChat(input: {
  userId: string
  threadId: string
  sourceKind: 'memo'
  run: AnalyzeRun
}): Promise<void> {
  const response = await fetch('/v1/artifacts/share-to-chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': input.userId,
    },
    body: JSON.stringify({
      thread_id: input.threadId,
      source_kind: input.sourceKind,
      origin_snapshot_id: input.run.snapshot_id,
      analyze_run_id: input.run.run_id,
      blocks: input.run.blocks,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}
