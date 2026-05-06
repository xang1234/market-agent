import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AgentsPage } from './AgentsPage.tsx'
import { AnalyzePage } from './AnalyzePage.tsx'
import { ChatEmptyState, ChatLayout, ChatThreadView } from './ChatPage.tsx'
import { AuthContext } from '../shell/authTypes.ts'

const USER_ID = '00000000-0000-4000-8000-000000000001'

function renderWithAuth(element: React.ReactElement): string {
  return renderToString(
    <AuthContext.Provider
      value={{
        session: { userId: USER_ID, displayName: 'Mock User' },
        signIn: () => undefined,
        signOut: () => undefined,
      }}
    >
      {element}
    </AuthContext.Provider>,
  )
}

test('Chat surface renders thread list and composer workflow copy without phase placeholders', () => {
  const html = renderWithAuth(
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="/chat" element={<ChatLayout />}>
          <Route index element={<ChatEmptyState />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Thread list/)
  assert.match(html, /Start research/)
  assert.doesNotMatch(html, /ships with P2\.1/i)
})

test('Chat thread route renders message stream and composer workflow copy', () => {
  const html = renderWithAuth(
    <MemoryRouter initialEntries={['/chat/thread-123']}>
      <Routes>
        <Route path="/chat" element={<ChatLayout />}>
          <Route path=":threadId" element={<ChatThreadView />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Message stream/)
  assert.match(html, /Ask the analyst/)
  assert.doesNotMatch(html, /ships with P2\.1/i)
})

test('Analyze surface renders template controls, source controls, memo canvas, and Add to chat action', () => {
  const html = renderWithAuth(
    <MemoryRouter initialEntries={['/analyze']}>
      <Routes>
        <Route path="/analyze" element={<AnalyzePage />} />
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Template/)
  assert.match(html, /Instructions/)
  assert.match(html, /Source controls/)
  assert.match(html, /Memo canvas/)
  assert.match(html, /Add to chat/)
  assert.doesNotMatch(html, /ships with P4\.2/i)
})

test('Agents surface renders CRUD controls, run history, and activity status', () => {
  const html = renderWithAuth(<AgentsPage />)

  assert.match(html, /Create agent/)
  assert.match(html, /Run history/)
  assert.match(html, /Activity/)
  assert.doesNotMatch(html, /ships with P5\.1/i)
})
