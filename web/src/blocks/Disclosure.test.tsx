import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { Disclosure } from './Disclosure.tsx'
import { disclosureFixture } from './fixtures.ts'

const SEALED_ITEM = 'Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.'

test('a disclosure reads its as-of stamp as a date and keeps the sealed text on hover', () => {
  const html = renderToStaticMarkup(<Disclosure block={{ ...disclosureFixture, items: [SEALED_ITEM] }} />)

  assert.match(html, /<li[^>]*>Market prices use end-of-day data as of Sep 1, 2026; intraday moves may not be reflected\.<\/li>/)
  assert.match(html, /title="Market prices use end-of-day data as of 2026-09-01T00:00:00\.000Z;/)
})

test('a disclosure with no stamp renders as written, with no title', () => {
  const html = renderToStaticMarkup(<Disclosure block={disclosureFixture} />)

  assert.match(html, /<li data-testid="block-disclosure-disc-1-item-0">Forward estimates are model-derived and may diverge from consensus\.<\/li>/)
})
