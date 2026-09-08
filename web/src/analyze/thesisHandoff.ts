import type { AnalyzeRunDetail } from './runHistory.ts'
import { isSubjectRef, type SubjectRef } from '../subject/subjectRef.ts'

export type AnalyzeThesisHandoff = {
  sourceRunId: string
  subjectRef: SubjectRef & { kind: 'issuer' | 'instrument' | 'listing' }
  thesis: string
  name: string
}

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
    thesis: memoText(run),
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

function memoText(run: AnalyzeRunDetail): string {
  const parts = run.blocks.flatMap(blockText).map((part) => part.trim()).filter(Boolean)
  if (parts.length > 0) return parts.join('\n\n').slice(0, 4000)
  const instructions = isRecord(run.run_metadata) ? run.run_metadata.instructions : null
  return typeof instructions === 'string' ? instructions.trim().slice(0, 4000) : ''
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
