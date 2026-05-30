import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { SettingsView, type LlmEditableSettings } from './SettingsPage.tsx'

test('SettingsView renders AI model channels and model selectors', () => {
  const html = renderToString(
    <SettingsView
      state={{
        kind: 'ready',
        version: 'sha256:test',
        settings: settings(),
      }}
    />,
  )

  assert.match(html, /AI model channels/)
  assert.match(html, /openai/)
  assert.match(html, /gpt-4.1/)
  assert.match(html, /Primary model/)
  assert.match(html, /Fallback models/)
})

test('SettingsView preserves masked keys when saving', async () => {
  const saved: { current: LlmEditableSettings | null } = { current: null }
  const { document, cleanup } = renderIntoDom(
    <SettingsView
      state={{ kind: 'ready', version: 'sha256:test', settings: settings() }}
      onSave={async (next) => {
        saved.current = next
      }}
    />,
  )

  await click(buttonByText(document, 'Save'))

  assert.equal(saved.current?.channels[0]?.apiKey, '********')
  assert.deepEqual(saved.current?.channels[0]?.apiKeys, ['********'])
  cleanup()
})

test('SettingsView can add a channel and select primary/fallback models', async () => {
  const changes: LlmEditableSettings[] = []
  const { document, cleanup } = renderIntoDom(
    <SettingsView
      state={{ kind: 'ready', version: 'sha256:test', settings: settings() }}
      onChange={(next) => changes.push(next)}
    />,
  )

  await click(buttonByText(document, 'Add channel'))
  await change(selectByLabel(document, 'Primary model'), 'openai/o3')
  await selectMultiple(selectByLabel(document, 'Fallback models'), ['openai/gpt-4.1', 'openai/o3'])

  assert.equal(changes[0]?.channels.at(-1)?.name, 'deepseek')
  assert.equal(changes[1]?.primaryModel, 'openai/o3')
  assert.deepEqual(changes[2]?.fallbackModels, ['openai/gpt-4.1', 'openai/o3'])
  cleanup()
})

test('SettingsView displays pending and failed diagnostics states', () => {
  const pending = renderToString(
    <SettingsView
      state={{ kind: 'ready', version: 'sha256:test', settings: settings() }}
      busyAction="test"
    />,
  )
  const failed = renderToString(
    <SettingsView
      state={{ kind: 'ready', version: 'sha256:test', settings: settings(), message: 'auth_failed: bad key', messageTone: 'error' }}
    />,
  )

  assert.match(pending, /Testing/)
  assert.match(failed, /auth_failed: bad key/)
  assert.match(failed, /text-rose/)
})

function settings(): LlmEditableSettings {
  return {
    channels: [{
      name: 'openai',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '********',
      apiKeys: ['********'],
      models: ['gpt-4.1', 'o3'],
      enabled: true,
    }],
    primaryModel: 'openai/gpt-4.1',
    fallbackModels: [],
    agentModel: null,
    issues: [],
  }
}

function renderIntoDom(element: React.ReactElement): { document: Document; cleanup: () => void } {
  const dom = new JSDOM('<div id="root"></div>')
  const globals = globalThis as Record<string, unknown>
  const previousGlobals = {
    document: globals.document,
    window: globals.window,
    HTMLElement: globals.HTMLElement,
    HTMLInputElement: globals.HTMLInputElement,
    HTMLSelectElement: globals.HTMLSelectElement,
    HTMLButtonElement: globals.HTMLButtonElement,
    Event: globals.Event,
    InputEvent: globals.InputEvent,
    MouseEvent: globals.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  }
  globals.document = dom.window.document
  globals.window = dom.window
  globals.HTMLElement = dom.window.HTMLElement
  globals.HTMLInputElement = dom.window.HTMLInputElement
  globals.HTMLSelectElement = dom.window.HTMLSelectElement
  globals.HTMLButtonElement = dom.window.HTMLButtonElement
  globals.Event = dom.window.Event
  globals.InputEvent = dom.window.InputEvent
  globals.MouseEvent = dom.window.MouseEvent
  globals.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(dom.window.document.getElementById('root')!)
  act(() => {
    root.render(element)
  })
  return {
    document: dom.window.document,
    cleanup: () => {
      act(() => root.unmount())
      globals.document = previousGlobals.document
      globals.window = previousGlobals.window
      globals.HTMLElement = previousGlobals.HTMLElement
      globals.HTMLInputElement = previousGlobals.HTMLInputElement
      globals.HTMLSelectElement = previousGlobals.HTMLSelectElement
      globals.HTMLButtonElement = previousGlobals.HTMLButtonElement
      globals.Event = previousGlobals.Event
      globals.InputEvent = previousGlobals.InputEvent
      globals.MouseEvent = previousGlobals.MouseEvent
      globals.IS_REACT_ACT_ENVIRONMENT = previousGlobals.IS_REACT_ACT_ENVIRONMENT
    },
  }
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    const view = element.ownerDocument.defaultView
    assert.ok(view)
    element.dispatchEvent(new view.MouseEvent('click', { bubbles: true }))
  })
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const view = element.ownerDocument.defaultView
    assert.ok(view)
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
    valueSetter?.call(element, value)
    element.dispatchEvent(new view.Event('input', { bubbles: true }))
    element.dispatchEvent(new view.Event('change', { bubbles: true }))
  })
}

async function selectMultiple(element: HTMLSelectElement, values: string[]): Promise<void> {
  await act(async () => {
    const view = element.ownerDocument.defaultView
    assert.ok(view)
    for (const option of element.options) {
      option.selected = values.includes(option.value)
    }
    element.dispatchEvent(new view.Event('change', { bubbles: true }))
  })
}

function buttonByText(document: Document, text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))
  assert.ok(button)
  return button
}

function selectByLabel(document: Document, text: string): HTMLSelectElement {
  const label = labelByText(document, text)
  const select = label.querySelector('select')
  assert.ok(select)
  return select
}

function labelByText(document: Document, text: string): HTMLLabelElement {
  const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent?.includes(text))
  assert.ok(label)
  return label
}
