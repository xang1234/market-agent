import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'

import { SettingsView } from './SettingsPage.tsx'

test('SettingsView renders AI model channels and model selectors', () => {
  const html = renderToString(
    <SettingsView
      state={{
        kind: 'ready',
        version: 'sha256:test',
        settings: {
          channels: [{
            name: 'deepseek',
            protocol: 'openai-compatible',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: '********',
            apiKeys: ['********'],
            models: ['deepseek-chat'],
            enabled: true,
          }],
          primaryModel: 'deepseek/deepseek-chat',
          fallbackModels: [],
          agentModel: null,
          issues: [],
        },
      }}
    />,
  )

  assert.match(html, /AI model channels/)
  assert.match(html, /deepseek/)
  assert.match(html, /deepseek-chat/)
  assert.match(html, /Primary model/)
  assert.match(html, /Fallback models/)
})
