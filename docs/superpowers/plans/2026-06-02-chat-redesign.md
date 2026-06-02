# Chat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the analyst's markdown answers properly (tables/headers/bold), give tables & charts room via left-aligned prose + breakout columns, and add Enter-to-send, new-chat, and delete-chat controls.

**Architecture:** Frontend-only (`web/`). A new themed `Markdown` component (react-markdown + remark-gfm) renders rich-text segments. `turnLayout.tsx` gains left-aligned prose (680px) and breakout (960px) width wrappers chosen per block kind. `ChatPage.tsx` gains a collapsible sidebar with new-chat/delete controls and an Enter-to-send composer. No backend changes — `POST` and `DELETE /v1/chat/threads` already exist.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, `react-markdown`, `remark-gfm`. Tests: `node --import tsx --test` with jsdom + `react-dom/client`.

**Conventions:**
- Run a single test file: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/path/to/file.test.tsx`
- Typecheck (covers test files): `cd web && npm run typecheck`
- Component tests use jsdom. Copy the `installDomGlobals(dom.window)` helper and the provider-wrapper boilerplate from `web/src/blocks/blockView.test.tsx` (top ~60 lines) as the template for any test that mounts React.

---

## File structure

| File | Responsibility |
|---|---|
| `web/package.json` | add `react-markdown`, `remark-gfm` deps |
| `web/src/blocks/Markdown.tsx` (new) | themed GFM markdown → React renderer |
| `web/src/blocks/Markdown.test.tsx` (new) | markdown render tests |
| `web/src/blocks/RichText.tsx` | render text segments via `Markdown`; `<p>`→`<div>`; refs unchanged |
| `web/src/chat/turnLayout.tsx` | `isWideBlock`, `BlockColumn`, prose/breakout width constants (left-aligned) |
| `web/src/chat/turnLayout.test.tsx` (new) | `isWideBlock` + `BlockColumn` tests |
| `web/src/chat/MessageItem.tsx` | wrap each assistant block in `BlockColumn`; keep user bubble right |
| `web/src/chat/StreamingTurnView.tsx` | same per-block column wrapping for in-flight blocks |
| `web/src/pages/ChatPage.tsx` | collapsible sidebar, slim top bar, Enter-to-send, new-chat + delete |

---

## Task 1: Markdown component (deps + renderer)

**Files:**
- Modify: `web/package.json`
- Create: `web/src/blocks/Markdown.tsx`
- Test: `web/src/blocks/Markdown.test.tsx`

- [ ] **Step 1: Install deps**

Run: `cd web && npm install react-markdown@^9 remark-gfm@^4`
Expected: `package.json` + `package-lock.json` updated, no errors.

- [ ] **Step 2: Write the failing test**

Create `web/src/blocks/Markdown.test.tsx` (copy `installDomGlobals` from `blockView.test.tsx`):

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "./Markdown.tsx";

// installDomGlobals: copy verbatim from web/src/blocks/blockView.test.tsx
function installDomGlobals(window: Window) {
  const g = globalThis as Record<string, unknown>;
  const keys = ["window", "document", "navigator", "HTMLElement", "Node", "getComputedStyle"];
  const prev = Object.fromEntries(keys.map((k) => [k, g[k]]));
  for (const k of keys) g[k] = (window as unknown as Record<string, unknown>)[k];
  return () => { for (const k of keys) g[k] = prev[k]; };
}

async function renderHtml(node: React.ReactNode): Promise<string> {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { root.render(node as React.ReactElement); });
    return dom.window.document.getElementById("root")!.innerHTML;
  } finally { restore(); }
}

test("Markdown renders a GFM table as a real table", async () => {
  const md = "| Metric | FY25 |\n| --- | --- |\n| Revenue | $12.59B |";
  const html = await renderHtml(<Markdown text={md} />);
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]*>Metric<\/th>/);
  assert.match(html, /<td[^>]*>\$12\.59B<\/td>/);
});

test("Markdown renders bold and headings", async () => {
  const html = await renderHtml(<Markdown text={"# GLW\n\n**$176.70**"} />);
  assert.match(html, /<h1[^>]*>GLW<\/h1>/);
  assert.match(html, /<strong[^>]*>\$176\.70<\/strong>/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/blocks/Markdown.test.tsx`
