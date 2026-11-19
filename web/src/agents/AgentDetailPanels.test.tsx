import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentDetailPanels } from './AgentDetailPanels.tsx'

test('run activity reads its time in words and keeps the exact stamp (#410)', () => {
  const html = renderToStaticMarkup(
    <AgentDetailPanels
      findings={[]}
      assessments={[]}
      detailsError={null}
      runs={[]}
      runActivities={[{ run_activity_id: 'a1', agent_id: 'g1', stage: 'reading', summary: 'Read the 10-K.', ts: '2026-11-19T16:40:05.000Z' }]}
    />,
  )
  const time = new JSDOM(html).window.document.querySelector('li time')
  assert.equal(time?.getAttribute('dateTime'), '2026-11-19T16:40:05.000Z')
  assert.doesNotMatch(time?.textContent ?? '', /T16:40/)
})
