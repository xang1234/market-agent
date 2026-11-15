import type { AnalyzeRunDetail } from './runHistory.ts'
import { readResearchHandoff, type DiscoveryResearchHandoff } from '../discovery/handoff.ts'
import { isSubjectRef, type SubjectRef } from '../subject/subjectRef.ts'

export type AnalyzeThesisHandoff = {
  sourceRunId: string
  subjectRef: SubjectRef & { kind: 'issuer' | 'instrument' | 'listing' }
  thesis: string
  name: string
}

export type ThesisHandoff =
  | ({ kind: 'analyze' } & AnalyzeThesisHandoff)
  | DiscoveryResearchHandoff

export function analyzeThesisHandoff(run: AnalyzeRunDetail): AnalyzeThesisHandoff | null {
  const metadata = run.run_metadata
  if (!isRecord(metadata) || !Array.isArray(metadata.subject_refs) || metadata.subject_refs.length !== 1) {
    return null
  }
  const [subjectRef] = metadata.subject_refs
  if (!isMonitorableSubject(subjectRef)) return null

  return {
    sourceRunId: run.run_id,
    subjectRef,
    thesis: (thesisSectionText(run) ?? memoText(run)).slice(0, 4000),
    name: `${run.display_title} monitor`,
  }
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

function thesisSectionText(run: AnalyzeRunDetail): string | null {
  const section = run.blocks.find((block) => isRecord(block) && block.kind === 'section' && isRecord(block.data_ref)
    && isRecord(block.data_ref.params) && block.data_ref.params.playbook_section_id === 'investment_thesis')
  if (!isRecord(section) || !Array.isArray(section.children)) return null
  const paragraphs = section.children.map(paragraphText).filter(Boolean)
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : null
}

// A ref reads as the value or quote it shows; one with neither is left out, with the space it leaves.
function paragraphText(block: unknown): string {
  if (!isRecord(block) || !Array.isArray(block.segments)) return ''
  return block.segments.map((segment) => {
    const text = isRecord(segment) ? (segment.type === 'text' ? segment.text : segment.format) : null
    return typeof text === 'string' ? text : ''
  }).join('').replace(/ {2,}/g, ' ').trim()
}

function memoText(run: AnalyzeRunDetail): string {
  const parts = run.blocks.flatMap(blockText).map((part) => part.trim()).filter(Boolean)
  if (parts.length > 0) return parts.join('\n\n')
  const instructions = isRecord(run.run_metadata) ? run.run_metadata.instructions : null
  return typeof instructions === 'string' ? instructions.trim() : ''
}

function blockText(value: unknown): string[] {
  if (!isRecord(value)) return []
  const parts: string[] = []
  if (Array.isArray(value.segments)) {
    parts.push(...value.segments.flatMap((segment) => {
      if (isRecord(segment) && segment.type === 'text' && typeof segment.text === 'string') {
        return [segment.text]
      }
      return []
    }))
  }
  if (Array.isArray(value.children)) parts.push(...value.children.flatMap(blockText))
  return parts
}

function isMonitorableSubject(value: unknown): value is AnalyzeThesisHandoff['subjectRef'] {
  return isSubjectRef(value)
    && (value.kind === 'issuer' || value.kind === 'instrument' || value.kind === 'listing')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