Expected: FAIL — cannot find `./Markdown.tsx`.

- [ ] **Step 4: Implement `Markdown.tsx`**

Create `web/src/blocks/Markdown.tsx`:

```tsx
import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Themed GFM renderer for analyst answers. Block-level output (tables, headings)
// means the caller must render this inside a <div>, never a <p>.
export function Markdown({ text }: { text: string }): ReactElement {
  return (
    <div className="text-sm leading-6 text-fg-soft [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold text-fg">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold text-fg">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">{children}</a>,
          code: ({ children }) => <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">{children}</code>,
          pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">{children}</pre>,
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
          th: ({ children }) => <th className="border border-line px-2 py-1 text-right first:text-left">{children}</th>,
          td: ({ children }) => <td className="num border border-line px-2 py-1 text-right first:text-left">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/blocks/Markdown.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/blocks/Markdown.tsx web/src/blocks/Markdown.test.tsx
git commit -m "feat(web): themed GFM markdown renderer for analyst answers"
```

---

## Task 2: RichText renders markdown for text segments

**Files:**
- Modify: `web/src/blocks/RichText.tsx`
- Test: `web/src/blocks/RichText.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `web/src/blocks/RichText.test.tsx` (reuse the `renderHtml` helper pattern from Task 1; wrap in the same providers as `blockView.test.tsx` — `EvidenceInspectorProvider` + `AuthContext` + `BlockRegistryProvider` + snapshot manifest context). Minimal version mounting `RichText` directly with a null manifest context:

```tsx
test("RichText renders a markdown table from a text segment", async () => {
  const block = {
    id: "rt-1", kind: "rich_text", snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: "rich_text", id: "rt-1" }, source_refs: [],
    as_of: "2026-06-02T00:00:00.000Z", title: "A",
    segments: [{ type: "text", text: "| M | FY25 |\n| --- | --- |\n| Rev | $12B |" }],
  } as RichTextBlock;
  const html = await renderRichText(block); // mounts RichText inside SnapshotManifestProvider value={null}
  assert.match(html, /<table/);
  assert.match(html, /<td[^>]*>\$12B<\/td>/);
});
```

(For the ref-segment regression, keep the existing `blockView.test.tsx` ref test — it already covers `InspectableRef` rendering and must stay green.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/blocks/RichText.test.tsx`
Expected: FAIL — output contains the literal `| M | FY25 |` text, no `<table>`.

- [ ] **Step 3: Modify `RichText.tsx`**

Change the container and the plain-text branch. Replace the `<p ...>` wrapper with a `<div ...>` and render text segments via `Markdown`:

```tsx
// imports: add
import { Markdown } from './Markdown.tsx'

// in RichText(): change <p ...> to:
return (
  <div
    data-testid={`block-rich-text-${block.id}`}
    data-block-kind="rich_text"
    className="text-sm leading-6 text-fg-soft"
  >
    {block.segments.map((segment, index) => {
      if (isRefSegment(segment)) {
        return (
          <RefSegmentSpan
            key={`${block.id}-seg-${index}`}
            snapshotId={block.snapshot_id}
            blockId={block.id}
            index={index}
            segment={segment}
            manifest={manifest}
          />
        )
      }
      return <Markdown key={`${block.id}-seg-${index}`} text={segment.text} />
    })}
  </div>
)
```

