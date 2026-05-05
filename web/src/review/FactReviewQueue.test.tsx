import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { JSDOM } from 'jsdom'

import {
  FactReviewQueue,
  type FactReviewQueueAction,
  type FactReviewQueueItem,
  type FactReviewQueueRejectAction,
} from './FactReviewQueue.tsx'

const ITEM: FactReviewQueueItem = {
  review_id: '66666666-6666-4666-8666-666666666666',
  candidate: {
    subject_kind: 'issuer',
    value_num: 99.9,
    unit: 'USD',
  },
  reason: 'below_review_confidence_threshold',
  source_id: '55555555-5555-4555-8555-555555555555',
  metric_id: '44444444-4444-4444-8444-444444444444',
  confidence: 0.61,
  threshold: 0.7,
  created_at: '2026-05-03T00:00:00.000Z',
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
  }
}

test('FactReviewQueue renders an empty state', () => {
  const html = renderToString(
    <FactReviewQueue items={[]} onApprove={() => undefined} onEdit={() => undefined} onReject={() => undefined} />,
  )

  assert.match(html, /No candidate facts need review/)
})

test('FactReviewQueue surfaces stale queue items for operators', () => {
  const html = renderToString(
    <FactReviewQueue
      items={[{ ...ITEM, age_seconds: 7200, stale_after_seconds: 3600 }]}
      onApprove={() => undefined}
      onEdit={() => undefined}
      onReject={() => undefined}
    />,
  )

  assert.match(html, /Stale <!-- -->2h/)
})

test('FactReviewQueue submits approved reviewer edits with notes', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const approvals: FactReviewQueueAction[] = []

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <FactReviewQueue
          items={[ITEM]}
          onApprove={(action) => {
            approvals.push(action)
          }}
          onEdit={() => undefined}
          onReject={() => undefined}
        />,
      )
    })

    const textareas = container.querySelectorAll('textarea')
    const candidate = textareas[0]!
    const notes = textareas[1]!
    await act(async () => {
      candidate.value = JSON.stringify({ ...ITEM.candidate, value_num: 101.25 })
      notes.value = 'matches 10-Q table'
    })
    await act(async () => {
      getButton(container, 'Approve').click()
    })

    assert.deepEqual(approvals, [
      {
        review_id: ITEM.review_id,
        candidate: { ...ITEM.candidate, value_num: 101.25 },
        notes: 'matches 10-Q table',
      },
    ])
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('FactReviewQueue submits rejects without reparsing candidate JSON', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const rejects: FactReviewQueueRejectAction[] = []

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <FactReviewQueue
          items={[ITEM]}
          onApprove={() => undefined}
          onEdit={() => undefined}
          onReject={(action) => {
            rejects.push(action)
          }}
        />,
      )
    })

    const textareas = container.querySelectorAll('textarea')
    textareas[0]!.value = '{'
    textareas[1]!.value = 'wrong segment'
    await act(async () => {
      getButton(container, 'Reject').click()
    })

    assert.deepEqual(rejects, [{ review_id: ITEM.review_id, notes: 'wrong segment' }])
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('FactReviewQueue blocks approve when candidate JSON is invalid', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const approvals: FactReviewQueueAction[] = []

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <FactReviewQueue
          items={[ITEM]}
          onApprove={(action) => {
            approvals.push(action)
          }}
          onEdit={() => undefined}
          onReject={() => undefined}
        />,
      )
    })

    const candidate = container.querySelector('textarea')!
    await act(async () => {
      candidate.value = '{'
    })
    await act(async () => {
      getButton(container, 'Approve').click()
    })

    assert.deepEqual(approvals, [])
    assert.match(container.textContent ?? '', /Candidate JSON is invalid/)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('FactReviewQueue surfaces async action failures to the operator', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <FactReviewQueue
          items={[ITEM]}
          onApprove={async () => {
            throw new Error('backend refused action')
          }}
          onEdit={() => undefined}
          onReject={() => undefined}
        />,
      )
    })

    await act(async () => {
      getButton(container, 'Approve').click()
    })

    assert.match(container.textContent ?? '', /backend refused action/)
    assert.equal(getButton(container, 'Approve').disabled, false)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('FactReviewQueue keeps each in-flight row disabled independently', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  let resolveFirst: (() => void) | null = null
  let resolveSecond: (() => void) | null = null
  const secondItem: FactReviewQueueItem = {
    ...ITEM,
    review_id: '77777777-7777-4777-8777-777777777777',
    candidate: { ...ITEM.candidate, value_num: 88.8 },
  }

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <FactReviewQueue
          items={[ITEM, secondItem]}
          onApprove={(action) =>
            new Promise<void>((resolve) => {
              if (action.review_id === ITEM.review_id) resolveFirst = resolve
              else resolveSecond = resolve
            })
          }
          onEdit={() => undefined}
          onReject={() => undefined}
        />,
      )
    })

    const approveButtons = getButtons(container, 'Approve')
    await act(async () => {
      approveButtons[0]!.click()
    })
    assert.equal(approveButtons[0]!.disabled, true)
    assert.equal(approveButtons[1]!.disabled, false)

    await act(async () => {
      approveButtons[1]!.click()
    })
    assert.equal(approveButtons[0]!.disabled, true)
    assert.equal(approveButtons[1]!.disabled, true)

    await act(async () => {
      resolveFirst?.()
      resolveSecond?.()
    })
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

function getButton(container: Element, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
  if (!button || button.tagName !== 'BUTTON') throw new Error(`button not found: ${label}`)
  return button
}

function getButtons(container: Element, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(
    (candidate): candidate is HTMLButtonElement => candidate.tagName === 'BUTTON' && candidate.textContent === label,
  )
}
