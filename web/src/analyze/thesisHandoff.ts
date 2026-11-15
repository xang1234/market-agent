import type { AnalyzeRunDetail } from './runHistory.ts'
import { readResearchHandoff, type DiscoveryResearchHandoff } from '../discovery/handoff.ts'
import { isSubjectRef, type SubjectRef } from '../subject/subjectRef.ts'
import { refSegmentText } from '../blocks/richText.ts'
import type { RefSegment } from '../blocks/types.ts'
import { THESIS_TEXT_MAX } from '../../../services/agents/src/thesis-types.ts'

export type AnalyzeThesisHandoff = {
  sourceRunId: string
  subjectRef: SubjectRef & { kind: 'issuer' | 'instrument' | 'listing' }
  thesis: string
  name: string
}

export type ThesisHandoff =
  | ({ kind: 'analyze' } & AnalyzeThesisHandoff)
  | DiscoveryResearchHandoff

export const NO_THESIS_SECTION = 'This memo has no investment thesis section to monitor.'

/** Analyze offers the memo's thesis section to monitor, or a note that it has none. */
export type AnalyzeThesisOffer =
  | { kind: 'handoff'; handoff: AnalyzeThesisHandoff }
  | { kind: 'no_thesis'; note: typeof NO_THESIS_SECTION }

export function analyzeThesisHandoff(run: AnalyzeRunDetail): AnalyzeThesisOffer | null {
  const metadata = run.run_metadata
  if (!isRecord(metadata) || !Array.isArray(metadata.subject_refs) || metadata.subject_refs.length !== 1) {
    return null
  }
  const [subjectRef] = metadata.subject_refs
  if (!isMonitorableSubject(subjectRef)) return null

  const thesis = clip(thesisSectionText(run))
  if (thesis === '') return { kind: 'no_thesis', note: NO_THESIS_SECTION }
  return { kind: 'handoff', handoff: { sourceRunId: run.run_id, subjectRef, thesis, name: `${run.display_title} monitor` } }
}

export function readAnalyzeThesisHandoff(state: unknown): AnalyzeThesisHandoff | null {
  if (!isRecord(state) || !isRecord(state.thesisHandoff)) return null
  const handoff = state.thesisHandoff
  if (
    typeof handoff.sourceRunId !== 'string'
    || typeof handoff.thesis !== 'string'
    || typeof handoff.name !== 'string'
    || !isMonitorableSubject(handoff.subjectRef)
  ) {
    return null
  }
  return {
    sourceRunId: handoff.sourceRunId,
    subjectRef: handoff.subjectRef,
    thesis: handoff.thesis,
    name: handoff.name,
  }
}

export function readThesisHandoff(state: unknown): ThesisHandoff | null {
  const discovery = readResearchHandoff(state)
  if (discovery) return discovery
  const analyze = readAnalyzeThesisHandoff(state)
  return analyze ? { kind: 'analyze', ...analyze } : null
}

// A memo's thesis section is a section block of its paragraphs, or, in a v1 memo, the rich text blocks it tags.
function thesisSectionText(run: AnalyzeRunDetail): string {
  return run.blocks
    .filter((block) => isRecord(block.data_ref) && isRecord(block.data_ref.params) && block.data_ref.params.playbook_section_id === 'investment_thesis')
    .flatMap((block) => (block.kind === 'section' ? (Array.isArray(block.children) ? block.children : []) : [block]))
    .map(paragraphText)
    .filter(Boolean)
    .join('\n\n')
}

// Commentary reads as its checked parts, verified inferences and then figures. Unverified and pending inferences stay out.
function paragraphText(block: unknown): string {
  if (!isRecord(block)) return ''
  if (Array.isArray(block.commentary)) {
    const parts = block.commentary.filter(isRecord)
    return [
      ...parts.flatMap((part) => (part.kind === 'inference' && typeof part.text === 'string' ? [typeof part.subject === 'string' ? `${part.subject}: ${part.text}` : part.text] : [])),
      ...parts.flatMap((part) => (part.kind === 'figures' && Array.isArray(part.segments) ? [segmentsText(part.segments)] : [])),
    ].map((text) => text.trim()).filter(Boolean).join('\n\n')
  }
  if (block.analyst_commentary === true || !Array.isArray(block.segments)) return ''
  return segmentsText(block.segments)
}

function segmentsText(segments: ReadonlyArray<unknown>): string {
  return segments.map((segment) => {
    if (!isRecord(segment)) return ''
    if (segment.type === 'text') return typeof segment.text === 'string' ? segment.text : ''
    return segment.type === 'ref' && typeof segment.ref_kind === 'string' && typeof segment.ref_id === 'string'
      ? refSegmentText(segment as RefSegment)
      : ''
  }).join('').trim()
}

// Whole code points, up to the saved limit, which counts UTF-16 units.
function clip(text: string): string {
  let clipped = ''
  for (const point of text) {
    if (clipped.length + point.length > THESIS_TEXT_MAX) break
    clipped += point
  }
  return clipped.trimEnd()
}

function isMonitorableSubject(value: unknown): value is AnalyzeThesisHandoff['subjectRef'] {
  return isSubjectRef(value)
    && (value.kind === 'issuer' || value.kind === 'instrument' || value.kind === 'listing')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
