import test from 'node:test'
import assert from 'node:assert/strict'
import { ProtectedActionType, type ProtectedAction } from './authInterruptState.ts'
import {
  clearProtectedActionRegistryForTests,
  dispatchProtectedAction,
  registerProtectedActionHandler,
} from './protectedActionRegistry.ts'

const action: ProtectedAction = {
  actionType: ProtectedActionType.SaveToWatchlist,
  payload: {
    symbol: 'AAPL',
  },
}

test.afterEach(() => {
  clearProtectedActionRegistryForTests()
})

test('dispatchProtectedAction invokes registered action handlers by type', () => {
  const handled: ProtectedAction[] = []

  registerProtectedActionHandler(ProtectedActionType.SaveToWatchlist, (next) => {
    handled.push(next)
  })

  assert.equal(dispatchProtectedAction(action), true)
  assert.deepEqual(handled, [action])
})

test('dispatchProtectedAction queues actions until a typed handler registers', () => {
  const handled: ProtectedAction[] = []

  assert.equal(dispatchProtectedAction(action), false)

  registerProtectedActionHandler(ProtectedActionType.SaveToWatchlist, (next) => {
    handled.push(next)
  })

  assert.deepEqual(handled, [action])
})

test('registered action handlers can be removed', () => {
  const handled: ProtectedAction[] = []
  const unregister = registerProtectedActionHandler(ProtectedActionType.SaveToWatchlist, (next) => {
    handled.push(next)
  })

  unregister()

  assert.equal(dispatchProtectedAction(action), false)
  assert.deepEqual(handled, [])
})
