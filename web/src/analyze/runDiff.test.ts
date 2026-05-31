import assert from 'node:assert/strict'
import test from 'node:test'

import { diffAnalyzeRuns } from './runHistory.ts'

test('diffAnalyzeRuns matches sections by playbook section id before title', () => {
  const diff = diffAnalyzeRuns(
    runDetail({
      runId: 'run-a',
      snapshotId: '11111111-1111-4111-8111-111111111111',
      blocks: [
        block({ id: 'old-summary', title: 'Summary', sectionId: 'summary' }),
        block({ id: 'old-inventory', title: 'Inventory bridge', sectionId: 'inventory_bridge' }),
      ],
    }),
    runDetail({
      runId: 'run-b',
      snapshotId: '22222222-2222-4222-8222-222222222222',
      blocks: [
        block({ id: 'new-summary', title: 'Executive summary', sectionId: 'summary' }),
        block({ id: 'new-watch', kind: 'table', title: 'Watch items', sectionId: 'watch_items' }),
      ],
    }),
  )

  assert.deepEqual(diff.rows.map((row) => `${row.status}:${row.title}`), [
    'changed:Executive summary',
    'added:Watch items',
    'removed:Inventory bridge',
  ])
})

test('diffAnalyzeRuns ignores volatile block identity fields', () => {
  const diff = diffAnalyzeRuns(
    runDetail({
      runId: 'run-a',
      snapshotId: '11111111-1111-4111-8111-111111111111',
      blocks: [
        {
          ...block({ id: 'old-summary', title: 'Summary', sectionId: 'summary' }),
          rich_text: { segments: [{ text: 'Copper inventories fell 9%.', claim_refs: [{ kind: 'claim', id: 'claim-1' }] }] },
          source_refs: [{ kind: 'source', id: 'source-1' }],
        },
      ],
    }),
    runDetail({
      runId: 'run-b',
      snapshotId: '22222222-2222-4222-8222-222222222222',
      blocks: [
        {
          ...block({ id: 'new-summary', title: 'Summary', sectionId: 'summary' }),
          rich_text: { segments: [{ text: 'Copper inventories fell 9%.', claim_refs: [{ kind: 'claim', id: 'claim-1' }] }] },
          source_refs: [{ kind: 'source', id: 'source-1' }],
        },
      ],
    }),
  )

  assert.equal(diff.rows[0]?.status, 'unchanged')
})

test('diffAnalyzeRuns marks rich text content changes as changed', () => {
  const before = runDetail({
    runId: 'run-a',
    snapshotId: '11111111-1111-4111-8111-111111111111',
    blocks: [
      {
        ...block({ id: 'old-summary', title: 'Summary', sectionId: 'summary' }),
        rich_text: { segments: [{ text: 'Copper inventories fell 9%.' }] },
      },
    ],
  })
  const after = runDetail({
    runId: 'run-b',
    snapshotId: '22222222-2222-4222-8222-222222222222',
    blocks: [
      {
        ...block({ id: 'new-summary', title: 'Summary', sectionId: 'summary' }),
        rich_text: { segments: [{ text: 'Copper inventories fell 11%.' }] },
      },
    ],
  })

  assert.equal(diffAnalyzeRuns(before, after).rows[0]?.status, 'changed')
})

test('diffAnalyzeRuns marks table row changes as changed', () => {
  const before = runDetail({
    runId: 'run-a',
    snapshotId: '11111111-1111-4111-8111-111111111111',
    blocks: [
      {
        ...block({ id: 'old-table', kind: 'table', title: 'Inventory bridge', sectionId: 'inventory_bridge' }),
        table: { columns: ['Metric', 'Value'], rows: [['Exchange stocks', '42kt']] },
      },
    ],
  })
  const after = runDetail({
    runId: 'run-b',
    snapshotId: '22222222-2222-4222-8222-222222222222',
    blocks: [
      {
        ...block({ id: 'new-table', kind: 'table', title: 'Inventory bridge', sectionId: 'inventory_bridge' }),
        table: { columns: ['Metric', 'Value'], rows: [['Exchange stocks', '43kt']] },
      },
    ],
  })

  assert.equal(diffAnalyzeRuns(before, after).rows[0]?.status, 'changed')
})

