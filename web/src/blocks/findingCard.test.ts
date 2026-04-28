import assert from 'node:assert/strict'
import test from 'node:test'
import { findingSeverityBadgeClass } from './findingCard.ts'
import { FINDING_SEVERITIES } from './types.ts'

test('findingSeverityBadgeClass returns a non-empty class string for every severity', () => {
  for (const severity of FINDING_SEVERITIES) {
    const className = findingSeverityBadgeClass(severity)
    assert.ok(className.length > 0, `expected a class for ${severity}`)
  }
})

test('findingSeverityBadgeClass returns distinct classes per severity so the four levels are visually separable', () => {
  const classes = new Set(FINDING_SEVERITIES.map(findingSeverityBadgeClass))
  assert.equal(classes.size, FINDING_SEVERITIES.length)
})
