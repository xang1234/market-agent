import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { installDomGlobals } from '../../analyst-grids/testDom.ts'
import { KeyStatsGrid } from './KeyStatsGrid.tsx'

test('a blank key stat with a known reason names it to keyboard and pointer users', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(<KeyStatsGrid cells={[{ key: 'pe_ratio', label: 'P/E (diluted)', value: null, reason: 'No market price yet.' }]} />)
    })
    const doc = dom.window.document
    const trigger = doc.querySelector('[data-testid="key-stat-pe_ratio"] [tabindex="0"]') as HTMLElement
    assert.ok(trigger, 'the dash is keyboard reachable')
    const tip = doc.getElementById(trigger.getAttribute('aria-describedby')!)!
    assert.equal(tip.textContent, 'No market price yet.')
    assert.equal(tip.getAttribute('role'), 'tooltip')
    assert.match(tip.className, /sr-only/, 'hidden visually until hover or focus')
    await act(async () => { trigger.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })) })
    assert.doesNotMatch(tip.className, /sr-only/, 'focus shows the reason')
    await act(async () => { trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    assert.match(tip.className, /sr-only/, 'Escape dismisses it')
    await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })) })
    assert.doesNotMatch(tip.className, /sr-only/, 'hover shows the reason')
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('scroll')) })
    assert.match(tip.className, /sr-only/, 'a scroll hides the fixed tip rather than leaving it adrift')
    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

test('a reason for a dash near the bottom of the window opens above it, on screen', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(<KeyStatsGrid cells={[{ key: 'pe_ratio', label: 'P/E (diluted)', value: null, reason: 'No market price yet.' }]} />)
    })
    const doc = dom.window.document
    const trigger = doc.querySelector('[data-testid="key-stat-pe_ratio"] [tabindex="0"]') as HTMLElement
    const tip = doc.getElementById(trigger.getAttribute('aria-describedby')!)!
    const at = (top: number) => { trigger.getBoundingClientRect = () => ({ left: 10, right: 30, top, bottom: top + 20, width: 20, height: 20, x: 10, y: top, toJSON: () => ({}) }) as DOMRect }
    const height = dom.window.innerHeight
    at(height - 30)
    await act(async () => { trigger.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })) })
    assert.deepEqual([tip.style.top, tip.style.bottom], ['', '30px'], 'anchored above the dash')
    await act(async () => { trigger.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })) })
    at(100)
    await act(async () => { trigger.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })) })
    assert.deepEqual([tip.style.top, tip.style.bottom], ['120px', ''], 'below the dash when there is room')
    await act(async () => root.unmount())
  } finally {
    restore()
  }
})

async function renderPe() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const root = createRoot(dom.window.document.getElementById('root')!)
  await act(async () => {
    root.render(<KeyStatsGrid cells={[{ key: 'pe_ratio', label: 'P/E (diluted)', value: null, reason: 'No market price yet.' }]} />)
  })
  const trigger = dom.window.document.querySelector('[data-testid="key-stat-pe_ratio"] [tabindex="0"]') as HTMLElement
  const tip = dom.window.document.getElementById(trigger.getAttribute('aria-describedby')!)!
  const at = (top: number) => { trigger.getBoundingClientRect = () => ({ left: 10, right: 30, top, bottom: top + 20, width: 20, height: 20, x: 10, y: top, toJSON: () => ({}) }) as DOMRect }
  const done = async () => { await act(async () => root.unmount()); restore() }
  return { dom, trigger, tip, at, done }
}

test('focusing a dash below the fold keeps its reason through the scroll that brings it into view', async () => {
  const { dom, trigger, tip, at, done } = await renderPe()
  try {
    at(dom.window.innerHeight + 200)
    await act(async () => { trigger.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true })) })
    at(300)
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('scroll')) })
    assert.doesNotMatch(tip.className, /sr-only/, 'the focus-induced scroll does not close it')
    assert.equal(tip.style.top, '320px', 'it follows the dash to where the scroll put it')
    at(-100)
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('scroll')) })
    assert.match(tip.className, /sr-only/, 'scrolling the dash out of view closes it')
  } finally {
    await done()
  }
})

test('the dash is named for the figure it stands in for, with the reason as its description', async () => {
  const { trigger, tip, done } = await renderPe()
  try {
    assert.equal(trigger.getAttribute('role'), 'img')
    assert.equal(trigger.getAttribute('aria-label'), 'P/E (diluted): not available')
    assert.equal(tip.textContent, 'No market price yet.')
  } finally {
    await done()
  }
})

test('Escape dismisses a reason opened by hover, wherever focus is', async () => {
  const { dom, trigger, tip, done } = await renderPe()
  try {
    await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })) })
    assert.doesNotMatch(tip.className, /sr-only/)
    await act(async () => { dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    assert.match(tip.className, /sr-only/)
  } finally {
    await done()
  }
})
