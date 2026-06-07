import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { Table } from './Table.tsx'
import type { TableBlock } from './types.ts'

const TABLE_BLOCK: TableBlock = {
  id: 'table-1',
  kind: 'table',
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  data_ref: { kind: 'fixture', id: 'table-1' },
  source_refs: [],
  as_of: '2026-05-05T12:00:00.000Z',
  columns: ['Metric', 'FY 2026'],
  rows: [
    ['Revenue', 123.45],
  ],
}

test('Table renders body cells with the shared numeric class', () => {
  const html = renderToStaticMarkup(<Table block={TABLE_BLOCK} />)

  assert.match(html, /class="[^"]*\bnum\b[^"]*"[^>]*>123\.45<\/td>/)
  assert.doesNotMatch(html, /tabular-nums/)
})
