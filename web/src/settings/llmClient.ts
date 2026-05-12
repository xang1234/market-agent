import { authenticatedFetch, authenticatedJson } from '../http/authFetch.ts'
import type {
  LlmCredential,
  LlmCredentialUpsertBody,
  LlmProviderEntry,
  LlmRole,
  LlmTestResult,
} from './llmTypes.ts'

export type LlmCredentialsResponse = { credentials: ReadonlyArray<LlmCredential> }
export type LlmProvidersResponse = { providers: ReadonlyArray<LlmProviderEntry> }

export async function fetchLlmProviders(userId: string): Promise<LlmProvidersResponse> {
  return authenticatedJson<LlmProvidersResponse>('/v1/llm/providers', { userId })
}

export async function fetchLlmCredentials(userId: string): Promise<LlmCredentialsResponse> {
  return authenticatedJson<LlmCredentialsResponse>('/v1/llm/credentials', { userId })
}

export async function saveLlmCredential(
  userId: string,
  role: LlmRole,
  body: LlmCredentialUpsertBody,
): Promise<LlmCredential> {
  return authenticatedJson<LlmCredential>(`/v1/llm/credentials/${encodeURIComponent(role)}`, {
    userId,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteLlmCredential(userId: string, role: LlmRole): Promise<void> {
  const response = await authenticatedFetch(`/v1/llm/credentials/${encodeURIComponent(role)}`, {
    userId,
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`failed to delete credential: HTTP ${response.status}`)
  }
}

export async function testLlmCredential(userId: string, role: LlmRole): Promise<LlmTestResult> {
  return authenticatedJson<LlmTestResult>(`/v1/llm/credentials/${encodeURIComponent(role)}/test`, {
    userId,
    method: 'POST',
  })
}
