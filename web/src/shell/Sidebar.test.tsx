import '../pages/installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import { AuthContext } from './authTypes.ts'
import { Sidebar } from './Sidebar.tsx'
import { SidebarSlotProvider } from './SidebarSlotProvider.tsx'
import { ThemeContext } from './themeTypes.ts'
import { useSidebarSlot } from './useSidebarSlot.ts'
import { WatchlistContext } from '../watchlists/watchlistContext.ts'
import type { ManualWatchlistState } from '../watchlists/useManualWatchlist.ts'

// about:blank has no storage; the collapse choice persists through localStorage.
Object.assign(globalThis, { localStorage: new JSDOM('', { url: 'http://localhost/' }).window.localStorage })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Claims the sidebar's lower section and portals into it, as ChatLayout does.
function ClaimingPage() {
  const { setClaimed, node, collapsed } = useSidebarSlot()
  useLayoutEffect(() => {
    setClaimed(true)
    return () => setClaimed(false)
  }, [setClaimed])
  return node && !collapsed ? createPortal(<nav aria-label="Chats">Chat list</nav>, node) : null
}

const emptyWatchlist: ManualWatchlistState = {
  members: [],
  load: { status: 'idle' },
  editError: null,
  addSubject: async () => undefined,
  removeSubject: async () => undefined,
  reload: () => undefined,
}

async function mount(children: ReactNode) {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <AuthContext.Provider value={{ session: { userId: 'u1', displayName: 'Test User' }, signIn: () => undefined, signOut: () => undefined }}>
        <ThemeContext.Provider value={{ mode: 'system', resolved: 'light', setMode: () => undefined }}>
          <WatchlistContext.Provider value={emptyWatchlist}>
            <SidebarSlotProvider>
              <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>
            </SidebarSlotProvider>
          </WatchlistContext.Provider>
        </ThemeContext.Provider>
      </AuthContext.Provider>,
    ),
  )
  const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  return { container, button, unmount: () => act(async () => root.unmount()) }
}

test('a page that claims the sidebar shows its content there instead of the watchlist', async () => {
  localStorage.clear()
  const view = await mount(
    <>
      <Sidebar />
      <ClaimingPage />
    </>,
  )
  const aside = view.container.querySelector('aside')!
  assert.equal(aside.querySelector('nav[aria-label="Chats"]')?.textContent, 'Chat list')
  assert.equal(aside.querySelector('[aria-label="Watchlist"]'), null)
  await view.unmount()
})

test('a collapsed sidebar keeps named controls, takes focus to Expand, and stays collapsed on return', async () => {
  localStorage.clear()
  const view = await mount(
    <>
      <Sidebar />
      <ClaimingPage />
    </>,
  )
  view.button('Collapse sidebar')!.focus()
  await act(async () => view.button('Collapse sidebar')!.click())

  assert.equal(localStorage.getItem('sidebar-collapsed'), 'true')
  assert.equal(document.activeElement, view.button('Expand sidebar'))
  const names = [...view.container.querySelectorAll('nav[aria-label="Primary workspaces"] a')].map((link) => link.textContent)
  assert.deepEqual(names.slice(0, 3), ['Home', 'Agents', 'Review'])
  assert.ok(view.button('Sign out'), 'the session control stays reachable')
  assert.equal(view.container.querySelectorAll('[role="radiogroup"][aria-label="Theme"] [role="radio"]').length, 3)
  assert.equal(view.container.querySelector('nav[aria-label="Chats"]'), null, 'the claimed section folds away')
  await view.unmount()

  const again = await mount(<Sidebar />)
  assert.ok(again.button('Expand sidebar'), 'the choice survives a remount')
  await again.unmount()
})
