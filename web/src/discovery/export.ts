import type { CandidateView, RunView, SourceView } from '../../../services/discovery/src/types.ts'

export type CampaignMarkdownView = {
  run: RunView
  candidates: ReadonlyArray<CandidateView>
}

export function formatCampaignMarkdown(view: CampaignMarkdownView): string {
  const candidates = uniqueCandidates([...view.run.shortlist, ...view.candidates])
    .filter((candidate) => candidate.state === 'shortlisted')
    .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name))

  const lines = [
    '# Research shortlist',
    '',
    `Run: ${view.run.run_id}`,
    `Campaign: ${view.run.campaign_id}`,
    `Status: ${view.run.status}`,
    '',
    '## Research boundaries',
    `- Research limit: ${view.run.limits.research}`,
    `- Candidate limit: ${view.run.limits.candidates}`,
    `- Shortlist limit: ${view.run.limits.shortlist}`,
    `- Completed research items: ${view.run.coverage.assessed}`,
    '',
    '## Rank policy:',
    '- Ranks reflect the current saved-brief shortlist order after the recorded assessment process.',
    '- A rank is research context only; this export does not provide a trading instruction.',
    '',
    '## Shortlist',
  ]

  if (candidates.length === 0) {
    lines.push('- No companies are currently shortlisted.')
  } else {
    for (const candidate of candidates) appendCandidate(lines, candidate)
  }

  lines.push('', '## Data gaps')
  if (view.run.coverage.gaps.length === 0) {
    lines.push('- No run-level data gaps were recorded.')
  } else {
    for (const gap of view.run.coverage.gaps) {
      const candidate = gap.candidate_id ? candidates.find((item) => item.candidate_id === gap.candidate_id) : null
      lines.push(`- ${gap.code}${candidate ? ` (${escapeMarkdown(candidate.name)})` : ''}: ${escapeMarkdown(gap.detail)}`)
    }
  }

  return lines.join('\n')
}

function appendCandidate(lines: string[], candidate: CandidateView): void {
  const rank = candidate.rank === null ? 'Unranked' : `#${candidate.rank}`
  lines.push('', `### ${rank} ${escapeMarkdown(candidate.name)}`)
  if (candidate.identity) {
    lines.push(`- Listing: ${escapeMarkdown(candidate.identity.ticker)} · ${escapeMarkdown(candidate.identity.mic)}`)
  }
  const valuation = candidate.assessment?.dimensions.valuation_context
  lines.push(`- Valuation context: ${valuation?.level ?? 'unknown'}`)
  if (!candidate.evidence_available) {
    lines.push('- Evidence details are no longer available and are not included in this export.')
    return
  }
  if (candidate.assessment) {
    for (const [label, dimension] of Object.entries(candidate.assessment.dimensions)) {
      lines.push(`- ${humanize(label)}: ${dimension.level} — ${escapeMarkdown(dimension.explanation)}`)
    }
  }
  appendSources(lines, candidate.sources)
}

function appendSources(lines: string[], sources: ReadonlyArray<SourceView>): void {
  lines.push('- Sources:')
  const visibleSources = sources.filter((source) => isHttpsUrl(source.url))
  if (visibleSources.length === 0) {
    lines.push('  - No currently available cited sources.')
    return
  }
  for (const source of visibleSources) {
    lines.push(`  - ${escapeMarkdown(source.title)} — ${source.url}`)
    lines.push(`    - Evidence date: ${dateLabel(source.published_at ?? source.retrieved_at)}`)
  }
}

function uniqueCandidates(candidates: CandidateView[]): CandidateView[] {
  return [...new Map(candidates.map((candidate) => [candidate.candidate_id, candidate])).values()]
}

function dateLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10)
}

function humanize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).replaceAll('_', ' ')}`
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]<>]/g, '\\$&')
}
