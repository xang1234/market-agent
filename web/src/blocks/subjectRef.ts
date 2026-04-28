import type { SubjectRef } from './types.ts'

export function formatSubjectRefShort(subject: SubjectRef): string {
  return `${subject.kind}:${subject.id.slice(0, 8)}`
}
