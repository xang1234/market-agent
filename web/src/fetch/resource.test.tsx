import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { JSDOM } from 'jsdom'
import { act, StrictMode, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  defineResource,
  forgetUserData,
  NotOnFileError,
  resetResourcesForTests,
  useResource,
  type FetchedResult,
  type Json,
  type Resource,
  type VisibleFetchState,
} from './resource.ts'

type Call<P, T> = {
  params: P
  signal: AbortSignal
  settle: (result: FetchedResult<T>) => void
  fail: (error: Error) => void
}

function controlledLoader<P, T>() {
  const calls: Call<P, T>[] = []
  const load = (params: P, signal: AbortSignal) =>
    new Promise<FetchedResult<T>>((resolve, reject) => {
      calls.push({ params, signal, settle: resolve, fail: reject })
    })
  return { calls, load }
}

function describeState(state: VisibleFetchState<unknown>): string {
  if (state.status === 'idle' || state.status === 'loading') return state.status
  if (state.status === 'unavailable') return `unavailable:${state.reason}`
  if (state.status === 'not_on_file') return `not_on_file:${state.reason}`
  return `ready:${String(state.data)}${state.refreshing ? '|refreshing' : ''}`
}

function Probe<P extends Json, T>({
  resource,
  params,
  log,
  testId,
}: {
  resource: Resource<P, T>
  params: P | null
  log?: VisibleFetchState<T>[]
  testId?: string
}): ReactElement {
  const state = useResource(resource, params)
  log?.push(state)
  return <span data-testid={testId}>{describeState(state)}</span>
}

let dom: JSDOM
let root: Root
let restoreGlobals: () => void

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
  const previous = { ...globals }
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = dom.window.document
  globals.window = dom.window as unknown as Window
  restoreGlobals = () => {
    globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT
    globals.document = previous.document
    globals.window = previous.window
  }
  root = createRoot(dom.window.document.getElementById('root')!)
})

afterEach(async () => {
  await act(async () => root.unmount())
  resetResourcesForTests()
  dom.window.close()
  restoreGlobals()
})

async function render(element: ReactElement): Promise<void> {
  await act(async () => root.render(element))
}

async function settle<P, T>(call: Call<P, T>, result: FetchedResult<T>): Promise<void> {
  await act(async () => call.settle(result))
}

function text(testId?: string): string {
  const doc = dom.window.document
  const node = testId === undefined ? doc.getElementById('root') : doc.querySelector(`[data-testid="${testId}"]`)
  return node?.textContent ?? '<missing>'
}

test('a revisit renders the cached result in its first commit without reloading', async () => {
  const loader = controlledLoader<string, string>()
  const profile = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={profile} params="iss-1" />)
  assert.equal(text(), 'loading')
  await settle(loader.calls[0], { kind: 'ready', data: 'Apple' })
  assert.equal(text(), 'ready:Apple')

  await render(<></>)
  const log: VisibleFetchState<string>[] = []
  await render(<Probe resource={profile} params="iss-1" log={log} />)
  assert.deepEqual(log[0], { status: 'ready', data: 'Apple', refreshing: false, refreshError: null })
  assert.equal(loader.calls.length, 1)
})

test('a load that finds nothing on file settles as not_on_file and is not reloaded on revisit', async () => {
  const loader = controlledLoader<string, string>()
  const segments = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={segments} params="iss-1" />)
  await act(async () => loader.calls[0].fail(new NotOnFileError('business segments not found')))
  assert.equal(text(), 'not_on_file:business segments not found')

  await render(<></>)
  await render(<Probe resource={segments} params="iss-1" />)
  assert.equal(text(), 'not_on_file:business segments not found')
  assert.equal(loader.calls.length, 1)
})

test('a key change never shows the previous key data', async () => {
  const loader = controlledLoader<string, string>()
  const series = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={series} params="A" />)
  await settle(loader.calls[0], { kind: 'ready', data: 'A-data' })
  assert.equal(text(), 'ready:A-data')

  const toB: VisibleFetchState<string>[] = []
  await render(<Probe resource={series} params="B" log={toB} />)
  assert.deepEqual(toB.map(describeState), ['loading'])
  await settle(loader.calls[1], { kind: 'ready', data: 'B-data' })
  assert.equal(text(), 'ready:B-data')

  const backToA: VisibleFetchState<string>[] = []
  await render(<Probe resource={series} params="A" log={backToA} />)
  assert.equal(describeState(backToA[0]), 'ready:A-data')
  assert.deepEqual(loader.calls.map((call) => call.params), ['A', 'B'])
})

