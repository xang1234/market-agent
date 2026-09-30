import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { BlockRegistryProvider, createDefaultBlockRegistry } from '../blocks/index.ts'
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

test('StreamingTurnView shows an unverified turn with a per-block label and collapsible reasons', () => {
  const block = {
    id: 'b-unverified',
    kind: 'rich_text',
    snapshot_id: '11111111-1111-4111-a111-111111111111',
    data_ref: { kind: 'chat_turn', id: 'turn-1' },
    source_refs: [],
    as_of: '2026-05-06T00:00:00.000Z',
    segments: [{ type: 'text', text: 'Revenue rose every quarter.' }],
  }
  const state: StreamState = {
    turn_status: 'unverified',
    blocks_by_id: new Map(),
    block_order: [],
    plan_steps: [],
    completed_message_id: null,
    error: null,
    unverified: {
      failures: [{ reason_code: 'missing_fact_ref', details: { fact_id: 'f-1' } }],
      blocks: [block],
    },
  }

  const html = renderToStaticMarkup(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <StreamingTurnView state={state} />
    </BlockRegistryProvider>,
  )

  assert.match(html, /data-turn-status="unverified"/)
  assert.match(html, /not saved/)
  assert.match(html, /data-verification="unverified"/)
  assert.match(html, /Revenue rose every quarter\./)
  assert.match(html, /<details[^>]*data-testid="unverified-reasons"/)
  assert.match(html, /Why unverified/)
  assert.match(html, /missing_fact_ref/)
})
