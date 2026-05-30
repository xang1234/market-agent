import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'

export type AnalyzeRunMetadata = {
  schema_version: 1
  template_id: string
  template_version: number
  playbook_id: string | null
  playbook_version: number | null
  instructions: string
  source_categories: ReadonlyArray<string>
  subject_refs: ReadonlyArray<{ kind: string; id: string }>
  rerun_of_run_id?: string
}

export type AnalyzeRunHistoryItem = {
  run_id: string
  template_id: string
  template_name: string
  template_version: number
  playbook_id: string | null
  playbook_name: string | null
  playbook_version: number | null
  display_title: string
  can_rerun: boolean
  rerun_unavailable_reason: string | null
  created_at: string
  snapshot_id: string
}

export type AnalyzeRunDetail = AnalyzeRunHistoryItem & {
  run_metadata: AnalyzeRunMetadata | Record<string, unknown>
  blocks: ReadonlyArray<Record<string, unknown>>
}

export type AnalyzeRunDiffRow = {
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  key: string
  title: string
}

export type AnalyzeRunDiffSummary = {
  template_changed: boolean
  evidence_snapshot_changed: boolean
  playbook_changed: boolean
  template_name_before: string
  template_name_after: string
  template_version_before: number | null
  template_version_after: number | null
  playbook_name_before: string | null
  playbook_name_after: string | null
  playbook_version_before: number | null
  playbook_version_after: number | null
  snapshot_id_before: string
  snapshot_id_after: string
}

export type AnalyzeRunDiff = {
  summary: AnalyzeRunDiffSummary
  rows: ReadonlyArray<AnalyzeRunDiffRow>
}

export type AnalyzeRunListResponse = {
  runs: ReadonlyArray<AnalyzeRunHistoryItem>
  next_cursor: string | null
}

export async function fetchAnalyzeRuns(input: {
  userId: string
  limit?: number
  cursor?: string | null
  fetchImpl?: FetchImpl
}): Promise<AnalyzeRunListResponse> {
  const params = new URLSearchParams()
  if (input.limit !== undefined) params.set('limit', String(input.limit))
  if (input.cursor) params.set('cursor', input.cursor)
  const path = params.size > 0 ? `/v1/analyze/runs?${params.toString()}` : '/v1/analyze/runs'
  return authenticatedJson<AnalyzeRunListResponse>(path, {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  })
}

export async function fetchAnalyzeRun(input: {
  userId: string
  runId: string
  fetchImpl?: FetchImpl
}): Promise<AnalyzeRunDetail> {
  return authenticatedJson<AnalyzeRunDetail>(`/v1/analyze/runs/${input.runId}`, {
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  })
}

export async function rerunAnalyzeRun(input: {
  userId: string
  runId: string
  fetchImpl?: FetchImpl
}): Promise<AnalyzeRunDetail> {
  return authenticatedJson<AnalyzeRunDetail>(`/v1/analyze/runs/${input.runId}/rerun`, {
    method: 'POST',
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  })
}

export function isRerunnableRun(run: AnalyzeRunHistoryItem): boolean {
  return run.can_rerun
}

export function diffAnalyzeRuns(
  before: AnalyzeRunDetail,
  after: AnalyzeRunDetail,
): AnalyzeRunDiff {
  const beforeRows = blockRows(before.blocks)
  const afterRows = blockRows(after.blocks)
  const keys = orderedBlockKeys(before.blocks, after.blocks)
  return {
    summary: diffSummary(before, after),
    rows: keys.map((key) => {
      const left = beforeRows.get(key)
      const right = afterRows.get(key)
      const title = right?.title ?? left?.title ?? key
      if (left === undefined) return { status: 'added', key, title }
      if (right === undefined) return { status: 'removed', key, title }
      if (left.signature !== right.signature) return { status: 'changed', key, title }
      return { status: 'unchanged', key, title }
    }),
  }
}

function diffSummary(before: AnalyzeRunDetail, after: AnalyzeRunDetail): AnalyzeRunDiffSummary {
  const templateVersionBefore = templateVersion(before)
  const templateVersionAfter = templateVersion(after)
  return {
    template_changed: templateId(before) !== templateId(after) || templateVersionBefore !== templateVersionAfter,
    evidence_snapshot_changed: before.snapshot_id !== after.snapshot_id,
    playbook_changed: before.playbook_id !== after.playbook_id || before.playbook_version !== after.playbook_version,
    template_name_before: before.template_name,
    template_name_after: after.template_name,
    template_version_before: templateVersionBefore,
    template_version_after: templateVersionAfter,
    playbook_name_before: before.playbook_name,
    playbook_name_after: after.playbook_name,
    playbook_version_before: before.playbook_version,
    playbook_version_after: after.playbook_version,
    snapshot_id_before: before.snapshot_id,
    snapshot_id_after: after.snapshot_id,
  }
}

function templateId(run: AnalyzeRunDetail): string | null {
  return stringValue(metadataRecord(run.run_metadata).template_id)
}

function templateVersion(run: AnalyzeRunDetail): number | null {
  return numberValue(metadataRecord(run.run_metadata).template_version)
}

function metadataRecord(metadata: AnalyzeRunDetail['run_metadata']): Record<string, unknown> {
  return isRecord(metadata) ? metadata : {}
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

type DiffBlockRow = {
  title: string
  signature: string
}

function blockRows(blocks: ReadonlyArray<Record<string, unknown>>): Map<string, DiffBlockRow> {
  return new Map(blocks.map((block) => {
    const key = blockDiffKey(block)
    const title = blockTitle(block)
    return [key, {
      title,
      signature: canonicalBlockDiffSignature(block),
    }]
  }))
}

const VOLATILE_BLOCK_DIFF_FIELDS = new Set(['id', 'snapshot_id', 'data_ref', 'as_of'])

function canonicalBlockDiffSignature(block: Record<string, unknown>): string {
  return stableJson(canonicalizeBlockContent(block))
}

function canonicalizeBlockContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeBlockContent(item))
  }
  if (!isRecord(value)) {
    return value
  }

  const stripBlockFields = isBlockLikeRecord(value)
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (stripBlockFields && VOLATILE_BLOCK_DIFF_FIELDS.has(key)) continue
    output[key] = canonicalizeBlockContent(child)
  }
  return output
}

function isBlockLikeRecord(value: Record<string, unknown>): boolean {
  return typeof value.kind === 'string' && (
    'title' in value ||
    'snapshot_id' in value ||
    'data_ref' in value ||
    'children' in value
  )
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

function orderedBlockKeys(
  before: ReadonlyArray<Record<string, unknown>>,
  after: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<string> {
  const seen = new Set<string>()
  const keys: string[] = []
  const push = (block: Record<string, unknown>) => {
    const key = blockDiffKey(block)
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  for (const block of after) push(block)
  for (const block of before) push(block)
  return keys
}

function blockDiffKey(block: Record<string, unknown>): string {
  return playbookSectionId(block) ?? stringValue(block.id) ?? blockTitle(block) ?? stringValue(block.kind) ?? 'Untitled'
}

function blockTitle(block: Record<string, unknown>): string {
  return stringValue(block.title) ?? stringValue(block.id) ?? stringValue(block.kind) ?? 'Untitled'
}

function playbookSectionId(block: Record<string, unknown>): string | null {
  const dataRef = isRecord(block.data_ref) ? block.data_ref : {}
  const params = isRecord(dataRef.params) ? dataRef.params : {}
  return stringValue(params.playbook_section_id)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