test('two resources with the same params keep separate entries', async () => {
  const profileLoader = controlledLoader<string, string>()
  const statsLoader = controlledLoader<string, string>()
  const profile = defineResource({ freshness: 'filed', load: profileLoader.load })
  const stats = defineResource({ freshness: 'filed', load: statsLoader.load })

  await render(
    <>
      <Probe resource={profile} params="iss-1" testId="profile" />
      <Probe resource={stats} params="iss-1" testId="stats" />
    </>,
  )
  await settle(profileLoader.calls[0], { kind: 'ready', data: 'profile' })
  await settle(statsLoader.calls[0], { kind: 'ready', data: 'stats' })

  assert.equal(text('profile'), 'ready:profile')
  assert.equal(text('stats'), 'ready:stats')
  assert.equal(profileLoader.calls.length, 1)
  assert.equal(statsLoader.calls.length, 1)
})

test('object params with the same values in a different key order share one entry', async () => {
  const loader = controlledLoader<{ a: number; b: string }, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(
    <>
      <Probe resource={resource} params={{ a: 1, b: 'x' }} testId="first" />
      <Probe resource={resource} params={{ b: 'x', a: 1 }} testId="second" />
    </>,
  )
  await settle(loader.calls[0], { kind: 'ready', data: 'one' })

  assert.equal(loader.calls.length, 1)
  assert.deepEqual(loader.calls[0].params, { a: 1, b: 'x' })
  assert.equal(text('second'), 'ready:one')
})

test('subscribers on one key share a single load, StrictMode included', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(
    <StrictMode>
      <Probe resource={resource} params="k" testId="one" />
      <Probe resource={resource} params="k" testId="two" />
    </StrictMode>,
  )
  assert.equal(loader.calls.length, 1)
  await settle(loader.calls[0], { kind: 'ready', data: 'x' })

  assert.equal(text('one'), 'ready:x')
  assert.equal(text('two'), 'ready:x')
})

test('unmounting a subscriber does not abort the shared load', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(
    <>
      <Probe resource={resource} params="k" testId="one" />
      <Probe resource={resource} params="k" testId="two" />
    </>,
  )
  await render(<Probe resource={resource} params="k" testId="two" />)
  await settle(loader.calls[0], { kind: 'ready', data: 'x' })

  assert.equal(loader.calls[0].signal.aborted, false)
  assert.equal(text('two'), 'ready:x')
})

test('a load that outlives every subscriber still warms the cache', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={resource} params="k" />)
  await render(<></>)
  await settle(loader.calls[0], { kind: 'ready', data: 'x' })
  await render(<Probe resource={resource} params="k" />)

  assert.equal(text(), 'ready:x')
  assert.equal(loader.calls.length, 1)
})

test('stale data stays on screen while it refreshes past its freshness tier', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const loader = controlledLoader<string, string>()
  const quote = defineResource({ freshness: 'live', load: loader.load })

  await render(<Probe resource={quote} params="lst-1" />)
  await settle(loader.calls[0], { kind: 'ready', data: 'v1' })
  await render(<></>)

  t.mock.timers.tick(29_999)
  await render(<Probe resource={quote} params="lst-1" />)
  assert.equal(text(), 'ready:v1')
  assert.equal(loader.calls.length, 1)

  await render(<></>)
  t.mock.timers.tick(2)
  await render(<Probe resource={quote} params="lst-1" />)
  assert.equal(text(), 'ready:v1|refreshing')
  assert.equal(loader.calls.length, 2)

  await settle(loader.calls[1], { kind: 'ready', data: 'v2' })
  assert.equal(text(), 'ready:v2')
})

