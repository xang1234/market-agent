import './installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { TitleEditor } from './ChatPage.tsx'

test('an untouched name stays a cancel when the row\'s name changes while the field is open', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const done: Array<string | null> = []
  try {
    await act(async () => root.render(<TitleEditor initial="What is NVDA's gross margin…" onDone={(next) => done.push(next)} />))
    await act(async () => root.render(<TitleEditor initial="NVDA gross margin" onDone={(next) => done.push(next)} />))
    const input = container.querySelector('input')!
    assert.equal(input.value, "What is NVDA's gross margin…")

    await act(async () => input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })))

    assert.deepEqual(done, [null])
  } finally {
    await act(async () => root.unmount())
  }
})
