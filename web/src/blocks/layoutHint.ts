import { STREAMING_DATA_REF_KIND, type Block, type SectionBlock } from './types.ts'

// BlockLayoutHint: template-supplied advice on how to organize a memo's
// Block[] into sections. Stored as `analyze_templates.block_layout_hint`
// (jsonb, nullable). Read by applyBlockLayoutHint to wrap incoming blocks
// in SectionBlocks per the declared structure.
//
// "Advisory, not enforced" (per fra-i7z bead): unknown block_ids in the
// hint silently drop empty sections, and blocks not claimed by any
// section appear in a trailing __residual__ section so they can't be
// silently lost.
export type BlockLayoutHint = {
  sections: ReadonlyArray<BlockLayoutHintSection>
}

export type BlockLayoutHintSection = {
  // Hint-side identifier; becomes the SectionBlock id as `section:${id}`
  // so synthetic sections never collide with upstream block ids on React
  // keys.
  id: string
  title?: string
  // Block ids to claim from the input pool. First-claim-wins across the
  // entire hint tree (depth-first), so a block listed in two sections
  // ends up in the first one declared.
  block_ids?: ReadonlyArray<string>
  // Optional sub-sections. Walked depth-first.
  children?: ReadonlyArray<BlockLayoutHintSection>
  // Default-collapsed affordance. Threaded through to SectionBlock so
  // Section.tsx renders the expand/collapse toggle.
  collapsible?: boolean
}

export class BlockLayoutHintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockLayoutHintError'
  }
}

const RESIDUAL_SECTION_ID = '__residual__'

export function parseBlockLayoutHint(value: unknown): BlockLayoutHint | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BlockLayoutHintError('block_layout_hint: must be an object with a sections array')
  }
  const raw = value as { sections?: unknown }
  if (!Array.isArray(raw.sections)) {
    throw new BlockLayoutHintError('block_layout_hint.sections: must be an array')
  }
  return Object.freeze({
    sections: Object.freeze(parseSections(raw.sections, 'sections')),
  })
}

