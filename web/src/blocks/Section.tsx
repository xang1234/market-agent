import { useState, type ReactElement } from 'react'
import type { SectionBlock } from './types.ts'
import { BlockView } from './BlockView.tsx'

type SectionProps = { block: SectionBlock }

export function Section({ block }: SectionProps): ReactElement {
  const collapsible = block.collapsible === true || block.interactive?.collapsible === true
  const [isOpen, setIsOpen] = useState(true)
  const showChildren = !collapsible || isOpen

  return (
    <section
      data-testid={`block-section-${block.id}`}
      data-block-kind="section"
      data-collapsed={collapsible && !isOpen ? 'true' : 'false'}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      <SectionHeader
        title={block.title}
        collapsible={collapsible}
        isOpen={isOpen}
        onToggle={() => setIsOpen((prev) => !prev)}
      />
      {showChildren ? (
        <div className="flex flex-col gap-3">
          {block.children.map((child) => (
            <BlockView key={child.id} block={child} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

type SectionHeaderProps = {
  title: string | undefined
  collapsible: boolean
  isOpen: boolean
  onToggle: () => void
}

function SectionHeader({ title, collapsible, isOpen, onToggle }: SectionHeaderProps): ReactElement | null {
  if (!title && !collapsible) return null
  if (collapsible) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex items-center justify-between text-left text-sm font-medium text-fg"
      >
        <span>{title ?? 'Section'}</span>
        <span aria-hidden className="text-faint">{isOpen ? '▾' : '▸'}</span>
      </button>
    )
  }
  return <h4 className="text-sm font-medium text-fg">{title}</h4>
}
