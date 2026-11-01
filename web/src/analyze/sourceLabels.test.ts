import assert from 'node:assert/strict'
import test from 'node:test'

import { sourceCategoryLabel } from './sourceLabels.ts'

test('sourceCategoryLabel names known source categories for people', () => {
  assert.deepEqual(
    ['filings', 'transcripts', 'news', 'issuer_ir', 'financials_quarterly'].map(sourceCategoryLabel),
    ['Filings', 'Transcripts', 'News', 'Investor relations', 'Quarterly financials'],
  )
})

test('sourceCategoryLabel turns an unknown id into words rather than hiding it', () => {
  assert.equal(sourceCategoryLabel('unknown-feed'), 'Unknown feed')
  assert.equal(sourceCategoryLabel('broker_notes'), 'Broker notes')
})
