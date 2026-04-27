import { useOutletContext } from 'react-router-dom'
import type { ResolvedSubject } from '../symbol/search.ts'

export type SubjectDetailOutletContext = {
  subject: ResolvedSubject
}

export function useSubjectDetailContext(): SubjectDetailOutletContext {
  return useOutletContext<SubjectDetailOutletContext>()
}
