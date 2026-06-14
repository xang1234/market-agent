import assert from 'node:assert/strict'
import test from 'node:test'

import { tallyFindingSeverities, FINDING_SEVERITY_ORDER } from './findingStats.ts'
import type { HomeFindingCardSummary } from './summaryClient.ts'
import type { FindingSeverity } from '../blocks/types.ts'

function card(severity: FindingSeverity): HomeFindingCardSummary {
  return {
    home_card_id: severity,
    headline: 'x',
    severity,
    support_count: 1,
    contributing_finding_count: 1,
    created_at: '2026-05-05T00:00:00.000Z',
    destination: { kind: 'none', reason: 'fixture' },
    subject_refs: [],
  }
}

test('tallyFindingSeverities counts cards by severity', () => {
  const counts = tallyFindingSeverities([card('critical'), card('high'), card('high'), card('low')])
  assert.deepEqual(counts, { critical: 1, high: 2, medium: 0, low: 1 })
})

test('tallyFindingSeverities returns all-zero for an empty list', () => {
  assert.deepEqual(tallyFindingSeverities([]), { critical: 0, high: 0, medium: 0, low: 0 })
})

test('FINDING_SEVERITY_ORDER runs highest severity first', () => {
  assert.deepEqual([...FINDING_SEVERITY_ORDER], ['critical', 'high', 'medium', 'low'])
})
