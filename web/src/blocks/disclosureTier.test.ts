import assert from 'node:assert/strict'
import test from 'node:test'
import { disclosureTierBadgeClass, disclosureTierLabel } from './disclosureTier.ts'
import { DISCLOSURE_TIERS } from './types.ts'

test('disclosureTierBadgeClass returns a non-empty class string for every tier', () => {
  for (const tier of DISCLOSURE_TIERS) {
    assert.ok(disclosureTierBadgeClass(tier).length > 0, `expected a class for ${tier}`)
  }
})

test('disclosureTierLabel returns a non-empty humanized label for every tier', () => {
  for (const tier of DISCLOSURE_TIERS) {
    const label = disclosureTierLabel(tier)
    assert.ok(label.length > 0)
    assert.notEqual(label, tier, `expected ${tier} to be humanized rather than passed through`)
  }
})

test('disclosureTierLabel returns distinct labels per tier so the seven tiers are unambiguous in UI', () => {
  const labels = new Set(DISCLOSURE_TIERS.map(disclosureTierLabel))
  assert.equal(labels.size, DISCLOSURE_TIERS.length)
})
