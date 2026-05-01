import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHART_COMPARISON_BLOCK_KINDS,
  NARRATIVE_LAYOUT_BLOCK_KINDS,
  RESEARCH_EVIDENCE_BLOCK_KINDS,
  TRUST_PROVENANCE_BLOCK_KINDS,
} from '../blocks/types.ts'
import { SKELETON_HEIGHT_BY_KIND } from './blockSkeletonHeights.ts'

test('SKELETON_HEIGHT_BY_KIND covers every catalog kind so the default-height fallback never silently masks a missing entry', () => {
  const catalogKinds = [
    ...NARRATIVE_LAYOUT_BLOCK_KINDS,
    ...CHART_COMPARISON_BLOCK_KINDS,
    ...RESEARCH_EVIDENCE_BLOCK_KINDS,
    ...TRUST_PROVENANCE_BLOCK_KINDS,
  ]
  const missing = catalogKinds.filter((kind) => !(kind in SKELETON_HEIGHT_BY_KIND))
  assert.deepEqual(
    missing,
    [],
    `catalog kinds missing a per-kind skeleton height: ${missing.join(', ')}`,
  )
})
