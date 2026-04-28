import { createElement, type ReactElement, type ReactNode } from 'react'
import type { Block } from './types.ts'
import {
  BlockRegistryContext,
  useBlockRegistry,
  type BlockRegistry,
} from './Registry.ts'
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
  return createElement(renderer, { block })
}
