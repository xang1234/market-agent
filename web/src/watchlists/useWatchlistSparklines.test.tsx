import assert from 'node:assert/strict'
import { test } from 'node:test'

import { JSDOM } from 'jsdom'
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import { resetResourcesForTests } from '../fetch/resource.ts'
import type { SubjectRef } from '../symbol/search.ts'
import type { NormalizedSeriesQuery } from '../symbol/series.ts'
import { useWatchlistSparklines } from './useWatchlistSparklines.ts'

const A: SubjectRef = { kind: 'listing', id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }
const B: SubjectRef = { kind: 'listing', id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb' }

function SparklineProbe({ members }: { members: ReadonlyArray<SubjectRef> }): ReactElement {
  const closes = useWatchlistSparklines(members)
  return <span>{[...closes.entries()].map(([id, values]) => `${id.slice(0, 1)}=${values.join('/')}`).join(',')};</span>
}

test('members in any order or with repeats share one batched sparkline request', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }
  const previous = { ...globals }
  const originalFetch = globalThis.fetch
  const queries: NormalizedSeriesQuery[] = []
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = dom.window.document
  globals.window = dom.window as unknown as Window
  globalThis.fetch = async (_input, init) => {
    const query = JSON.parse(String(init?.body)) as NormalizedSeriesQuery
    queries.push(query)
    const results = query.subject_refs.map((listing, i) => ({
      listing,
      outcome: {
        outcome: 'available',
        data: { listing, bars: [{ close: i + 1 }, { close: i + 2 }] },
      },
    }))
    return new Response(JSON.stringify({ query, results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)

  try {
    await act(async () =>
      root.render(
        <>
          <SparklineProbe members={[B, A, A]} />
          <SparklineProbe members={[A, B]} />
        </>,
      ),
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    assert.deepEqual(
      queries.map((q) => q.subject_refs.map((ref) => ref.id)),
      [[A.id, B.id]],
    )
    assert.equal(dom.window.document.getElementById('root')?.textContent, 'a=1/2,b=2/3;a=1/2,b=2/3;')
  } finally {
    await act(async () => root.unmount())
    resetResourcesForTests()
    globalThis.fetch = originalFetch
    globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT
    globals.document = previous.document
    globals.window = previous.window
    dom.window.close()
  }
})

test('a partial batch is retried on revisit, and an all-failed retry keeps the earlier sparklines', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }
  const previous = { ...globals }
  const originalFetch = globalThis.fetch
  let requests = 0
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = dom.window.document
  globals.window = dom.window as unknown as Window
  globalThis.fetch = async (_input, init) => {
    requests += 1
    const query = JSON.parse(String(init?.body)) as NormalizedSeriesQuery
    const results = query.subject_refs.map((listing) =>
      requests === 1 && listing.id === A.id
        ? { listing, outcome: { outcome: 'available', data: { listing, bars: [{ close: 1 }, { close: 2 }] } } }
        : { listing, outcome: { outcome: 'unavailable', reason: 'missing_coverage' } },
    )
    return new Response(JSON.stringify({ query, results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  const flush = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  try {
    await act(async () => root.render(<SparklineProbe members={[A, B]} />))
    await flush()
    assert.equal(dom.window.document.getElementById('root')?.textContent, 'a=1/2;')

    await act(async () => root.render(<></>))
    await act(async () => root.render(<SparklineProbe members={[A, B]} />))
    await flush()
    assert.equal(requests, 2)
    assert.equal(dom.window.document.getElementById('root')?.textContent, 'a=1/2;')
  } finally {
    await act(async () => root.unmount())
    resetResourcesForTests()
    globalThis.fetch = originalFetch
    globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT
    globals.document = previous.document
    globals.window = previous.window
    dom.window.close()
  }
})
