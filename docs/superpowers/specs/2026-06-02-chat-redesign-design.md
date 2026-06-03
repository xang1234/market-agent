# Chat redesign — design spec

**Date:** 2026-06-02
**Status:** Approved (brainstorming)
**Scope:** `web/` chat experience only. No backend/API changes required.

## Overview

The chat backend was upgraded to produce grounded, markdown-rich analyst answers
(headers, GitHub-flavored tables, bold). The frontend never kept pace: it renders
answer text as plain spans, clamps everything to a narrow centered column, and is
missing basic thread controls. This redesign makes the chat render those answers
properly and gives data (tables/charts) room, while fixing three concrete UX gaps.

Chosen layout direction (validated with mockups): **"A — inline, breakout
artifacts"**, with assistant content **left-aligned**.

## Problems being solved

1. **Markdown renders raw.** `blocks/RichText.tsx:31` renders text segments as a
   plain `<span>`, so `#`, `| tables |`, `**bold**` show as literal characters.
   No markdown library is present.
2. **Enter does not send.** The composer (`ChatPage.tsx:266`) is a `<textarea>`
   with no key handler, so Enter inserts a newline instead of submitting.
3. **No "new chat" from inside a thread.** Thread creation lives only in
   `ChatEmptyState` (the `/chat` index). The sidebar has no create action.
4. **No way to delete chats.** The backend already exposes
   `DELETE /v1/chat/threads/:id` (archive, `threads-http.ts:159`); the sidebar
   never wires it.
5. **Inefficient layout.** `turnLayout.ts THREAD_COLUMN_CLASS = "mx-auto w-full
   max-w-[780px]"` clamps all content — including tables and `SeriesChart` — to a
   centered 780px column, with a tall page header eating vertical space.

## Design

### Layout frame (`ChatLayout`, `ChatThreadView`)

- **Collapsible thread sidebar.** Default ~260px; a collapse toggle in the thread
  top bar hides it to reclaim width. Collapsed state held in component state
  (no persistence needed for v1).
- **Slim top bar** replacing the tall page header — collapse toggle + the active
  thread's subject label. The big "Chat / Thread-scoped research workspace…"
  header block is removed to give the stream vertical room.
- **Left-aligned reading flow.** Assistant content aligns to the left edge of the
  content area (not centered). User messages stay right-aligned (bubble).

### Content widths (`turnLayout.tsx`)

Replace the single centered `THREAD_COLUMN_CLASS` with two left-aligned widths:

- **Prose column** — `max-w-[820px]` for rich-text answers and user/system text (widened from 680px during implementation to fit GFM tables).
- **Breakout column** — `max-w-[960px]` for artifact blocks (markdown tables,
  `metrics_comparison`, `SeriesChart`, `SegmentDonut`, etc.) so data has room.

Both `margin-0` (left-aligned). Widths are tunable constants in `turnLayout.tsx`.
Block kind decides which width wraps it: a small `isWideBlock(kind)` predicate
(artifact/table/chart kinds → breakout; text/finding/news → prose).

### Markdown rendering (`blocks/RichText.tsx` + new `blocks/Markdown.tsx`)

- Add dependencies: **`react-markdown`** + **`remark-gfm`** (GFM tables).
- New `Markdown` component maps markdown elements to themed renderers:
  `table/thead/th/td` (bordered, right-aligned numerics, left-aligned first col),
  `h1–h3`, `p`, `ul/ol/li`, `strong/em`, `code/pre`, `a`. Styling matches the
  mockup (surface card, line borders, `text-negative` is applied by content, not
  the renderer).
- `RichText` change: render **plain text segments** through `Markdown` instead of
  a bare `<span>`. **Ref segments (`isRefSegment`) are unchanged** — they keep
  rendering as `InspectableRef` citation spans.
- The container changes from `<p>` to `<div>` (block-level markdown — tables,
  headings — is invalid inside a `<p>`).
- Common case is clean: grounded answers arrive as a single text segment, so the
  whole answer renders as one markdown block; interleaved ref segments (research
  citations) render as inline siblings.

### Composer (`ChatThreadView`)

- `onKeyDown`: **Enter submits**, **Shift+Enter inserts a newline**. Submit reuses
  the existing `submitPrompt` path. Guard against submitting empty/whitespace and
  during IME composition (`event.nativeEvent.isComposing`).
- Add the hint line: "Press Enter to send · Shift+Enter for a newline".

### Sidebar controls (`ThreadList`)

- **"＋ New chat" button** at the top of the sidebar. Creates a thread
  (`POST /v1/chat/threads` with a null title, the existing `ChatEmptyState` call)
  and navigates to it. The list refreshes to include it.
- **Per-thread delete.** A trash control appears on hover / on the active row.
  Click → confirm → `DELETE /v1/chat/threads/:id` → remove from the list; if the
  deleted thread is the open one, navigate to `/chat`. Reuses `authenticatedFetch`.
- `ThreadList` gains a refresh trigger (callback or key bump) so create/delete
  update without a full reload.

## Components & files

| File | Change |
|---|---|
| `web/package.json` | add `react-markdown`, `remark-gfm` |
| `web/src/blocks/Markdown.tsx` (new) | themed markdown renderer |
| `web/src/blocks/RichText.tsx` | text segments → `Markdown`; `<p>`→`<div>`; refs unchanged |
| `web/src/chat/turnLayout.tsx` | left-aligned prose (680) + breakout (960) columns; `isWideBlock` |
| `web/src/pages/ChatPage.tsx` | collapsible sidebar, slim top bar, composer keydown + hint, new-chat + delete in `ThreadList`, left-align stream |

No changes to `services/` — `POST` and `DELETE /v1/chat/threads` already exist.

## Testing

- **Markdown:** `Markdown`/`RichText` render test — a GFM table string renders a
  `<table>` with rows; bold renders `<strong>`; a ref segment still renders an
  `InspectableRef`.
- **Composer:** Enter triggers submit; Shift+Enter does not; IME composition Enter
  does not submit.
- **Sidebar:** new-chat POSTs and navigates; delete calls DELETE and drops the row
  (mocked fetch); deleting the open thread navigates to `/chat`.
- **Layout:** wide block kinds get the breakout wrapper, text blocks get prose
  (unit test on `isWideBlock` + a render assertion on wrapper class).
- Existing block/chat tests stay green; run `npm run typecheck` (tsc -b, covers
  tests) and `npm test` in `web/`.

## Out of scope (explicit)

- The two-pane "pinned artifact panel" (mockup option B).
- Mobile/responsive polish beyond the sidebar collapse.
- Streaming markdown re-parse optimization (render the final text as markdown;
  in-flight streaming text may render plainly until the block completes).
- Persisting sidebar-collapsed state across reloads.
- Multi-subject comparison answers (separate backend feature).

## Risks / notes

- **Markdown inside refs:** mixing block-level markdown with inline ref segments in
  one block is uncommon (grounded answers are a single text segment). If a future
  answer interleaves both heavily, layout may look stacked; acceptable for v1.
- **Bundle size:** `react-markdown` + `remark-gfm` add ~40–60KB gzipped. Acceptable
  for a research app; both are standard, well-maintained.
- **Streaming:** `StreamingTurnView` shows in-flight deltas; those may render as
  plain text until the sealed block renders through `Markdown`. Fine for v1.
