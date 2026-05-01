import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import blockSchema from './blockSchema.json' with { type: 'json' }
import {
  CHART_COMPARISON_BLOCK_KINDS,
  NARRATIVE_LAYOUT_BLOCK_KINDS,
  RESEARCH_EVIDENCE_BLOCK_KINDS,
  TRUST_PROVENANCE_BLOCK_KINDS,
} from './types.ts'

// Drift-checks the catalog by static text scan of the register*Blocks.ts
// helpers because node:test's --experimental-strip-types cannot load the .tsx
// renderers those helpers import.

const BLOCKS_DIR = dirname(fileURLToPath(import.meta.url))

const ALL_CATALOG_KINDS = [
  ...NARRATIVE_LAYOUT_BLOCK_KINDS,
  ...CHART_COMPARISON_BLOCK_KINDS,
  ...RESEARCH_EVIDENCE_BLOCK_KINDS,
  ...TRUST_PROVENANCE_BLOCK_KINDS,
]

type BlockSchemaShape = {
  $defs: Record<string, { allOf?: Array<{ properties?: { kind?: { const?: string } } }> }> & {
    Block: { oneOf: Array<{ $ref: string }> }
  }
}

function schemaBlockKinds(): string[] {
  const schema = blockSchema as unknown as BlockSchemaShape
  return schema.$defs.Block.oneOf.map((entry) => {
    const defName = entry.$ref.replace('#/$defs/', '')
    const def = schema.$defs[defName]
    const kindBranch = def.allOf?.find((branch) => branch.properties?.kind?.const !== undefined)
    const kind = kindBranch?.properties?.kind?.const
    if (kind === undefined) {
      throw new Error(`schema $defs.${defName}: kind.const not found in allOf branches`)
    }
    return kind
  })
}

function extractRegisteredKinds(filename: string): string[] {
  const source = readFileSync(join(BLOCKS_DIR, filename), 'utf-8')
  return Array.from(source.matchAll(/registry\.register\(\s*["']([a-z_]+)["']/g)).map((m) => m[1])
}

test('typed kind-group constants match the canonical schema enum exactly', () => {
  assert.deepEqual(
    [...ALL_CATALOG_KINDS].sort(),
    schemaBlockKinds().sort(),
    'typed kind groups in types.ts must equal the schema enum — schema/types drift',
  )
})

test('each register*Blocks helper covers exactly the kinds in its typed group', () => {
  const cases: Array<{ filename: string; expected: readonly string[]; label: string }> = [
    { filename: 'registerNarrativeBlocks.ts', expected: NARRATIVE_LAYOUT_BLOCK_KINDS, label: 'narrative' },
    { filename: 'registerChartBlocks.ts', expected: CHART_COMPARISON_BLOCK_KINDS, label: 'chart' },
    {
      filename: 'registerResearchEvidenceBlocks.ts',
      expected: RESEARCH_EVIDENCE_BLOCK_KINDS,
      label: 'research_evidence',
    },
    {
      filename: 'registerTrustProvenanceBlocks.ts',
      expected: TRUST_PROVENANCE_BLOCK_KINDS,
      label: 'trust_provenance',
    },
  ]

  for (const { filename, expected, label } of cases) {
    const found = extractRegisteredKinds(filename)
    // Fail loud if the regex matches nothing — silent zero-match would still
    // pass deepEqual against an empty group, masking a register-syntax change.
    assert.ok(found.length > 0, `${filename}: extractRegisteredKinds matched zero kinds — regex out of sync with helper syntax`)
    assert.deepEqual(
      found.slice().sort(),
      [...expected].sort(),
      `${filename} (${label}) must register exactly its typed-group kinds — kind constant / register helper drift`,
    )
  }
})

test('defaultBlockRegistry composer invokes every register*Blocks helper', () => {
  const composer = readFileSync(join(BLOCKS_DIR, 'defaultBlockRegistry.ts'), 'utf-8')
  for (const helper of [
    'registerNarrativeBlockRenderers',
    'registerChartBlockRenderers',
    'registerResearchEvidenceBlockRenderers',
    'registerTrustProvenanceBlockRenderers',
  ]) {
    assert.ok(
      composer.includes(`${helper}(registry)`),
      `defaultBlockRegistry.ts must invoke ${helper}(registry) — composer/helper drift`,
    )
  }
})
