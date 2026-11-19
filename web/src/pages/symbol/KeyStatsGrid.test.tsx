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
