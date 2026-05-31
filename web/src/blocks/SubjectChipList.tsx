import type { ReactElement } from 'react'
import type { SubjectRef } from './types.ts'
import { formatSubjectRefShort } from './subjectRef.ts'

type SubjectChipListProps = {
  testId: string
  keyPrefix: string
  subjects: ReadonlyArray<SubjectRef>
  dense?: boolean
}

export function SubjectChipList({
  testId,
  keyPrefix,
  subjects,
  dense = false,
}: SubjectChipListProps): ReactElement {
  return (
    <ul
      data-testid={testId}
      className={`flex list-none flex-wrap p-0 text-xs ${dense ? 'gap-1' : 'gap-2'}`}
    >
      {subjects.map((subject) => (
        <li
          key={`${keyPrefix}-${subject.kind}-${subject.id}`}
          data-subject-kind={subject.kind}
          data-subject-id={subject.id}
          className="rounded-md bg-surface-2 px-2 py-0.5 text-muted"
        >
          {formatSubjectRefShort(subject)}
        </li>
      ))}
    </ul>
  )
}
