import type { Block } from '../blocks/types.ts'
import type { EvidenceInspectionRef } from './inspectionTypes.ts'

export type InspectableBlockRef = {
  snapshotId: string
  ref: EvidenceInspectionRef
}

export type InspectableBlockInput = Block | Readonly<Record<string, unknown>>

export function extractInspectableRefs(block: InspectableBlockInput): ReadonlyArray<InspectableBlockRef> {
  const refs: InspectableBlockRef[] = []
  collectBlockRefs(block as Record<string, unknown>, refs)
  return dedupeInspectableRefs(refs)
}

// Keep this aligned with services/snapshot/src/snapshot-verifier.ts extractBlockRefs.
function collectBlockRefs(block: Record<string, unknown>, refs: InspectableBlockRef[]): void {
  const snapshotId = stringValue(block.snapshot_id)
  const push = (kind: EvidenceInspectionRef['kind'], id: unknown) => {
    const value = stringValue(id)
    if (snapshotId !== null && value !== null) {
      refs.push({ snapshotId, ref: { kind, id: value } })
    }
  }

  pushArrayRefs(block, 'source_refs', 'source', push)
  pushArrayRefs(block, 'claim_refs', 'claim', push)
  pushArrayRefs(block, 'event_refs', 'event', push)
  pushArrayRefs(block, 'document_refs', 'document', push)
  pushArrayRefs(block, 'fact_refs', 'fact', push)

  if (block.kind === 'section') {
    for (const child of arrayValue(block.children)) {
      if (isRecord(child)) collectBlockRefs(child, refs)
    }
  }

  if (block.kind === 'rich_text') {
    for (const segment of arrayValue(block.segments)) {
      if (isRecord(segment) && segment.type === 'ref' && isInspectionKind(segment.ref_kind)) {
        push(segment.ref_kind, segment.ref_id)
      }
    }
  }

  if (block.kind === 'metric_row') {
    for (const item of arrayValue(block.items)) {
      if (!isRecord(item)) continue
      push('fact', item.value_ref)
      push('fact', item.delta_ref)
    }
  }

  if (block.kind === 'revenue_bars') {
    for (const bar of arrayValue(block.bars)) {
      if (!isRecord(bar)) continue
      push('fact', bar.value_ref)
      push('fact', bar.delta_ref)
    }
  }

  if (block.kind === 'segment_donut') {
    for (const segment of arrayValue(block.segments)) {
      if (isRecord(segment)) push('fact', segment.value_ref)
    }
  }

  if (block.kind === 'metrics_comparison') {
    for (const row of arrayValue(block.cells)) {
      for (const cell of arrayValue(row)) {
        // null = a gap cell; only a present cell carries a fact ref.
        if (isRecord(cell)) push('fact', cell.value_ref)
      }
    }
  }

  if (block.kind === 'analyst_consensus') {
    push('fact', block.analyst_count_ref)
    for (const item of arrayValue(block.distribution)) {
      if (isRecord(item)) push('fact', item.count_ref)
    }
  }

  if (block.kind === 'price_target_range') {
    push('fact', block.current_price_ref)
    push('fact', block.low_ref)
    push('fact', block.avg_ref)
    push('fact', block.high_ref)
    push('fact', block.upside_ref)
  }

  if (block.kind === 'eps_surprise') {
    for (const quarter of arrayValue(block.quarters)) {
      if (!isRecord(quarter)) continue
      push('fact', quarter.estimate_ref)
      push('fact', quarter.actual_ref)
      push('fact', quarter.surprise_ref)
    }
  }

  if (block.kind === 'sources') {
    for (const item of arrayValue(block.items)) {
      if (isRecord(item)) push('source', item.source_id)
    }
  }

  if (block.kind === 'news_cluster' || block.kind === 'filings_list') {
    for (const item of arrayValue(block.items)) {
      if (isRecord(item)) push('document', item.document_id)
    }
  }
}

function pushArrayRefs(
  block: Record<string, unknown>,
  key: 'source_refs' | 'fact_refs' | 'claim_refs' | 'event_refs' | 'document_refs',
  kind: EvidenceInspectionRef['kind'],
  push: (kind: EvidenceInspectionRef['kind'], id: unknown) => void,
): void {
  for (const id of arrayValue(block[key])) push(kind, id)
}

function dedupeInspectableRefs(refs: InspectableBlockRef[]): ReadonlyArray<InspectableBlockRef> {
  const seen = new Set<string>()
  return Object.freeze(
    refs.filter(({ snapshotId, ref }) => {
      const key = `${snapshotId}:${ref.kind}:${ref.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  )
}

function arrayValue(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : []
}

function isInspectionKind(value: unknown): value is EvidenceInspectionRef['kind'] {
  return value === 'source' || value === 'document' || value === 'claim' || value === 'event' || value === 'fact'
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