test('diffAnalyzeRuns returns drift summary separately from block rows', () => {
  const unchangedBlock = {
    kind: 'rich_text',
    title: 'Summary',
    rich_text: { segments: [{ text: 'Copper inventories fell 9%.' }] },
    data_ref: { kind: 'analyze_run', id: 'summary', params: { playbook_section_id: 'summary' } },
  }
  const before = runDetail({
    runId: 'run-a',
    snapshotId: '11111111-1111-4111-8111-111111111111',
    templateVersion: 1,
    playbookVersion: 1,
    blocks: [{ ...unchangedBlock, id: 'old-summary', snapshot_id: '11111111-1111-4111-8111-111111111111' }],
  })
  const after = runDetail({
    runId: 'run-b',
    snapshotId: '22222222-2222-4222-8222-222222222222',
    templateVersion: 2,
    playbookVersion: 2,
    blocks: [{ ...unchangedBlock, id: 'new-summary', snapshot_id: '22222222-2222-4222-8222-222222222222' }],
  })

  const diff = diffAnalyzeRuns(before, after)

  assert.equal(diff.rows[0]?.status, 'unchanged')
  assert.deepEqual(diff.summary, {
    template_changed: true,
    evidence_snapshot_changed: true,
    playbook_changed: true,
    template_name_before: 'Copper morning call template',
    template_name_after: 'Copper morning call template',
    template_version_before: 1,
    template_version_after: 2,
    playbook_name_before: 'Daily copper call',
    playbook_name_after: 'Daily copper call',
    playbook_version_before: 1,
    playbook_version_after: 2,
    snapshot_id_before: '11111111-1111-4111-8111-111111111111',
    snapshot_id_after: '22222222-2222-4222-8222-222222222222',
  })
})

function block(input: {
  id: string
  kind?: string
  title: string
  sectionId: string
}): Record<string, unknown> {
  return {
    id: input.id,
    kind: input.kind ?? 'rich_text',
    title: input.title,
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    data_ref: { kind: 'analyze_run', id: input.id, params: { playbook_section_id: input.sectionId } },
  }
}

function runDetail(input: {
  runId: string
  snapshotId: string
  templateId?: string
  templateVersion?: number
  playbookId?: string | null
  playbookVersion?: number | null
  blocks: ReadonlyArray<Record<string, unknown>>
}): Parameters<typeof diffAnalyzeRuns>[0] {
  const templateId = input.templateId ?? '33333333-3333-4333-8333-333333333333'
  const templateVersion = input.templateVersion ?? 1
  const playbookId = input.playbookId === undefined ? 'daily_copper_call' : input.playbookId
  const playbookVersion = input.playbookVersion === undefined ? 1 : input.playbookVersion
  return {
    run_id: input.runId,
    template_id: templateId,
    template_name: 'Copper morning call template',
    template_version: templateVersion,
    playbook_id: playbookId,
    playbook_name: playbookId ? 'Daily copper call' : null,
    playbook_version: playbookVersion,
    display_title: 'Daily copper call',
    run_metadata: {
      schema_version: 1,
      template_id: templateId,
      template_version: templateVersion,
      playbook_id: playbookId,
      playbook_version: playbookVersion,
      instructions: 'Focus on copper curve and inventory changes.',
      source_categories: ['prices', 'curves', 'inventories'],
      subject_refs: [],
    },
    can_rerun: true,
    rerun_unavailable_reason: null,
    created_at: '2026-05-29T00:00:00.000Z',
    snapshot_id: input.snapshotId,
    blocks: input.blocks,
  }
}
