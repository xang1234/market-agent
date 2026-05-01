import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BlockLayoutHintError,
  applyBlockLayoutHint,
  parseBlockLayoutHint,
} from './layoutHint.ts'
import { STREAMING_DATA_REF_KIND, type Block, type SectionBlock } from './types.ts'

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'
const AS_OF = '2026-05-01T12:00:00.000Z'

function richText(id: string, text: string, sourceRefs: ReadonlyArray<string> = []): Block {
  return {
    id,
    kind: 'rich_text',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: STREAMING_DATA_REF_KIND, id: `${id}-data` },
    source_refs: sourceRefs,
    as_of: AS_OF,
    segments: [{ type: 'text', text }],
  } as Block
}

function table(id: string, sourceRefs: ReadonlyArray<string> = []): Block {
  return {
    id,
    kind: 'table',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: STREAMING_DATA_REF_KIND, id: `${id}-data` },
    source_refs: sourceRefs,
    as_of: AS_OF,
    columns: ['x'],
    rows: [['1']],
  } as Block
}

// ---------- parseBlockLayoutHint ---------------------------------------

test('parseBlockLayoutHint accepts a minimal valid hint with sections by id', () => {
  const hint = parseBlockLayoutHint({
    sections: [
      { id: 'overview' },
      { id: 'financials', title: 'Financials', block_ids: ['fin-1', 'fin-2'] },
    ],
  })
  assert.ok(hint)
  assert.equal(hint.sections.length, 2)
  assert.equal(hint.sections[0].id, 'overview')
  assert.deepEqual([...(hint.sections[1].block_ids ?? [])], ['fin-1', 'fin-2'])
})

test('parseBlockLayoutHint preserves nested children for sub-sections', () => {
  // Memos in the videos show "Q1 2026 → revenue / margin / mix" patterns
  // — sub-sections inside a top-level section. The hint must round-trip
  // arbitrary depth without flattening.
  const hint = parseBlockLayoutHint({
    sections: [
      {
        id: 'q1',
        title: 'Q1 2026',
        children: [
          { id: 'revenue', block_ids: ['rev-bars'] },
          { id: 'margin', block_ids: ['margin-line'] },
        ],
      },
    ],
  })
  assert.ok(hint)
  assert.equal(hint.sections[0].children?.length, 2)
  assert.equal(hint.sections[0].children?.[0].id, 'revenue')
})

test('parseBlockLayoutHint returns null for a null or undefined input — templates with no hint are valid', () => {
  // analyze_templates.block_layout_hint is nullable in the schema. The
  // parser must surface that as null so callers can branch on "no hint
  // → render flat" without try/catch noise.
  assert.equal(parseBlockLayoutHint(null), null)
  assert.equal(parseBlockLayoutHint(undefined), null)
})

test('parseBlockLayoutHint rejects a non-object payload with BlockLayoutHintError', () => {
  for (const bad of ['nope', 42, true, []]) {
    assert.throws(
      () => parseBlockLayoutHint(bad),
      (err: Error) => err instanceof BlockLayoutHintError && /must be an object/.test(err.message),
      `expected BlockLayoutHintError for ${JSON.stringify(bad)}`,
    )
  }
})

test('parseBlockLayoutHint rejects sections that is not an array', () => {
  assert.throws(
    () => parseBlockLayoutHint({ sections: 'overview' }),
    (err: Error) => err instanceof BlockLayoutHintError && /sections.*array/.test(err.message),
  )
})

test('parseBlockLayoutHint rejects a section without a non-empty id', () => {
  // Section id is the join key for block_ids matching and the SectionBlock
  // id at render time. Empty/missing ids would silently collide on render.
  assert.throws(
    () => parseBlockLayoutHint({ sections: [{ title: 'no id' }] }),
    (err: Error) => err instanceof BlockLayoutHintError && /sections\[0\]\.id/.test(err.message),
  )
  assert.throws(
    () => parseBlockLayoutHint({ sections: [{ id: '' }] }),
    (err: Error) => err instanceof BlockLayoutHintError && /sections\[0\]\.id/.test(err.message),
  )
})

