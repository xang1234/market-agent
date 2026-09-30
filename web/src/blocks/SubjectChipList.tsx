import type { ReactElement } from 'react'
import type { SubjectRef } from './types.ts'
import { formatSubjectRefShort } from './subjectRef.ts'

type SubjectChipListProps = {
  testId: string
  keyPrefix: string
  subjects: ReadonlyArray<SubjectRef>
  // Display label per subject, in subjects order; falls back to the reference.
  labels?: ReadonlyArray<string>
  dense?: boolean
}

export function SubjectChipList({
  testId,
  keyPrefix,
  subjects,
  labels,
  dense = false,
}: SubjectChipListProps): ReactElement {
  return (
    <ul
      data-testid={testId}
      className={`flex list-none flex-wrap p-0 text-xs ${dense ? 'gap-1' : 'gap-2'}`}
    >
      {subjects.map((subject, index) => (
        <li
          key={`${keyPrefix}-${subject.kind}-${subject.id}`}
          data-subject-kind={subject.kind}
          data-subject-id={subject.id}
          className="rounded-md bg-surface-2 px-2 py-0.5 text-muted"
        >
          {labels?.[index] ?? formatSubjectRefShort(subject)}
        </li>
      ))}
    </ul>
  )
}
