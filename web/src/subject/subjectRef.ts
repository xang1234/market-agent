export const SUBJECT_KINDS = [
  'commodity',
  'benchmark',
  'contract',
  'curve',
  'region',
  'delivery_point',
  'asset',
  'producer',
  'route',
  'market_theme',
  'portfolio',
  'screen',
  'issuer',
  'instrument',
  'listing',
  'theme',
  'macro_topic',
] as const

export type SubjectKind = (typeof SUBJECT_KINDS)[number]

export type SubjectRef = {
  kind: SubjectKind
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isSubjectKind(value: unknown): value is SubjectKind {
  return typeof value === 'string' && (SUBJECT_KINDS as ReadonlyArray<string>).includes(value)
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function isSubjectRef(value: unknown): value is SubjectRef {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return isSubjectKind(obj.kind) && isUuid(obj.id)
}

export function formatSubjectRef(subjectRef: SubjectRef): string {
  return `${subjectRef.kind}:${subjectRef.id}`
}

export function parseSubjectRefString(decoded: string): SubjectRef | null {
  const separator = decoded.indexOf(':')
  if (separator <= 0) return null
  const kind = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)
  const candidate = { kind, id }
  return isSubjectRef(candidate) ? candidate : null
}
