import assert from 'node:assert/strict'
import test from 'node:test'
import { validateBlock } from './BlockValidator.ts'
import { ALL_BLOCK_FIXTURES, richTextFixture, sourcesFixture } from './fixtures.ts'

test('validateBlock accepts every canonical fixture', () => {
  for (const block of ALL_BLOCK_FIXTURES) {
    const result = validateBlock(block)
    if (!result.valid) {
      assert.fail(`fixture ${block.kind} failed validation:\n${JSON.stringify(result.errors, null, 2)}`)
    }
  }
})

test('validateBlock accepts analyst commentary citing an engine result, and no other ref kind', () => {
  const commentary = {
    ...richTextFixture,
    analyst_commentary: true,
    segments: [{ type: 'ref', ref_kind: 'result', ref_id: '91111111-1111-4111-9111-111111111111', format: '46.21%', period: 'FY2023' }],
  }
  assert.deepEqual(validateBlock(commentary), { valid: true, block: commentary })
  assert.equal(validateBlock({ ...commentary, segments: [{ ...commentary.segments[0], ref_kind: 'calculation' }] }).valid, false)
})

test('validateBlock rejects a block missing the kind discriminator', () => {
  const block: Record<string, unknown> = { ...richTextFixture }
  delete block.kind
  const result = validateBlock(block)
  assert.equal(result.valid, false)
})

test('validateBlock rejects a block with an unknown kind', () => {
  const result = validateBlock({ ...richTextFixture, kind: 'not_a_real_block_kind' })
  assert.equal(result.valid, false)
})

test('validateBlock rejects a block missing a required BaseBlock field', () => {
  const block: Record<string, unknown> = { ...richTextFixture }
  delete block.data_ref
  const result = validateBlock(block)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.ok(
      result.errors.some((e) => e.keyword === 'required' && e.message?.includes('data_ref')),
      `expected a "required" error mentioning data_ref; got ${JSON.stringify(result.errors)}`,
    )
  }
})

test('validateBlock rejects a block with a wrongly-typed field', () => {
  const result = validateBlock({ ...richTextFixture, id: 12345 })
  assert.equal(result.valid, false)
})

test('validateBlock rejects a block with a non-UUID snapshot_id', () => {
  const result = validateBlock({ ...richTextFixture, snapshot_id: 'not-a-uuid' })
  assert.equal(result.valid, false)
})

test('validateBlock rejects a structurally invalid UUID snapshot_id', () => {
  const result = validateBlock({ ...richTextFixture, snapshot_id: '------------------------------------' })
  assert.equal(result.valid, false)
})

test('validateBlock rejects sources URLs with unsafe schemes', () => {
  const [source] = sourcesFixture.items
  assert.ok(source, 'expected sources fixture to include at least one item')
  const result = validateBlock({
    ...sourcesFixture,
    items: [{ ...source, url: 'javascript:alert(1)' }],
  })
  assert.equal(result.valid, false)
})

test('validateBlock rejects a block with an unevaluated extra property', () => {
  const result = validateBlock({ ...richTextFixture, totally_made_up_field: 'oops' })
  assert.equal(result.valid, false)
})

test('validateBlock rejects a block whose kind-specific required field is missing', () => {
  const block: Record<string, unknown> = { ...richTextFixture }
  delete block.segments
  const result = validateBlock(block)
  assert.equal(result.valid, false)
})

test('validateBlock rejects entirely malformed input (string, number, null)', () => {
  for (const garbage of ['not a block', 42, null, undefined, []]) {
    const result = validateBlock(garbage)
    assert.equal(result.valid, false, `expected ${JSON.stringify(garbage)} to fail validation`)
  }
})

test('validateBlock accepts a series ref segment and rejects an unknown ref kind', () => {
  const withKind = (ref_kind: string) => ({
    ...richTextFixture,
    segments: [{ type: 'ref', ref_kind, ref_id: '33333333-3333-4333-8333-333333333333', format: '6.6%' }],
  })
  assert.deepEqual([validateBlock(withKind('series')).valid, validateBlock(withKind('chart')).valid], [true, false])
})
