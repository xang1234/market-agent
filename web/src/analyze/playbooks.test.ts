import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_ANALYZE_PLAYBOOKS,
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
} from './playbooks.ts'

test('DEFAULT_ANALYZE_PLAYBOOKS exposes the full commodities catalog from the shared spec', () => {
  assert.deepEqual(
    DEFAULT_ANALYZE_PLAYBOOKS.map((playbook) => playbook.playbook_id),
    [
      'daily_copper_call',
      'daily_iron_ore_call',
      'report_change_digest',
      'supply_shock_readout',
      'china_demand_watch',
      'curve_spread_explanation',
      'forecast_vs_market_review',
    ],
  )
  assert.equal(
    DEFAULT_ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === 'daily_copper_call')
      ?.sections.find((section) => section.section_id === 'watch_items')?.block_hint,
    'watch_item_table',
  )
})

test('parseAnalyzePlaybookCatalog rejects malformed catalog data before UI state trusts it', () => {
  const valid = DEFAULT_ANALYZE_PLAYBOOKS[0]
  assert.ok(valid)

  assert.throws(
    () => parseAnalyzePlaybookCatalog([{ ...valid, default_source_categories: ['prices', 'filings'] }]),
    AnalyzePlaybookCatalogError,
  )
  assert.throws(
    () => parseAnalyzePlaybookCatalog([{ ...valid, sections: [{ ...valid.sections[0], block_hint: 'markdown' }] }]),
    AnalyzePlaybookCatalogError,
  )
})
