import type { CandidateView, ResearchHandoff, RunView } from '../../../services/discovery/src/types.ts'
import { isUuid } from '../subject/subjectRef.ts'

const MAX_CONDITIONS = 5
const MAX_SUMMARY_LENGTH = 1_000

export type DiscoveryResearchHandoff = ResearchHandoff & {
  trimmedConditions: number
}

export type ResearchSummary = {
  campaignId: string
  runId: string
  candidateId: string
  subjectRef: { kind: 'listing'; id: string }
  summary: string
}

export type AuthorizedResearchView = {
  run: RunView
  candidates: ReadonlyArray<CandidateView>
}

export async function readAuthorizedResearchView(args: {
  userId: string
  campaignId: string
  runId: string
  signal?: AbortSignal
  getRun: (args: { userId: string; runId: string; signal?: AbortSignal }) => Promise<RunView>
  listCandidates: (args: { userId: string; runId: string; signal?: AbortSignal }) => Promise<ReadonlyArray<CandidateView>>
}): Promise<AuthorizedResearchView> {
  const [run, candidates] = await Promise.all([
    args.getRun({ userId: args.userId, runId: args.runId, signal: args.signal }),
    args.listCandidates({ userId: args.userId, runId: args.runId, signal: args.signal }),
  ])
  if (run.run_id !== args.runId || run.campaign_id !== args.campaignId || run.user_id !== args.userId) {
    throw new Error('This research is no longer authorized for the requested campaign.')
  }
  return { run, candidates }
}

export function readResearchHandoff(state: unknown): DiscoveryResearchHandoff | null {
  if (!isRecord(state) || !isRecord(state.researchHandoff)) return null
  const handoff = state.researchHandoff
  if (
    handoff.kind !== 'discovery'
    || !isUuid(handoff.campaignId)
    || !isUuid(handoff.runId)
    || !isUuid(handoff.candidateId)
    || !isThesisSubjectRef(handoff.subjectRef)
    || !nonEmptyString(handoff.name)
    || !nonEmptyString(handoff.thesis)
    || !Array.isArray(handoff.conditions)
  ) return null

  const conditions = handoff.conditions.map(condition).filter((value): value is ResearchHandoff['conditions'][number] => value !== null)
  if (conditions.length !== handoff.conditions.length) return null
  return {
    kind: 'discovery',
    campaignId: handoff.campaignId,
    runId: handoff.runId,
    candidateId: handoff.candidateId,
    subjectRef: handoff.subjectRef,
    name: handoff.name.trim(),
    thesis: handoff.thesis.trim(),
    conditions: conditions.slice(0, MAX_CONDITIONS),
    trimmedConditions: Math.max(0, conditions.length - MAX_CONDITIONS),
  }
}

export function researchHandoffForCandidate(run: RunView, candidate: CandidateView): DiscoveryResearchHandoff | null {
  const summary = researchSummaryForCandidate(run, candidate)
  if (!summary) return null
  return {
    kind: 'discovery',
    campaignId: summary.campaignId,
    runId: summary.runId,
    candidateId: summary.candidateId,
    subjectRef: summary.subjectRef,
    name: `${candidate.name} research monitor`,
    thesis: summary.summary,
    // Financial evidence can be unknown, so discovery never invents a numeric condition.
    conditions: [],
    trimmedConditions: 0,
  }
}

export function researchSummaryForCandidate(run: RunView, candidate: CandidateView): ResearchSummary | null {
  const identity = candidate.identity
  if (!identity || !isUuid(run.campaign_id) || !isUuid(run.run_id) || !isUuid(candidate.candidate_id) || !isUuid(identity.listing_id)) return null

  const sourceTitles = candidate.evidence_available
    ? candidate.sources.filter((source) => isHttpsUrl(source.url)).map((source) => source.title.trim()).filter(Boolean)
    : []
  const valuation = candidate.assessment?.dimensions.valuation_context.level ?? 'unknown'
  const parts = [
    candidate.state === 'shortlisted'
      ? `${candidate.name} was shortlisted in discovery research.`
      : candidate.state === 'eligible_not_shortlisted'
        ? `${candidate.name} was investigated in discovery research.`
        : `${candidate.name} was reviewed in discovery research.`,
    sourceTitles.length > 0 ? `Cited sources: ${sourceTitles.join('; ')}.` : 'Cited source details are unavailable.',
    `Valuation context: ${valuation}.`,
  ]
  if (candidate.assessment?.unresolved_questions[0]) {
    parts.push(`Open research question: ${candidate.assessment.unresolved_questions[0]}`)
  }

  return {
    campaignId: run.campaign_id,
    runId: run.run_id,
    candidateId: candidate.candidate_id,
    subjectRef: { kind: 'listing', id: identity.listing_id },
    summary: parts.join(' ').slice(0, MAX_SUMMARY_LENGTH),
  }
}

function condition(value: unknown): ResearchHandoff['conditions'][number] | null {
  if (!isRecord(value) || !nonEmptyString(value.statement) || !nonEmptyString(value.falsifier) || !nonEmptyString(value.horizon)) return null
  return { statement: value.statement.trim(), falsifier: value.falsifier.trim(), horizon: value.horizon.trim() }
}

function isThesisSubjectRef(value: unknown): value is ResearchHandoff['subjectRef'] {
  return isRecord(value) && (value.kind === 'issuer' || value.kind === 'listing') && isUuid(value.id)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
