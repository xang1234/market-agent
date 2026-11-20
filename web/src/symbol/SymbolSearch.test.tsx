import '../pages/installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { Announcer } from '../ui/Announcer.tsx'
import { ANNOUNCE_DELAY_MS, resetAnnouncerForTests } from '../ui/announcer.ts'
import { SymbolSearch } from './SymbolSearch.tsx'
import type { ResolvedSubject } from './search.ts'

async function renderSearch(t: test.TestContext, reply: () => Response, onResolvedSubject?: (subject: ResolvedSubject) => void) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => reply()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount())
    container.remove()
    globalThis.fetch = originalFetch
    resetAnnouncerForTests()
  })
  let pathname = ''
  function LocationProbe() {
    pathname = useLocation().pathname
    return null
  }
  await act(async () => root.render(
    <MemoryRouter>
      <SymbolSearch placement={onResolvedSubject ? 'watchlist' : 'topbar'} onResolvedSubject={onResolvedSubject} />
      <Announcer />
      <LocationProbe />
    </MemoryRouter>,
  ))
  const input = container.querySelector('input')!
  const region = container.querySelector('[data-testid="announcer"] [role="status"]')!
  // Every text the region takes, so a repeat of the same message shows as a clear and a refill.
  const heard: string[] = []
  new window.MutationObserver(() => {
    if (heard.at(-1) !== region.textContent) heard.push(region.textContent ?? '')
  }).observe(region, { childList: true, characterData: true, subtree: true })
  return {
    heard,
    settle: async () => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
      await act(async () => new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DELAY_MS)))
    },
    type: (text: string) => act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    }),
    submit: () => act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))),
    message: () => container.querySelector('form')?.lastElementChild?.textContent,
    value: () => input.value,
    pathname: () => pathname,
    options: () => [...container.querySelectorAll('[role="option"]')].map((option) => option.querySelector('span span')?.textContent),
    optionLines: () => [...container.querySelectorAll('[role="option"]')].map((option) => [...option.querySelectorAll('span span')].map((line) => line.textContent)),
  }
}

test('a search with no match says No match for the query, while typing and on submit, and is announced each time', async (t) => {
  const search = await renderSearch(t, () => new Response(JSON.stringify({ subjects: [], unresolved: ['ZZZZ'] }), { status: 200 }))
  await search.type('ZZZZ')
  await search.settle()
  assert.deepEqual([search.message(), search.heard], ['No match for "ZZZZ".', ['No match for "ZZZZ".']])

  await search.submit()
  await search.settle()
  assert.deepEqual([search.message(), search.heard], ['No match for "ZZZZ".', ['No match for "ZZZZ".', '', 'No match for "ZZZZ".']])
})

test('a search that fails says to try again, while typing and on submit, without the error text, and is announced each time', async (t) => {
  const search = await renderSearch(t, () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
  await search.type('AAPL')
  await search.settle()
  assert.deepEqual([search.message(), search.heard], ["Couldn't search. Try again.", ["Couldn't search. Try again."]])

  await search.submit()
  await search.settle()
  assert.deepEqual([search.message(), search.heard], ["Couldn't search. Try again.", ["Couldn't search. Try again.", '', "Couldn't search. Try again."]])
})

test('typeahead options with no name or listing are numbered, not blank', async (t) => {
  const unlabelled = (id: string) => ({ subject_ref: { kind: 'listing', id }, confidence: 0.4 })
  const search = await renderSearch(t, () => new Response(JSON.stringify({
    subjects: [unlabelled('11111111-1111-4111-a111-111111111111'), unlabelled('22222222-2222-4222-a222-222222222222')],
    unresolved: [],
  }), { status: 200 }))
  await search.type('APPL')
  await search.settle()
  assert.deepEqual(search.options(), ['Symbol 1', 'Symbol 2'])
})

test('a typeahead option shows its listing on a second line only when the name is not that listing', async (t) => {
  const search = await renderSearch(t, () => new Response(JSON.stringify({
    subjects: [
      { subject_ref: { kind: 'listing', id: '11111111-1111-4111-a111-111111111111' }, display_labels: { primary: 'Apple Inc.', ticker: 'AAPL', mic: 'XNAS' }, confidence: 0.9 },
      { subject_ref: { kind: 'listing', id: '22222222-2222-4222-a222-222222222222' }, display_labels: { ticker: 'AAPL', mic: 'XLON' }, confidence: 0.4 },
    ],
    unresolved: [],
  }), { status: 200 }))
  await search.type('AAPL')
  await search.settle()
  assert.deepEqual(search.optionLines(), [['Apple Inc.', 'AAPL · XNAS'], ['AAPL · XLON']])
})

const AAPL = { subject_ref: { kind: 'listing', id: '11111111-1111-4111-a111-111111111111' }, display_labels: { primary: 'Apple Inc.', ticker: 'AAPL', mic: 'XNAS' }, confidence: 0.9 }

test('the add-symbol box hands the symbol over, empties itself, and stays on the page', async (t) => {
  const added: ResolvedSubject[] = []
  const search = await renderSearch(t, () => new Response(JSON.stringify({ subjects: [AAPL], unresolved: [] }), { status: 200 }), (subject) => added.push(subject))
  await search.type('AAPL')
  await search.settle()
  await search.submit()
  await search.settle()
  assert.deepEqual([added.map((subject) => subject.subject_ref.id), search.value(), search.pathname()], [[AAPL.subject_ref.id], '', '/'])
})

test('the top-bar search still opens the symbol it resolves', async (t) => {
  const search = await renderSearch(t, () => new Response(JSON.stringify({ subjects: [AAPL], unresolved: [] }), { status: 200 }))
  await search.type('AAPL')
  await search.settle()
  await search.submit()
  await search.settle()
  assert.notEqual(search.pathname(), '/')
})
