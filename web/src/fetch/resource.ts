import { useCallback, useSyncExternalStore } from 'react'

export type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json }

// An incomplete result (a batch with failed legs) is shown but stays stale,
// so the next subscribe retries it. not_on_file is the server saying it holds
// no such data: a settled answer, cached like ready, with nothing to retry.
export type FetchedResult<T> =
  | { kind: 'ready'; data: T; incomplete?: true }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'not_on_file'; reason: string }

// A loader throws this to settle as not_on_file.
export class NotOnFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotOnFileError'
  }
}

export type VisibleFetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string; retry: () => void }
  | { status: 'not_on_file'; reason: string }
  | { status: 'ready'; data: T; refreshing: boolean; refreshError: string | null }

const FRESH_FOR_MS = {
  live: 30_000,
  intraday: 5 * 60_000,
  filed: 60 * 60_000,
  pinned: Infinity,
} as const

export type Freshness = keyof typeof FRESH_FOR_MS

// A userId can only reach a loader through its params, so params that carry
// one must be dropped on sign-out; the compiler enforces the declaration.
type ScopeFor<P> = P extends { readonly userId: Json } ? { scope: 'user' } : { scope?: 'public' }

type ResourceSpec<P extends Json, T> = {
  freshness: Freshness
  load: (params: P, signal: AbortSignal) => Promise<FetchedResult<T>>
} & ScopeFor<P>

declare const resourceTypes: unique symbol
export type Resource<P extends Json, T> = { readonly [resourceTypes]: (params: P) => T }

type ResourceDef = {
  readonly serial: number
  readonly freshForMs: number
  readonly userScoped: boolean
  readonly load: (params: Json, signal: AbortSignal) => Promise<FetchedResult<unknown>>
}

type EntrySnapshot<T> = Exclude<VisibleFetchState<T>, { status: 'idle' }>

type Entry = {
  readonly id: string
  readonly key: string
  readonly def: ResourceDef
  snapshot: EntrySnapshot<unknown>
  readyAt: number | null
  inflight: AbortController | null
  readonly listeners: Set<() => void>
}

const IDLE: VisibleFetchState<never> = { status: 'idle' }
const LOADING: EntrySnapshot<never> = { status: 'loading' }
const MAX_IDLE_ENTRIES = 200

// Insertion order is recency: a touched entry is re-inserted at the end.
const entries = new Map<string, Entry>()
let nextSerial = 0

export function defineResource<P extends Json, T>(spec: ResourceSpec<P, T>): Resource<P, T> {
  const def: ResourceDef = {
    serial: nextSerial++,
    freshForMs: FRESH_FOR_MS[spec.freshness],
    userScoped: spec.scope === 'user',
    load: spec.load as ResourceDef['load'],
  }
  return def as unknown as Resource<P, T>
}