test('a failed refresh keeps the earlier data and reports the failure until a refresh succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const loader = controlledLoader<string, string>()
  const quote = defineResource({ freshness: 'live', load: loader.load })
  const log: VisibleFetchState<string>[] = []

  await render(<Probe resource={quote} params="lst-1" log={log} />)
  await settle(loader.calls[0], { kind: 'ready', data: 'v1' })
  await render(<></>)
  t.mock.timers.tick(30_001)
  await render(<Probe resource={quote} params="lst-1" log={log} />)
  await settle(loader.calls[1], { kind: 'unavailable', reason: 'HTTP 503' })
  assert.deepEqual(log.at(-1), { status: 'ready', data: 'v1', refreshing: false, refreshError: 'HTTP 503' })

  await render(<></>)
  await render(<Probe resource={quote} params="lst-1" log={log} />)
  assert.deepEqual(log.at(-1), { status: 'ready', data: 'v1', refreshing: true, refreshError: 'HTTP 503' })
  await settle(loader.calls[2], { kind: 'ready', data: 'v3' })
  assert.deepEqual(log.at(-1), { status: 'ready', data: 'v3', refreshing: false, refreshError: null })
})

test('an unavailable result is retried on the next mount', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })
  const log: VisibleFetchState<string>[] = []

  await render(<Probe resource={resource} params="k" log={log} />)
  await settle(loader.calls[0], { kind: 'unavailable', reason: 'HTTP 500' })
  assert.equal(describeState(log.at(-1)!), 'unavailable:HTTP 500')

  await render(<></>)
  await render(<Probe resource={resource} params="k" />)
  assert.equal(text(), 'loading')
  assert.equal(loader.calls.length, 2)
})

test('retry on an unavailable state reloads it in place', async () => {
  const loader = controlledLoader<string, string>()
  const profile = defineResource({ freshness: 'filed', load: loader.load })
  const log: VisibleFetchState<string>[] = []

  await render(<Probe resource={profile} params="iss-1" log={log} />)
  await settle(loader.calls[0], { kind: 'unavailable', reason: 'HTTP 503' })
  const failed = log.at(-1)!
  if (failed.status !== 'unavailable') assert.fail(`expected unavailable, got ${failed.status}`)

  await act(async () => failed.retry())
  assert.equal(text(), 'loading')
  assert.equal(loader.calls.length, 2)
  await settle(loader.calls[1], { kind: 'ready', data: 'Apple' })
  assert.equal(text(), 'ready:Apple')
})

test('retry from a forgotten entry starts no load', async () => {
  const loader = controlledLoader<{ userId: string }, string>()
  const settings = defineResource({ freshness: 'filed', scope: 'user', load: loader.load })
  const log: VisibleFetchState<string>[] = []

  await render(<Probe resource={settings} params={{ userId: 'u1' }} log={log} />)
  await settle(loader.calls[0], { kind: 'unavailable', reason: 'HTTP 503' })
  const failed = log.at(-1)!
  if (failed.status !== 'unavailable') assert.fail(`expected unavailable, got ${failed.status}`)

  await render(<></>)
  forgetUserData()
  failed.retry()
  assert.equal(loader.calls.length, 1)
})

test('an incomplete result is shown, retried on the next mount, and kept fresh once complete', async () => {
  const loader = controlledLoader<string, string>()
  const comparison = defineResource({ freshness: 'pinned', load: loader.load })

  await render(<Probe resource={comparison} params="k" />)
  await settle(loader.calls[0], { kind: 'ready', data: 'partial', incomplete: true })
  assert.equal(text(), 'ready:partial')

  await render(<></>)
  await render(<Probe resource={comparison} params="k" />)
  assert.equal(text(), 'ready:partial|refreshing')
  assert.equal(loader.calls.length, 2)
  await settle(loader.calls[1], { kind: 'ready', data: 'full' })

  await render(<></>)
  await render(<Probe resource={comparison} params="k" />)
  assert.equal(text(), 'ready:full')
  assert.equal(loader.calls.length, 2)
})

test('an incomplete refresh clears the earlier refresh error', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })
  const log: VisibleFetchState<string>[] = []

  await render(<Probe resource={resource} params="k" log={log} />)
  await settle(loader.calls[0], { kind: 'ready', data: 'v1', incomplete: true })
  await render(<></>)
  await render(<Probe resource={resource} params="k" log={log} />)
  await settle(loader.calls[1], { kind: 'unavailable', reason: 'HTTP 503' })
  assert.deepEqual(log.at(-1), { status: 'ready', data: 'v1', refreshing: false, refreshError: 'HTTP 503' })

  await render(<></>)
  await render(<Probe resource={resource} params="k" log={log} />)
  await settle(loader.calls[2], { kind: 'ready', data: 'v2', incomplete: true })
  assert.deepEqual(log.at(-1), { status: 'ready', data: 'v2', refreshing: false, refreshError: null })
})

