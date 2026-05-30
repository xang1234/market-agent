import { useEffect, useState } from 'react'
import { HttpJsonError, readJsonBody } from '../http/authFetch.ts'

export type LlmChannelSettings = {
  name: string
  protocol: string
  baseUrl: string | null
  apiKey: string | null
  apiKeys: string[]
  models: string[]
  enabled: boolean
}

export type LlmEditableSettings = {
  channels: LlmChannelSettings[]
  primaryModel: string | null
  fallbackModels: string[]
  agentModel: string | null
  issues?: string[]
}

type SettingsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; version: string; settings: LlmEditableSettings; message?: string }

export function SettingsPage() {
  const [state, setState] = useState<SettingsState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    getJson<{ version: string; settings: LlmEditableSettings }>('/v1/dev/llm-settings')
      .then((body) => {
        if (!cancelled) setState({ kind: 'ready', version: body.version, settings: normalizeSettings(body.settings) })
      })
      .catch((error) => {
        if (!cancelled) setState({ kind: 'error', message: errorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsView
      state={state}
      onChange={(settings) => setState((current) => current.kind === 'ready' ? { ...current, settings } : current)}
      onSave={async (settings, version) => {
        const body = await putJson<{ version: string; settings: LlmEditableSettings }>('/v1/dev/llm-settings', {
          version,
          settings,
        })
        setState({ kind: 'ready', version: body.version, settings: normalizeSettings(body.settings), message: 'Saved' })
      }}
      onTest={async () => {
        const body = await postJson<{ ok: boolean; reply: string }>('/v1/dev/llm-settings/test-channel', {})
        setState((current) => current.kind === 'ready'
          ? { ...current, message: body.ok ? `Test passed: ${body.reply}` : `Unexpected reply: ${body.reply}` }
          : current)
      }}
      onDiscover={async (channel) => {
        const body = await postJson<{ models: string[] }>('/v1/dev/llm-settings/discover-models', {
          baseUrl: channel.baseUrl,
          apiKey: channel.apiKey,
        })
        setState((current) => current.kind === 'ready'
          ? {
              ...current,
              settings: {
                ...current.settings,
                channels: current.settings.channels.map((candidate) =>
                  candidate.name === channel.name ? { ...candidate, models: body.models } : candidate,
                ),
              },
              message: `Discovered ${body.models.length} models`,
            }
          : current)
      }}
    />
  )
}

export function SettingsView({
  state,
  onChange = () => undefined,
  onSave = async () => undefined,
  onTest = async () => undefined,
  onDiscover = async () => undefined,
}: {
  state: SettingsState
  onChange?: (settings: LlmEditableSettings) => void
  onSave?: (settings: LlmEditableSettings, version: string) => Promise<void>
  onTest?: () => Promise<void>
  onDiscover?: (channel: LlmChannelSettings) => Promise<void>
}) {
  const modelOptions = state.kind === 'ready'
    ? state.settings.channels.flatMap((channel) => channel.models.map((model) => `${channel.name}/${model}`))
    : []
  if (state.kind === 'loading') {
    return <div className="p-6 text-sm text-neutral-600 dark:text-neutral-300">Loading settings...</div>
  }
  if (state.kind === 'error') {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Settings unavailable</h1>
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{state.message}</p>
      </div>
    )
  }

  const settings = state.settings
  const updateChannel = (index: number, channel: LlmChannelSettings) => {
    onChange({
      ...settings,
      channels: settings.channels.map((candidate, candidateIndex) => candidateIndex === index ? channel : candidate),
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-50 p-6 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-950 dark:text-neutral-50">Settings</h1>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">AI model channels</p>
          </div>
          <div className="flex gap-2">
            <button className={SECONDARY_BUTTON} onClick={() => onTest()} type="button">Test</button>
            <button className={PRIMARY_BUTTON} onClick={() => onSave(settings, state.version)} type="button">Save</button>
          </div>
        </header>

        {state.message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p> : null}
        {settings.issues?.length ? (
          <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {settings.issues.join(' ')}
          </div>
        ) : null}

        <section className="flex flex-col gap-3">
          {settings.channels.map((channel, index) => (
            <div key={`${channel.name}-${index}`} className="grid gap-3 border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 md:grid-cols-[1fr_1fr_1fr_auto]">
              <label className={FIELD_LABEL}>
                Channel
                <input className={INPUT_CLASS} value={channel.name} onChange={(event) => updateChannel(index, { ...channel, name: event.target.value })} />
              </label>
              <label className={FIELD_LABEL}>
                Protocol
                <select className={INPUT_CLASS} value={channel.protocol} onChange={(event) => updateChannel(index, { ...channel, protocol: event.target.value })}>
                  <option value="openai-compatible">OpenAI compatible</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label className={FIELD_LABEL}>
                Base URL
                <input className={INPUT_CLASS} value={channel.baseUrl ?? ''} onChange={(event) => updateChannel(index, { ...channel, baseUrl: event.target.value || null })} />
              </label>
              <label className="flex items-center gap-2 self-end text-sm text-neutral-700 dark:text-neutral-200">
                <input checked={channel.enabled} onChange={(event) => updateChannel(index, { ...channel, enabled: event.target.checked })} type="checkbox" />
                Enabled
              </label>
              <label className={FIELD_LABEL}>
                API key
                <input className={INPUT_CLASS} value={channel.apiKey ?? ''} onChange={(event) => updateChannel(index, { ...channel, apiKey: event.target.value || null, apiKeys: event.target.value ? [event.target.value] : [] })} type="password" />
              </label>
              <label className={`${FIELD_LABEL} md:col-span-2`}>
                Models
                <input className={INPUT_CLASS} value={channel.models.join(',')} onChange={(event) => updateChannel(index, { ...channel, models: splitCsv(event.target.value) })} />
              </label>
              <div className="flex items-end gap-2">
                <button className={SECONDARY_BUTTON} onClick={() => onDiscover(channel)} type="button">Discover</button>
                <button className={DANGER_BUTTON} onClick={() => onChange({ ...settings, channels: settings.channels.filter((_, candidateIndex) => candidateIndex !== index) })} type="button">Remove</button>
              </div>
            </div>
          ))}
          <button className={SECONDARY_BUTTON} onClick={() => onChange({ ...settings, channels: [...settings.channels, defaultChannel()] })} type="button">
            Add channel
          </button>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <label className={FIELD_LABEL}>
            Primary model
            <select className={INPUT_CLASS} value={settings.primaryModel ?? ''} onChange={(event) => onChange({ ...settings, primaryModel: event.target.value || null })}>
              <option value="">None</option>
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <label className={FIELD_LABEL}>
            Fallback models
            <input className={INPUT_CLASS} value={settings.fallbackModels.join(',')} onChange={(event) => onChange({ ...settings, fallbackModels: splitCsv(event.target.value) })} />
          </label>
          <label className={FIELD_LABEL}>
            Agent model
            <select className={INPUT_CLASS} value={settings.agentModel ?? ''} onChange={(event) => onChange({ ...settings, agentModel: event.target.value || null })}>
              <option value="">Use primary</option>
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        </section>
      </div>
    </div>
  )
}

function defaultChannel(): LlmChannelSettings {
  return {
    name: 'deepseek',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    apiKeys: [''],
    models: ['deepseek-chat'],
    enabled: true,
  }
}

function normalizeSettings(settings: LlmEditableSettings): LlmEditableSettings {
  return {
    channels: settings.channels ?? [],
    primaryModel: settings.primaryModel ?? null,
    fallbackModels: settings.fallbackModels ?? [],
    agentModel: settings.agentModel ?? null,
    issues: settings.issues ?? [],
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await readJsonBody(response)
  if (!response.ok) throw new HttpJsonError(response.status, body)
  return body as T
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const responseBody = await readJsonBody(response)
  if (!response.ok) throw new HttpJsonError(response.status, responseBody)
  return responseBody as T
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const responseBody = await readJsonBody(response)
  if (!response.ok) throw new HttpJsonError(response.status, responseBody)
  return responseBody as T
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'settings request failed'
}

const FIELD_LABEL = 'flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400'
const INPUT_CLASS = 'h-9 border border-neutral-300 bg-white px-2 text-sm normal-case tracking-normal text-neutral-900 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-neutral-100'
const PRIMARY_BUTTON = 'h-9 border border-neutral-900 bg-neutral-900 px-3 text-sm font-medium text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950'
const SECONDARY_BUTTON = 'h-9 border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
const DANGER_BUTTON = 'h-9 border border-rose-300 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-neutral-900 dark:text-rose-300 dark:hover:bg-rose-950'
