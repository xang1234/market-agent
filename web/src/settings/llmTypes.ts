export const LLM_ROLES = ['summary', 'analyst', 'reader'] as const
export type LlmRole = (typeof LLM_ROLES)[number]

export const LLM_ROLE_LABELS: Record<LlmRole, string> = {
  summary: 'Summary / title',
  analyst: 'Analyst (chat answers)',
  reader: 'Reader (document extraction)',
}

export const LLM_ROLE_DESCRIPTIONS: Record<LlmRole, string> = {
  summary:
    'Cheap, fast model for thread titles and finding headlines. Latency matters more than depth.',
  analyst:
    'Tool-using model that drives chat answers and produces sealed Block[] responses. Choose your most capable available model.',
  reader:
    'Extracts mentions, claims, and events from documents. Behind MA_FLAG_LLM_READER until rollout step 5.',
}

export const REASONING_EFFORTS = ['off', 'low', 'medium', 'high', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export type LlmProviderEntry = {
  id: string
  label: string
  default_base_url: string | null
  default_model: string | null
  suggested_models: ReadonlyArray<string>
  requires_key: boolean
  base_url_editable: boolean
  supports_reasoning_effort: boolean
  supports_tools: boolean
  supports_json_mode: boolean
  supports_streaming: boolean
}

export type LlmCredential = {
  role: LlmRole
  provider_id: string
  model: string
  base_url: string | null
  reasoning_effort: ReasoningEffort | null
  key_fingerprint: string | null
  created_at: string
  updated_at: string
}

export type LlmCredentialUpsertBody = {
  provider_id: string
  model: string
  base_url?: string | null
  reasoning_effort?: ReasoningEffort | null
  api_key?: string
}

export type LlmTestResult =
  | { ok: true; latency_ms: number; model: string }
  | { ok: false; error_code: string; message: string; latency_ms: number }