(`RefSegmentSpan` is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/blocks/RichText.test.tsx src/blocks/blockView.test.tsx`
Expected: PASS — new markdown test passes, ref-segment test still passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/blocks/RichText.tsx web/src/blocks/RichText.test.tsx
git commit -m "feat(web): render rich-text segments as markdown (refs unchanged)"
```

---

## Task 3: Left-aligned prose + breakout columns

**Files:**
- Modify: `web/src/chat/turnLayout.tsx`
- Test: `web/src/chat/turnLayout.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `web/src/chat/turnLayout.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { isWideBlock, PROSE_COLUMN_CLASS, BREAKOUT_COLUMN_CLASS } from "./turnLayout.tsx";

test("artifact block kinds break out wide; text kinds stay prose", () => {
  assert.equal(isWideBlock("metrics_comparison"), true);
  assert.equal(isWideBlock("series_chart"), true);
  assert.equal(isWideBlock("segment_donut"), true);
  assert.equal(isWideBlock("rich_text"), false);
  assert.equal(isWideBlock("finding_card"), false);
});

test("columns are left-aligned (no mx-auto)", () => {
  assert.doesNotMatch(PROSE_COLUMN_CLASS, /mx-auto/);
  assert.doesNotMatch(BREAKOUT_COLUMN_CLASS, /mx-auto/);
  assert.match(PROSE_COLUMN_CLASS, /max-w-\[680px\]/);
  assert.match(BREAKOUT_COLUMN_CLASS, /max-w-\[960px\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/chat/turnLayout.test.tsx`
Expected: FAIL — `isWideBlock`/`PROSE_COLUMN_CLASS`/`BREAKOUT_COLUMN_CLASS` not exported.

- [ ] **Step 3: Add to `turnLayout.tsx`**

Append (and keep the existing `ThreadColumn`/`AssistantTurn`/`USER_BUBBLE_CLASS` exports — `ThreadColumn` is still used by the composer and transient column in `ChatPage`; just change its class to left-aligned):

```tsx
// Change THREAD_COLUMN_CLASS to left-aligned (was mx-auto ... max-w-[780px]):
export const THREAD_COLUMN_CLASS = 'w-full max-w-[960px]'

// Prose width for text-y blocks; breakout width for data artifacts. Both left-aligned.
export const PROSE_COLUMN_CLASS = 'w-full max-w-[680px]'
export const BREAKOUT_COLUMN_CLASS = 'w-full max-w-[960px]'

// Block kinds that hold tabular/graphical data and deserve the wider column.
const WIDE_BLOCK_KINDS: ReadonlySet<string> = new Set([
  'metrics_comparison',
  'series_chart',
  'segment_donut',
  'analyst_consensus',
  'holders_table',
  'statements_table',
])

export function isWideBlock(kind: string): boolean {
  return WIDE_BLOCK_KINDS.has(kind)
}

// Wraps a single block at the right width based on its kind.
export function BlockColumn({ kind, children }: { kind: string; children: ReactNode }) {
  return <div className={isWideBlock(kind) ? BREAKOUT_COLUMN_CLASS : PROSE_COLUMN_CLASS}>{children}</div>
}
```

> Implementation note: confirm the real block-kind strings against `web/src/blocks/types.ts` / `blockSchema.json` during this task and adjust `WIDE_BLOCK_KINDS` to the exact kinds present (e.g. the metrics-comparison and chart blocks). The test above asserts the intent; align the set to actual kinds.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/chat/turnLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/chat/turnLayout.tsx web/src/chat/turnLayout.test.tsx
git commit -m "feat(web): left-aligned prose + breakout column helpers for chat blocks"
```

---

## Task 4: Per-block columns in MessageItem + StreamingTurnView

**Files:**
- Modify: `web/src/chat/MessageItem.tsx`
- Modify: `web/src/chat/StreamingTurnView.tsx`

- [ ] **Step 1: Write the failing test**

Add to `web/src/chat/turnLayout.test.tsx` (or a new `MessageItem.test.tsx` using the jsdom mount helper) a render assertion: an assistant message containing a `rich_text` block and a wide block renders the wide block inside `max-w-[960px]` and the text block inside `max-w-[680px]`. Concretely, mount `MessageItem` with a two-block assistant message and assert both wrapper classes appear in `innerHTML`.

```tsx
test("assistant blocks get per-kind width wrappers", async () => {
  const message = { message_id: "m1", role: "assistant", blocks: [
    { id: "b1", kind: "rich_text", /* …minimal fields… */ },
    { id: "b2", kind: "metrics_comparison", /* …minimal fields… */ },
  ] } as ChatMessage;
  const html = await renderMessageItem(message); // jsdom mount w/ block providers
  assert.match(html, /max-w-\[680px\]/);
  assert.match(html, /max-w-\[960px\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/chat/MessageItem.test.tsx`
Expected: FAIL — only one width (or none) present; blocks currently share one card.

- [ ] **Step 3: Modify `MessageItem.tsx`**

Wrap each assistant block in `BlockColumn`. Keep the user bubble right-aligned. Replace the blocks mapping + assistant branch:

```tsx
import { AssistantTurn, BlockColumn, USER_BUBBLE_CLASS } from './turnLayout.tsx'

// inside MessageItemInner, replace the `blocks` const + return body:
const isUser = message.role === 'user'
return (
  <div
    ref={ref}
    data-testid={`chat-message-${message.message_id}`}
    data-message-id={message.message_id}
    data-role={message.role}
    className={`flex flex-col py-2 ${isUser ? 'items-end' : 'items-start'}`}
  >
    {isUser ? (
      <div className={USER_BUBBLE_CLASS}>
        {message.blocks.map((block) => <MemoizedBlockView key={block.id} block={block} />)}
      </div>
    ) : (
      <div className="flex w-full flex-col gap-3">
        {message.blocks.map((block) => (
          <BlockColumn key={block.id} kind={block.kind}>
            <AssistantTurn><MemoizedBlockView block={block} /></AssistantTurn>
          </BlockColumn>
        ))}
      </div>
    )}
  </div>
)
```

(Note: this renders each assistant block in its own `AssistantTurn` card at its column width — matching the approved mock where prose and the table sit in separate, differently-sized cards. `items-stretch` becomes `items-start` so cards left-align.)

- [ ] **Step 4: Apply the same wrapping in `StreamingTurnView.tsx`**

Read `web/src/chat/StreamingTurnView.tsx`; wherever it maps in-flight blocks, wrap each in `<BlockColumn kind={block.kind}>` the same way so streaming and persisted turns align. (In-flight text still renders via `RichText`/`Markdown`; that's fine.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/chat/MessageItem.test.tsx src/chat/turnLayout.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/chat/MessageItem.tsx web/src/chat/StreamingTurnView.tsx web/src/chat/MessageItem.test.tsx
git commit -m "feat(web): per-block left-aligned width columns in chat turns"
```

---

## Task 5: Enter-to-send composer

**Files:**
- Modify: `web/src/pages/ChatPage.tsx` (`ChatThreadView`)

- [ ] **Step 1: Write the failing test**

Add `web/src/pages/ChatPage.composer.test.tsx`: mount `ChatThreadView` (inside `MemoryRouter` + `AuthContext` with a session, mock `persistUserChatTurn`/`openChatTurnStream`), type into the textarea, dispatch a `keydown` Enter, and assert the submit path ran (e.g. `persistUserChatTurn` called). Then dispatch Shift+Enter and assert it did NOT submit.

```tsx
// Pseudocode of the key assertions (use the jsdom mount + module mocks pattern):
fireKeyDown(textarea, { key: "Enter", shiftKey: false });
assert.equal(persistCalls.length, 1);
fireKeyDown(textarea, { key: "Enter", shiftKey: true });
assert.equal(persistCalls.length, 1); // unchanged
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/pages/ChatPage.composer.test.tsx`
Expected: FAIL — Enter does not submit (no handler).

- [ ] **Step 3: Add the key handler + hint in `ChatThreadView`**

Add an `onKeyDown` to the textarea (line ~266) and a hint line under the composer box:

```tsx
// Add a ref-free handler near submitPrompt:
const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // Enter sends; Shift+Enter inserts a newline. Ignore while an IME is composing.
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
}

// On the <textarea>, add: onKeyDown={handleComposerKeyDown}
// Under the rounded composer box (after the closing </div> of the input row), add:
<p className="mt-1.5 text-[11px] text-faint">
  Press <span className="font-medium text-muted">Enter</span> to send ·{' '}
  <span className="font-medium text-muted">Shift+Enter</span> for a newline
</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/pages/ChatPage.composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ChatPage.tsx src/pages/ChatPage.composer.test.tsx
git commit -m "feat(web): Enter-to-send composer (Shift+Enter newline, IME-safe)"
```

---

## Task 6: New-chat button in sidebar

**Files:**
- Modify: `web/src/pages/ChatPage.tsx` (`ChatLayout`, `ThreadList`)

- [ ] **Step 1: Write the failing test**

Add to a `web/src/pages/ChatPage.sidebar.test.tsx`: mount `ChatLayout` with a session and a mocked `authenticatedJson` that returns a new thread; click the "New chat" button; assert `POST /v1/chat/threads` was called and navigation occurred (mock `useNavigate`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/pages/ChatPage.sidebar.test.tsx`
Expected: FAIL — no "New chat" button.

- [ ] **Step 3: Implement**

Extract a `createThread` helper (reuse `ChatEmptyState`'s POST body `{ title: null }`) and add a button at the top of `ThreadList`. Lift thread-list refresh into a key/callback so a created thread appears:

```tsx
// In ThreadList, add a refreshKey prop and an onCreate handler:
async function createThreadAndOpen(userId: string, navigate: NavigateFunction) {
  const thread = await authenticatedJson<ChatThread>('/v1/chat/threads', {
    userId, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: null }),
  })
  navigate(`/chat/${thread.thread_id}`)
}

// Button JSX at top of the <nav>:
<button
  type="button"
  onClick={() => void createThreadAndOpen(userId, navigate).then(() => bumpRefresh())}
  className={`${PRIMARY_BUTTON_CLASS} w-full justify-center`}
>
  + New chat
</button>
```

Wire `useNavigate()` into `ThreadList`, and a `refreshKey` state in `ChatLayout` passed to `ThreadList` so create/delete re-fetch the list (the existing `useEffect` already depends on `userId`; add `refreshKey` to its dependency array).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/pages/ChatPage.sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ChatPage.tsx src/pages/ChatPage.sidebar.test.tsx
git commit -m "feat(web): new-chat button in chat sidebar"
```

---

## Task 7: Per-thread delete

**Files:**
- Modify: `web/src/pages/ChatPage.tsx` (`ThreadList`)

- [ ] **Step 1: Write the failing test**

In `ChatPage.sidebar.test.tsx`, add: render a thread row, stub `window.confirm` → true, mock `authenticatedFetch` for `DELETE`, click the row's delete control, assert `DELETE /v1/chat/threads/:id` was called and the row is removed from the rendered list.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/pages/ChatPage.sidebar.test.tsx`
Expected: FAIL — no delete control.

- [ ] **Step 3: Implement**

Add a delete button to each thread `<li>` (visible on hover / on the active row), guarded by `window.confirm`:

```tsx
async function deleteThread(userId: string, threadId: string): Promise<void> {
  const res = await authenticatedFetch(`/v1/chat/threads/${encodeURIComponent(threadId)}`, {
    userId, method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
}

// In the row, beside the <Link>:
<button
  type="button"
  aria-label={`Delete ${thread.title ?? 'thread'}`}
  className="opacity-0 group-hover:opacity-100 text-muted hover:text-negative"
  onClick={(e) => {
    e.preventDefault()
    if (!window.confirm('Delete this chat? This cannot be undone.')) return
    void deleteThread(userId, thread.thread_id).then(() => {
      bumpRefresh()
      if (location.pathname.includes(thread.thread_id)) navigate('/chat')
    })
  }}
>🗑</button>
```

Make the `<li>` a `group relative` so `group-hover` reveals the button. Use `useNavigate` + `useLocation` already available in the module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test src/pages/ChatPage.sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ChatPage.tsx
git commit -m "feat(web): delete (archive) chats from the sidebar"
```

---

## Task 8: Collapsible sidebar + slim top bar + left-aligned stream

**Files:**
- Modify: `web/src/pages/ChatPage.tsx` (`ChatLayout`, `ChatThreadView`)

- [ ] **Step 1: Implement the slim header + collapse**

In `ChatLayout`, replace the tall `<header>` (the "Chat / Thread-scoped research workspace…" block) with nothing (or fold the title into the sidebar). Add a `collapsed` state and toggle:

```tsx
const [collapsed, setCollapsed] = useState(false)
// grid columns: collapsed ? '0px_1fr' (hide aside) : '260px_1fr'
<div className={`grid min-h-0 flex-1 ${collapsed ? 'grid-cols-[0px_minmax(0,1fr)]' : 'grid-cols-[260px_minmax(0,1fr)]'} overflow-hidden`}>
  <aside className={`min-h-0 border-r border-line bg-surface-2/70 ${collapsed ? 'hidden' : 'p-4'}`}>
    <ThreadList userId={userId} refreshKey={refreshKey} />
  </aside>
  <div className="min-h-0 overflow-auto"><Outlet context={{ collapsed, setCollapsed }} /></div>
</div>
```

In `ChatThreadView`, replace the `Message stream` / raw-`threadId` header section with a slim top bar containing the collapse toggle and the thread label:

```tsx
<section className="flex items-center gap-3 border-b border-line px-6 py-2.5">
  <button type="button" onClick={() => setCollapsed((c) => !c)} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
    {collapsed ? '☰' : '⟨'}
  </button>
  <span className="num text-xs text-faint">{threadId}</span>
</section>
```

(`collapsed`/`setCollapsed` come from `useOutletContext`. Define a typed context shape.)

- [ ] **Step 2: Left-align the stream**

Change the stream container so content aligns left: the `ThreadColumn` already became left-aligned in Task 3 (`w-full max-w-[960px]`, no `mx-auto`). Confirm `ChatThreadView`'s stream wrapper does not re-center (no `items-center`/`mx-auto`).

- [ ] **Step 3: Typecheck + run web tests**

Run: `cd web && npm run typecheck && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/**/*.test.ts' 'src/**/*.test.tsx'`
Expected: typecheck clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ChatPage.tsx
git commit -m "feat(web): collapsible sidebar, slim top bar, left-aligned chat stream"
```

---

## Task 9: Full verification + manual run

- [ ] **Step 1: Typecheck, lint, test**

Run:
```bash
cd web && npm run typecheck
cd web && npx eslint src/blocks/Markdown.tsx src/blocks/RichText.tsx src/chat/turnLayout.tsx src/chat/MessageItem.tsx src/pages/ChatPage.tsx
cd web && TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/**/*.test.ts' 'src/**/*.test.tsx'
```
Expected: all clean / green.

- [ ] **Step 2: Manual smoke (restart dev stack)**

Restart so the running web picks up changes, then verify in the browser at the chat section:
```bash
./scripts/dev-shell.sh down && ./scripts/dev-shell.sh up
```
Check: (a) "tell me about GLW" renders a styled table + headings (not raw markdown); (b) prose is left-aligned, table is wider than prose; (c) Enter sends, Shift+Enter newlines; (d) "+ New chat" creates and opens a thread; (e) deleting a thread removes it and confirms first; (f) collapse hides the sidebar.

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/chat-redesign
gh pr create --base main --title "feat(web): chat redesign — markdown rendering, breakout layout, thread controls" --body "Implements docs/superpowers/specs/2026-06-02-chat-redesign-design.md"
```

---

## Self-review notes

- **Spec coverage:** markdown (T1–T2), widths/breakout/left-align (T3–T4, T8), Enter-to-send (T5), new-chat (T6), delete (T7), collapsible sidebar/slim header (T8). All spec sections map to a task.
- **Block-kind strings:** `isWideBlock`'s `WIDE_BLOCK_KINDS` must be reconciled with the real kinds in `web/src/blocks/types.ts` during Task 3 (flagged inline).
- **Test boilerplate:** component tests reuse the `installDomGlobals` + provider-wrapper pattern from `blockView.test.tsx`; that file is the canonical template.
- **Naming consistency:** `BlockColumn(kind)`, `isWideBlock(kind)`, `PROSE_COLUMN_CLASS`, `BREAKOUT_COLUMN_CLASS`, `bumpRefresh`/`refreshKey` used consistently across tasks.
