import assert from 'node:assert/strict'
import test from 'node:test'

import { commodityBlockDisplayRows } from './commodityBlockModel.ts'
import type { DriverBoardBlock, ImpactMatrixBlock, SpreadTableBlock } from './types.ts'

const BASE = {
  id: 'block-1',
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  data_ref: { kind: 'test', id: 'block-1' },
  source_refs: ['22222222-2222-4222-8222-222222222222'],
  as_of: '2026-05-31T00:00:00.000Z',
}

test('commodityBlockDisplayRows exposes driver-board payload instead of only title text', () => {
  const rows = commodityBlockDisplayRows({
    ...BASE,
    kind: 'driver_board',
    drivers: [
      {
        driver_id: 'driver-1',
        channel: 'supply',
        direction: 'negative',
        horizon: '1w',
        summary: 'Copper concentrate disruption tightens availability.',
        confidence: 0.82,
      },
    ],
  } satisfies DriverBoardBlock)

  assert.deepEqual(rows, [
    ['supply / negative / 1w', 'Copper concentrate disruption tightens availability.', '82%'],
  ])
})

test('commodityBlockDisplayRows exposes spread and impact rows with stable labels', () => {
  assert.deepEqual(
    commodityBlockDisplayRows({
      ...BASE,
      kind: 'spread_table',
      spreads: [{ label: 'Cash / 3M', value: 18.5, currency: 'USD', unit: 't' }],
    } satisfies SpreadTableBlock),
    [['Cash / 3M', '18.5 USD/t']],
  )

  assert.deepEqual(
    commodityBlockDisplayRows({
      ...BASE,
      kind: 'impact_matrix',
      rows: [
        {
          channel: 'inventory',
          direction: 'positive',
          horizon: '1d',
          confidence: 0.91,
          summary: 'LME draw supports prompt spreads.',
        },
      ],
    } satisfies ImpactMatrixBlock),
    [['inventory / positive / 1d', 'LME draw supports prompt spreads.', '91%']],
  )
})
