import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  mentionVolumeFixture,
  newsClusterFixture,
  sentimentTrendFixture,
} from './fixtures.ts'
import {
  MENTION_VOLUME_DISCLOSURE,
  newsClusterEvidenceTarget,
  newsClusterSupportSummary,
  seriesCacheContract,
  socialSeriesSummary,
} from './socialNewsBlocks.ts'

const BLOCKS_DIR = dirname(fileURLToPath(import.meta.url))

test('newsClusterSupportSummary requires claims and supporting documents', () => {
  assert.deepEqual(newsClusterSupportSummary(newsClusterFixture), {
    claimCount: 2,
    documentCount: 2,
    supportLabel: '2 claims · 2 documents',
  })

  assert.throws(
    () => newsClusterSupportSummary({ ...newsClusterFixture, claim_refs: [] }),
    /claim_refs: at least one claim is required/,
  )
  assert.throws(
    () => newsClusterSupportSummary({ ...newsClusterFixture, document_refs: [] }),
    /document_refs: at least one document is required/,
  )
})

test('newsClusterEvidenceTarget binds click-through to cluster and claim refs without raw text', () => {
  const target = newsClusterEvidenceTarget(newsClusterFixture)

  assert.deepEqual(target, {
    clusterId: newsClusterFixture.cluster_id,
    claimIds: newsClusterFixture.claim_refs,
    documentIds: newsClusterFixture.document_refs,
    bundleInput: { claim_ids: newsClusterFixture.claim_refs },
  })
  assert.equal(JSON.stringify(target).includes(newsClusterFixture.headline), false)
})

test('social series summaries expose latest value and totals without changing series shape', () => {
  assert.deepEqual(socialSeriesSummary(sentimentTrendFixture), {
    kind: 'sentiment_trend',
    latestLabel: 'Latest sentiment',
    latestValue: '+0.02',
    pointCount: 5,
    total: null,
  })

  assert.deepEqual(socialSeriesSummary(mentionVolumeFixture), {
      kind: 'mention_volume',
      latestLabel: 'Latest mentions',
      latestValue: '1,660',
      pointCount: 10,
      total: 7970,
    })
})

test('seriesCacheContract reads sealed series refs and allowed transforms from block metadata', () => {
  const block = {
    ...sentimentTrendFixture,
    data_ref: {
      ...sentimentTrendFixture.data_ref,
      params: {
        series_refs: [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        ],
      },
    },
    interactive: {
      ranges: ['7D', '30D'],
      intervals: ['1d'],
      allowed_transforms: {
        series: [
          {
            range: {
              start: '2026-04-01T00:00:00.000Z',
              end: '2026-05-01T00:00:00.000Z',
            },
            interval: '1d',
          },
        ],
      },
      range_end_max: '2026-05-04T00:00:00.000Z',
      hover_details: true,
    },
  }

  assert.deepEqual(seriesCacheContract(block), {
    seriesRefs: [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    ],
    allowedRanges: ['7D', '30D'],
    allowedIntervals: ['1d'],
    allowedTransforms: {
      series: [
        {
          range: {
            start: '2026-04-01T00:00:00.000Z',
            end: '2026-05-01T00:00:00.000Z',
          },
          interval: '1d',
        },
      ],
    },
    rangeEndMax: '2026-05-04T00:00:00.000Z',
    hoverDetails: true,
  })
})

test('mention volume exposes the required volume-not-impact disclosure', () => {
  assert.match(MENTION_VOLUME_DISCLOSURE, /mentions/i)
  assert.match(MENTION_VOLUME_DISCLOSURE, /not impact/i)
})

test('specialized renderers surface evidence and disclosure affordances', () => {
  const newsClusterSource = readFileSync(join(BLOCKS_DIR, 'NewsCluster.tsx'), 'utf8')
  assert.match(newsClusterSource, /data-evidence-bundle-claim-ids/)
  assert.match(newsClusterSource, /View evidence bundle/)
  assert.doesNotMatch(newsClusterSource, /raw[-_\s]?text/i)

  const mentionVolumeSource = readFileSync(join(BLOCKS_DIR, 'MentionVolume.tsx'), 'utf8')
  assert.match(mentionVolumeSource, /MENTION_VOLUME_DISCLOSURE/)
})
