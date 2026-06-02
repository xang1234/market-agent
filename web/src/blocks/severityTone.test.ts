import assert from 'node:assert/strict'
import test from 'node:test'
import { severityBadgeClass } from './severityTone.ts'
import { FINDING_SEVERITIES } from './types.ts'

test('severityBadgeClass returns a non-empty class string for every severity', () => {
  for (const severity of FINDING_SEVERITIES) {
    const className = severityBadgeClass(severity)
    assert.ok(className.length > 0, `expected a class for ${severity}`)
  }
})

test('severityBadgeClass returns distinct classes per severity so the levels are visually separable', () => {
  const classes = new Set(FINDING_SEVERITIES.map(severityBadgeClass))
  assert.equal(classes.size, FINDING_SEVERITIES.length)
})
