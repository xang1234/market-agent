import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { installDomGlobals } from '../analyst-grids/testDom.ts'
import { BlockRegistryProvider, createDefaultBlockRegistry } from '../blocks/index.ts'
import { EvidenceInspectorProvider } from '../evidence/EvidenceInspectorProvider.tsx'
import { AuthContext } from '../shell/authTypes.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'
import type { RunOrigin, StreamLink, TurnIds } from './chatSession.ts'
import { AssistantBlocks } from './MessageItem.tsx'
import { PendingTurnView } from './PendingTurnView.tsx'
import { INITIAL_STREAM_STATE, applyChatStreamEvent, type StreamState } from './streamReducer.ts'

const TURN: TurnIds = { runId: 'run-1', messageId: 'u1', snapshotId: 'snap-1', text: 'Analyze NVDA' }
const RUN = { runId: 'run-1', turnId: 'u1' }
const noop = () => undefined
const handlers = { messages: [], onRetry: noop, onReconnect: noop, onReload: noop, onAsk: () => true }
const OWN: RunOrigin = { kind: 'own', input: { userIntent: 'Analyze NVDA' } }
const LINK: StreamLink = { kind: 'open', attach: false, attempt: 0, reached: true, drops: 0, seenSeq: 0 }
const ADOPTED: RunOrigin = { kind: 'adopted' }

test('PendingTurnView renders the agent plan panel above streamed blocks', () => {
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
    snapshot_id: null,
    error: null,
  }

  const html = renderToStaticMarkup(<PendingTurnView turn={{ phase: 'streaming', run: RUN, origin: OWN, stream: state, link: LINK }} {...handlers} />)

  assert.match(html, /data-testid="agent-plan-panel"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /Agent plan/)
  assert.match(html, /Planner/)
  assert.match(html, /Fundamentals/)
  assert.match(html, /running/)
  assert.ok(html.indexOf('Agent plan') < html.indexOf('Partial answer.'))
})