function parseSections(value: unknown[], path: string): ReadonlyArray<BlockLayoutHintSection> {
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const label = `${path}[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BlockLayoutHintError(`${label}: must be an object`)
    }
    const raw = entry as Partial<BlockLayoutHintSection> & { children?: unknown; block_ids?: unknown }
    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      throw new BlockLayoutHintError(`${label}.id: must be a non-empty string`)
    }
    if (seen.has(raw.id)) {
      throw new BlockLayoutHintError(`${label}: duplicate section id "${raw.id}" at the same level`)
    }
    seen.add(raw.id)
    if (raw.title !== undefined && typeof raw.title !== 'string') {
      throw new BlockLayoutHintError(`${label}.title: must be a string when provided`)
    }
    if (raw.collapsible !== undefined && typeof raw.collapsible !== 'boolean') {
      throw new BlockLayoutHintError(`${label}.collapsible: must be a boolean when provided`)
    }
    let block_ids: ReadonlyArray<string> | undefined
    if (raw.block_ids !== undefined) {
      if (!Array.isArray(raw.block_ids)) {
        throw new BlockLayoutHintError(`${label}.block_ids: must be an array of strings`)
      }
      block_ids = Object.freeze(
        raw.block_ids.map((bid, bi) => {
          if (typeof bid !== 'string' || bid.length === 0) {
            throw new BlockLayoutHintError(`${label}.block_ids[${bi}]: must be a non-empty string`)
          }
          return bid
        }),
      )
    }
    let children: ReadonlyArray<BlockLayoutHintSection> | undefined
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children)) {
        throw new BlockLayoutHintError(`${label}.children: must be an array of sections`)
      }
      children = Object.freeze(parseSections(raw.children, `${label}.children`))
    }
    return Object.freeze({
      id: raw.id,
      ...(raw.title !== undefined ? { title: raw.title } : {}),
      ...(block_ids !== undefined ? { block_ids } : {}),
      ...(children !== undefined ? { children } : {}),
      ...(raw.collapsible !== undefined ? { collapsible: raw.collapsible } : {}),
    })
  })
}

type ApplyBlockLayoutHintInput = {
  blocks: ReadonlyArray<Block>
  hint: BlockLayoutHint | null
  snapshot_id: string
  as_of: string
}

export function applyBlockLayoutHint(input: ApplyBlockLayoutHintInput): ReadonlyArray<Block> {
  if (input.hint === null) {
    // No hint = pass-through. Don't synthesize any sections.
    return input.blocks
  }

  // Mutable index of remaining blocks keyed by id; sections claim from
  // here and the residual fallback collects whatever is left in original
  // declaration order.
  const remainingIds = new Set(input.blocks.map((b) => b.id))
  const blocksById = new Map(input.blocks.map((b) => [b.id, b]))

  const topSections = input.hint.sections
    .map((section) => buildSection(section, remainingIds, blocksById, input.snapshot_id, input.as_of))
    .filter((section): section is SectionBlock => section !== null)

  // Residual: any blocks the hint walk did not claim, in original order.
  const residual = input.blocks.filter((b) => remainingIds.has(b.id))
  if (residual.length === 0) return Object.freeze(topSections)
  const residualSection = synthesizeSection(
    RESIDUAL_SECTION_ID,
    undefined,
    residual,
    input.snapshot_id,
    input.as_of,
    undefined,
  )
  return Object.freeze([...topSections, residualSection])
}

function buildSection(
  hint: BlockLayoutHintSection,
  remainingIds: Set<string>,
  blocksById: ReadonlyMap<string, Block>,
  snapshotId: string,
  asOf: string,
): SectionBlock | null {
  // Claim own blocks first (depth-first, parent-before-children for the
  // claim, but children appear after parent's own blocks in the rendered
  // output — see test "...nests child sections under a parent section").
  const ownChildren: Block[] = []
  for (const blockId of hint.block_ids ?? []) {
    if (!remainingIds.has(blockId)) continue
    const block = blocksById.get(blockId)
    if (block === undefined) continue
    remainingIds.delete(blockId)
    ownChildren.push(block)
  }

  // Then walk child sections; each may claim from the still-remaining pool.
  const childSections = (hint.children ?? [])
    .map((child) => buildSection(child, remainingIds, blocksById, snapshotId, asOf))
    .filter((s): s is SectionBlock => s !== null)

  // Drop empty sections — advisory contract: a section with nothing to
  // render shouldn't surface an empty heading to the reader.
  if (ownChildren.length === 0 && childSections.length === 0) return null

  return synthesizeSection(
    hint.id,
    hint.title,
    [...ownChildren, ...childSections],
    snapshotId,
    asOf,
    hint.collapsible,
  )
}

function synthesizeSection(
  hintId: string,
  title: string | undefined,
  children: ReadonlyArray<Block>,
  snapshotId: string,
  asOf: string,
  collapsible: boolean | undefined,
): SectionBlock {
  return Object.freeze({
    id: `section:${hintId}`,
    kind: 'section' as const,
    snapshot_id: snapshotId,
    // Sections are layout containers, not data anchors; mark with the
    // streaming sentinel so the manifest resolver doesn't try to resolve
    // refs against a non-existent data row. Same convention as
    // STREAMING_DATA_REF_KIND for in-flight chat blocks.
    data_ref: { kind: STREAMING_DATA_REF_KIND, id: `section:${hintId}` },
    source_refs: dedupeSourceRefs(children),
    as_of: asOf,
    ...(title !== undefined ? { title } : {}),
    children: Object.freeze([...children]),
    ...(collapsible !== undefined ? { collapsible } : {}),
  }) as SectionBlock
}

function dedupeSourceRefs(children: ReadonlyArray<Block>): ReadonlyArray<string> {
  // Union of descendant source_refs preserving first-seen order so the
  // section header's source list is deterministic across re-runs.
  // Recurses into SectionBlocks so a deep nest still bubbles up to the
  // top.
  const seen = new Set<string>()
  const out: string[] = []
  function visit(block: Block): void {
    for (const ref of block.source_refs) {
      if (seen.has(ref)) continue
      seen.add(ref)
      out.push(ref)
    }
    if (block.kind === 'section') {
      for (const child of (block as SectionBlock).children) visit(child)
    }
  }
  children.forEach(visit)
  return Object.freeze(out)
}