test('a loader that throws renders as unavailable with the error message', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={resource} params="k" />)
  await act(async () => loader.calls[0].fail(new Error('boom')))

  assert.equal(text(), 'unavailable:boom')
})

test('null params render idle and never load', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={resource} params={null} />)

  assert.equal(text(), 'idle')
  assert.equal(loader.calls.length, 0)
})

test('forgetUserData drops user-scoped entries without refetching and keeps public ones', async () => {
  type HeldParams = { userId: string; subjectId: string }
  const heldLoader = controlledLoader<HeldParams, boolean>()
  const profileLoader = controlledLoader<string, string>()
  const held = defineResource({ scope: 'user', freshness: 'live', load: heldLoader.load })
  const profile = defineResource({ freshness: 'filed', load: profileLoader.load })

  const page = (userId: string) => (
    <>
      <Probe resource={held} params={{ userId, subjectId: 's1' }} testId="held" />
      <Probe resource={profile} params="iss-1" testId="profile" />
    </>
  )
  await render(page('u1'))
  await settle(heldLoader.calls[0], { kind: 'ready', data: true })
  await settle(profileLoader.calls[0], { kind: 'ready', data: 'Apple' })

  await act(async () => forgetUserData())
  assert.equal(text('held'), 'loading')
  assert.equal(heldLoader.calls.length, 1)
  assert.equal(text('profile'), 'ready:Apple')
  assert.equal(profileLoader.calls.length, 1)

  await render(page('u2'))
  assert.deepEqual(heldLoader.calls[1].params, { userId: 'u2', subjectId: 's1' })
})

test('forgetUserData aborts an in-flight user load and drops its late result', async () => {
  const loader = controlledLoader<{ userId: string }, string>()
  const held = defineResource({ scope: 'user', freshness: 'live', load: loader.load })

  await render(<Probe resource={held} params={{ userId: 'u1' }} />)
  await act(async () => forgetUserData())
  await settle(loader.calls[0], { kind: 'ready', data: 'late' })

  assert.equal(loader.calls[0].signal.aborted, true)
  assert.equal(text(), 'loading')
})

test('at most 200 idle entries are kept, oldest evicted first', async () => {
  const loads = new Map<string, number>()
  const resource = defineResource({
    freshness: 'filed',
    load: async (key: string) => {
      loads.set(key, (loads.get(key) ?? 0) + 1)
      return { kind: 'ready', data: key }
    },
  })

  for (let i = 0; i <= 201; i += 1) {
    await render(<Probe resource={resource} params={`k${i}`} />)
  }
  await render(<Probe resource={resource} params="k0" />)
  assert.equal(loads.get('k0'), 2)

  await render(<Probe resource={resource} params="k200" />)
  assert.equal(text(), 'ready:k200')
  assert.equal(loads.get('k200'), 1)
})

test('unmounting many entries at once trims the idle entries to 200, oldest first', async () => {
  const loads = new Map<string, number>()
  const resource = defineResource({
    freshness: 'filed',
    load: async (key: string) => {
      loads.set(key, (loads.get(key) ?? 0) + 1)
      return { kind: 'ready', data: key }
    },
  })
  const keys = Array.from({ length: 300 }, (_, i) => `k${i}`)

  await render(
    <>
      {keys.map((key) => (
        <Probe key={key} resource={resource} params={key} />
      ))}
    </>,
  )
  await render(<></>)

  await render(<Probe resource={resource} params="k0" />)
  assert.equal(loads.get('k0'), 2)
  await render(<Probe resource={resource} params="k299" />)
  assert.equal(text(), 'ready:k299')
  assert.equal(loads.get('k299'), 1)
})

