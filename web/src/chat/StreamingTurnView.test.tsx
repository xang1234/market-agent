import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { StreamingTurnView } from './StreamingTurnView.tsx'
import type { StreamState } from './streamReducer.ts'

test('StreamingTurnView renders the agent plan panel above streamed blocks', () => {
  const state: StreamState = {
    turn_status: 'started',
    blocks_by_id: new Map([
      [
        'b1',
        {
          block_id: 'b1',
          kind: 'rich_text',
          status: 'streaming',
          segments: [{ type: 'text', text: 'Partial answer.' }],
        },
      ],
    ]),
    block_order: ['b1'],
    plan_steps: [
      {
        step_id: 'planner',
        label: 'Planner',
        detail: 'Planning single subject analysis.',
        status: 'done',
      },
      {
        step_id: 'tool:fundamentals-1',
        label: 'Fundamentals',
        detail: 'Running compose analyst blocks.',
        status: 'running',
      },
      {
        step_id: 'composer',
        label: 'Composer',
        detail: 'Awaiting evidence.',
        status: 'waiting',
      },
    ],
    completed_message_id: null,
    error: null,
  }

  const html = renderToStaticMarkup(<StreamingTurnView state={state} />)

  assert.match(html, /data-testid="agent-plan-panel"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /Agent plan/)
  assert.match(html, /Planner/)
  assert.match(html, /Fundamentals/)
  assert.match(html, /running/)
  assert.ok(html.indexOf('Agent plan') < html.indexOf('Partial answer.'))
})
