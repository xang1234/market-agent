import { createContext, useContext, type ComponentType } from 'react'
import type { BaseBlock, Block } from './types.ts'

export type BlockRendererProps<B extends BaseBlock = Block> = { block: B }
export type BlockRenderer<B extends BaseBlock = Block> = ComponentType<BlockRendererProps<B>>

export type BlockRegistry = {
  register: <B extends BaseBlock>(kind: string, renderer: BlockRenderer<B>) => void
  resolve: (kind: string) => BlockRenderer | undefined
  kinds: () => ReadonlyArray<string>
}

export function createBlockRegistry(): BlockRegistry {
  const renderers = new Map<string, BlockRenderer>()
  return {
    register(kind, renderer) {
      renderers.set(kind, renderer as BlockRenderer)
    },
    resolve(kind) {
      return renderers.get(kind)
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
