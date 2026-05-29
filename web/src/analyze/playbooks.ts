import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'

export type AnalyzePlaybookSection = {
  section_id: string
  title: string
  required: boolean
  block_hint: string
}

export type AnalyzePlaybook = {
  playbook_id: string
  version: number
  name: string
  description: string
  default_instructions: string
  default_source_categories: ReadonlyArray<string>
  sections: ReadonlyArray<AnalyzePlaybookSection>
}

export async function fetchAnalyzePlaybooks(input: {
  userId: string
  fetchImpl?: FetchImpl
}): Promise<ReadonlyArray<AnalyzePlaybook>> {
  const body = await authenticatedJson<{ playbooks: AnalyzePlaybook[] }>('/v1/analyze/playbooks', {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  })
  return body.playbooks
}
