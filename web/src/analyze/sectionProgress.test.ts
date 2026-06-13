import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sectionProgress } from './sectionProgress.ts'

const sections = [
  { section_id: 'thesis', title: 'Investment thesis' },
  { section_id: 'verdict', title: 'Final verdict' },
]

test('idle: all sections pending', () => {
  const rows = sectionProgress(sections, 'idle', null)
  assert.deepEqual(rows.map((row) => row.state), ['pending', 'pending'])
  assert.deepEqual(rows.map((row) => row.title), ['Investment thesis', 'Final verdict'])
})

test('generating: all sections running', () => {
  const rows = sectionProgress(sections, 'generating', null)
  assert.deepEqual(rows.map((row) => row.state), ['running', 'running'])
})

test('complete: sections with a matching block title are done, others skipped', () => {
  const rows = sectionProgress(sections, 'complete', [
    { title: 'investment THESIS' },
    { title: 'Margin bridge' },
    {},
  ])
  assert.deepEqual(rows.map((row) => row.state), ['done', 'skipped'])
})

test('non-string block titles from run payloads do not throw', () => {
  const rows = sectionProgress(sections, 'complete', [
    { title: null } as unknown as { title?: string },
    { title: 'Final verdict' },
  ])
  assert.deepEqual(rows.map((row) => row.state), ['skipped', 'done'])
})
