import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../shell/useAuth.ts'
import {
  deleteLlmCredential,
  fetchLlmCredentials,
  fetchLlmProviders,
  saveLlmCredential,
  testLlmCredential,
} from './llmClient.ts'
import { LlmRoleCard } from './LlmRoleCard.tsx'
import {
  LLM_ROLES,
  type LlmCredential,
  type LlmProviderEntry,
  type LlmRole,
} from './llmTypes.ts'

type PanelState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'service_unavailable' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      catalog: ReadonlyArray<LlmProviderEntry>
      credentials: ReadonlyMap<LlmRole, LlmCredential>
    }

export function LlmCredentialsPanel(): JSX.Element {
  const { session } = useAuth()
  const [state, setState] = useState<PanelState>({ kind: 'loading' })

  const reload = useCallback(async () => {
    if (!session) {
      setState({ kind: 'unauthenticated' })
      return
    }
    setState({ kind: 'loading' })
    try {
      const [providers, credentials] = await Promise.all([
        fetchLlmProviders(session.userId),
        fetchLlmCredentials(session.userId),
      ])
      const map = new Map<LlmRole, LlmCredential>()
      for (const credential of credentials.credentials) {
        map.set(credential.role, credential)
      }
      setState({ kind: 'ready', catalog: providers.providers, credentials: map })
    } catch (error) {
      if (isServiceUnavailable(error)) {
        setState({ kind: 'service_unavailable' })
        return
      }
      setState({ kind: 'error', message: errorMessage(error) })
    }
  }, [session])

  useEffect(() => {
    void reload()
  }, [reload])

  if (state.kind === 'loading') {
    return <p className="text-sm text-neutral-500">Loading model settings…</p>
  }
  if (state.kind === 'unauthenticated') {
    return <p className="text-sm text-neutral-500">Sign in to manage model providers.</p>
  }
  if (state.kind === 'service_unavailable') {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Model credential storage is not configured. Set <code>LLM_MASTER_ENCRYPTION_KEY</code> on
        the dev-api process to enable per-user provider keys.
      </p>
    )
  }
  if (state.kind === 'error') {
    return <p className="text-sm text-red-700 dark:text-red-400">Failed to load: {state.message}</p>
  }

  return (
    <div className="grid gap-4">
      {LLM_ROLES.map((role) => (
        <LlmRoleCard
          key={role}
          role={role}
          catalog={state.catalog}
          credential={state.credentials.get(role) ?? null}
          onSave={async (body) => {
            if (!session) return
            await saveLlmCredential(session.userId, role, body)
            await reload()
          }}
          onRemove={async () => {
            if (!session) return
            await deleteLlmCredential(session.userId, role)
            await reload()
          }}
          onTest={async () => {
            if (!session) throw new Error('not signed in')
            return testLlmCredential(session.userId, role)
          }}
        />
      ))}
    </div>
  )
}

function isServiceUnavailable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  return status === 503
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'unknown error'
}
