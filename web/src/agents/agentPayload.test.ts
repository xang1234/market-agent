import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentPayloadValidationError, buildAgentPayload, canRoundTripUniverse } from './agentPayload.ts'
import { dynamicUniverseIdFor, universeLabel } from './agentLabels.ts'

const BASE_STATE = {
  name: 'Monitor',
  thesis: 'Track risk',
  cadence: 'daily',
  universeMode: 'static' as const,
  staticSubjectRefsText: '',
  dynamicUniverseId: '',
  subjectKind: 'issuer' as const,
  subjectId: '',
  alertRuleId: '',
  alertSeverity: 'medium',
  alertHeadline: '',
  alertEmail: false,
  alertWebPush: false,
  alertSms: false,
  alertMobilePush: false,
  alertDigest: false,
}

test('buildAgentPayload trims manual static subject ids but rejects invalid lines', () => {
  assert.deepEqual(
    buildAgentPayload({
      ...BASE_STATE,
      staticSubjectRefsText: 'issuer: 11111111-1111-4111-8111-111111111111',
    }).universe,
    { mode: 'static', subject_refs: [{ kind: 'issuer', id: '11111111-1111-4111-8111-111111111111' }] },
  )

  assert.throws(
    () => buildAgentPayload({
      ...BASE_STATE,
      staticSubjectRefsText: 'issuer:11111111-1111-4111-8111-111111111111\nlisting:AAPL',
    }),
    (error: unknown) =>
      error instanceof AgentPayloadValidationError &&
      error.message === 'Static subject ref line 2 must be kind:uuid',
  )
})

test('buildAgentPayload rejects invalid dynamic universe ids instead of coercing to empty static universe', () => {
  assert.throws(
    () => buildAgentPayload({
      ...BASE_STATE,
      universeMode: 'theme',
      dynamicUniverseId: 'theme-123',
    }),
    (error: unknown) =>
      error instanceof AgentPayloadValidationError &&
      error.message === 'theme universe id must be a UUID',
  )
})

test('buildAgentPayload preserves unsupported existing universes before validating editable fields', () => {
  const unsupportedUniverse = { mode: 'custom_query', query_id: 'legacy-query' }

  assert.equal(
    buildAgentPayload({
      ...BASE_STATE,
      universeMode: 'theme',
      dynamicUniverseId: '',
    }, {
      universe: unsupportedUniverse,
    }).universe,
    unsupportedUniverse,
  )
})

test('a watchlist universe round-trips through the form and is labelled by its name', () => {
  const watchlistId = '22222222-2222-4222-8222-222222222222'
  const universe = buildAgentPayload({ ...BASE_STATE, universeMode: 'watchlist', dynamicUniverseId: watchlistId }).universe
  assert.deepEqual(universe, { mode: 'watchlist', watchlist_id: watchlistId })
  assert.equal(canRoundTripUniverse(universe), true)
  assert.equal(dynamicUniverseIdFor({ mode: 'watchlist', watchlist_id: watchlistId }), watchlistId)
  assert.equal(universeLabel({ mode: 'watchlist', watchlist_id: watchlistId }, new Map([[watchlistId, 'Semis']])), 'watchlist: Semis')
  assert.equal(universeLabel({ mode: 'watchlist', watchlist_id: watchlistId }), `watchlist: ${watchlistId}`)
})
