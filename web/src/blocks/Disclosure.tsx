import type { ReactElement } from 'react'
import type { DisclosureBlock } from './types.ts'
import { Badge } from './Badge.tsx'
import { ChartCard } from './ChartCard.tsx'
import { disclosureTierBadgeClass, disclosureTierLabel } from './disclosureTier.ts'
import { readableText } from '../evidence/readable.ts'

type DisclosureProps = { block: DisclosureBlock }

export function Disclosure({ block }: DisclosureProps): ReactElement {
  const tier = block.disclosure_tier
  return (
    <ChartCard
      testId={`block-disclosure-${block.id}`}
      blockKind="disclosure"
      title={block.title}
      dataAttrs={tier ? { 'data-tier': tier } : undefined}
    >
      {tier ? (
        <Badge
          testId={`block-disclosure-${block.id}-tier`}
          toneClass={disclosureTierBadgeClass(tier)}
          layoutClass="inline-block self-start"
        >
          {disclosureTierLabel(tier)}
        </Badge>
      ) : null}
      <ul className="flex list-none flex-col gap-1 p-0 text-xs text-fg-soft">
        {block.items.map((item, index) => {
          // Sealed items carry the exact stamp; a midnight-UTC cutoff reads as its date.
          const shown = readableText(item, { storedDate: true })
          return (
            <li
              key={`${block.id}-item-${index}`}
              data-testid={`block-disclosure-${block.id}-item-${index}`}
              title={shown === item ? undefined : item}
            >
              {shown}
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
