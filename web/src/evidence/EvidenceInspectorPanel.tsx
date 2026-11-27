import { useEffect, useRef } from 'react'

import { FinancialResultInspector } from '../blocks/renderers/FinancialResultInspector.tsx'
import { financialHeading } from '../blocks/financialInspection.ts'
import type { FigureDerivation, FigureOperand, FigureSegment, SourceRef } from '../blocks/types.ts'
import { Skeleton } from '../ui/Skeleton.tsx'
import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from './evidenceInspectorContext.ts'
import type {
  EvidenceBlockInspection,
  EvidenceInspection,
  EvidenceInspectionRefKind,
  EvidenceInspectionRelatedRef,
  EvidenceInspectionRow,
} from './inspectionTypes.ts'
import type { InspectorPage, InspectorStack } from './inspectorStack.ts'
import { InspectableRef } from './InspectableRef.tsx'
import { sourceLabel, sourceText } from '../blocks/richText.ts'
import { SourceLink } from './SourceLink.tsx'
import { Details, Facts, ReadableValue } from './Readable.tsx'
import { humanize, isIdentifier, readableDate } from './readable.ts'

const REF_KIND_NAMES: Readonly<Record<EvidenceInspectionRefKind, string>> = {
  source: 'Source',
  document: 'Document',
  claim: 'Claim',
  event: 'Event',
  fact: 'Fact',
  series: 'Price series',
}

// Row labels the server and block metadata use for a page's point in time,
// in the order the header prefers them, with the word the header shows.
const DATE_ROWS: ReadonlyArray<readonly [label: string, shown: string]> = [
  ['As of', 'As of'],
  ['Published', 'Published'],
  ['Effective time', 'Effective'],
  ['Occurred', 'Occurred'],
  ['Retrieved', 'Retrieved'],
]

const LINK_CLASS = 'text-accent-ink underline underline-offset-2'

const DERIVATION_NAMES: Readonly<Record<FigureDerivation, string>> = {
  margin: 'Margin',
  growth: 'Growth',
  difference: 'Difference',
  ratio: 'Ratio',
  share_of_total: 'Share of total',
  sum: 'Sum',
}

// Each operand's part in its derivation, in the order chat's labeller gives them
// (services/chat/src/checked-prose.ts): margin [profit, revenue], growth [earlier, later]...
const OPERAND_ROLES: Readonly<Record<Exclude<FigureDerivation, 'sum'>, readonly [string, string]>> = {
  margin: ['Profit', 'Revenue'],
  share_of_total: ['Part', 'Total'],
  growth: ['From', 'To'],
  difference: ['From', 'Less'],
  ratio: ['Numerator', 'Denominator'],
}
const operandRole = (derivation: FigureDerivation, count: number, index: number) =>
  derivation === 'sum' ? 'Add' : count === 2 ? OPERAND_ROLES[derivation][index]! : `Operand ${index + 1}`
// The sources a figure's operands read, or null when it has none to read them by.
const operandSources = (figure: FigureSegment) =>
  figure.derivation && figure.operands ? new Set(figure.operands.flatMap((operand) => [...operand.add, ...operand.subtract, ...(operand.over ?? [])])) : null

/**
 * The inspector docked beside the main column. It shows the top page of the
 * stack; Back and the breadcrumb step down it. Refs opened from inside the
 * panel go through `inspector`, which pushes rather than replaces.
 */