test('parseBlockLayoutHint rejects duplicate section ids at the same level (would silently swallow blocks)', () => {
  // Two sections with the same id at the same level is the kind of typo
  // that would route blocks unpredictably between them. Reject early.
  assert.throws(
    () => parseBlockLayoutHint({ sections: [{ id: 'overview' }, { id: 'overview' }] }),
    (err: Error) => err instanceof BlockLayoutHintError && /duplicate.*overview/i.test(err.message),
  )
})

test('parseBlockLayoutHint rejects block_ids with non-string elements', () => {
  assert.throws(
    () => parseBlockLayoutHint({ sections: [{ id: 'x', block_ids: ['ok', 42] }] }),
    (err: Error) =>
      err instanceof BlockLayoutHintError && /sections\[0\]\.block_ids\[1\]/.test(err.message),
  )
})

// ---------- applyBlockLayoutHint ---------------------------------------

test('applyBlockLayoutHint returns blocks unchanged when the hint is null — no hint = no reshape', () => {
  // The renderer's pass-through path. No hint = no opinion = no synthetic
  // section blocks.
  const blocks = [richText('a', 'A'), richText('b', 'B')]
  const out = applyBlockLayoutHint({
    blocks,
    hint: null,
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 2)
  assert.equal(out[0].id, 'a')
  assert.equal(out[1].id, 'b')
})

test('applyBlockLayoutHint emits one SectionBlock per hint section, in declared order, holding the matching blocks', () => {
  // Headline behavior: hint says "overview then financials"; output must
  // wrap each in a SectionBlock with the right children.
  const blocks = [
    richText('overview-summary', 'overview text'),
    table('fin-table'),
    richText('overview-callout', 'callout'),
  ]
  const hint = {
    sections: [
      { id: 'overview', title: 'Overview', block_ids: ['overview-summary', 'overview-callout'] },
      { id: 'financials', title: 'Financials', block_ids: ['fin-table'] },
    ],
  }
  const out = applyBlockLayoutHint({
    blocks,
    hint: parseBlockLayoutHint(hint),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 2)
  assert.equal(out[0].kind, 'section')
  assert.equal((out[0] as SectionBlock).title, 'Overview')
  assert.deepEqual(
    (out[0] as SectionBlock).children.map((b) => b.id),
    ['overview-summary', 'overview-callout'],
  )
  assert.equal((out[1] as SectionBlock).title, 'Financials')
  assert.deepEqual((out[1] as SectionBlock).children.map((b) => b.id), ['fin-table'])
})

test('applyBlockLayoutHint sets each synthetic SectionBlock id to `section:${hint.id}` for stable React keys', () => {
  // BlockView uses block.id as the React key. Section ids must be stable
  // and unique within a memo so re-renders don't churn the section
  // headings. Prefix scopes them so a hint section and an upstream block
  // can never collide on id.
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A')],
    hint: parseBlockLayoutHint({ sections: [{ id: 'overview', block_ids: ['a'] }] }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out[0].id, 'section:overview')
})

test('applyBlockLayoutHint drops empty sections — hint is advisory, no empty placeholders', () => {
  // Bead contract: "block_layout_hint is advisory, not enforced." A
  // section that references unknown block_ids (e.g. orchestrator output
  // changed shape between runs) should silently drop, not surface an
  // empty heading that confuses the reader.
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A')],
    hint: parseBlockLayoutHint({
      sections: [
        { id: 'present', block_ids: ['a'] },
        { id: 'missing', title: 'Missing', block_ids: ['no-such-block'] },
      ],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 1, 'empty sections must be dropped')
  assert.equal((out[0] as SectionBlock).title, undefined)
})

test('applyBlockLayoutHint appends residual blocks (not claimed by any section) to a trailing fallback section', () => {
  // Blocks exist that no hint section claims — happens when the
  // orchestrator shipped a new block kind the template author hasn't
  // wired in. They must NOT be silently dropped (advisory, not enforced)
  // — they go into a trailing fallback section at the end.
  const out = applyBlockLayoutHint({
    blocks: [
      richText('a', 'A'),
      richText('b', 'B'),
      richText('extra', 'extra'),
    ],
    hint: parseBlockLayoutHint({
      sections: [{ id: 'main', title: 'Main', block_ids: ['a', 'b'] }],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 2)
  assert.equal((out[0] as SectionBlock).title, 'Main')
  assert.equal((out[1] as SectionBlock).id, 'section:__residual__')
  assert.deepEqual(
    (out[1] as SectionBlock).children.map((b) => b.id),
    ['extra'],
  )
})

test('applyBlockLayoutHint omits the residual section when every block was claimed', () => {
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A')],
    hint: parseBlockLayoutHint({ sections: [{ id: 'main', block_ids: ['a'] }] }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 1)
  assert.equal((out[0] as SectionBlock).id, 'section:main')
})

test('applyBlockLayoutHint claims each block by exactly one section — first hint section wins', () => {
  // Without first-claim semantics, a block listed in two sections would
  // appear twice with the same id, breaking React keys and inflating the
  // memo. Pin first-claim wins explicitly.
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A')],
    hint: parseBlockLayoutHint({
      sections: [
        { id: 'first', block_ids: ['a'] },
        { id: 'second', block_ids: ['a'] },
      ],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 1, 'second section is empty after the first claimed the block, so it drops')
  assert.equal((out[0] as SectionBlock).id, 'section:first')
})

test('applyBlockLayoutHint nests child sections under a parent section, ordering by hint declaration', () => {
  // Sub-sections must render inside the parent's children array, in hint
  // order. Critical for "Q1 → revenue / margin" memo shapes.
  const out = applyBlockLayoutHint({
    blocks: [richText('rev', 'r'), richText('marg', 'm'), richText('intro', 'i')],
    hint: parseBlockLayoutHint({
      sections: [
        {
          id: 'q1',
          title: 'Q1 2026',
          block_ids: ['intro'],
          children: [
            { id: 'revenue', title: 'Revenue', block_ids: ['rev'] },
            { id: 'margin', title: 'Margin', block_ids: ['marg'] },
          ],
        },
      ],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 1)
  const q1 = out[0] as SectionBlock
  // The parent's own block_ids come first, then the child sections.
  assert.equal(q1.children.length, 3)
  assert.equal(q1.children[0].id, 'intro')
  assert.equal((q1.children[1] as SectionBlock).id, 'section:revenue')
  assert.equal((q1.children[2] as SectionBlock).id, 'section:margin')
})

test('applyBlockLayoutHint walks the hint depth-first so an earlier section\'s child claims a block before a later sibling section can', () => {
  // The hint is read in declaration order, and "first claim wins" applies
  // across the whole tree (depth-first). A child of section A can grab a
  // block that section B (declared after A) also lists, leaving B empty
  // and dropping it.
  const out = applyBlockLayoutHint({
    blocks: [richText('shared', 's')],
    hint: parseBlockLayoutHint({
      sections: [
        {
          id: 'a',
          children: [{ id: 'a-child', block_ids: ['shared'] }],
        },
        { id: 'b', block_ids: ['shared'] },
      ],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  // Section a's child claims `shared` first; section b is empty and dropped.
  assert.equal(out.length, 1)
  assert.equal((out[0] as SectionBlock).id, 'section:a')
  const aChildren = (out[0] as SectionBlock).children
  assert.equal(aChildren.length, 1)
  assert.equal((aChildren[0] as SectionBlock).id, 'section:a-child')
})

test('applyBlockLayoutHint propagates collapsible from the hint to the SectionBlock', () => {
  // Section.tsx honors `collapsible` to render the expand/collapse
  // affordance. The hint surface must thread it through — otherwise
  // template authors can't request collapsed-by-default sections.
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A')],
    hint: parseBlockLayoutHint({
      sections: [{ id: 'main', collapsible: true, block_ids: ['a'] }],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal((out[0] as SectionBlock).collapsible, true)
})

test('applyBlockLayoutHint synthesizes section source_refs as the union of descendant source_refs (deduped, order preserved)', () => {
  // SectionBlock satisfies BaseBlock; source_refs must be present. The
  // section's own source_refs are the union of its descendants' refs so
  // a Sources block at the top of the memo gets the right anchors. Order
  // tracks first-seen across descendants so deterministic against re-runs.
  const out = applyBlockLayoutHint({
    blocks: [
      richText('a', 'A', ['src-1', 'src-2']),
      richText('b', 'B', ['src-2', 'src-3']),
    ],
    hint: parseBlockLayoutHint({
      sections: [{ id: 'main', block_ids: ['a', 'b'] }],
    }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.deepEqual(
    [...(out[0] as SectionBlock).source_refs],
    ['src-1', 'src-2', 'src-3'],
  )
})

test('applyBlockLayoutHint stamps each synthetic SectionBlock with the run snapshot_id and as_of', () => {
  // SectionBlock satisfies BaseBlock — it must carry the same snapshot_id
  // and as_of as the leaves it wraps. Otherwise the SnapshotManifest
  // resolver can't anchor section-level metadata.
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A')],
    hint: parseBlockLayoutHint({ sections: [{ id: 'main', block_ids: ['a'] }] }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out[0].snapshot_id, SNAPSHOT_ID)
  assert.equal(out[0].as_of, AS_OF)
})

test('applyBlockLayoutHint produces visibly different memos for two different hints applied to the same blocks (fra-i7z headline)', () => {
  // The bead's verification: "Two templates with different layout hints
  // produce visibly different memos." Same source Block[], two distinct
  // hints, and the output Block[] structures must differ in section
  // ordering / nesting.
  const blocks = [
    richText('a', 'A'),
    richText('b', 'B'),
    richText('c', 'C'),
  ]
  const hintA = parseBlockLayoutHint({
    sections: [
      { id: 'top', title: 'Top', block_ids: ['a'] },
      { id: 'bottom', title: 'Bottom', block_ids: ['b', 'c'] },
    ],
  })
  const hintB = parseBlockLayoutHint({
    sections: [{ id: 'all', title: 'All', block_ids: ['c', 'b', 'a'] }],
  })
  const outA = applyBlockLayoutHint({ blocks, hint: hintA, snapshot_id: SNAPSHOT_ID, as_of: AS_OF })
  const outB = applyBlockLayoutHint({ blocks, hint: hintB, snapshot_id: SNAPSHOT_ID, as_of: AS_OF })
  // Number of top-level sections differs.
  assert.notEqual(outA.length, outB.length)
  // Section A has 2 sections; Section B has 1.
  assert.equal(outA.length, 2)
  assert.equal(outB.length, 1)
  // And the order of children inside the single section in B is hint-driven.
  assert.deepEqual((outB[0] as SectionBlock).children.map((b) => b.id), ['c', 'b', 'a'])
})

test('applyBlockLayoutHint with an empty blocks array returns the empty array — no fallback section', () => {
  // No blocks to display → no synthetic content. The fallback section
  // exists only when there are residual blocks to hold; without any input
  // there's nothing to fall back from.
  const out = applyBlockLayoutHint({
    blocks: [],
    hint: parseBlockLayoutHint({ sections: [{ id: 'main', block_ids: ['a'] }] }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 0)
})

test('applyBlockLayoutHint with a hint of zero sections + no fallback eligible blocks returns the empty array', () => {
  // Edge: hint exists but is empty AND blocks is empty → empty output.
  const out = applyBlockLayoutHint({
    blocks: [],
    hint: parseBlockLayoutHint({ sections: [] }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 0)
})

test('applyBlockLayoutHint with a hint of zero sections puts every block into the residual fallback', () => {
  // Hint says "no opinion on sectioning" — every block is residual.
  const out = applyBlockLayoutHint({
    blocks: [richText('a', 'A'), richText('b', 'B')],
    hint: parseBlockLayoutHint({ sections: [] }),
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
  })
  assert.equal(out.length, 1)
  assert.equal((out[0] as SectionBlock).id, 'section:__residual__')
  assert.deepEqual(
    (out[0] as SectionBlock).children.map((b) => b.id),
    ['a', 'b'],
  )
})
