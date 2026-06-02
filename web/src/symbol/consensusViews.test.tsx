import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { ConsensusBody, PriceTargetBody } from './consensusViews.tsx'
import type { AnalystConsensusEnvelope, PriceTarget } from './consensus.ts'

function envelope(overrides: Partial<AnalystConsensusEnvelope>): AnalystConsensusEnvelope {
  return {
    subject: { kind: 'issuer', id: 'iss-1' },
    family: 'analyst_consensus',
    analyst_count: 10,
    as_of: '2026-05-01T00:00:00.000Z',
    rating_distribution: null,
    price_target: null,
    estimates: [],
    coverage_warnings: [],
    ...overrides,
  }
}

test('ConsensusBody falls back (no NaN widths) when contributor_count is non-positive', () => {
  const html = renderToStaticMarkup(
    <ConsensusBody
      envelope={envelope({
        rating_distribution: {
          // Malformed payload: a non-zero bucket but zero contributors.
          counts: { strong_buy: 3, buy: 0, hold: 0, sell: 0, strong_sell: 0 },
          contributor_count: 0,
          as_of: '2026-05-01T00:00:00.000Z',
          source_id: 'src-1',
        },
      })}
    />,
  )
  assert.match(html, /No rating distribution available/)
  assert.doesNotMatch(html, /NaN/)
})

function priceTarget(overrides: Partial<PriceTarget>): PriceTarget {
  return {
    currency: 'USD',
    low: 100,
    mean: 150,
    median: 150,
    high: 200,
    contributor_count: 5,
    as_of: '2026-05-01T00:00:00.000Z',
    source_id: 'src-1',
    ...overrides,
  }
}

test('PriceTargetBody clamps an out-of-band mean marker onto the track', () => {
  const html = renderToStaticMarkup(<PriceTargetBody target={priceTarget({ mean: 300, median: 50 })} />)
  // mean 300 > high 200 -> clamped to the right edge; median 50 < low 100 -> left edge.
  assert.match(html, /left:100%/)
  assert.match(html, /left:0%/)
  assert.doesNotMatch(html, /left:-/)
})
