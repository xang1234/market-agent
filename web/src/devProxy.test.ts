import assert from 'node:assert/strict'
import test from 'node:test'

import viteConfig from '../vite.config.ts'

test('Vite proxies local dev settings API to dev-api', () => {
  const proxy = typeof viteConfig === 'object' && viteConfig !== null
    ? viteConfig.server?.proxy
    : undefined

  assert.ok(proxy && typeof proxy === 'object' && '/v1/dev' in proxy)
})
