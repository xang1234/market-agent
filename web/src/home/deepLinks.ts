import { analyzePathForSubject } from '../analyze/analyzeEntry.ts'
import { subjectRouteParam, type SubjectRef } from '../symbol/search.ts'

export const HOME_SYMBOL_TABS = [
  'overview',
  'financials',
  'earnings',
  'holders',
  'signals',
] as const
export type HomeSymbolTab = (typeof HOME_SYMBOL_TABS)[number]

export const HOME_ANALYZE_INTENTS = ['memo', 'compare', 'general'] as const
export type HomeAnalyzeIntent = (typeof HOME_ANALYZE_INTENTS)[number]

export type HomeCardDestination =
  | {
      kind: 'symbol'
      subject_ref: SubjectRef
      tab: HomeSymbolTab
    }
  | {
      kind: 'theme'
      subject_ref: SubjectRef & { kind: 'theme' }
    }
  | {
      kind: 'analyze'
      subject_ref: SubjectRef
      intent: HomeAnalyzeIntent
    }
  | {
      kind: 'none'
      reason: string
    }

export function homeCardPath(destination: HomeCardDestination): string | null {
  if (destination.kind === 'symbol') {
    return `/symbol/${subjectRouteParam(destination.subject_ref)}/${destination.tab}`
  }

  if (destination.kind === 'analyze') {
    return analyzePathForSubject(destination.subject_ref, destination.intent)
  }

  return null
}
