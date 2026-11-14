import assert from 'node:assert/strict'
import { test } from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { installDomGlobals } from '../analyst-grids/testDom.ts'
import type { VisibleFetchState } from '../fetch/resource.ts'
import { FetchStateView } from './FetchStateView.tsx'

function render(state: VisibleFetchState<string>): string {
  return renderToStaticMarkup(
    <FetchStateView state={state} noun="quote">
      {(data) => <span>{data}</span>}
    </FetchStateView>,
  )
}

test('ready data renders unchanged while a refresh is in flight', () => {
  assert.equal(
    render({ status: 'ready', data: 'AAPL 196.58', refreshing: true, refreshError: null }),
    '<span>AAPL 196.58</span>',
  )
})

test('a failed refresh keeps the earlier data and puts the error in the title', () => {
  assert.equal(
    render({ status: 'ready', data: 'AAPL 196.58', refreshing: false, refreshError: 'HTTP 503' }),
    '<span>AAPL 196.58</span><p class="text-xs text-faint" title="HTTP 503">Showing earlier quote. Couldn&#x27;t refresh.</p>',
  )
})

test('loading renders a status skeleton named for the noun', () => {
  assert.equal(
    render({ status: 'loading' }),
    '<span role="status" class="block h-16 animate-pulse rounded-md bg-surface-2"><span class="sr-only">Loading quote</span></span>',
  )
})

test('idle without a message says the company data is not linked', () => {
  assert.equal(
    render({ status: 'idle' }),
    '<p class="text-sm text-muted">Company data isn&#x27;t linked to this listing yet. Search for the symbol to load it.</p>',
  )
})

test('unavailable says it could not load, keeps the reason in details, and Retry calls retry', async () => {
  let retries = 0
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <FetchStateView
          state={{ status: 'unavailable', reason: 'HTTP 503', retry: () => (retries += 1) }}
          noun="profile"
        >
          {() => <span>ready</span>}
        </FetchStateView>,
      )
    })
    const doc = dom.window.document
    assert.equal(doc.querySelector('p')?.textContent, "Couldn't load the profile.")
    assert.equal(doc.querySelector('details')?.textContent, 'DetailsHTTP 503')
    assert.equal(doc.querySelector('summary')?.textContent, 'Details')

    await act(async () => doc.querySelector<HTMLButtonElement>('button')!.click())
    assert.equal(retries, 1)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('not on file says so plainly, with no Retry', () => {
  assert.equal(
    render({ status: 'not_on_file', reason: 'business segments not found' }),
    '<p class="text-sm text-muted">No quote on file.</p>',
  )
})
