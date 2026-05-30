import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Sources } from './Sources.tsx'
import type { SourcesBlock } from './types.ts'

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '22222222-2222-4222-8222-222222222222'

test('Sources renders source refs as inspectable controls and keeps external navigation separate', () => {
  const block: SourcesBlock = {
    id: 'sources-1',
    kind: 'sources',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'sources', id: 'sources-1' },
    source_refs: [SOURCE_ID],
    as_of: '2026-05-29T00:00:00.000Z',
    title: 'Sources',
    items: [{ source_id: SOURCE_ID, label: 'SEC 10-K', url: 'https://www.sec.gov/example' }],
  }

  const html = renderToStaticMarkup(createElement(Sources, { block }))

  assert.match(html, /data-inspection-kind="source"/)
  assert.match(html, new RegExp(`data-inspection-id="${SOURCE_ID}"`))
  assert.match(html, /data-inspection-disabled="true"/)
  assert.match(html, /href="https:\/\/www\.sec\.gov\/example"/)
  assert.match(html, />Open</)
})
