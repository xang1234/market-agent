import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { LlmRoleCard, buildUpsertBody, type LlmRoleCardFormState } from './LlmRoleCard.tsx'
import type {
  LlmCredential,
  LlmCredentialUpsertBody,
  LlmProviderEntry,
  LlmTestResult,
} from './llmTypes.ts'

const OPENAI: LlmProviderEntry = {
  id: 'openai',
  label: 'OpenAI',
  default_base_url: 'https://api.openai.com/v1',
  default_model: 'gpt-4o-mini',
  suggested_models: ['gpt-4o-mini', 'gpt-4o'],
  requires_key: true,
  base_url_editable: false,
  supports_reasoning_effort: true,
  supports_tools: true,
  supports_json_mode: true,
  supports_streaming: true,
}

const COMPAT: LlmProviderEntry = {
  id: 'openai_compatible',
  label: 'OpenAI-compatible',
  default_base_url: null,
  default_model: null,
  suggested_models: [],
  requires_key: false,
  base_url_editable: true,
  supports_reasoning_effort: false,
  supports_tools: true,
  supports_json_mode: true,
  supports_streaming: true,
}

const CATALOG: ReadonlyArray<LlmProviderEntry> = [OPENAI, COMPAT]

function baseForm(overrides: Partial<LlmRoleCardFormState> = {}): LlmRoleCardFormState {
  return {
    providerId: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: '',
    reasoningEffort: '',
    apiKey: '',
    clearKey: false,
    ...overrides,
  }
}

// --- pure logic --------------------------------------------------------------

test("buildUpsertBody omits api_key when the form has no key change", () => {
  const body = buildUpsertBody(baseForm({ model: 'gpt-4o' }), OPENAI)
  assert.deepEqual(body, { provider_id: 'openai', model: 'gpt-4o' })
  assert.equal('api_key' in body, false)
})

test("buildUpsertBody emits api_key='' when clearKey is checked", () => {
  const body = buildUpsertBody(baseForm({ clearKey: true }), OPENAI)
  assert.equal(body.api_key, '')
})

test("buildUpsertBody emits the typed key when apiKey is non-empty and clearKey is unchecked", () => {
  const body = buildUpsertBody(baseForm({ apiKey: 'sk-new-XYZ4242' }), OPENAI)
  assert.equal(body.api_key, 'sk-new-XYZ4242')
})

test("buildUpsertBody strips reasoning_effort for providers that do not support it", () => {
  const body = buildUpsertBody(
    baseForm({ providerId: 'openai_compatible', reasoningEffort: 'high' }),
    COMPAT,
  )
  assert.equal('reasoning_effort' in body, false)
})

test("buildUpsertBody strips base_url for providers with a fixed default", () => {
  const body = buildUpsertBody(
    baseForm({ baseUrl: 'https://hijack.example.com/v1' }),
    OPENAI,
  )
  assert.equal('base_url' in body, false)
})

test("buildUpsertBody forwards base_url for openai-compatible providers when filled", () => {
  const body = buildUpsertBody(
    baseForm({ providerId: 'openai_compatible', baseUrl: 'http://localhost:11434/v1' }),
    COMPAT,
  )
  assert.equal(body.base_url, 'http://localhost:11434/v1')
})

test("buildUpsertBody trims whitespace from model and base_url", () => {
  const body = buildUpsertBody(
    baseForm({
      providerId: 'openai_compatible',
      model: '  llama3  ',
      baseUrl: '  http://localhost:11434/v1  ',
    }),
    COMPAT,
  )
  assert.equal(body.model, 'llama3')
  assert.equal(body.base_url, 'http://localhost:11434/v1')
})

// --- rendering ---------------------------------------------------------------

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
  }
}

