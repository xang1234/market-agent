import type { CampaignEvent } from '../../../services/discovery/src/types.ts'
import { learningForEvent } from './learning.ts'

export function ResearchTrail({
  events,
  hasMore = false,
  onLoadMore,
}: {
  events: ReadonlyArray<CampaignEvent>
  hasMore?: boolean
  onLoadMore?: () => void
}) {
  if (events.length === 0) {
    return <div className="mt-2 space-y-2"><p className="text-sm text-muted">Recorded activity will appear here as research progresses.</p>{hasMore && onLoadMore ? <button type="button" onClick={onLoadMore} className="text-sm font-medium text-accent underline">Load more recorded activity</button> : null}</div>
  }
  const groups = groupEvents(events)
  return <div className="mt-3 space-y-4">{groups.map((group) => (
    <section key={group.label} aria-label={group.label}>
      <h3 className="text-xs font-semibold uppercase text-muted">{group.label}</h3>
      <ol className="mt-2 space-y-2">{group.events.map((event) => {
        const learning = learningForEvent(event)
        return <li key={event.sequence} className="rounded-md bg-surface-2 p-2 text-sm text-muted">
          <p className="text-fg">{event.summary}</p>
          {learning ? <><p className="mt-1 text-xs font-medium text-fg-soft">{learning.title}</p><p className="mt-1 text-xs">{learning.explanation}</p></> : null}
        </li>
      })}</ol>
    </section>
  ))}{hasMore && onLoadMore ? <button type="button" onClick={onLoadMore} className="text-sm font-medium text-accent underline">Load more recorded activity</button> : null}</div>
}

function groupEvents(events: ReadonlyArray<CampaignEvent>): Array<{ label: string; events: CampaignEvent[] }> {
  const groups = new Map<string, CampaignEvent[]>()
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const label = `${stageLabel(event.stage)} · ${roleForEvent(event.kind)}`
    groups.set(label, [...(groups.get(label) ?? []), event])
  }
  return [...groups.entries()].map(([label, groupedEvents]) => ({ label, events: groupedEvents }))
}

function stageLabel(stage: CampaignEvent['stage']): string {
  return `${stage.slice(0, 1).toUpperCase()}${stage.slice(1)}`
}

function roleForEvent(kind: CampaignEvent['kind']): string {
  return ({
    lead_resolved: 'Planner',
    search_completed: 'Scout',
    document_acquired: 'Researcher',
    criterion_assessed: 'Analyst',
    skeptic_completed: 'Skeptic',
    budget_exhausted: 'Resource control',
    run_resumed: 'Checkpoint',
    run_finalized: 'Run record',
  } as const)[kind]
}
