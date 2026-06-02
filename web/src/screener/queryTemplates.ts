// Starter screens — one-click presets that seed the workspace draft. Each is a
// full ScreenerQuery built only from fields the workspace renders (so the
// reverse projection queryToDraft restores every clause into the form). A
// clicked template flows through the same queryToDraft → runSearch path as
// reopening a saved screen, so there is no preset-specific code path to drift.
//
// Fields are deliberately limited to what the result roster carries: there is
// no dividend-yield field in the registry today, so the third slot is a
// large-cap sector screen rather than the prototype's "High dividend."

import type { ScreenerQuery } from './contracts.ts'

export type QueryTemplate = {
  name: string
  description: string
  query: ScreenerQuery
}

export const QUERY_TEMPLATES: ReadonlyArray<QueryTemplate> = [
  {
    name: 'Momentum breakouts',
    description: 'Liquid names up ≥2% on the day, strongest first',
    query: {
      universe: [],
      market: [{ field: 'change_pct', min: 0.02 }],
      fundamentals: [],
      sort: [{ field: 'change_pct', direction: 'desc' }],
      page: { limit: 50 },
    },
  },
  {
    name: 'Oversold quality',
    description: 'Profitable names that pulled back ≥2%',
    query: {
      universe: [],
      market: [{ field: 'change_pct', max: -0.02 }],
      fundamentals: [{ field: 'net_margin', min: 0 }],
      sort: [{ field: 'change_pct', direction: 'asc' }],
      page: { limit: 50 },
    },
  },
  {
    name: 'Large-cap tech',
    description: 'Technology issuers by market cap',
    query: {
      universe: [{ field: 'sector', values: ['Technology'] }],
      market: [],
      fundamentals: [],
      sort: [{ field: 'market_cap', direction: 'desc' }],
      page: { limit: 50 },
    },
  },
]
