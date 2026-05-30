import { createElement, type ReactElement, type ReactNode } from 'react'
import type { Block } from './types.ts'
import {
  BlockRegistryContext,
  useBlockRegistry,
  type BlockRegistry,
} from './Registry.ts'
import { extractInspectableRefs } from '../evidence/inspectableRefs.ts'
import type { EvidenceBlockInspection } from '../evidence/inspectionTypes.ts'
import { useEvidenceInspector } from '../evidence/useEvidenceInspector.ts'
import type { SnapshotManifest } from './snapshotManifest.ts'
import { SnapshotManifestContext } from './snapshotManifestContext.ts'

type BlockRegistryProviderProps = {
  registry: BlockRegistry
  children: ReactNode
}

export function BlockRegistryProvider({ registry, children }: BlockRegistryProviderProps): ReactElement {
  return <BlockRegistryContext.Provider value={registry}>{children}</BlockRegistryContext.Provider>
}

type SnapshotManifestProviderProps = {
  manifest: SnapshotManifest
  children: ReactNode
}

export function SnapshotManifestProvider({ manifest, children }: SnapshotManifestProviderProps): ReactElement {
  return <SnapshotManifestContext.Provider value={manifest}>{children}</SnapshotManifestContext.Provider>
}

type BlockViewProps = { block: Block }

// Dispatches a block to its registered renderer. If no renderer is
// registered for the kind (e.g., a sibling-bead kind hasn't shipped yet),
// renders an unobtrusive placeholder so a snapshot still surfaces the
// gap to a reviewer instead of silently dropping content.
export function BlockView({ block }: BlockViewProps): ReactElement {
  const registry = useBlockRegistry()
  const inspector = useEvidenceInspector()
  const renderer = registry.resolve(block.kind)
  if (renderer === undefined) {
    return (
      <div
        data-testid={`block-unknown-${block.id}`}
        data-block-kind={block.kind}
        className="rounded border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 dark:border-neutral-700"
      >
        Unsupported block kind: {block.kind}
      </div>
    )
  }
  // Registry returns an existing component reference; createElement
  // sidesteps the react-hooks/static-components heuristic that treats
  // capitalized JSX identifiers as locally-declared components.
  const rendered = createElement(renderer, { block })
  if (inspector === null) return rendered
  return (
    <div className="group relative" data-testid={`block-shell-${block.id}`}>
      <button
        type="button"
        aria-label="Inspect block metadata"
        data-testid={`block-${block.id}-metadata`}
        onClick={() => inspector.openBlockInspection(blockInspectionFromBlock(block))}
        className="absolute right-0 top-0 z-10 hidden h-6 w-6 items-center justify-center rounded border border-neutral-300 bg-white text-xs font-semibold text-neutral-600 shadow-sm group-hover:flex focus:flex dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300"
      >
        i
      </button>
      {rendered}
    </div>
  )
}

function blockInspectionFromBlock(block: Block): EvidenceBlockInspection {
  const relatedRefs = extractInspectableRefs(block).map(({ ref }) => ref)
  return {
    snapshot_id: block.snapshot_id,
    block_id: block.id,
    block_kind: block.kind,
    title: blockTitle(block),
    subtitle: block.snapshot_id,
    badges: [block.kind],
    rows: [
      { label: 'Block id', value: block.id },
      { label: 'Kind', value: block.kind },
      { label: 'Snapshot', value: block.snapshot_id },
      { label: 'As of', value: block.as_of },
      { label: 'Data ref', value: data_ref_label(block.data_ref) },
    ],
    related_refs: relatedRefs,
  }
}

function blockTitle(block: Block): string {
  return typeof block.title === 'string' && block.title.trim() !== '' ? block.title : block.kind
}

function data_ref_label(data_ref: Block['data_ref']): string {
  return `${data_ref.kind}:${data_ref.id}`
}
