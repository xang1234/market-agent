import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  LLM_ROLE_DESCRIPTIONS,
  LLM_ROLE_LABELS,
  REASONING_EFFORTS,
  type LlmCredential,
  type LlmCredentialUpsertBody,
  type LlmProviderEntry,
  type LlmRole,
  type LlmTestResult,
  type ReasoningEffort,
} from './llmTypes.ts'

export type LlmRoleCardProps = {
  role: LlmRole
  catalog: ReadonlyArray<LlmProviderEntry>
  credential: LlmCredential | null
  onSave(body: LlmCredentialUpsertBody): Promise<void>
  onRemove(): Promise<void>
  onTest(): Promise<LlmTestResult>
}

export type LlmRoleCardFormState = {
  providerId: string
  model: string
  baseUrl: string
  reasoningEffort: ReasoningEffort | ''
  apiKey: string
  clearKey: boolean
}

type FormState = LlmRoleCardFormState

// Pure builder used by handleSubmit and exercised by unit tests. Encodes the
// three-state api_key contract (undefined = keep, "" = wipe, string = set) and
// strips fields the catalog says the provider does not support.
export function buildUpsertBody(form: FormState, provider: LlmProviderEntry): LlmCredentialUpsertBody {
  const body: LlmCredentialUpsertBody = {
    provider_id: provider.id,
    model: form.model.trim(),
  }
  if (provider.base_url_editable && form.baseUrl.trim() !== '') {
    body.base_url = form.baseUrl.trim()
  }
  if (provider.supports_reasoning_effort && form.reasoningEffort !== '') {
    body.reasoning_effort = form.reasoningEffort
  }
  if (form.clearKey) {
    body.api_key = ''
  } else if (form.apiKey !== '') {
    body.api_key = form.apiKey
  }
  return body
}

type FlashState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }
  | { kind: 'tested_ok'; latencyMs: number; model: string }
  | { kind: 'tested_failed'; message: string }

function initialFormState(
  credential: LlmCredential | null,
  catalog: ReadonlyArray<LlmProviderEntry>,
): FormState {
  const provider = credential
    ? catalog.find((entry) => entry.id === credential.provider_id) ?? catalog[0]
    : catalog[0]
  const providerId = provider?.id ?? ''
  return {
    providerId,
    model: credential?.model ?? provider?.default_model ?? '',
    baseUrl: credential?.base_url ?? '',
    reasoningEffort: credential?.reasoning_effort ?? '',
    apiKey: '',
    clearKey: false,
  }
}

