import type { ScreenerQuery } from '../screener/contracts.ts'
import { isSubjectRef, type SubjectRef } from '../symbol/search.ts'

export const AUTH_INTERRUPT_STORAGE_KEY = 'auth-interrupt'
export const AUTH_INTERRUPT_SCHEMA_VERSION = 1
export const AUTH_INTERRUPT_TTL_MS = 15 * 60 * 1_000

export const ProtectedActionType = {
  SaveToWatchlist: 'save-to-watchlist',
  SaveScreen: 'save-screen',
} as const

export type ProtectedActionType =
  (typeof ProtectedActionType)[keyof typeof ProtectedActionType]

export type SaveToWatchlistProtectedAction = {
  actionType: typeof ProtectedActionType.SaveToWatchlist
  payload: {
    subject_ref: SubjectRef
    display_name?: string
  }
}

// SaveScreen carries the full ScreenerQuery envelope so a deferred
// save survives a sessionStorage round-trip without losing any clause.
// The screener service validates the envelope at the POST boundary;
// this trust boundary's job is only to keep obviously malformed
// objects out of the resume flow, not to re-validate every clause.
export const SCREEN_NAME_MAX_LENGTH = 200
export type SaveScreenProtectedAction = {
  actionType: typeof ProtectedActionType.SaveScreen
  payload: {
    name: string
    definition: ScreenerQuery
  }
}

export type ProtectedAction =
  | SaveToWatchlistProtectedAction
  | SaveScreenProtectedAction

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
  | { type: 'expired' }
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
  if (!isRecord(value.payload)) return false

  switch (value.actionType) {
    case ProtectedActionType.SaveToWatchlist:
      return isSaveToWatchlistPayload(value.payload)
    case ProtectedActionType.SaveScreen:
      return isSaveScreenPayload(value.payload)
    default:
      return false
  }
}

function isSaveToWatchlistPayload(payload: Record<string, unknown>): boolean {
  if (!isSubjectRef(payload.subject_ref)) return false
  if (
    'display_name' in payload &&
    payload.display_name != null &&
    typeof payload.display_name !== 'string'
  ) {
    return false
  }
  return true
}

// Top-level shape check only. Every clause-level invariant lives in
// services/screener/src/query.ts and is enforced when the resumed
// handler POSTs the envelope; duplicating ~300 lines of clause
// validation here would drift from the server.
function isSaveScreenPayload(payload: Record<string, unknown>): boolean {
  if (typeof payload.name !== 'string') return false
  if (payload.name.length === 0) return false
  if (payload.name.length > SCREEN_NAME_MAX_LENGTH) return false
  if (!isRecord(payload.definition)) return false
  const def = payload.definition
  if (!Array.isArray(def.universe)) return false
  if (!Array.isArray(def.market)) return false
  if (!Array.isArray(def.fundamentals)) return false
  if (!Array.isArray(def.sort) || def.sort.length === 0) return false
  if (!isRecord(def.page)) return false
  if (typeof def.page.limit !== 'number') return false
  return true
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
    if (parsed.expiresAt <= parsed.createdAt || parsed.expiresAt <= now) return null
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
  now = Date.now(),
  pending,
}: {
  currentPath: string
  hasSession: boolean
  now?: number
  pending: PendingProtectedAction | null
}): ProtectedActionResumePlan {
  if (!hasSession || pending == null) return { type: 'idle' }
  if (pending.expiresAt <= now) return { type: 'expired' }

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
