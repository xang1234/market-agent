export type ThesisPeriodKind = 'point' | 'fiscal_q' | 'fiscal_y' | 'ttm'
export type ThesisOperator = 'gte' | 'lte'

export type ThesisMetricCheck = {
  metric_key: string
  unit: string
  period_kind: ThesisPeriodKind
  operator: ThesisOperator
  threshold: number
  max_age_days: number
}

export type ThesisCondition = {
  condition_id: string
  statement: string
  falsifier: string
  horizon: string
  metric?: ThesisMetricCheck
}

export type ThesisVersion = {
  thesis_version_id: string
  agent_id: string
  version: number
  thesis: string
  subject_ref: { kind: 'issuer'; id: string }
  conditions: ThesisCondition[]
  created_at: string
}

export type ConditionAssessment = {
  condition_id: string
  status: 'supported' | 'challenged' | 'unresolved'
  reason: string
  claim_refs: string[]
  fact_refs: string[]
  method: 'metric' | 'model' | 'no_evidence'
}

export type ThesisAssessment = {
  assessment_id: string
  thesis_version_id: string
  run_id: string
  snapshot_id: string
  input_hash: string
  results: ConditionAssessment[]
  model_version: string | null
  prompt_version: string
  assessed_at: string
}

export type ThesisMetricOption = {
  metric_key: string
  label: string
  unit: string
  period_kind: ThesisPeriodKind
}

export type ThesisHistoryResponse = {
  thesis: ThesisVersion | null
  versions: ThesisVersion[]
  assessments: ThesisAssessment[]
  metrics?: ThesisMetricOption[]
}

export type SaveThesisInput = {
  expected_version: number
  thesis: string
  conditions: ThesisCondition[]
}
