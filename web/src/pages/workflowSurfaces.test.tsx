import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AgentsPage } from './AgentsPage.tsx'
import { AnalyzePage } from './AnalyzePage.tsx'
import { ChatEmptyState, ChatLayout, ChatThreadView } from './ChatPage.tsx'
import { BlockRegistryProvider, createDefaultBlockRegistry, type Block } from '../blocks'
import { AuthContext } from '../shell/authTypes.ts'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'

const IMPORTED_MEMO_BLOCK: Block = {
  id: 'memo-block',
  kind: 'rich_text',
  snapshot_id: SNAPSHOT_ID,
  data_ref: { kind: 'analyze_run', id: 'memo-block' },
  source_refs: [],
  as_of: '2026-05-06T00:00:00.000Z',
  segments: [{ type: 'text', text: 'Imported memo content' }],
}

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

test('Chat thread route renders an imported Analyze memo handoff', () => {
  const html = renderWithAuth(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/chat/thread-123',
            state: {
              importedMemo: {
                run_id: 'run-123',
                snapshot_id: SNAPSHOT_ID,
                blocks: [IMPORTED_MEMO_BLOCK],
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/chat/:threadId" element={<ChatThreadView />} />
        </Routes>
      </MemoryRouter>
    </BlockRegistryProvider>,
  )

  assert.match(html, /Imported analyze memo/)
  assert.match(html, /Imported memo content/)
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
  assert.match(html, /Generate memo/)
  assert.match(html, /Add to chat/)
  assert.doesNotMatch(html, /ships with P4\.2/i)
})

test('Agents surface renders CRUD controls, run history, and activity status', () => {
  const html = renderWithAuth(<AgentsPage />)

  assert.match(html, /Create agent/)
  assert.match(html, /Disable/)
  assert.match(html, /Delete/)
  assert.match(html, /Run history/)
  assert.match(html, /Activity/)
  assert.doesNotMatch(html, /ships with P5\.1/i)
})
