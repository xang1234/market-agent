import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import type { MentionVolumeBlock, NewsClusterBlock, SentimentTrendBlock } from '../blocks/types.ts'
import {
  SIGNALS_BLOCK_KINDS,
  loadSignalsFixture,
} from './signals.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const BLOCKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'blocks')

test('signals fixture composes real BlockRegistry-backed social/news blocks', () => {
  const envelope = loadSignalsFixture(APPLE_ISSUER_ID)
  const kinds = envelope.blocks.map((block) => block.kind)

  assert.deepEqual(kinds, ['sentiment_trend', 'mention_volume', 'news_cluster', 'news_cluster'])
  assert.deepEqual(SIGNALS_BLOCK_KINDS, ['sentiment_trend', 'mention_volume', 'news_cluster'])

  const registeredChartKinds = readFileSync(join(BLOCKS_DIR, 'registerChartBlocks.ts'), 'utf8')
  const registeredEvidenceKinds = readFileSync(join(BLOCKS_DIR, 'registerResearchEvidenceBlocks.ts'), 'utf8')
  for (const block of envelope.blocks) {
    assert.ok(
      registeredChartKinds.includes(`'${block.kind}'`) || registeredEvidenceKinds.includes(`'${block.kind}'`),
      `${block.kind} must be registered in the default BlockRegistry helpers`,
    )
  }
})

test('signals trend blocks carry cache-safe series refs and allowed transforms', () => {
  const envelope = loadSignalsFixture(APPLE_ISSUER_ID)
  const trendBlocks = envelope.blocks.filter(
    (block): block is SentimentTrendBlock | MentionVolumeBlock =>
      block.kind === 'sentiment_trend' || block.kind === 'mention_volume',
  )

  assert.equal(trendBlocks.length, 2)
  for (const block of trendBlocks) {
    assert.ok(Array.isArray(block.data_ref.params?.series_refs))
    assert.ok((block.data_ref.params?.series_refs as unknown[]).length > 0)
    assert.deepEqual(block.interactive?.ranges, ['7D', '30D'])
    assert.deepEqual(block.interactive?.intervals, ['1d'])
    assert.ok(Array.isArray(block.interactive?.allowed_transforms?.series))
    assert.deepEqual(
      block.interactive?.allowed_transforms?.series?.map((transform) => transform.interval),
      ['1d', '1d'],
    )
    assert.equal(block.interactive?.hover_details, true)
  }
})

test('signals news clusters are evidence-bound and do not carry raw social text', () => {
  const envelope = loadSignalsFixture(APPLE_ISSUER_ID)
  const clusters = envelope.blocks.filter(
    (block): block is NewsClusterBlock => block.kind === 'news_cluster',
  )

  assert.ok(clusters.length >= 1)
  for (const block of clusters) {
    assert.ok(block.claim_refs.length > 0)
    assert.ok(block.document_refs.length > 0)
    assert.equal(JSON.stringify(block).includes('representative_claim'), false)
    assert.equal(JSON.stringify(block).includes('raw_text'), false)
  }
})