async function renderCard(
  container: HTMLElement,
  credential: LlmCredential | null,
  callbacks: {
    onSave?: (body: LlmCredentialUpsertBody) => Promise<void>
    onRemove?: () => Promise<void>
    onTest?: () => Promise<LlmTestResult>
  } = {},
): Promise<ReturnType<typeof createRoot>> {
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <LlmRoleCard
        role="summary"
        catalog={CATALOG}
        credential={credential}
        onSave={callbacks.onSave ?? (async () => undefined)}
        onRemove={callbacks.onRemove ?? (async () => undefined)}
        onTest={callbacks.onTest ?? (async () => ({ ok: true, latency_ms: 1, model: 'x' }))}
      />,
    )
  })
  return root
}

test("LlmRoleCard renders the saved key fingerprint as ••••<tail>", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const container = dom.window.document.getElementById('root')! as unknown as HTMLElement
    const credential: LlmCredential = {
      role: 'summary',
      provider_id: 'openai',
      model: 'gpt-4o-mini',
      base_url: 'https://api.openai.com/v1',
      reasoning_effort: 'low',
      key_fingerprint: '1234',
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }
    const root = await renderCard(container, credential)
    const fingerprint = container.querySelector('[data-testid="llm-summary-key-fingerprint"]')
    assert.ok(fingerprint, 'fingerprint span should be rendered when a credential is saved')
    assert.match(fingerprint!.textContent ?? '', /••••1234/)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test("LlmRoleCard hides the fingerprint span and disables Test until a credential is saved", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const container = dom.window.document.getElementById('root')! as unknown as HTMLElement
    const root = await renderCard(container, null)
    assert.equal(container.querySelector('[data-testid="llm-summary-key-fingerprint"]'), null)
    const testButton = container.querySelector('[data-testid="llm-summary-test"]') as HTMLButtonElement
    assert.equal(testButton.disabled, true)
    assert.equal(container.querySelector('[data-testid="llm-summary-remove"]'), null)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test("LlmRoleCard renders the reasoning_effort dropdown when the catalog allows it", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const container = dom.window.document.getElementById('root')! as unknown as HTMLElement
    // Initial form state derives from credential.provider_id = openai (which supports reasoning_effort).
    const credential: LlmCredential = {
      role: 'summary',
      provider_id: 'openai',
      model: 'gpt-4o-mini',
      base_url: 'https://api.openai.com/v1',
      reasoning_effort: 'medium',
      key_fingerprint: '1234',
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }
    const root = await renderCard(container, credential)
    assert.ok(container.querySelector('[data-testid="llm-summary-reasoning-effort"]'))
    assert.equal(container.querySelector('[data-testid="llm-summary-base-url"]'), null)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test("LlmRoleCard renders the base_url field for openai_compatible and hides reasoning_effort", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const container = dom.window.document.getElementById('root')! as unknown as HTMLElement
    const credential: LlmCredential = {
      role: 'summary',
      provider_id: 'openai_compatible',
      model: 'llama3',
      base_url: 'http://localhost:11434/v1',
      reasoning_effort: null,
      key_fingerprint: null,
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }
    const root = await renderCard(container, credential)
    assert.ok(container.querySelector('[data-testid="llm-summary-base-url"]'))
    assert.equal(container.querySelector('[data-testid="llm-summary-reasoning-effort"]'), null)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test("LlmRoleCard Test button surfaces ok result with latency and model when clicked", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const container = dom.window.document.getElementById('root')! as unknown as HTMLElement
    const credential: LlmCredential = {
      role: 'summary',
      provider_id: 'openai',
      model: 'gpt-4o-mini',
      base_url: 'https://api.openai.com/v1',
      reasoning_effort: null,
      key_fingerprint: '1234',
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    }
    let testCalls = 0
    const root = await renderCard(container, credential, {
      onTest: async () => {
        testCalls += 1
        return { ok: true, latency_ms: 12, model: 'gpt-4o-mini' }
      },
    })
    const testButton = container.querySelector('[data-testid="llm-summary-test"]') as HTMLButtonElement
    await act(async () => {
      testButton.click()
    })
    const flash = container.querySelector('[data-testid="llm-summary-flash"]')
    assert.ok(flash)
    assert.match(flash!.textContent ?? '', /OK · gpt-4o-mini · 12ms/)
    assert.equal(testCalls, 1)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})
