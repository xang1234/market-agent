import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { OpenClarificationContext } from './openClarification.ts'
import { RichText } from './RichText.tsx'
import type { RichTextBlock } from './types.ts'

const block = {
  id: 'clarify-1',
  kind: 'rich_text',
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  data_ref: { kind: 'rich_text', id: 'clarify-1' },
  source_refs: [],
  as_of: '2026-11-12T00:00:00.000Z',
  segments: [{ type: 'text', text: 'Which margin would you like?' }],
  clarification_choices: ['Gross margin', 'Operating margin'],
} as RichTextBlock

const listed = (html: string) => [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1])

test('an answered clarification lists the options it offered; the open one leaves them to its buttons', () => {
  assert.deepEqual(listed(renderToStaticMarkup(<RichText block={block} />)), ['Gross margin', 'Operating margin'])
  const open = renderToStaticMarkup(
    <OpenClarificationContext.Provider value="clarify-1">
      <RichText block={block} />
    </OpenClarificationContext.Provider>,
  )
  assert.deepEqual(listed(open), [])
  assert.match(open, /Which margin would you like\?/)
})
