import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'

import { ThemeMembershipRationaleList, type ThemeMembershipRationaleView } from './ThemeMembershipRationaleList.tsx'
import {
  fetchThemeMembershipRationales,
  parseThemeMembershipRationaleResponse,
} from './themeRationale.ts'

const CLAIM_A = '44444444-4444-4444-8444-444444444444'
const CLAIM_B = '55555555-5555-4555-8555-555555555555'

test('ThemeMembershipRationaleList renders score, membership mode, and rationale claim refs', () => {
  const html = renderToString(
    <ThemeMembershipRationaleList
      memberships={[
        rationale({
          theme_name: 'AI infrastructure',
          membership_mode: 'inferred',
          score: 2,
          rationale_supported: true,
          rationale_claim_ids: [CLAIM_A, CLAIM_B],
        }),
      ]}
    />,
  )

  assert.match(html, /AI infrastructure/)
  assert.match(html, /inferred/)
  assert.match(html, /Score 2/)
  assert.match(html, /2 rationale claims/)
  assert.match(html, /claim:44444444/)
  assert.match(html, /claim:55555555/)
  assert.match(html, /title="claim:44444444-4444-4444-8444-444444444444"/)
})

test('ThemeMembershipRationaleList explains manual memberships without fabricated claim rationale', () => {
  const html = renderToString(
    <ThemeMembershipRationaleList
      memberships={[
        rationale({
          theme_name: 'Manual coverage',
          membership_mode: 'manual',
          score: null,
          rationale_supported: false,
          rationale_claim_ids: [],
        }),
      ]}
    />,
  )

  assert.match(html, /Manual coverage/)
  assert.match(html, /manual/)
  assert.match(html, /No claim rationale for this membership mode/)
  assert.doesNotMatch(html, /claim:/)
})

test('parseThemeMembershipRationaleResponse maps service read-model rows for product rendering', () => {
  const response = parseThemeMembershipRationaleResponse({
    memberships: [
      {
        theme_id: '11111111-1111-4111-8111-111111111111',
        theme_name: 'AI infrastructure',
        theme_description: 'Source-backed AI buildout claims',
        membership_mode: 'rule_based',
        score: 0.75,
        rationale_supported: true,
        rationale_claim_ids: [CLAIM_A],
      },
    ],
    truncated: true,
  })
  const html = renderToString(
    <ThemeMembershipRationaleList memberships={response.memberships} />,
  )

  assert.equal(response.truncated, true)
  assert.match(html, /AI infrastructure/)
  assert.match(html, /rule_based/)
  assert.match(html, /Score 0.75/)
  assert.match(html, /claim:44444444/)
})

test('fetchThemeMembershipRationales calls the real BFF route by subject ref', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input)
    return new Response(
      JSON.stringify({
        memberships: [rationale({ membership_mode: 'inferred' })],
        truncated: false,
      }),
      { status: 200 },
    )
  }) as typeof fetch
  try {
    const response = await fetchThemeMembershipRationales(
      { kind: 'issuer', id: '33333333-3333-4333-8333-333333333333' },
      { limit: 8 },
    )

    assert.equal(
      requestedUrl,
      '/v1/themes/membership-rationales?subject_kind=issuer&subject_id=33333333-3333-4333-8333-333333333333&limit=8',
    )
    assert.equal(response.memberships[0]?.theme_name, 'Theme')
  } finally {
    globalThis.fetch = originalFetch
  }
})

function rationale(overrides: Partial<ThemeMembershipRationaleView> = {}): ThemeMembershipRationaleView {
  return {
    theme_id: '11111111-1111-4111-8111-111111111111',
    theme_name: 'Theme',
    theme_description: null,
    membership_mode: 'inferred',
    score: 1,
    rationale_supported: true,
    rationale_claim_ids: [CLAIM_A],
    ...overrides,
  }
}
