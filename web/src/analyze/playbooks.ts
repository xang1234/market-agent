import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'
import playbookCatalog from '../../../spec/commodities_analyze_playbooks.json' with { type: 'json' }
import {
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
  type AnalyzePlaybook,
  type AnalyzePlaybookSection,
} from '../../../spec/commodities_analyze_catalog.ts'

export {
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
  type AnalyzePlaybook,
  type AnalyzePlaybookSection,
}

export const DEFAULT_ANALYZE_PLAYBOOKS: ReadonlyArray<AnalyzePlaybook> = parseAnalyzePlaybookCatalog(playbookCatalog)

export async function fetchAnalyzePlaybooks(input: {
  userId: string
  fetchImpl?: FetchImpl
}): Promise<ReadonlyArray<AnalyzePlaybook>> {
  const body = await authenticatedJson<{ playbooks: AnalyzePlaybook[] }>('/v1/analyze/playbooks', {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  })
  return body.playbooks
}
