import { useMemo } from 'react'
import {
  BlockRegistryProvider,
  BlockView,
  createDefaultBlockRegistry,
} from '../../blocks/index.ts'
import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import { loadSignalsFixture } from '../../symbol/signals.ts'

const PLACEHOLDER_CLASS = 'text-sm text-neutral-500 dark:text-neutral-400'

export function SignalsSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)
  const envelope = useMemo(
    () => (issuerId === null ? null : loadSignalsFixture(issuerId)),
    [issuerId],
  )
  const registry = useMemo(() => createDefaultBlockRegistry(), [])

  if (envelope === null) {
    return (
      <div data-testid="section-signals" className="flex w-full flex-col gap-6 p-8">
        <p className={PLACEHOLDER_CLASS}>
          Issuer context unavailable for this entry. Open this symbol from search to load signals.
        </p>
      </div>
    )
  }

  return (
    <BlockRegistryProvider registry={registry}>
      <div data-testid="section-signals" className="flex w-full flex-col gap-4 p-8">
        {envelope.blocks.map((block) => (
          <BlockView key={block.id} block={block} />
        ))}
        <p className={`${PLACEHOLDER_CLASS} px-1`} data-testid="signals-provenance-note">
          Source-agnostic surface: community, news, and filing-derived evidence compose shared
          blocks. Mentions and sentiment are evidence-backed signals, not raw social feeds.
        </p>
      </div>
    </BlockRegistryProvider>
  )
}