export function useResource<P extends Json, T>(
  resource: Resource<P, T>,
  params: P | null,
): VisibleFetchState<T> {
  const key = params === null ? null : canonicalJson(params)
  const subscribe = useCallback(
    (onChange: () => void) => (key === null ? noop : subscribeEntry(defOf(resource), key, onChange)),
    [resource, key],
  )
  const getSnapshot = useCallback(
    () => (key === null ? IDLE : (entries.get(entryId(defOf(resource), key))?.snapshot ?? LOADING)),
    [resource, key],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as VisibleFetchState<T>
}

// Called on identity change, before the new session renders. Loads for the
// old user are aborted and not restarted.
export function forgetUserData(): void {
  for (const entry of [...entries.values()]) {
    if (entry.def.userScoped) drop(entry)
  }
}

export function resetResourcesForTests(): void {
  for (const entry of [...entries.values()]) drop(entry)
}

function nextSnapshot(
  entry: Entry,
  event: { type: 'start' } | { type: 'settled'; result: FetchedResult<unknown> },
): EntrySnapshot<unknown> {
  const prev = entry.snapshot
  if (event.type === 'start') {
    if (prev.status === 'ready') return { ...prev, refreshing: true }
    return LOADING
  }
  const { result } = event
  if (result.kind === 'not_on_file') return { status: 'not_on_file', reason: result.reason }
  if (result.kind === 'ready') {
    return { status: 'ready', data: result.data, refreshing: false, refreshError: null }
  }
  if (prev.status === 'ready') {
    return { status: 'ready', data: prev.data, refreshing: false, refreshError: result.reason }
  }
  return { status: 'unavailable', reason: result.reason, retry: () => retry(entry) }
}

function retry(entry: Entry): void {
  if (entries.get(entry.id) === entry) ensureFresh(entry)
}

function subscribeEntry(def: ResourceDef, key: string, onChange: () => void): () => void {
  const entry = touch(def, key)
  entry.listeners.add(onChange)
  scheduleTrim()
  ensureFresh(entry)
  return () => {
    entry.listeners.delete(onChange)
    if (entry.listeners.size === 0) scheduleTrim()
  }
}

// React runs every unsubscribe in a commit before any subscribe, so a trim
// inside either one could evict an entry a later subscribe in the same commit
// is about to reclaim. Trimming after the commit sees only truly idle entries.
let trimScheduled = false
function scheduleTrim(): void {
  if (trimScheduled) return
  trimScheduled = true
  queueMicrotask(() => {
    trimScheduled = false
    evictIdle()
  })
}

function touch(def: ResourceDef, key: string): Entry {
  const id = entryId(def, key)
  const existing = entries.get(id)
  if (existing !== undefined) entries.delete(id)
  const entry = existing ?? {
    id,
    key,
    def,
    snapshot: LOADING,
    readyAt: null,
    inflight: null,
    listeners: new Set<() => void>(),
  }
  entries.set(id, entry)
  return entry
}

function evictIdle(): void {
  let idle = 0
  for (const entry of entries.values()) if (entry.listeners.size === 0) idle += 1
  for (const entry of entries.values()) {
    if (idle <= MAX_IDLE_ENTRIES) return
    if (entry.listeners.size === 0) {
      drop(entry)
      idle -= 1
    }
  }
}

function ensureFresh(entry: Entry): void {
  if (entry.inflight !== null) return
  const fresh =
    (entry.snapshot.status === 'ready' || entry.snapshot.status === 'not_on_file') &&
    entry.readyAt !== null &&
    Date.now() - entry.readyAt < entry.def.freshForMs
  if (fresh) return

  // Claimed before the first await so concurrent subscribers share this load.
  const controller = new AbortController()
  entry.inflight = controller
  publish(entry, nextSnapshot(entry, { type: 'start' }))
  void runLoad(entry, controller)
}

async function runLoad(entry: Entry, controller: AbortController): Promise<void> {
  let result: FetchedResult<unknown>
  try {
    result = await entry.def.load(JSON.parse(entry.key) as Json, controller.signal)
  } catch (err) {
    result = err instanceof NotOnFileError
      ? { kind: 'not_on_file', reason: err.message }
      : { kind: 'unavailable', reason: err instanceof Error ? err.message : 'fetch failed' }
  }
  // Evicted, forgotten, reset or superseded: the result belongs to no one.
  if (entries.get(entry.id) !== entry || entry.inflight !== controller) return
  entry.inflight = null
  if ((result.kind === 'ready' && result.incomplete !== true) || result.kind === 'not_on_file') {
    entry.readyAt = Date.now()
  }
  publish(entry, nextSnapshot(entry, { type: 'settled', result }))
}

function drop(entry: Entry): void {
  entries.delete(entry.id)
  entry.inflight?.abort()
  entry.inflight = null
  for (const listener of [...entry.listeners]) listener()
}

function publish(entry: Entry, snapshot: EntrySnapshot<unknown>): void {
  if (snapshot === entry.snapshot) return
  entry.snapshot = snapshot
  for (const listener of [...entry.listeners]) listener()
}

function defOf<P extends Json, T>(resource: Resource<P, T>): ResourceDef {
  return resource as unknown as ResourceDef
}

function entryId(def: ResourceDef, key: string): string {
  return `${def.serial}\u0000${key}`
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as { readonly [k: string]: Json }
    const fields = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

function noop(): void {}
