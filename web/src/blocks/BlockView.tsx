import { Component, createElement, type ReactElement, type ReactNode } from 'react'
import type { Block } from './types.ts'
import {
  BlockRegistryContext,
  useBlockRegistry,
  type BlockRegistry,
} from './Registry.ts'
import { extractInspectableRefs } from '../evidence/inspectableRefs.ts'
import type { EvidenceBlockInspection } from '../evidence/inspectionTypes.ts'
import { useEvidenceInspector } from '../evidence/useEvidenceInspector.ts'
import { BlockProofContext, proofLabels, proofRows, type BlockProof } from './blockProof.ts'
import { VerificationLabel } from './VerificationLabel.tsx'
import { humanize } from '../evidence/readable.ts'
import type { VerificationKind } from './verification.ts'

type BlockRegistryProviderProps = {
  registry: BlockRegistry
  children: ReactNode
}

export function BlockRegistryProvider({ registry, children }: BlockRegistryProviderProps): ReactElement {
  return <BlockRegistryContext.Provider value={registry}>{children}</BlockRegistryContext.Provider>
}

// `verification` overrides the kind's own label, e.g. for an answer that failed verification.
// `proof` is the server-derived claim set for this block (#193); with it, the
// label says what is actually established, not the kind's default.
type BlockViewProps = { block: Block; verification?: VerificationKind; proof?: BlockProof }

export function BlockView(props: BlockViewProps): ReactElement {
  return (
    <BlockErrorBoundary key={props.block.id} block={props.block}>
      <RegisteredBlockView {...props} />
    </BlockErrorBoundary>
  )
}

type BoundaryState = { failed: boolean; block: Block }

class BlockErrorBoundary extends Component<{ block: Block; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false, block: this.props.block }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  // A new copy of the block (a later history load, a corrected stream) gets a
  // fresh attempt; the same block keeps its failure.
  static getDerivedStateFromProps(props: { block: Block }, state: BoundaryState): BoundaryState | null {
    return props.block === state.block ? null : { failed: false, block: props.block }
  }

  componentDidCatch(error: unknown): void {
    console.error(`Block ${this.props.block.id} (${this.props.block.kind}) failed to render`, error)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div
        data-testid="block-render-failed"
        data-block-id={this.props.block.id}
        data-block-kind={this.props.block.kind}
        className="rounded border border-dashed border-line-strong px-2 py-1 text-xs text-muted"
      >
        This part of the answer couldn't be displayed.
      </div>
    )
  }
}

// Dispatches a block to its registered renderer. If no renderer is
// registered for the kind (e.g., a sibling-bead kind hasn't shipped yet),
// renders an unobtrusive placeholder so a snapshot still surfaces the
// gap to a reviewer instead of silently dropping content.
function RegisteredBlockView({ block, verification: verificationOverride, proof }: BlockViewProps): ReactElement {
  const registry = useBlockRegistry()
  const inspector = useEvidenceInspector()
  const renderer = registry.resolve(block.kind)
  if (renderer === undefined) {
    return (
      <div
        data-testid={`block-unknown-${block.id}`}
        data-block-kind={block.kind}
        className="rounded border border-dashed border-line-strong px-2 py-1 text-xs text-muted"
      >
        Unsupported block kind: {block.kind}
      </div>
    )
  }
  // Registry returns an existing component reference; createElement
  // sidesteps the react-hooks/static-components heuristic that treats
  // capitalized JSX identifiers as locally-declared components.
  const content = createElement(renderer, { block })
  // With a server proof, every claim-bearing block shows what it establishes
  // (proofLabels); without one, the kind's default label (if any) stands.
  const declared = verificationOverride ?? registry.verification(block)
  const labels: VerificationKind[] = proof && !verificationOverride ? proofLabels(proof, block.kind) : declared === null ? [] : [declared]
  // The label sits on the block itself, so neighbouring blocks never borrow each other's status.
  const labelled = labels.length === 0 ? content : (
    <div className="flex flex-col items-start gap-1" data-block-verification={labels.join(' ')}>
      <div className="flex flex-wrap gap-1">
        {labels.map((kind) => <VerificationLabel key={kind} kind={kind} />)}
      </div>
      <div className="w-full">{content}</div>
    </div>
  )
  // Every block sets its own proof, or none: a nested block (a section's child)
  // never reads its parent's.
  const rendered = <BlockProofContext.Provider value={proof ?? null}>{labelled}</BlockProofContext.Provider>
  if (inspector === null) return rendered
  return (
    <div className="group relative" data-testid={`block-shell-${block.id}`}>
      <button
        type="button"
        aria-label="Inspect block metadata"
        data-testid={`block-${block.id}-metadata`}
        onClick={() => inspector.openBlockInspection(blockInspectionFromBlock(block, proof))}
        className="absolute right-0 top-0 z-10 hidden h-6 w-6 items-center justify-center rounded border border-line-strong bg-surface text-xs font-semibold text-muted shadow-sm group-hover:flex focus:flex"
      >
        i
      </button>
      {rendered}
    </div>
  )
}

function blockInspectionFromBlock(block: Block, proof: BlockProof | undefined): EvidenceBlockInspection {
  const relatedRefs = extractInspectableRefs(block).map(({ ref }) => ref)
  return {
    snapshot_id: block.snapshot_id,
    block_id: block.id,
    block_kind: block.kind,
    title: blockTitle(block),
    subtitle: null,
    badges: [],
    rows: [
      { label: 'Block id', value: block.id },
      { label: 'Kind', value: humanize(block.kind) },
      { label: 'Snapshot', value: block.snapshot_id },
      { label: 'As of', value: block.as_of },
      { label: 'Data ref', value: data_ref_label(block.data_ref) },
      // Each claim on its own: a sealed snapshot is not a verified calculation,
      // and stored-by-cutoff is not public-by-cutoff.
      ...proofRows(proof),
    ],
    related_refs: relatedRefs,
  }
}

function blockTitle(block: Block): string {
  return typeof block.title === 'string' && block.title.trim() !== '' ? block.title : humanize(block.kind)
}

function data_ref_label(data_ref: Block['data_ref']): string {
  return `${data_ref.kind}:${data_ref.id}`
}
