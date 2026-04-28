import type { ReactElement } from 'react'
import type { DisclosureBlock } from './types.ts'
import { Badge } from './Badge.tsx'
import { ChartCard } from './ChartCard.tsx'
import { disclosureTierBadgeClass, disclosureTierLabel } from './disclosureTier.ts'

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
      <ul className="flex list-none flex-col gap-1 p-0 text-xs text-neutral-700 dark:text-neutral-300">
        {block.items.map((item, index) => (
          <li
            key={`${block.id}-item-${index}`}
            data-testid={`block-disclosure-${block.id}-item-${index}`}
          >
            {item}
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
