import { useOutletContext } from 'react-router-dom'
import type { ResolvedSubject, RouteResolvedSubject } from '../symbol/search.ts'

export type SubjectDetailOutletContext = {
  subject: ResolvedSubject | RouteResolvedSubject
}

export function useSubjectDetailContext(): SubjectDetailOutletContext {
  return useOutletContext<SubjectDetailOutletContext>()
}
