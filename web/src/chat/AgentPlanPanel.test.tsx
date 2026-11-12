import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { installDomGlobals } from '../analyst-grids/testDom.ts'
import { AgentPlanPanel } from './AgentPlanPanel.tsx'
import type { StreamPlanStep } from './streamPlan.ts'

const step = (step_id: string, status: StreamPlanStep['status']): StreamPlanStep => ({ step_id, label: step_id, detail: `${step_id} detail`, status })

test('the plan panel reads "Working" with a ticking clock until every step is done, and names each status for screen readers', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  t.after(restore)
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const container = dom.window.document.getElementById('root')!
  const root = createRoot(container)
  const heading = () => container.querySelector('h3')?.textContent

  await act(async () => root.render(<AgentPlanPanel steps={[step('Planner', 'done'), step('Fundamentals', 'running'), step('Composer', 'waiting')]} />))
  assert.equal(heading(), 'Working · 0s')
  assert.deepEqual(
    [...container.querySelectorAll('li .sr-only')].map((node) => node.textContent),
    [' done', ' running', ' waiting'],
  )

  await act(async () => t.mock.timers.tick(65_000))
  assert.equal(heading(), 'Working · 1m 5s')

  await act(async () => root.render(<AgentPlanPanel steps={[step('Planner', 'done'), step('Fundamentals', 'done'), step('Composer', 'done')]} />))
  await act(async () => t.mock.timers.tick(5_000))
  assert.equal(heading(), 'Worked for 1m 5s')

  await act(async () => root.unmount())
})
