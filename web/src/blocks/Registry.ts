import { createContext, useContext, type ComponentType } from 'react'
import type { BaseBlock, Block } from './types.ts'
import type { VerificationKind } from './verification.ts'

export type BlockRendererProps<B extends BaseBlock = Block> = { block: B }
export type BlockRenderer<B extends BaseBlock = Block> = ComponentType<BlockRendererProps<B>>

/**
 * How a block kind is labelled wherever it renders: always one kind, or
 * decided per block. Kinds that label themselves (certified financial
 * answers) or carry no figures declare nothing.
 */
export type BlockVerification<B extends BaseBlock = Block> = VerificationKind | ((block: B) => VerificationKind | null)

export type BlockRegistry = {
  register: <B extends BaseBlock>(kind: string, renderer: BlockRenderer<B>, verification?: BlockVerification<B>) => void
  resolve: (kind: string) => BlockRenderer | undefined
  /** The label BlockView shows above this block, if its kind declares one. */
  verification: (block: Block) => VerificationKind | null
  kinds: () => ReadonlyArray<string>
}

export function createBlockRegistry(): BlockRegistry {
  const renderers = new Map<string, BlockRenderer>()
  const verifications = new Map<string, BlockVerification>()
  return {
    register(kind, renderer, verification) {
      renderers.set(kind, renderer as BlockRenderer)
      if (verification === undefined) verifications.delete(kind)
      else verifications.set(kind, verification as BlockVerification)
    },
    resolve(kind) {
      return renderers.get(kind)
    },
    verification(block) {
      const declared = verifications.get(block.kind)
      return typeof declared === 'function' ? declared(block) : declared ?? null
    },
    kinds() {
      return Array.from(renderers.keys())
    },
  }
}

export const BlockRegistryContext = createContext<BlockRegistry | null>(null)

export function useBlockRegistry(): BlockRegistry {
  const registry = useContext(BlockRegistryContext)
  if (registry === null) {
    throw new Error('useBlockRegistry must be used inside <BlockRegistryProvider>')
  }
  return registry
}
