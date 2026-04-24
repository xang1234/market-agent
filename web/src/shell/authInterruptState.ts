export const AUTH_INTERRUPT_STORAGE_KEY = 'auth-interrupt'
export const AUTH_INTERRUPT_SCHEMA_VERSION = 1
export const AUTH_INTERRUPT_TTL_MS = 15 * 60 * 1_000

export const ProtectedActionType = {
  SaveToWatchlist: 'save-to-watchlist',
} as const

export type ProtectedActionType =
  (typeof ProtectedActionType)[keyof typeof ProtectedActionType]

export type SaveToWatchlistProtectedAction = {
  actionType: typeof ProtectedActionType.SaveToWatchlist
  payload: {
    symbol: string
  }
}

export type ProtectedAction = SaveToWatchlistProtectedAction

export type ProtectedActionKind = ProtectedAction['actionType']

export type RouteSnapshot = {
  pathname: string
  search: string
  hash: string
}

export type PendingProtectedAction = {
  schemaVersion: typeof AUTH_INTERRUPT_SCHEMA_VERSION
  title: string
  description?: string
  returnTo: RouteSnapshot
  createdAt: number
  expiresAt: number
  action: ProtectedAction
}

export type ProtectedActionResumePlan =
  | { type: 'idle' }
  | { type: 'dispatch'; action: ProtectedAction }
  | { type: 'navigate'; to: string; action: ProtectedAction }

export type ProtectedActionResumeDispatchPlan = {
  shouldDispatch: boolean
  resumeKey: string
}

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

  if (value.actionType !== ProtectedActionType.SaveToWatchlist) return false
  if (!isRecord(value.payload)) return false

  return typeof value.payload.symbol === 'string'
}

function isAppRoutePathname(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

function isRouteSearch(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || value.startsWith('?'))
}

function isRouteHash(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || value.startsWith('#'))
}

function isRouteSnapshot(value: unknown): value is RouteSnapshot {
  if (!isRecord(value)) return false

  return (
    isAppRoutePathname(value.pathname) &&
    isRouteSearch(value.search) &&
    isRouteHash(value.hash)
  )
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getCurrentRoutePath({ pathname, search = '', hash = '' }: RouteLike): string {
  return `${pathname}${search}${hash}`
}

export function getCurrentRouteSnapshot({
  pathname,
  search = '',
  hash = '',
}: RouteLike): RouteSnapshot {
  return { pathname, search, hash }
}

export function getRouteSnapshotPath(route: RouteSnapshot): string {
  return getCurrentRoutePath(route)
}

export function createPendingProtectedAction({
  title,
  description,
  returnTo,
  action,
  now = Date.now(),
}: {
  title: string
  description?: string
  returnTo: RouteSnapshot
  action: ProtectedAction
  now?: number
}): PendingProtectedAction {
  return {
    schemaVersion: AUTH_INTERRUPT_SCHEMA_VERSION,
    title,
    description,
    returnTo,
    createdAt: now,
    expiresAt: now + AUTH_INTERRUPT_TTL_MS,
    action,
  }
}

export function serializePendingProtectedAction(pending: PendingProtectedAction): string {
  return JSON.stringify(pending)
}

function getProtectedActionResumeKey(path: string, action: ProtectedAction): string {
  return `${path}\u0000${JSON.stringify(action)}`
}

export function parsePendingProtectedAction(
  raw: string | null,
  { now = Date.now() }: { now?: number } = {},
): PendingProtectedAction | null {
  if (raw == null) return null

  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (parsed.schemaVersion !== AUTH_INTERRUPT_SCHEMA_VERSION) return null
    if (typeof parsed.title !== 'string') return null
    if (!isRouteSnapshot(parsed.returnTo)) return null
    if (!isValidTimestamp(parsed.createdAt)) return null
    if (!isValidTimestamp(parsed.expiresAt)) return null
    if (parsed.expiresAt <= parsed.createdAt || parsed.expiresAt < now) return null
    if ('description' in parsed && parsed.description != null && typeof parsed.description !== 'string') {
      return null
    }
    if (!isProtectedAction(parsed.action)) return null

    return {
      title: parsed.title,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      returnTo: parsed.returnTo,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      action: parsed.action,
      schemaVersion: parsed.schemaVersion,
    }
  } catch {
    return null
  }
}

export function planProtectedActionResumeDispatch(
  lastResumeKey: string | null,
  path: string,
  action: ProtectedAction,
): ProtectedActionResumeDispatchPlan {
  const resumeKey = getProtectedActionResumeKey(path, action)

  return {
    shouldDispatch: lastResumeKey !== resumeKey,
    resumeKey,
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
  const returnTo = getRouteSnapshotPath(pending.returnTo)

  if (currentPath === returnTo) {
    return {
      type: 'dispatch',
      action: pending.action,
    }
  }

  return {
    type: 'navigate',
    to: returnTo,
    action: pending.action,
  }
}
