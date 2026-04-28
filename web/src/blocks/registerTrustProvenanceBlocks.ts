import type { BlockRegistry } from './Registry.ts'
import { Disclosure } from './Disclosure.tsx'
import { Sources } from './Sources.tsx'

export function registerTrustProvenanceBlockRenderers(registry: BlockRegistry): void {
  registry.register('sources', Sources)
  registry.register('disclosure', Disclosure)
}
