import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'

import { reviewSeverity, isStaleItem, severityForItem, tallySeverities } from './severity.ts'
import { FactReviewQueue, type FactReviewQueueItem } from './FactReviewQueue.tsx'

test('reviewSeverity tracks the shortfall below the approval threshold', () => {
  // Confidence well below the bar → high.
  assert.equal(reviewSeverity({ confidence: 0.5, threshold: 0.7, isStale: false }), 'high')
  // Just below the bar → medium.
  assert.equal(reviewSeverity({ confidence: 0.61, threshold: 0.7, isStale: false }), 'medium')
  // At or above the bar → low.
  assert.equal(reviewSeverity({ confidence: 0.8, threshold: 0.7, isStale: false }), 'low')
})

test('reviewSeverity forces high for stale candidates regardless of confidence', () => {
  assert.equal(reviewSeverity({ confidence: 0.99, threshold: 0.7, isStale: true }), 'high')
})

test('isStaleItem requires both age and freshness window to be present and exceeded', () => {
  assert.equal(isStaleItem({ age_seconds: 100, stale_after_seconds: 60 }), true)
  assert.equal(isStaleItem({ age_seconds: 30, stale_after_seconds: 60 }), false)
  assert.equal(isStaleItem({ age_seconds: 100 }), false)
  assert.equal(isStaleItem({}), false)
})

test('severityForItem derives severity from an item, and tallySeverities counts a set', () => {
  const items = [
    { confidence: 0.4, threshold: 0.7 }, // high
    { confidence: 0.62, threshold: 0.7 }, // medium
    { confidence: 0.9, threshold: 0.7 }, // low
    { confidence: 0.99, threshold: 0.7, age_seconds: 100, stale_after_seconds: 60 }, // stale -> high
  ]
  assert.equal(severityForItem(items[0]), 'high')
  assert.equal(severityForItem(items[3]), 'high')
  assert.deepEqual(tallySeverities(items), { high: 2, medium: 1, low: 1 })
})

const noop = () => undefined

function item(overrides: Partial<FactReviewQueueItem>): FactReviewQueueItem {
  return {
    review_id: overrides.review_id ?? 'r-1',
    candidate: { value_num: 1 },
    reason: 'below_review_confidence_threshold',
    source_id: null,
    metric_id: null,
    confidence: 0.61,
    threshold: 0.7,
    created_at: '2026-05-03T00:00:00.000Z',
    ...overrides,
  }
}

test('FactReviewQueue summary header tallies severities and shows Approve all low', () => {
  const items = [
    item({ review_id: 'a', confidence: 0.4, threshold: 0.7 }), // high
    item({ review_id: 'b', confidence: 0.62, threshold: 0.7 }), // medium
    item({ review_id: 'c', confidence: 0.9, threshold: 0.7 }), // low
  ]
  const html = renderToString(
    <FactReviewQueue
      items={items}
      onApprove={noop}
      onEdit={noop}
      onReject={noop}
      onApproveAllLow={noop}
    />,
  )
  // Strip tags + React's <!-- --> text-boundary markers to assert on content.
  const text = html.replace(/<[^>]*>/g, '')
  assert.match(text, /3 claims awaiting review/)
  // Severity counts now read from the stacked-bar legend (High/Med/Low N).
  assert.match(text, /High 1/)
  assert.match(text, /Med 1/)
  assert.match(text, /Low 1/)
  assert.match(text, /Approve all low/)
})

test('FactReviewQueue omits Approve all low when no low-severity items exist', () => {
  const html = renderToString(
    <FactReviewQueue
      items={[item({ confidence: 0.4, threshold: 0.7 })]}
      onApprove={noop}
      onEdit={noop}
      onReject={noop}
      onApproveAllLow={noop}
    />,
  )
  assert.doesNotMatch(html, /Approve all low/)
})
