import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'
import type { SaveThesisInput, ThesisCondition, ThesisHistoryResponse, ThesisVersion } from './thesisTypes.ts'

export function fetchThesisHistory(input: {
  userId: string
  agentId: string
  signal?: AbortSignal
  fetchImpl?: FetchImpl
}): Promise<ThesisHistoryResponse> {
  return authenticatedJson<ThesisHistoryResponse>(thesisPath(input.agentId), {
    userId: input.userId,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  })
}

export async function saveAgentThesis(input: {
  userId: string
  agentId: string
  thesis: SaveThesisInput
  fetchImpl?: FetchImpl
}): Promise<ThesisVersion> {
  const body = await authenticatedJson<{ thesis: ThesisVersion }>(thesisPath(input.agentId), {
    userId: input.userId,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input.thesis),
    fetchImpl: input.fetchImpl,
  })
  return body.thesis
}

export async function draftAgentThesisConditions(input: {
  userId: string
  agentId: string
  thesis: string
  fetchImpl?: FetchImpl
}): Promise<ThesisCondition[]> {
  const body = await authenticatedJson<{ conditions: ThesisCondition[] }>(`${thesisPath(input.agentId)}/draft`, {
    userId: input.userId,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thesis: input.thesis }),
    fetchImpl: input.fetchImpl,
  })
  return body.conditions
}

function thesisPath(agentId: string): string {
  return `/v1/agents/${encodeURIComponent(agentId)}/thesis`
}