test('a StrictMode remount at the idle bound keeps its entry and its single load', async () => {
  const filler = defineResource({
    freshness: 'filed',
    load: async (key: string) => ({ kind: 'ready', data: key }),
  })
  const keys = Array.from({ length: 200 }, (_, i) => `k${i}`)
  await render(
    <>
      {keys.map((key) => (
        <Probe key={key} resource={filler} params={key} />
      ))}
    </>,
  )
  await render(<></>)

  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })
  await render(
    <StrictMode>
      <Probe resource={resource} params="new" />
    </StrictMode>,
  )
  await settle(loader.calls[0], { kind: 'ready', data: 'x' })

  assert.equal(loader.calls.length, 1)
  assert.equal(loader.calls[0].signal.aborted, false)
  assert.equal(text(), 'ready:x')
})

test('switching back to the oldest idle entry at the bound renders it from cache', async () => {
  const loads = new Map<string, number>()
  const resource = defineResource({
    freshness: 'filed',
    load: async (key: string) => {
      loads.set(key, (loads.get(key) ?? 0) + 1)
      return { kind: 'ready', data: key }
    },
  })
  for (let i = 0; i <= 200; i += 1) {
    await render(<Probe resource={resource} params={`k${i}`} />)
  }
  const log: VisibleFetchState<string>[] = []

  await render(<Probe resource={resource} params="k0" log={log} />)

  assert.equal(loads.get('k0'), 1)
  assert.deepEqual(log.map(describeState), ['ready:k0'])
})

test('a sibling subscribing in the same commit does not evict the entry another hook switches to', async () => {
  const loads = new Map<string, number>()
  const resource = defineResource({
    freshness: 'filed',
    load: async (key: string) => {
      loads.set(key, (loads.get(key) ?? 0) + 1)
      return { kind: 'ready', data: key }
    },
  })
  for (let i = 0; i < 200; i += 1) {
    await render(
      <>
        <Probe resource={resource} params="a" />
        <Probe resource={resource} params={`k${i}`} />
      </>,
    )
  }
  await render(
    <>
      <Probe resource={resource} params="a" />
      <Probe resource={resource} params="b" />
    </>,
  )
  const log: VisibleFetchState<string>[] = []

  await render(
    <>
      <Probe resource={resource} params="n" />
      <Probe resource={resource} params="k0" log={log} />
    </>,
  )

  assert.equal(loads.get('k0'), 1)
  assert.deepEqual(log.map(describeState), ['ready:k0'])
})

test('a mounted entry is never evicted', async () => {
  const keptLoader = controlledLoader<string, string>()
  const kept = defineResource({ freshness: 'filed', load: keptLoader.load })
  const churn = defineResource({
    freshness: 'filed',
    load: async (key: string) => ({ kind: 'ready', data: key }),
  })

  await render(<Probe resource={kept} params="kept" testId="kept" />)
  await settle(keptLoader.calls[0], { kind: 'ready', data: 'kept' })
  for (let i = 0; i < 250; i += 1) {
    await render(
      <>
        <Probe resource={kept} params="kept" testId="kept" />
        <Probe resource={churn} params={`k${i}`} />
      </>,
    )
  }

  assert.equal(text('kept'), 'ready:kept')
  assert.equal(keptLoader.calls.length, 1)
})

test('a load that settles after a reset is dropped', async () => {
  const loader = controlledLoader<string, string>()
  const resource = defineResource({ freshness: 'filed', load: loader.load })

  await render(<Probe resource={resource} params="A" />)
  resetResourcesForTests()
  await settle(loader.calls[0], { kind: 'ready', data: 'stale' })
  await render(<></>)
  await render(<Probe resource={resource} params="A" />)

  assert.equal(loader.calls[0].signal.aborted, true)
  assert.equal(text(), 'loading')
  assert.equal(loader.calls.length, 2)
})

test('params carrying a userId must declare the user scope', () => {
  const load = async (params: { userId: string }): Promise<FetchedResult<string>> => ({
    kind: 'ready',
    data: params.userId,
  })
  // @ts-expect-error a userId in params without scope: 'user' would survive sign-out
  defineResource({ freshness: 'live', load })
  defineResource({ scope: 'user', freshness: 'live', load })

  const loadMaybeSignedIn = async (params: { userId: string | null }): Promise<FetchedResult<string>> => ({
    kind: 'ready',
    data: params.userId ?? 'anonymous',
  })
  // @ts-expect-error a nullable userId still identifies the signed-in user
  defineResource({ freshness: 'live', load: loadMaybeSignedIn })
  defineResource({ scope: 'user', freshness: 'live', load: loadMaybeSignedIn })
})
