import assert from 'node:assert/strict'
import test from 'node:test'

import viteConfig from '../vite.config.ts'

test('Vite proxies local dev settings API to dev-api', () => {
  const proxy = typeof viteConfig === 'object' && viteConfig !== null
    ? viteConfig.server?.proxy
    : undefined

  assert.ok(proxy && typeof proxy === 'object' && '/v1/dev' in proxy)
})

test('Vite proxies evidence inspection to dev-api, ahead of the /v1/evidence review server', () => {
  const proxy = viteConfig.server?.proxy as Record<string, { target: string }>
  const keys = Object.keys(proxy)
  // Vite uses the first matching key, so the specific route must precede the prefix.
  assert.ok(keys.indexOf('/v1/evidence/inspect') !== -1, 'inspect route is proxied')
  assert.ok(keys.indexOf('/v1/evidence/inspect') < keys.indexOf('/v1/evidence'))
  assert.equal(proxy['/v1/evidence/inspect'].target, process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312')
})
