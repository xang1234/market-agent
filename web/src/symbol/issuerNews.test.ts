import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchIssuerNews, formatRelativeTime, isFilingKind, type IssuerNewsItem } from './issuerNews.ts'

const ISSUER_ID = '33333333-3333-4333-a333-333333333333'

const item: IssuerNewsItem = {
  document_id: '11111111-1111-4111-a111-111111111111',
  kind: 'filing',
  title: 'Q1 FY26 10-Q',
  published_at: '2026-05-03T00:00:00.000Z',
  provider: 'sec_edgar',
  provider_doc_id: '0000320193-26-000050',
}

test('fetchIssuerNews calls the public read with issuer_id + limit and returns items', async () => {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ items: [item] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const items = await fetchIssuerNews(ISSUER_ID, { limit: 8, fetchImpl })
  assert.equal(items.length, 1)
  assert.equal(items[0].provider, 'sec_edgar')
  assert.match(calls[0], /\/v1\/evidence\/issuer-news\?/)
  assert.match(calls[0], new RegExp(`issuer_id=${ISSUER_ID}`))
  assert.match(calls[0], /limit=8/)
})

test('fetchIssuerNews throws on a non-ok response', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch
  await assert.rejects(() => fetchIssuerNews(ISSUER_ID, { fetchImpl }), /HTTP 500/)
})

test('isFilingKind separates filings/transcripts from news', () => {
  assert.equal(isFilingKind('filing'), true)
  assert.equal(isFilingKind('transcript'), true)
  assert.equal(isFilingKind('article'), false)
  assert.equal(isFilingKind('social_post'), false)
})

test('formatRelativeTime buckets by magnitude', () => {
  const now = new Date('2026-05-03T06:00:00.000Z')
  assert.equal(formatRelativeTime('2026-05-03T04:00:00.000Z', now), '2h ago')
  assert.equal(formatRelativeTime('2026-05-01T06:00:00.000Z', now), '2d ago')
  assert.equal(formatRelativeTime('2026-05-03T05:59:30.000Z', now), 'just now')
  assert.equal(formatRelativeTime(null, now), '')
})