export function LlmRoleCard(props: LlmRoleCardProps): JSX.Element {
  const { role, catalog, credential, onSave, onRemove, onTest } = props
  const [form, setForm] = useState<FormState>(() => initialFormState(credential, catalog))
  const [flash, setFlash] = useState<FlashState>({ kind: 'idle' })

  useEffect(() => {
    setForm(initialFormState(credential, catalog))
    setFlash({ kind: 'idle' })
  }, [credential, catalog])

  const provider = useMemo(
    () => catalog.find((entry) => entry.id === form.providerId) ?? null,
    [catalog, form.providerId],
  )

  const baseUrlEditable = provider?.base_url_editable ?? false
  const supportsReasoningEffort = provider?.supports_reasoning_effort ?? false
  const baseUrlPlaceholder = provider?.default_base_url ?? 'https://example.com/v1'
  const hasSavedKey = credential?.key_fingerprint !== null && credential !== null

  const handleProviderChange = (providerId: string) => {
    const next = catalog.find((entry) => entry.id === providerId)
    setForm((prev) => ({
      ...prev,
      providerId,
      model:
        prev.providerId === providerId
          ? prev.model
          : next?.default_model ?? prev.model,
      reasoningEffort: next?.supports_reasoning_effort ? prev.reasoningEffort : '',
      baseUrl: next?.base_url_editable ? prev.baseUrl : '',
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (provider === null) return
    if (form.model.trim() === '') {
      setFlash({ kind: 'error', message: 'model is required' })
      return
    }
    setFlash({ kind: 'saving' })
    const body = buildUpsertBody(form, provider)
    try {
      await onSave(body)
      setForm((prev) => ({ ...prev, apiKey: '', clearKey: false }))
      setFlash({ kind: 'saved' })
    } catch (error) {
      setFlash({ kind: 'error', message: errorMessage(error) })
    }
  }

  const handleRemove = async () => {
    setFlash({ kind: 'saving' })
    try {
      await onRemove()
      setFlash({ kind: 'idle' })
    } catch (error) {
      setFlash({ kind: 'error', message: errorMessage(error) })
    }
  }

  const handleTest = async () => {
    if (credential === null) {
      setFlash({ kind: 'error', message: 'save a credential before testing' })
      return
    }
    setFlash({ kind: 'saving' })
    try {
      const result = await onTest()
      if (result.ok) {
        setFlash({ kind: 'tested_ok', latencyMs: result.latency_ms, model: result.model })
      } else {
        setFlash({ kind: 'tested_failed', message: `${result.error_code}: ${result.message}` })
      }
    } catch (error) {
      setFlash({ kind: 'tested_failed', message: errorMessage(error) })
    }
  }

  return (
    <section
      aria-label={`${LLM_ROLE_LABELS[role]} provider`}
      className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <header className="mb-3">
        <h3 className="text-base font-semibold">{LLM_ROLE_LABELS[role]}</h3>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {LLM_ROLE_DESCRIPTIONS[role]}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="grid gap-3">
        <label className="block text-sm">
          <span className="block text-neutral-700 dark:text-neutral-300">Provider</span>
          <select
            value={form.providerId}
            onChange={(event) => handleProviderChange(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            data-testid={`llm-${role}-provider`}
          >
            {catalog.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="flex items-center justify-between text-neutral-700 dark:text-neutral-300">
            <span>Model</span>
            {provider?.default_model ? (
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({ ...prev, model: provider.default_model ?? prev.model }))
                }
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Reset to {provider.default_model}
              </button>
            ) : null}
          </span>
          <input
            type="text"
            value={form.model}
            onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
            placeholder={provider?.suggested_models[0] ?? 'gpt-4o-mini'}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            data-testid={`llm-${role}-model`}
          />
        </label>

        {baseUrlEditable ? (
          <label className="block text-sm">
            <span className="block text-neutral-700 dark:text-neutral-300">Base URL</span>
            <input
              type="url"
              value={form.baseUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
              placeholder={baseUrlPlaceholder}
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              data-testid={`llm-${role}-base-url`}
            />
          </label>
        ) : null}

        <label className="block text-sm">
          <span className="flex items-center justify-between text-neutral-700 dark:text-neutral-300">
            <span>API key</span>
            {hasSavedKey ? (
              <span
                className="text-xs text-neutral-500 dark:text-neutral-400"
                data-testid={`llm-${role}-key-fingerprint`}
              >
                Saved: ••••{credential?.key_fingerprint}
              </span>
            ) : null}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder={hasSavedKey ? 'Leave blank to keep saved key' : provider?.requires_key ? 'Required' : 'Optional'}
            disabled={form.clearKey}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
            data-testid={`llm-${role}-api-key`}
          />
          {hasSavedKey ? (
            <label className="mt-1 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={form.clearKey}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, clearKey: event.target.checked, apiKey: '' }))
                }
                data-testid={`llm-${role}-clear-key`}
              />
              Clear saved key on save
            </label>
          ) : null}
        </label>

        {supportsReasoningEffort ? (
          <label className="block text-sm">
            <span className="block text-neutral-700 dark:text-neutral-300">Reasoning effort</span>
            <select
              value={form.reasoningEffort}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  reasoningEffort: event.target.value as FormState['reasoningEffort'],
                }))
              }
              className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              data-testid={`llm-${role}-reasoning-effort`}
            >
              <option value="">Default</option>
              {REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            data-testid={`llm-${role}-save`}
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={credential === null}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            data-testid={`llm-${role}-test`}
          >
            Test
          </button>
          {credential !== null ? (
            <button
              type="button"
              onClick={handleRemove}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
              data-testid={`llm-${role}-remove`}
            >
              Remove
            </button>
          ) : null}
          <FlashLine flash={flash} role={role} />
        </div>
      </form>
    </section>
  )
}

function FlashLine({ flash, role }: { flash: FlashState; role: LlmRole }): JSX.Element | null {
  if (flash.kind === 'idle') return null
  const base = 'ml-2 text-xs'
  if (flash.kind === 'saving') {
    return (
      <span className={`${base} text-neutral-500`} data-testid={`llm-${role}-flash`}>
        Saving…
      </span>
    )
  }
  if (flash.kind === 'saved') {
    return (
      <span className={`${base} text-emerald-600 dark:text-emerald-400`} data-testid={`llm-${role}-flash`}>
        Saved
      </span>
    )
  }
  if (flash.kind === 'tested_ok') {
    return (
      <span className={`${base} text-emerald-600 dark:text-emerald-400`} data-testid={`llm-${role}-flash`}>
        OK · {flash.model} · {flash.latencyMs}ms
      </span>
    )
  }
  if (flash.kind === 'tested_failed') {
    return (
      <span className={`${base} text-red-600 dark:text-red-400`} data-testid={`llm-${role}-flash`}>
        Test failed: {flash.message}
      </span>
    )
  }
  return (
    <span className={`${base} text-red-600 dark:text-red-400`} data-testid={`llm-${role}-flash`}>
      {flash.message}
    </span>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'unknown error'
}
