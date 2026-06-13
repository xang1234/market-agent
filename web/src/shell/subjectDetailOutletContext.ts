import { useOutletContext } from 'react-router-dom'
import type { ResolvedSubject, RouteResolvedSubject } from '../symbol/search.ts'
import type { QuoteSnapshot } from '../symbol/quote.ts'

export type SubjectDetailOutletContext = {
  subject: ResolvedSubject | RouteResolvedSubject
  // The shell's single subject quote (null when unavailable/loading), shared
  // with section content so the key-stats grid reads the authoritative prev
  // close / currency instead of re-fetching or approximating from bars.
  quote: QuoteSnapshot | null
}

export function useSubjectDetailContext(): SubjectDetailOutletContext {
  return useOutletContext<SubjectDetailOutletContext>()
}
