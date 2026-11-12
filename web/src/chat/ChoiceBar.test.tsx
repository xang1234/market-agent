import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { installDomGlobals } from '../analyst-grids/testDom.ts'
import type { Block } from '../blocks/types.ts'
import { ChoiceBar } from './ChoiceBar.tsx'
import { offeredChoices } from './offeredChoices.ts'
import type { ChatMessage } from './messageTypes.ts'

function message(role: ChatMessage['role'], blocks: ReadonlyArray<Partial<Block>>): ChatMessage {
  return { message_id: `m-${role}`, thread_id: 't', role, snapshot_id: 's', blocks: blocks as Block[], content_hash: 'h', created_at: '2026-11-12T00:00:00Z' }
}
const clarification = message('assistant', [{ id: 'b', kind: 'rich_text', segments: [], clarification_choices: ['Gross margin', 'Operating margin'] }])

test('offeredChoices reads the saved field of the last message only when it is the assistant', () => {
  assert.deepEqual(offeredChoices([message('user', []), clarification]), ['Gross margin', 'Operating margin'])
  assert.deepEqual(offeredChoices([clarification, message('user', [])]), [])
  assert.deepEqual(offeredChoices([message('assistant', [{ id: 'b', kind: 'rich_text', segments: [{ type: 'text', text: 'Which one? A; B' }] }])]), [])
  assert.deepEqual(offeredChoices([]), [])
})

test('ChoiceBar sends an option by click or digit key, and digits typed in a field stay text', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div><textarea></textarea>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const g = globalThis as { HTMLElement?: unknown }
  const prevElement = g.HTMLElement
  g.HTMLElement = dom.window.HTMLElement
  const asked: string[] = []
  const root = createRoot(dom.window.document.getElementById('root')!)
  try {
    await act(async () => root.render(<ChoiceBar choices={['Gross margin', 'Operating margin']} onAsk={(text) => (asked.push(text), true)} />))
    const labels = [...dom.window.document.querySelectorAll('button')].map((button) => button.textContent)
    assert.deepEqual(labels, ['1Gross margin', '2Operating margin', '3All of the above'])
    await act(async () => dom.window.document.querySelectorAll('button')[1].click())
    const key = (target: EventTarget, init: KeyboardEventInit) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, ...init }))
    await act(async () => {
      key(dom.window.document.body, { key: '3' })
      key(dom.window.document.body, { key: '1', metaKey: true })
      key(dom.window.document.querySelector('textarea')!, { key: '1' })
      key(dom.window.document.body, { key: '4' })
    })
    assert.deepEqual(asked, ['Operating margin', 'All of the above'])
  } finally {
    await act(async () => root.unmount())
    g.HTMLElement = prevElement
    restore()
  }
})