test('PendingTurnView shows an unverified turn with a per-block label and collapsible reasons', () => {
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
    snapshot_id: null,
    error: null,
    unverified: {
      failures: [{ reason_code: 'missing_fact_ref', details: { fact_id: 'f-1' } }],
      blocks: [block],
    },
  }

  const html = renderToStaticMarkup(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <PendingTurnView turn={{ phase: 'unverified', run: RUN, stream: state }} {...handlers} />
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

const STREAMED: StreamState = {
  turn_status: 'unsealed',
  blocks_by_id: new Map([
    ['b1', { block_id: 'b1', kind: 'rich_text', status: 'completed', segments: [{ type: 'text', text: "NVIDIA's revenue rose" }] }],
  ]),
  block_order: ['b1'],
  plan_steps: [],
  message_id: 'a1',
  snapshot_id: null,
  error: 'turn.completed carried no valid sealed message',
}

test('a failed own run offers Retry; a turn whose sealed copy never arrived offers only Reload thread; a run nobody here sent offers nothing', () => {
  const retry = renderToStaticMarkup(
    <PendingTurnView turn={{ phase: 'failed', run: RUN, origin: OWN, stream: STREAMED, error: 'Stream error: upstream_500', recovery: 'retry_run' }} {...handlers} />,
  )
  assert.match(retry, /NVIDIA&#x27;s revenue rose/)
  assert.match(retry, /Stream error: upstream_500/)
  assert.match(retry, />Retry<\/button>/)
  assert.doesNotMatch(retry, /Reload thread/)

  const reload = renderToStaticMarkup(
    <PendingTurnView turn={{ phase: 'failed', run: RUN, origin: OWN, stream: STREAMED, error: "Couldn't show the saved copy of this answer.", recovery: 'reload_thread', messageId: 'a1' }} {...handlers} />,
  )
  assert.match(reload, /NVIDIA&#x27;s revenue rose/)
  assert.match(reload, /Couldn&#x27;t show the saved copy of this answer\./)
  assert.match(reload, />Reload thread<\/button>/)
  assert.doesNotMatch(reload, />Retry<\/button>/)

  const adopted = renderToStaticMarkup(
    <PendingTurnView turn={{ phase: 'failed', run: RUN, origin: ADOPTED, stream: STREAMED, error: 'Stream error: upstream_500', recovery: 'none' }} {...handlers} />,
  )
  assert.match(adopted, /Stream error: upstream_500/)
  assert.doesNotMatch(adopted, /<button/)
  assert.doesNotMatch(adopted, /NVIDIA&#x27;s revenue rose/)
})

test('PendingTurnView shows the optimistic question while it is being saved', () => {
  const html = renderToStaticMarkup(<PendingTurnView turn={{ phase: 'persisting', turn: TURN }} {...handlers} />)
  assert.match(html, /Analyze NVDA/)
  assert.match(html, /Starting…/)
  assert.doesNotMatch(html, /data-testid="streaming-turn"/)
})

test('an opened stream shows Starting… until turn.started, which no other event precedes (#398)', () => {
  const render = (stream: StreamState) =>
    renderToStaticMarkup(<PendingTurnView turn={{ phase: 'streaming', run: RUN, origin: OWN, stream, link: LINK }} {...handlers} />)
  assert.match(render(INITIAL_STREAM_STATE), /Starting…/)
  const started = applyChatStreamEvent(INITIAL_STREAM_STATE, { type: 'turn.started', seq: 1, bundle_id: 'financial_answer' } as unknown as ChatSseEvent)
  assert.doesNotMatch(render(started), /Starting…/)
  const failed = renderToStaticMarkup(
    <PendingTurnView turn={{ phase: 'failed', run: RUN, origin: OWN, stream: INITIAL_STREAM_STATE, error: 'The run failed.', recovery: 'retry_run' }} {...handlers} />,
  )
  assert.deepEqual([/The run failed\./.test(failed), /Starting…/.test(failed)], [true, false], 'a failed run says so, not Starting…')
})

test('an adopted run shows its plan and its link state, never streamed blocks; an own run shows its blocks attached or not', () => {
  const stream: StreamState = { ...STREAMED, turn_status: 'started', plan_steps: [{ step_id: 'planner', label: 'Planner', detail: 'Planning.', status: 'running' }] }
  const render = (link: StreamLink, origin: RunOrigin = ADOPTED) => renderToStaticMarkup(<PendingTurnView turn={{ phase: 'streaming', run: RUN, origin, stream, link }} {...handlers} />)

  const notices = ([
    { ...LINK, attach: true },
    { ...LINK, kind: 'reconnecting', attach: true, drops: 1 },
    { ...LINK, kind: 'offline', attach: true },
  ] as const).map((link) => {
    const html = render(link)
    assert.match(html, /Planner/)
    assert.doesNotMatch(html, /NVIDIA&#x27;s revenue rose/)
    return [/still answering/.test(html), /Reconnecting to the analyst/.test(html), />Reconnect<\/button>/.test(html)]
  })
  assert.deepEqual(notices, [[true, false, false], [false, true, false], [false, false, true]])
  assert.match(render(LINK, OWN), /NVIDIA&#x27;s revenue rose/)
  assert.match(render({ ...LINK, attach: true }, OWN), /NVIDIA&#x27;s revenue rose/)
})

test('a sealed answer shown while the judge reads its inferences renders as the saved message it becomes, with its proofs, for any reader of the run, until history holds it', () => {
  const answer = {
    id: 'b-answer',
    kind: 'rich_text',
    snapshot_id: '11111111-1111-4111-a111-111111111111',
    data_ref: { kind: 'rich_text', id: 'b-answer' },
    source_refs: ['s-1'],
    as_of: '2026-05-06T00:00:00.000Z',
    segments: [
      { type: 'text', text: 'Data Center revenue was ' },
      { type: 'ref', ref_kind: 'fact', ref_id: 'f-1', format: '$55.2B' },
      { type: 'text', text: '.\n\n> _Checking an analyst inference against the figures it rests on…_' },
    ],
  }
  const proofs = { 'b-answer': { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown' } } as const
  const stream: StreamState = {
    turn_status: 'started',
    blocks_by_id: new Map(),
    block_order: [],
    plan_steps: [{ step_id: 'planner', label: 'Planner', detail: 'Planning.', status: 'done' }],
    snapshot_id: null,
    error: null,
    shown: { message_id: 'a1', snapshot_id: '22222222-2222-4222-a222-222222222222', blocks: [answer], block_proofs: proofs },
  }
  const registry = createDefaultBlockRegistry()
  const render = (origin: RunOrigin) => renderToStaticMarkup(
    <BlockRegistryProvider registry={registry}>
      <PendingTurnView turn={{ phase: 'streaming', run: RUN, origin, stream, link: LINK }} {...handlers} />
    </BlockRegistryProvider>,
  )
  const saved = renderToStaticMarkup(
    <BlockRegistryProvider registry={registry}>
      <AssistantBlocks blocks={[answer]} proofs={proofs} />
    </BlockRegistryProvider>,
  )

  for (const origin of [OWN, ADOPTED]) {
    const html = render(origin)
    assert.ok(html.includes(saved), 'the saved message\'s own tree, proof labels included')
    assert.match(html, /Source-linked narrative/)
    assert.match(html, /Checking an analyst inference against the figures it rests on/)
    assert.doesNotMatch(html, /Agent plan/)
  }

  // A load during the answer's commentary already holds it: history shows it, once.
  const held = { message_id: 'a1', thread_id: 'T1', role: 'assistant', snapshot_id: stream.shown!.snapshot_id, blocks: [answer], content_hash: 'sha256:a1', created_at: '2026-05-06T00:00:00.000Z' } as const
  const attached = renderToStaticMarkup(
    <BlockRegistryProvider registry={registry}>
      <PendingTurnView turn={{ phase: 'streaming', run: RUN, origin: ADOPTED, stream, link: { ...LINK, attach: true } }} {...handlers} messages={[held]} />
    </BlockRegistryProvider>,
  )
  assert.doesNotMatch(attached, /Data Center revenue was/)
  assert.match(attached, /The analyst is still answering this question/)
})

test('a figure clicked while its answer streams asks the inspector for it in the sealed snapshot', async () => {
  const sealedId = '72fe1508-c2ab-4176-83d7-6ffe178f7a8b'
  const ids = { thread_id: 'thread-1', run_id: RUN.runId, turn_id: RUN.turnId }
  const events: ChatSseEvent[] = [
    { ...ids, type: 'turn.started', seq: 1 },
    { ...ids, type: 'snapshot.sealed', seq: 2, snapshot_id: sealedId },
    { ...ids, type: 'block.began', seq: 3, block_id: 'b1', kind: 'rich_text' },
    { ...ids, type: 'block.delta', seq: 4, block_id: 'b1', delta: { segment: { type: 'text', text: 'Revenue was ' } } },
    { ...ids, type: 'block.delta', seq: 5, block_id: 'b1', delta: { segment: { type: 'ref', ref_kind: 'fact', ref_id: 'f-1', format: '$62.1B' } } },
  ]
  const stream = events.reduce(applyChatStreamEvent, INITIAL_STREAM_STATE)

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const bodies: unknown[] = []
  try {
    globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: '00000000-0000-4000-8000-000000000001', displayName: 'Mock User' }, signIn: noop, signOut: noop }}>
          <EvidenceInspectorProvider>
            <PendingTurnView turn={{ phase: 'streaming', run: RUN, origin: OWN, stream, link: LINK }} {...handlers} />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      )
    })
    await act(async () => {
      dom.window.document.querySelector('button[data-inspection-kind="fact"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    assert.deepEqual(bodies, [{ snapshot_id: sealedId, ref: { kind: 'fact', id: 'f-1' } }])
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})