export function EvidenceInspectorPanel({
  stack,
  inspector,
  onBack,
  onClose,
}: {
  stack: InspectorStack
  inspector: EvidenceInspectorContextValue
  onBack(to?: number): void
  onClose(): void
}) {
  const page = stack[stack.length - 1]
  const headingRef = useRef<HTMLHeadingElement>(null)
  const pageKey = page.kind === 'block' ? page.inspection : page.kind === 'figure' ? page.figure : page.request

  useEffect(() => {
    headingRef.current?.focus()
  }, [stack.length, pageKey])

  return (
    <aside
      aria-label={page.kind === 'financial' ? 'Verified calculation inspector' : 'Evidence inspector'}
      className="flex h-full w-[420px] max-w-full shrink-0 flex-col border-l border-line bg-surface"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex items-center gap-3">
          {stack.length > 1 ? (
            <button
              type="button"
              onClick={() => onBack()}
              className="rounded-md border border-line-strong px-2 py-1 text-xs text-fg hover:bg-surface-2"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs text-fg hover:bg-surface-2"
          >
            Close
          </button>
        </div>
        {stack.length > 1 ? (
          <nav aria-label="Inspector pages">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
              {stack.map((crumb, index) => (
                <li key={index} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {index === stack.length - 1 ? (
                    <span aria-current="page" className="max-w-40 truncate text-fg">{pageTitle(crumb)}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBack(index)}
                      className={`max-w-40 truncate ${LINK_CLASS}`}
                    >
                      {pageTitle(crumb)}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="break-words text-sm font-semibold text-fg focus:outline-none">
            {pageTitle(page)}
          </h2>
          <p className="mt-1 text-xs text-muted">{pageSubtitle(page)}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <EvidenceInspectorContext.Provider value={inspector}>
          <PageBody page={page} />
        </EvidenceInspectorContext.Provider>
      </div>
    </aside>
  )
}

function PageBody({ page }: { page: InspectorPage }) {
  if (page.kind === 'financial') {
    return <FinancialResultInspector load={page.load} shown={page.shown} />
  }
  if (page.kind === 'block') return <BlockInspectionBody inspection={page.inspection} />
  if (page.kind === 'figure') return <FigureSources snapshotId={page.snapshotId} figure={page.figure} />
  if (page.load.kind === 'loading') return <Skeleton label="Loading evidence" className="h-40" />
  if (page.load.kind === 'error') return <p className="text-sm text-fg-soft">{page.load.message}</p>
  return <InspectionBody inspection={page.load.inspection} />
}

function pageTitle(page: InspectorPage): string {
  if (page.kind === 'financial') return heading(page).title
  if (page.kind === 'block') return page.inspection.title
  if (page.kind === 'figure') return page.figure.text
  if (page.shownAs) return page.shownAs
  return page.load.kind === 'ready' ? page.load.inspection.title : REF_KIND_NAMES[page.ref.kind]
}

function pageSubtitle(page: InspectorPage): string {
  if (page.kind === 'financial') return heading(page).subtitle
  if (page.kind === 'block') return joinParts(['Block', datePart(page.inspection.rows)])
  if (page.kind === 'figure') {
    const used = operandSources(page.figure)
    const count = (n: number) => `${n} source${n === 1 ? '' : 's'}`
    return used && page.figure.derivation ? `${DERIVATION_NAMES[page.figure.derivation]}, computed from ${count(used.size)}` : `Cites ${count(page.figure.sources.length)}`
  }
  if (page.load.kind !== 'ready') return REF_KIND_NAMES[page.ref.kind]
  const { inspection } = page.load
  const provider = inspection.rows.find((row) => row.label === 'Provider')?.value ??
    inspection.related_refs.find((ref) => ref.kind === 'source')?.label ??
    null
  return joinParts([REF_KIND_NAMES[inspection.kind], provider, datePart(inspection.rows)])
}

function heading(page: Extract<InspectorPage, { kind: 'financial' }>) {
  return financialHeading(page.shown, page.load.kind === 'ready' ? page.load.inspection : null)
}

function datePart(rows: ReadonlyArray<EvidenceInspectionRow>): string | null {
  for (const [label, shown] of DATE_ROWS) {
    const row = rows.find((candidate) => candidate.label === label)
    if (row && row.value !== 'Unknown') return `${shown} ${shortDate(row.value)}`
  }
  return null
}

// The day the body's Timestamp falls on, so the header and the row agree.
function shortDate(value: string): string {
  return readableDate(value, { day: true })
}

function joinParts(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(' · ')
}

// A computed figure's operands in the order its derivation reads them, each source in its
// part (added, subtracted, divided by) and opening its own page; then any source no operand
// reads, as a citation.
function FigureSources({ snapshotId, figure }: { snapshotId: string; figure: FigureSegment }) {
  const used = operandSources(figure)
  const link = (index: number) => {
    const source: SourceRef | undefined = figure.sources[index]
    if (!source) return <span key={index}>a missing source</span>
    return <SourceLink key={index} snapshotId={snapshotId} source={source} text={sourceText(source)}>{sourceLabel(source)}</SourceLink>
  }
  const terms = (indexes: ReadonlyArray<number>, wrap: boolean) => {
    const joined = indexes.flatMap((index, k) => (k === 0 ? [link(index)] : [' + ', link(index)]))
    return wrap && indexes.length > 1 ? ['(', ...joined, ')'] : joined
  }
  const operandText = (operand: FigureOperand) => {
    const top = [...terms(operand.add, false), ...operand.subtract.flatMap((index) => [' − ', link(index)])]
    if (operand.over === null) return top
    return [...(operand.add.length + operand.subtract.length > 1 ? ['(', ...top, ')'] : top), ' ÷ ', ...terms(operand.over, true)]
  }
  const cited = figure.sources.flatMap((_, index) => (used?.has(index) ? [] : [index]))
  return (
    <div className="flex flex-col gap-4 text-sm">
      {used && figure.derivation && figure.operands ? (
        <ol aria-label="Calculation" className="flex flex-col gap-2">
          {figure.operands.map((operand, index) => (
            <li key={index}>
              <span className="text-muted">{operandRole(figure.derivation!, figure.operands!.length, index)}</span> {operandText(operand)}
            </li>
          ))}
        </ol>
      ) : null}
      {cited.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{used ? 'Also cited' : 'Sources'}</h3>
          <ul aria-label={used ? 'Also cited' : 'Sources'} className="flex flex-col gap-2">
            {cited.map((index) => <li key={index}>{link(index)}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function InspectionBody({ inspection }: { inspection: EvidenceInspection }) {
  return <PageSections {...inspection} />
}

function BlockInspectionBody({ inspection }: { inspection: EvidenceBlockInspection }) {
  return <PageSections {...inspection} links={[]} />
}

// Every evidence and block page reads the same way: what it is, where to open
// it, its facts in words, what it relates to, and identifiers under Details.
function PageSections({ subtitle, badges, rows, links, snapshot_id, related_refs }: {
  subtitle: string | null
  badges: ReadonlyArray<string>
  rows: ReadonlyArray<EvidenceInspectionRow>
  links: EvidenceInspection['links']
  snapshot_id: string
  related_refs: ReadonlyArray<EvidenceInspectionRelatedRef>
}) {
  const linked = links.some((link) => link.href === subtitle)
  const subtitleIsId = subtitle !== null && !linked && isIdentifier(subtitle)
  const shownSubtitle = subtitle !== null && !linked && !subtitleIsId ? subtitle : null
  const facts = rows.filter((row) => !isIdentifier(row.value))
  const ids = rows.filter((row) => isIdentifier(row.value))
  return (
    <div className="flex flex-col gap-5">
      {shownSubtitle || badges.length > 0 ? (
        <section className="flex flex-col gap-2">
          {shownSubtitle ? <p className="min-w-0 break-words text-sm text-fg-soft"><ReadableValue value={shownSubtitle} label="the subtitle" /></p> : null}
          <Badges badges={badges} />
        </section>
      ) : null}
      {links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                title={link.href}
                className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line-strong px-3 py-2 hover:bg-surface-2"
              >
                <span className="shrink-0 text-sm font-medium text-accent-ink">{link.label} <span aria-hidden="true">↗</span></span>
                <span className="min-w-0 truncate text-xs text-muted">{link.href.replace(/^https?:\/\//u, '')}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {facts.length > 0 ? <Facts rows={facts.map((row) => [row.label, <ReadableValue value={row.value} label={row.label} />] as const)} /> : null}
      <RelatedRefs snapshotId={snapshot_id} refs={related_refs} />
      {ids.length > 0 || subtitleIsId ? (
        <Details>
          <Facts rows={[
            ...ids.map((row) => [row.label, <ReadableValue value={row.value} label={row.label} />] as const),
            ...(subtitleIsId && !rows.some((row) => row.value === subtitle) ? [['Reference', <ReadableValue value={subtitle} label="the reference" />] as const] : []),
          ]} />
        </Details>
      ) : null}
    </div>
  )
}

function Badges({ badges }: { badges: ReadonlyArray<string> }) {
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span key={badge} className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-soft">
          {humanize(badge)}
        </span>
      ))}
    </div>
  )
}

function RelatedRefs({ snapshotId, refs }: { snapshotId: string; refs: ReadonlyArray<EvidenceInspectionRelatedRef> }) {
  if (refs.length === 0) return null
  const labels = relatedRefLabels(refs)
  return (
    <section className="grid gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Related</h3>
      <ul className="flex flex-col gap-2">
        {refs.map((ref, index) => (
          <li key={`${ref.kind}:${ref.id}`}>
            <InspectableRef
              snapshotId={snapshotId}
              inspectionRef={{ kind: ref.kind, id: ref.id }}
              className={`break-words text-left text-sm font-medium decoration-dotted ${LINK_CLASS}`}
            >
              {labels[index]}
            </InspectableRef>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Unlabeled refs fall back to their kind's name, numbered when several of
// one kind would otherwise read the same.
function relatedRefLabels(refs: ReadonlyArray<EvidenceInspectionRelatedRef>): ReadonlyArray<string> {
  const unlabeled = new Map<EvidenceInspectionRefKind, number>()
  for (const ref of refs) if (!ref.label) unlabeled.set(ref.kind, (unlabeled.get(ref.kind) ?? 0) + 1)
  const seen = new Map<EvidenceInspectionRefKind, number>()
  return refs.map((ref) => {
    if (ref.label) return ref.label
    const name = REF_KIND_NAMES[ref.kind]
    if (unlabeled.get(ref.kind) === 1) return name
    const ordinal = (seen.get(ref.kind) ?? 0) + 1
    seen.set(ref.kind, ordinal)
    return `${name} ${ordinal}`
  })
}
