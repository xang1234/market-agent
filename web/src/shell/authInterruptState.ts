export const AUTH_INTERRUPT_STORAGE_KEY = 'auth-interrupt'

export type SaveToWatchlistProtectedAction = {
  kind: 'save-to-watchlist'
  symbol: string
}

export type ProtectedAction = SaveToWatchlistProtectedAction

export type ProtectedActionKind = ProtectedAction['kind']

export type PendingProtectedAction = {
  title: string
  description?: string
  returnTo: string
  action: ProtectedAction
}

export type ProtectedActionResumePlan =
  | { type: 'idle' }
  | { type: 'dispatch'; action: ProtectedAction }
  | { type: 'navigate'; to: string; action: ProtectedAction }

type RouteLike = {
  pathname: string
  search?: string
  hash?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProtectedAction(value: unknown): value is ProtectedAction {
  if (!isRecord(value)) return false

  return value.kind === 'save-to-watchlist' && typeof value.symbol === 'string'
}

export function getCurrentRoutePath({ pathname, search = '', hash = '' }: RouteLike): string {
  return `${pathname}${search}${hash}`
}

export function serializePendingProtectedAction(pending: PendingProtectedAction): string {
  return JSON.stringify(pending)
}

export function parsePendingProtectedAction(raw: string | null): PendingProtectedAction | null {
  if (raw == null) return null

  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (typeof parsed.title !== 'string') return null
    if (typeof parsed.returnTo !== 'string') return null
    if ('description' in parsed && parsed.description != null && typeof parsed.description !== 'string') {
      return null
    }
    if (!isProtectedAction(parsed.action)) return null

    return {
      title: parsed.title,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      returnTo: parsed.returnTo,
      action: parsed.action,
    }
  } catch {
    return null
  }
}

export function planPendingProtectedActionResume({
  currentPath,
  hasSession,
  pending,
}: {
  currentPath: string
  hasSession: boolean
  pending: PendingProtectedAction | null
}): ProtectedActionResumePlan {
  if (!hasSession || pending == null) return { type: 'idle' }
  if (currentPath === pending.returnTo) {
    return {
      type: 'dispatch',
      action: pending.action,
    }
  }

  return {
    type: 'navigate',
    to: pending.returnTo,
    action: pending.action,
  }
}
