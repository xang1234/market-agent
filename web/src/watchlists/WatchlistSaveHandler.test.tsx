import '../pages/installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { ProtectedActionType } from '../shell/authInterruptState.ts'
import { clearProtectedActionRegistryForTests, dispatchProtectedAction } from '../shell/protectedActionRegistry.ts'
import type { SubjectRef } from '../symbol/search.ts'
import { WatchlistContext } from './watchlistContext.ts'
import type { ManualWatchlistState } from './useManualWatchlist.ts'
import { WatchlistSaveHandler } from './WatchlistSaveHandler.tsx'

test('a save-to-watchlist action is added without the sidebar watchlist mounted', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  clearProtectedActionRegistryForTests()
  const added: SubjectRef[] = []
  const watchlist: ManualWatchlistState = {
    members: [],
    load: { status: 'idle' },
    editError: null,
    addSubject: async (ref) => {
      added.push(ref)
    },
    removeSubject: async () => undefined,
    reload: () => undefined,
  }
  const ref: SubjectRef = { kind: 'listing', id: '11111111-1111-4111-a111-111111111111' }
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <WatchlistContext.Provider value={watchlist}>
        <WatchlistSaveHandler />
      </WatchlistContext.Provider>,
    ),
  )

  const handled = dispatchProtectedAction({ actionType: ProtectedActionType.SaveToWatchlist, payload: { subject_ref: ref } })

  assert.equal(handled, true, 'a handler was registered to take the action')
  assert.deepEqual(added, [ref])
  await act(async () => root.unmount())
  clearProtectedActionRegistryForTests()
})
