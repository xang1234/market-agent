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

  await act(async () => root.render(<AgentPlanPanel steps={[step('Planner', 'done'), step('Fundamentals', 'running'), step('Composer', 'waiting')]} active />))
  assert.equal(heading(), 'Working · 0s')
  assert.deepEqual(
    [...container.querySelectorAll('li .sr-only')].map((node) => node.textContent),
    [' done', ' running', ' waiting'],
  )

  await act(async () => t.mock.timers.tick(65_000))
  assert.equal(heading(), 'Working · 1m 5s')

  await act(async () => root.render(<AgentPlanPanel steps={[step('Planner', 'done'), step('Fundamentals', 'done'), step('Composer', 'done')]} active />))
  await act(async () => t.mock.timers.tick(5_000))
  assert.equal(heading(), 'Worked for 1m 5s')

  await act(async () => root.unmount())
})

test('a turn that ended stops the clock and the spinner, and the clock stays out of live announcements', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  t.after(restore)
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const container = dom.window.document.getElementById('root')!
  const root = createRoot(container)
  const steps = [step('Planner', 'done'), step('Fundamentals', 'running')]

  await act(async () => root.render(<AgentPlanPanel steps={steps} active />))
  assert.equal(container.querySelector('h3 [aria-hidden="true"]')?.textContent, '0s')

  await act(async () => root.render(<AgentPlanPanel steps={steps} active={false} />))
  await act(async () => t.mock.timers.tick(5_000))
  assert.equal(container.querySelector('h3')?.textContent, 'Worked for 0s')
  assert.deepEqual([...container.querySelectorAll('li .sr-only')].map((node) => node.textContent), [' done', ' error'])

  await act(async () => root.unmount())
})

test('each step shows how long it ran once it is done, timed from when it was first seen running', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  t.after(restore)
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const container = dom.window.document.getElementById('root')!
  const root = createRoot(container)
  const times = () => [...container.querySelectorAll('li')].map((row) => row.querySelector('[data-testid="step-time"]')?.textContent)
  const render = (statuses: ReadonlyArray<StreamPlanStep['status']>, active = true) =>
    act(async () => root.render(<AgentPlanPanel steps={statuses.map((status, index) => step(['Planner', 'Fundamentals', 'Composer'][index]!, status))} active={active} />))

  await render(['running', 'waiting', 'waiting'])
  await act(async () => t.mock.timers.tick(4_000))
  await render(['done', 'running', 'waiting'])
  assert.deepEqual(times(), ['4s', '', ''])

  await act(async () => t.mock.timers.tick(65_000))
  await render(['done', 'done', 'running'])
  assert.deepEqual(times(), ['4s', '1m 5s', ''])

  await act(async () => t.mock.timers.tick(2_000))
  await render(['done', 'done', 'running'], false)
  assert.deepEqual(times(), ['4s', '1m 5s', '2s'], 'a step the ended turn left running stops when the turn did')

  await act(async () => root.unmount())
})

test('a step first seen already done shows no time, since when it started is unknown', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  t.after(restore)
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const container = dom.window.document.getElementById('root')!
  const root = createRoot(container)
  await act(async () => root.render(<AgentPlanPanel steps={[step('Planner', 'done')]} active />))
  assert.equal(container.querySelector('[data-testid="step-time"]')?.textContent, '')
  await act(async () => root.unmount())
})
