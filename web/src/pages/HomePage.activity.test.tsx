import './installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import { AuthContext, DEFAULT_MOCK_SESSION } from '../shell/authTypes.ts'
import { RightRailProvider } from '../shell/RightRailProvider.tsx'
import { RightRailSlot } from '../shell/RightRailSlot.tsx'
import { HomePage } from './HomePage.tsx'

const EMPTY_SUMMARY = {
  generated_at: '2026-11-19T12:00:00.000Z',
  findings: { cards: [] },
  market_pulse: { rows: [], omitted: [] },
  watchlist_movers: { reason: 'no_default_watchlist', rows: [], omitted: [] },
  agent_summaries: { window_hours: 24, rows: [] },
  saved_screens: { rows: [] },
}

const STORED_ACTIVITY = {
  run_activity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  agent_id: '11111111-1111-4111-8111-111111111111',
  stage: 'found',
  summary: 'Found a guidance cut in the latest 8-K',
  ts: '2026-11-19T10:00:00.000Z',
}

async function renderHome(t: test.TestContext, recent: () => Response) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const path = String(input)
    if (path === '/v1/run-activities') return recent()
    if (path === '/v1/home/summary') return new Response(JSON.stringify(EMPTY_SUMMARY), { status: 200 })
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount())
    container.remove()
    globalThis.fetch = originalFetch
  })
  await act(async () => root.render(
    <AuthContext.Provider value={{ session: DEFAULT_MOCK_SESSION, signIn: () => undefined, signOut: () => undefined }}>
      <MemoryRouter>
        <RightRailProvider>
          <HomePage />
          <RightRailSlot />
        </RightRailProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  ))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  return () => container.querySelector('aside[aria-label="Activity rail"]')?.textContent
}

test('the Activity rail shows what agent runs already stored, not only what streams in while Home is open', async (t) => {
  const rail = await renderHome(t, () => new Response(JSON.stringify({ activities: [STORED_ACTIVITY] }), { status: 200 }))
  assert.match(rail() ?? '', /Found a guidance cut in the latest 8-K/)
  assert.doesNotMatch(rail() ?? '', /No recent activity/)
})

test('the Activity rail says when stored activity could not load instead of claiming there is none', async (t) => {
  const rail = await renderHome(t, () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
  assert.match(rail() ?? '', /Couldn't load earlier activity\./)
  assert.doesNotMatch(rail() ?? '', /No recent activity/)
})
