import type { SubjectRef } from './search.ts'
import type { ThemeMembershipRationaleView } from './ThemeMembershipRationaleList.tsx'

export type ThemeMembershipRationaleResponse = {
  memberships: ReadonlyArray<ThemeMembershipRationaleView>
  truncated: boolean
}

export async function fetchThemeMembershipRationales(
  subjectRef: SubjectRef,
  options: {
    signal?: AbortSignal
    limit?: number
  } = {},
): Promise<ThemeMembershipRationaleResponse> {
  const params = new URLSearchParams({
    subject_kind: subjectRef.kind,
    subject_id: subjectRef.id,
  })
  if (options.limit !== undefined) params.set('limit', String(options.limit))

  const response = await fetch(`/v1/themes/membership-rationales?${params.toString()}`, {
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`theme membership rationale request failed (${response.status})`)
  }

  return parseThemeMembershipRationaleResponse(await response.json())
}

export function parseThemeMembershipRationaleResponse(
  value: unknown,
): ThemeMembershipRationaleResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('theme membership rationale response must be an object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.memberships)) {
    throw new Error('theme membership rationale response memberships must be an array')
  }
  return {
    memberships: record.memberships.map(parseThemeMembershipRationale),
    truncated: record.truncated === true,
  }
}

function parseThemeMembershipRationale(value: unknown): ThemeMembershipRationaleView {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('theme membership rationale row must be an object')
  }
  const record = value as Record<string, unknown>
  const mode = record.membership_mode
  if (mode !== 'manual' && mode !== 'rule_based' && mode !== 'inferred') {
    throw new Error('theme membership rationale membership_mode is invalid')
  }
  return {
    theme_id: readString(record.theme_id, 'theme_id'),
    theme_name: readString(record.theme_name, 'theme_name'),
    theme_description: readNullableString(record.theme_description, 'theme_description'),
    membership_mode: mode,
    score: readNullableNumber(record.score, 'score'),
    rationale_supported: record.rationale_supported === true,
    rationale_claim_ids: readStringArray(record.rationale_claim_ids, 'rationale_claim_ids'),
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`theme membership rationale ${label} must be a non-empty string`)
  }
  return value
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error(`theme membership rationale ${label} must be a string or null`)
  }
  return value
}

function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`theme membership rationale ${label} must be a finite number or null`)
  }
  return value
}

function readStringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`theme membership rationale ${label} must be a string array`)
  }
  return value
}
