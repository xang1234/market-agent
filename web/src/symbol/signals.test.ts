import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLAIM_STANCES,
  EVIDENCE_SOURCE_KINDS,
  loadSignalsFixture,
  sourceKindLabel,
  stanceLabel,
  totalEvidenceCount,
} from './signals.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const NVDA_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa5'

test('loadSignalsFixture returns a deterministic envelope for the same issuer id', () => {
  const a = loadSignalsFixture(APPLE_ISSUER_ID)
  const b = loadSignalsFixture(APPLE_ISSUER_ID)
  assert.deepEqual(a.sentiment_trend.points, b.sentiment_trend.points)
  assert.deepEqual(a.claim_clusters.clusters, b.claim_clusters.clusters)
})

test('loadSignalsFixture varies by issuer so different subjects render distinct surfaces', () => {
  const apple = loadSignalsFixture(APPLE_ISSUER_ID)
  const nvda = loadSignalsFixture(NVDA_ISSUER_ID)
  assert.notDeepEqual(apple.sentiment_trend.points, nvda.sentiment_trend.points)
  // The rotation embeds a per-issuer offset into each cluster_id's `-cluster-N`
  // suffix. Stripping the issuer prefix lets us compare the rotation result
  // directly — if two issuers hashed to the same offset, this sequence would
  // match (and the cross-issuer divergence guarantee would be defeated).
  const rotationIndex = (id: string) => id.split('-cluster-').at(-1)
  const appleRotation = apple.claim_clusters.clusters.map((c) => rotationIndex(c.cluster_id))
  const nvdaRotation = nvda.claim_clusters.clusters.map((c) => rotationIndex(c.cluster_id))
  assert.notDeepEqual(appleRotation, nvdaRotation)
})

test('sentiment trend block carries BaseBlock provenance fields', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  const trend = env.sentiment_trend
  assert.equal(trend.kind, 'sentiment_trend')
  assert.equal(trend.subject.id, APPLE_ISSUER_ID)
  assert.equal(trend.window_days, 30)
  assert.equal(trend.points.length, 30)
  assert.ok(trend.id.length > 0)
  assert.ok(trend.snapshot_id.length > 0)
  assert.ok(trend.data_ref.length > 0)
  assert.ok(trend.source_refs.length > 0)
  assert.ok(trend.as_of.length > 0)
})

test('sentiment scores stay inside [-1, 1] and mention counts stay non-negative', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  for (const point of env.sentiment_trend.points) {
    assert.ok(point.sentiment_score >= -1 && point.sentiment_score <= 1)
    assert.ok(point.mention_count >= 0)
    assert.match(point.date, /^\d{4}-\d{2}-\d{2}$/)
  }
})

test('sentiment trend points are ordered oldest-first so a left-to-right chart reads chronologically', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  const points = env.sentiment_trend.points
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i - 1].date <= points[i].date, `expected ascending dates at index ${i}`)
  }
})

test('claim clusters cover every defined stance category in the source-agnostic enum', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  const seenStances = new Set(env.claim_clusters.clusters.map((c) => c.stance))
  for (const stance of CLAIM_STANCES) {
    assert.ok(seenStances.has(stance), `expected at least one ${stance} cluster`)
  }
})

test('claim clusters carry source diversity across community / news / filing', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  for (const cluster of env.claim_clusters.clusters) {
    for (const kind of EVIDENCE_SOURCE_KINDS) {
      assert.ok(
        Number.isInteger(cluster.evidence_mix[kind]),
        `expected integer count for ${kind}`,
      )
      assert.ok(cluster.evidence_mix[kind] >= 0)
    }
    assert.ok(
      totalEvidenceCount(cluster.evidence_mix) > 0,
      'each cluster should cite at least one piece of evidence',
    )
  }
})

test('claim clusters are ordered most-recently-observed first', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  const clusters = env.claim_clusters.clusters
  for (let i = 1; i < clusters.length; i++) {
    assert.ok(
      clusters[i - 1].last_observed >= clusters[i].last_observed,
      `expected newest-first at index ${i}`,
    )
  }
})

test('first_observed precedes or equals last_observed for every cluster', () => {
  const env = loadSignalsFixture(APPLE_ISSUER_ID)
  for (const cluster of env.claim_clusters.clusters) {
    assert.ok(cluster.first_observed <= cluster.last_observed)
  }
})

test('stanceLabel and sourceKindLabel cover every enum value', () => {
  for (const stance of CLAIM_STANCES) {
    assert.ok(stanceLabel(stance).length > 0)
  }
  for (const kind of EVIDENCE_SOURCE_KINDS) {
    assert.ok(sourceKindLabel(kind).length > 0)
  }
})
