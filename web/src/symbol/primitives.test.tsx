import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { SectorChip } from './SectorChip.tsx'
import { SeverityBadge } from '../blocks/SeverityBadge.tsx'

test('SectorChip renders its label with the violet soft tint', () => {
  const html = renderToStaticMarkup(<SectorChip>Technology</SectorChip>)
  assert.match(html, /Technology/)
  assert.match(html, /bg-violet-soft/)
  assert.match(html, /text-violet/)
})

test('SeverityBadge maps severity to a tone and a default label', () => {
  assert.match(renderToStaticMarkup(<SeverityBadge severity="high" />), /text-negative/)
  assert.match(renderToStaticMarkup(<SeverityBadge severity="high" />), /High/)
  assert.match(renderToStaticMarkup(<SeverityBadge severity="medium" />), /text-warning/)
  assert.match(renderToStaticMarkup(<SeverityBadge severity="low" />), /text-muted/)
  // Reuses the canonical FindingSeverity scale, so `critical` is valid too.
  assert.match(renderToStaticMarkup(<SeverityBadge severity="critical" />), /bg-negative/)
})
