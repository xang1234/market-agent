import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVIDENCE_SOURCE_KINDS,
  loadSignalsFixture,
  sourceKindLabel,
  totalEvidenceCount,
} from './signals.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const NVDA_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'

test('loadSignalsFixture returns a deterministic block envelope for the same issuer id', () => {
  const a = loadSignalsFixture(APPLE_ISSUER_ID)
  const b = loadSignalsFixture(APPLE_ISSUER_ID)
  assert.deepEqual(a.blocks, b.blocks)
})

test('loadSignalsFixture varies by issuer so different subjects render distinct surfaces', () => {
  const apple = loadSignalsFixture(APPLE_ISSUER_ID)
  const nvda = loadSignalsFixture(NVDA_ISSUER_ID)
  assert.notDeepEqual(apple.sentiment_trend.series, nvda.sentiment_trend.series)
  assert.notDeepEqual(apple.news_clusters.map((cluster) => cluster.cluster_id), nvda.news_clusters.map((cluster) => cluster.cluster_id))
})

test('sentiment trend block carries BaseBlock provenance and chronological series points', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  const trend = env.sentiment_trend
  assert.equal(trend.kind, 'sentiment_trend')
  assert.equal(trend.series.length, 1)
  assert.equal(trend.series[0]!.points.length, 30)
  assert.ok(trend.id.length > 0)
  assert.ok(trend.snapshot_id.length > 0)
  assert.ok(trend.data_ref.id.length > 0)
  assert.ok(trend.source_refs.length > 0)
  assert.ok(trend.as_of.length > 0)

  const points = trend.series[0]!.points
  for (let i = 1; i < points.length; i++) {
    assert.ok(String(points[i - 1]!.x) <= String(points[i]!.x), `expected ascending dates at index ${i}`)
  }
  for (const point of points) {
    assert.ok(point.y >= -1 && point.y <= 1)
  }
})

test('mention volume carries non-negative integer counts across source series', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  assert.equal(env.mention_volume.kind, 'mention_volume')
  assert.equal(env.mention_volume.series.length, 2)
  for (const series of env.mention_volume.series) {
    for (const point of series.points) {
      assert.ok(Number.isInteger(point.y))
      assert.ok(point.y >= 0)
    }
  }
})

test('news clusters are evidence-bound with claim and document refs', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  assert.ok(env.news_clusters.length > 0)
  for (const cluster of env.news_clusters) {
    assert.equal(cluster.kind, 'news_cluster')
    assert.ok(cluster.claim_refs.length > 0)
    assert.ok(cluster.document_refs.length > 0)
    assert.ok(cluster.source_refs.length > 0)
  }
})

test('sourceKindLabel and totalEvidenceCount cover every source enum value', () => {
  for (const kind of EVIDENCE_SOURCE_KINDS) {
    assert.ok(sourceKindLabel(kind).length > 0)
  }
  assert.equal(totalEvidenceCount({ community: 2, news: 3, filing: 5 }), 10)
})
