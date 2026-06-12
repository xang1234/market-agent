# Video-Parity UI Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-priority capability and look-and-feel gaps between the current web client and the reference product shown in `vid1.mp4`/`vid2.mp4` — document-flow chat answers, watchlist sparklines with a timeframe selector, visible keyboard affordances, toned narrative deltas, crosshair-interactive charts, a live perf-comparison chart with range buttons, a hero symbol chart, an Investment Memo playbook, and a section-progress rail on Analyze.

**Architecture:** All frontend work composes existing primitives (`Sparkline`, `SeriesChart`, `SegmentedToggle`, `ChangePill`, the `Block[]` registry, `fetchSeries` batched market API). The one backend task adds a pure-data playbook to `services/analyze` (playbooks are static data; the template runner is generic). The block-schema change (text-segment `tone`) is mirrored spec → web via the existing `npm run sync:schema` script and guarded by `blockSchemaSync.test.ts`.

**Tech Stack:** React 19 + Vite + Tailwind v4, node:test (+tsx) for web tests, `node --experimental-strip-types --test` for services/analyze.

**Out of scope (deliberately deferred to follow-up plans, per gap-analysis rationale):**
- NL screener (`POST /v1/screener/parse` + LLM constrained call) — independent backend subsystem.
- News feed surface — needs a new evidence-service endpoint; independent subsystem.
- Reddit/social ingestion — rejected for now (positioning + cost).
- Accent color change (blue → green) — brand decision for the user; one-token swap when decided.
- Symbol "Profile" sub-tab — low priority; profile card already lives on Overview.

**Verification commands:**
- Web tests: `cd web && npm test` (node --test over `src/**/*.test.ts{,x}`)
- Web typecheck: `cd web && npm run typecheck`
- Analyze service tests: `cd services/analyze && npm test`
- Schema sync: `cd web && npm run sync:schema`

---

### Task 1: Chat answers as document flow (kill per-block cards)

The video renders assistant research as one continuous document on the canvas; the current UI wraps **every block** in its own bordered card (`AssistantTurn` applied per block in both `MessageItem` and `StreamingTurnView`). Change `AssistantTurn` to a borderless document surface and apply it **once per turn**.

**Files:**
- Modify: `web/src/chat/turnLayout.tsx`
- Modify: `web/src/chat/MessageItem.tsx:42-51`
- Modify: `web/src/chat/StreamingTurnView.tsx:29-39`
- Test: `web/src/chat/turnLayout.test.tsx`, `web/src/chat/MessageItem.test.tsx`

- [ ] **Step 1: Run the existing chat tests to see current assertions**

Run: `cd web && npm test 2>&1 | grep -A2 -i "turnLayout\|MessageItem"`
Expected: PASS (baseline).

- [ ] **Step 2: Restyle `AssistantTurn` as a document surface**

In `web/src/chat/turnLayout.tsx` replace the `AssistantTurn` className:

```tsx
// Assistant turns get the full answer canvas as continuous document flow —
// no card chrome. The turn is one surface; blocks inside it are separated by
// vertical rhythm only (reference-terminal reading experience).
export function AssistantTurn({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-col gap-4 py-1 ${className}`.trim()} {...rest}>
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Apply `AssistantTurn` once per turn in `MessageItem`**

Replace the assistant branch (currently wraps each block):

```tsx
      ) : (
        <AssistantTurn className="w-full">
          {message.blocks.map((block) => (
            <BlockColumn key={block.id} kind={block.kind}>
              <MemoizedBlockView block={block} />
            </BlockColumn>
          ))}
        </AssistantTurn>
      )}
```

- [ ] **Step 4: Same change in `StreamingTurnView`**

```tsx
      <AgentPlanPanel steps={state.plan_steps} />
      <AssistantTurn className="w-full">
        {state.block_order.map((block_id) => {
          const block = state.blocks_by_id.get(block_id)
          if (block === undefined) return null
          return (
            <BlockColumn key={block_id} kind={block.kind}>
              <StreamingBlockView block={block} />
            </BlockColumn>
          )
        })}
      </AssistantTurn>
```

- [ ] **Step 5: Run chat tests; update any assertion that expected per-block card classes (border/bg-surface/shadow) or per-block AssistantTurn wrappers to expect the single document wrapper**

Run: `cd web && npm test`
Expected: PASS after updates.

- [ ] **Step 6: Typecheck + commit**

```bash
cd web && npm run typecheck
git add web/src/chat && git commit -m "feat(web): chat answers render as document flow, not per-block cards"
```

---

### Task 2: `tone` on rich_text text segments (inline colored deltas)

The video styles inline deltas (`+127% YoY`) green/red inside sentences. Add an optional `tone` to `TextSegment` in the spec schema, mirror to web, type it, and render it.

**Files:**
- Modify: `spec/finance_research_block_schema.json` (TextSegment $def, ~line 165)
- Modify: `web/src/blocks/blockSchema.json` (via `npm run sync:schema`)
- Modify: `web/src/blocks/types.ts:78`
- Modify: `web/src/blocks/RichText.tsx:34`
- Test: `web/src/blocks/RichText.test.tsx`

- [ ] **Step 1: Write the failing renderer test** (append to `web/src/blocks/RichText.test.tsx`, mirroring its existing render-helper pattern): a rich_text block with segments `[{type:'text',text:'Data Center revenue grew '},{type:'text',text:'+127% YoY',tone:'positive'},{type:'text',text:' last quarter'}]` renders the toned run with class containing `text-positive` and `data-tone="positive"`.

- [ ] **Step 2: Run it** — `cd web && npm test 2>&1 | grep -i richtext` — Expected: FAIL (tone not rendered / type error).

- [ ] **Step 3: Schema change in `spec/finance_research_block_schema.json`** — inside the `TextSegment` properties add:

```json
        "tone": {
          "type": "string",
          "enum": ["positive", "negative", "neutral"]
        }
```

(keep `additionalProperties: false`; `tone` stays optional — not in `required`).

- [ ] **Step 4: Mirror to web** — `cd web && npm run sync:schema`. Run `npm test 2>&1 | grep -i schemaSync` — Expected: PASS.

- [ ] **Step 5: Type it** in `web/src/blocks/types.ts`:

```ts
export type TextSegmentTone = 'positive' | 'negative' | 'neutral'
export type TextSegment = { type: 'text'; text: string; tone?: TextSegmentTone }
```

- [ ] **Step 6: Render it** in `web/src/blocks/RichText.tsx` — replace the plain text-segment span in the multi-segment branch:

```tsx
const TONE_CLASS: Readonly<Record<NonNullable<TextSegment['tone']>, string>> = {
  positive: 'font-medium text-positive',
  negative: 'font-medium text-negative',
  neutral: '',
}
```

and in the map:

```tsx
          : (
            <span
              key={`${block.id}-seg-${index}`}
              data-tone={segment.tone}
              className={segment.tone ? TONE_CLASS[segment.tone] : undefined}
            >
              {segment.text}
            </span>
          ),
```

(import `TextSegment` type; single-segment Markdown fast-path also gains tone by falling through to the multi-segment branch when `onlySegment.tone` is set: change the condition to `onlySegment && !isRefSegment(onlySegment) && onlySegment.tone === undefined`.)

- [ ] **Step 7: Run web tests + typecheck** — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add spec/finance_research_block_schema.json web/src/blocks
git commit -m "feat(blocks): optional tone on rich_text text segments"
```

---

### Task 3: Watchlist sparkline data layer (one batched series fetch)

`fetchSeries` already accepts multiple `subject_refs` — fetch all watchlist listings' daily bars in **one** POST per (members, window) and expose a `Map<listingId, number[]>` of closes.

**Files:**
- Create: `web/src/watchlists/watchlistSparklines.ts` (pure)
- Create: `web/src/watchlists/useWatchlistSparklines.ts` (hook)
- Test: `web/src/watchlists/watchlistSparklines.test.ts`

- [ ] **Step 1: Write failing tests** (`watchlistSparklines.test.ts`, node:test + assert, pattern as in `membership.test.ts`):

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WATCHLIST_WINDOWS,
  watchlistWindowDays,
  watchlistSeriesQuery,
  sparklineClosesByListing,
} from './watchlistSparklines.ts'
import type { GetSeriesResponse } from '../symbol/series.ts'

test('watchlistWindowDays maps fixed windows and computes YTD from now', () => {
  assert.equal(watchlistWindowDays('5D', new Date('2026-06-12T00:00:00Z')), 7)
  assert.equal(watchlistWindowDays('1M', new Date('2026-06-12T00:00:00Z')), 30)
  assert.equal(watchlistWindowDays('6M', new Date('2026-06-12T00:00:00Z')), 180)
  assert.equal(watchlistWindowDays('1Y', new Date('2026-06-12T00:00:00Z')), 365)
  // 2026-01-01 → 2026-06-12 is 162 days; floor + min 7 guard
  assert.equal(watchlistWindowDays('YTD', new Date('2026-06-12T00:00:00Z')), 162)
})

test('watchlistSeriesQuery batches only listing-kind members into one query', () => {
  const query = watchlistSeriesQuery(
    [
      { kind: 'listing', id: 'l-1' },
      { kind: 'issuer', id: 'i-1' },
      { kind: 'listing', id: 'l-2' },
    ],
    '1M',
    new Date('2026-06-12T00:00:00Z'),
  )
  assert.ok(query)
  assert.deepEqual(query.subject_refs.map((r) => r.id), ['l-1', 'l-2'])
  assert.equal(query.interval, '1d')
  assert.equal(query.normalization, 'raw')
})

test('watchlistSeriesQuery returns null with no listings', () => {
  assert.equal(watchlistSeriesQuery([{ kind: 'issuer', id: 'i-1' }], '1M', new Date()), null)
})

test('sparklineClosesByListing keeps available outcomes only', () => {
  const response = {
    query: {} as never,
    results: [
      {
        listing: { kind: 'listing', id: 'l-1' },
        outcome: {
          outcome: 'available',
          data: { bars: [{ close: 1 }, { close: 2 }] },
        },
      },
      {
        listing: { kind: 'listing', id: 'l-2' },
        outcome: { outcome: 'unavailable', reason: 'missing_coverage' },
      },
    ],
  } as unknown as GetSeriesResponse
  const map = sparklineClosesByListing(response)
  assert.deepEqual(map.get('l-1'), [1, 2])
  assert.equal(map.has('l-2'), false)
})
```

- [ ] **Step 2: Run to verify failure** — `cd web && npm test 2>&1 | grep -i watchlistSparklines` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `watchlistSparklines.ts`**

```ts
// Pure helpers for the watchlist rail's inline sparklines: window → day span,
// member list → ONE batched /v1/market/series query (listing-kind members
// only), and response → closes-by-listing map. The hook stays a thin wrapper.

import type { SubjectRef } from '../symbol/search.ts'
import type { GetSeriesResponse, NormalizedSeriesQuery } from '../symbol/series.ts'

export const WATCHLIST_WINDOWS = ['5D', '1M', '6M', 'YTD', '1Y'] as const
export type WatchlistWindow = (typeof WATCHLIST_WINDOWS)[number]

const FIXED_WINDOW_DAYS: Readonly<Record<Exclude<WatchlistWindow, 'YTD'>, number>> = {
  // 7 calendar days ≈ 5 trading bars.
  '5D': 7,
  '1M': 30,
  '6M': 180,
  '1Y': 365,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function watchlistWindowDays(window: WatchlistWindow, now: Date): number {
  if (window !== 'YTD') return FIXED_WINDOW_DAYS[window]
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
  // Min 7 so a January YTD still has enough bars to draw a line.
  return Math.max(7, Math.floor((now.getTime() - yearStart) / DAY_MS))
}

export function watchlistSeriesQuery(
  members: ReadonlyArray<SubjectRef>,
  window: WatchlistWindow,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = members.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  if (listings.length === 0) return null
  const days = watchlistWindowDays(window, now)
  return {
    subject_refs: listings,
    range: {
      start: new Date(now.getTime() - days * DAY_MS).toISOString(),
      end: now.toISOString(),
    },
    interval: '1d',
    basis: 'split_and_div_adjusted',
    normalization: 'raw',
  }
}

export function sparklineClosesByListing(
  response: GetSeriesResponse,
): Map<string, ReadonlyArray<number>> {
  const map = new Map<string, ReadonlyArray<number>>()
  for (const entry of response.results) {
    if (entry.outcome.outcome !== 'available') continue
    map.set(entry.listing.id, entry.outcome.data.bars.map((bar) => bar.close))
  }
  return map
}
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Implement the hook** `useWatchlistSparklines.ts`:

```ts
// One batched series fetch per (membership set, window). Keyed through
// useFetched so window flips re-fetch once and aborted fetches don't land.
import { useFetched } from '../symbol/useFetched.ts'
import { fetchSeries } from '../symbol/series.ts'
import type { SubjectRef } from '../symbol/search.ts'
import {
  sparklineClosesByListing,
  watchlistSeriesQuery,
  type WatchlistWindow,
} from './watchlistSparklines.ts'

const EMPTY: Map<string, ReadonlyArray<number>> = new Map()

export function useWatchlistSparklines(
  members: ReadonlyArray<SubjectRef>,
  window: WatchlistWindow,
): Map<string, ReadonlyArray<number>> {
  const listingIds = members
    .filter((ref) => ref.kind === 'listing')
    .map((ref) => ref.id)
    .sort()
    .join(',')
  const key = listingIds === '' ? null : `${window}|${listingIds}`
  const state = useFetched<Map<string, ReadonlyArray<number>>>(key, async (_key, signal) => {
    const query = watchlistSeriesQuery(members, window, new Date())
    if (query === null) return { kind: 'unavailable', reason: 'no listings' }
    const response = await fetchSeries(query, { signal })
    return { kind: 'ready', data: sparklineClosesByListing(response) }
  })
  return state.kind === 'ready' ? state.data : EMPTY
}
```

(Check `useFetched`'s exact state-shape names at integration time — it's the same helper `OverviewSection` uses; adjust `state.kind === 'ready'` to its actual ready discriminant.)

- [ ] **Step 6: Typecheck + commit**

```bash
cd web && npm run typecheck
git add web/src/watchlists && git commit -m "feat(web): batched watchlist sparkline data layer"
```

---

### Task 4: Watchlist rail UI — timeframe selector + inline sparklines

**Files:**
- Modify: `web/src/shell/WatchlistSection.tsx`
- Modify: `web/src/watchlists/ManualWatchlist.tsx`
- Modify: `web/src/symbol/QuoteRow.tsx`
- Test: existing `web/src/symbol/quoteRowView.test.ts` stays green; manual visual check.

- [ ] **Step 1: Add optional sparkline prop to `QuoteRow`** — render between text and price:

```tsx
import { Sparkline } from './Sparkline.tsx'

type QuoteRowProps = {
  subjectRef: SubjectRef
  trailing?: ReactNode
  sparkline?: ReadonlyArray<number>
}
```

and inside the Link, after the `min-w-0 flex-1` span:

```tsx
        {sparkline !== undefined && sparkline.length >= 2 ? (
          <Sparkline
            values={sparkline}
            ariaLabel="price trend"
            trendStrokeClass={
              sparkline[sparkline.length - 1] >= sparkline[0]
                ? 'stroke-positive'
                : 'stroke-negative'
            }
            className="h-6 w-14 shrink-0"
          />
        ) : null}
```

- [ ] **Step 2: Thread it through `ManualWatchlist`** — add props `sparklines: ReadonlyMap<string, ReadonlyArray<number>>`, pass `sparkline={member.subject_ref.kind === 'listing' ? sparklines.get(member.subject_ref.id) : undefined}` to each `QuoteRow`.

- [ ] **Step 3: Window state + toggle + hook in `WatchlistSection`**

```tsx
import { useState } from 'react'
import { SegmentedToggle } from '../symbol/SegmentedToggle.tsx'
import { useWatchlistSparklines } from '../watchlists/useWatchlistSparklines.ts'
import { WATCHLIST_WINDOWS, type WatchlistWindow } from '../watchlists/watchlistSparklines.ts'

const WINDOW_OPTIONS = WATCHLIST_WINDOWS.map((value) => ({ value, label: value }))
```

inside the component:

```tsx
  const [window, setWindow] = useState<WatchlistWindow>('1M')
  const memberRefs = watchlist.members.map((m) => m.subject_ref)
  const sparklines = useWatchlistSparklines(memberRefs, window)
```

render the toggle under the header row:

```tsx
      <SegmentedToggle
        options={WINDOW_OPTIONS}
        value={window}
        onChange={setWindow}
        ariaLabel="Watchlist sparkline range"
        testIdPrefix="watchlist-window"
      />
```

and pass `sparklines={sparklines}` to `ManualWatchlist`.

- [ ] **Step 4: Run web tests + typecheck** — Expected: PASS (QuoteRow prop optional ⇒ no breakage).

- [ ] **Step 5: Commit**

```bash
git add web/src/shell/WatchlistSection.tsx web/src/watchlists/ManualWatchlist.tsx web/src/symbol/QuoteRow.tsx
git commit -m "feat(web): watchlist rail sparklines with timeframe selector"
```

---

### Task 5: Single-key nav hotkeys + visible kbd chips

⌘K/"/" already exist with a visible `⌘K` chip. Add video-style single-key navigation (H/C/S/A/G) with kbd chips in the sidebar nav.

**Files:**
- Create: `web/src/shell/isTypingTarget.ts` (extracted)
- Modify: `web/src/shell/useSearchHotkey.ts` (use extraction)
- Create: `web/src/shell/useNavHotkeys.ts`
- Modify: `web/src/shell/SidebarNav.tsx`
- Modify: `web/src/shell/WorkspaceShell.tsx:40`
- Test: `web/src/shell/navHotkeys.test.ts`

- [ ] **Step 1: Extract `isTypingTarget`** to `web/src/shell/isTypingTarget.ts`:

```ts
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}
```

Update `useSearchHotkey.ts` to import it; delete the inline copy.

- [ ] **Step 2: Write failing test** `web/src/shell/navHotkeys.test.ts` for the pure key→path map:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NAV_HOTKEYS, navPathForKey } from './navHotkeys.ts'

test('single letters map to workspace paths', () => {
  assert.equal(navPathForKey('h'), '/home')
  assert.equal(navPathForKey('c'), '/chat')
  assert.equal(navPathForKey('s'), '/screener')
  assert.equal(navPathForKey('a'), '/agents')
  assert.equal(navPathForKey('g'), '/analyst-grids')
  assert.equal(navPathForKey('x'), null)
})

test('hotkey list carries display labels for the sidebar chips', () => {
  assert.ok(NAV_HOTKEYS.every((item) => item.key.length === 1 && item.to.startsWith('/')))
})
```

- [ ] **Step 3: Run to verify failure**, then implement `web/src/shell/navHotkeys.ts`:

```ts
export const NAV_HOTKEYS: ReadonlyArray<{ key: string; to: string }> = [
  { key: 'h', to: '/home' },
  { key: 'a', to: '/agents' },
  { key: 'c', to: '/chat' },
  { key: 's', to: '/screener' },
  { key: 'g', to: '/analyst-grids' },
]

export function navPathForKey(key: string): string | null {
  const hit = NAV_HOTKEYS.find((item) => item.key === key)
  return hit ? hit.to : null
}
```

and `web/src/shell/useNavHotkeys.ts`:

```ts
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isTypingTarget } from './isTypingTarget.ts'
import { navPathForKey } from './navHotkeys.ts'

// Video-style single-key workspace switching (H/A/C/S/G). Only when no
// modifier is held and focus is not in a text field, so typing stays safe.
export function useNavHotkeys() {
  const navigate = useNavigate()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const path = navPathForKey(event.key.toLowerCase())
      if (path === null) return
      event.preventDefault()
      navigate(path)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}
```

- [ ] **Step 4: Mount in `WorkspaceShell`** next to `useSearchHotkey()`: `useNavHotkeys()`.

- [ ] **Step 5: Kbd chips in `SidebarNav`** — extend `PRIMARY_WORKSPACES` entries with `hotkey?: string` (`h`, `a`, `c`, `s`, `g`; none for Review/Analyze/Settings) and render after the label:

```tsx
          <span className="flex-1">{label}</span>
          {hotkey ? (
            <kbd
              aria-hidden="true"
              className="num rounded border border-line px-1 text-[10px] uppercase text-faint"
            >
              {hotkey}
            </kbd>
          ) : null}
```

- [ ] **Step 6: Tests + typecheck + commit**

```bash
cd web && npm test && npm run typecheck
git add web/src/shell && git commit -m "feat(web): single-key nav hotkeys with visible kbd chips"
```

---

### Task 6: SeriesChart crosshair hover (per-point values)

**Files:**
- Modify: `web/src/blocks/seriesGeometry.ts` (expose per-point pixel coords)
- Modify: `web/src/blocks/SeriesChart.tsx` (hover overlay)
- Test: `web/src/blocks/seriesGeometry.test.ts`

- [ ] **Step 1: Write failing geometry test** (append):

```ts
test('computeSeriesGeometry exposes per-point pixel coordinates', () => {
  const geometry = computeSeriesGeometry(
    [{ name: 'A', points: [{ x: 'Q1', y: 0 }, { x: 'Q2', y: 10 }] }],
    { width: 100, height: 50 },
  )
  assert.ok(geometry)
  const pts = geometry.paths[0].points
  assert.equal(pts.length, 2)
  assert.equal(pts[0].xLabel, 'Q1')
  assert.equal(pts[0].value, 0)
  assert.ok(pts[0].x < pts[1].x)
  assert.ok(pts[0].y > pts[1].y) // higher value → smaller y
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Extend `SeriesPath`** in `seriesGeometry.ts` — mirror `sparklineGeometry`'s scale math (padX=4, padY=6, flat-series mid-line guard):

```ts
export type SeriesChartPoint = {
  x: number
  y: number
  value: number
  xLabel: string | number | undefined
}
```

add `points: ReadonlyArray<SeriesChartPoint>` to `SeriesPath`, and in `computeSeriesGeometry` compute alongside the existing path call:

```ts
  const PAD_X = 4
  const PAD_Y = 6
  const [lo, hi] = yDomain
  const rawSpan = hi - lo
  const span = rawSpan === 0 ? 1 : rawSpan
  for (const s of series) {
    const values = s.points.map((p) => p.y)
    const geom = computeSparklineGeometry({ values, domain: yDomain, width, height })
    if (geom === null) continue
    const innerW = width - PAD_X * 2
    const innerH = height - PAD_Y * 2
    const midY = PAD_Y + innerH / 2
    const points = s.points.map((point, i) => ({
      x: PAD_X + (i / (values.length - 1)) * innerW,
      y: rawSpan === 0 ? midY : PAD_Y + (1 - (point.y - lo) / span) * innerH,
      value: point.y,
      xLabel: point.label ?? point.x,
    }))
    paths.push({ name: s.name, unit: s.unit, d: geom.path, areaPath: geom.areaPath, end: geom.end, points })
  }
```

- [ ] **Step 4: Run geometry tests** — Expected: PASS.

- [ ] **Step 5: Hover overlay in `SeriesChart.tsx`** — track hovered index from pointer position over the relative wrapper; render a vertical rule + value badges:

```tsx
import { useId, useState, type ReactElement, type PointerEvent } from 'react'
```

inside the component:

```tsx
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const maxPoints = geometry === null ? 0 : Math.max(...geometry.paths.map((p) => p.points.length))

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (maxPoints < 2) return
    const rect = event.currentTarget.getBoundingClientRect()
    const rel = (event.clientX - rect.left) / rect.width
    setHoverIndex(Math.max(0, Math.min(maxPoints - 1, Math.round(rel * (maxPoints - 1)))))
  }
```

wrap the existing `<div className="relative">` with the handlers (`onPointerMove={onPointerMove} onPointerLeave={() => setHoverIndex(null)}`), and add after `<SeriesEndLabels …/>`:

```tsx
        {hoverIndex !== null ? (
          <SeriesCrosshair testId={testId} geometry={geometry} index={hoverIndex} />
        ) : null}
```

with:

```tsx
function SeriesCrosshair({
  testId,
  geometry,
  index,
}: {
  testId: string
  geometry: SeriesGeometry
  index: number
}): ReactElement | null {
  const anchor = geometry.paths.find((p) => p.points[index] !== undefined)?.points[index]
  if (anchor === undefined) return null
  const leftPct = (anchor.x / geometry.width) * 100
  return (
    <div data-testid={`${testId}-crosshair`} aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-y-0 border-l border-dashed border-line-strong" style={{ left: `${leftPct}%` }} />
      <div
        className={`absolute top-1 flex flex-col gap-0.5 rounded-md border border-line bg-surface/95 px-2 py-1 text-[10px] shadow-md ${leftPct > 60 ? '-translate-x-full' : ''}`}
        style={{ left: `${leftPct}%` }}
      >
        <span className="num text-faint">{String(anchor.xLabel ?? '')}</span>
        {geometry.paths.map((path, seriesIndex) => {
          const point = path.points[index]
          if (point === undefined) return null
          return (
            <span key={`${testId}-hover-${seriesIndex}`} className={`num font-medium ${paletteAt(seriesIndex).text}`}>
              {path.name}: {formatHoverValue(point.value)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function formatHoverValue(value: number): string {
  return Math.abs(value) >= 1000
    ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
```

- [ ] **Step 6: Web tests + typecheck + commit**

```bash
cd web && npm test && npm run typecheck
git add web/src/blocks && git commit -m "feat(web): crosshair hover with per-series values on SeriesChart"
```

---

### Task 7: perf_comparison renders a live chart with range buttons

Today `PerfComparison.tsx` renders only metadata (chips + range/basis labels) — the video's centerpiece is the actual multi-series chart. Client-fetch `/v1/market/series` for the block's listing-kind subjects with `normalization: 'pct_return'`, render through `SeriesChart` (crosshair from Task 6), and offer range buttons (`interactive.ranges` when present, sensible defaults otherwise).

**Files:**
- Create: `web/src/blocks/perfComparisonSeries.ts` (pure)
- Modify: `web/src/blocks/PerfComparison.tsx`
- Test: `web/src/blocks/perfComparisonSeries.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  perfRangeOptions,
  perfRangeDays,
  perfSeriesQuery,
  seriesFromPerfResponse,
} from './perfComparisonSeries.ts'
import type { PerfComparisonBlock } from './types.ts'
import type { GetSeriesResponse } from '../symbol/series.ts'

const block = {
  id: 'b1', kind: 'perf_comparison', snapshot_id: 's', data_ref: { kind: 'k', id: 'i' },
  source_refs: [], as_of: '2026-06-12T00:00:00Z',
  subject_refs: [
    { kind: 'listing', id: 'l-1' },
    { kind: 'issuer', id: 'i-1' },
  ],
  default_range: 'YTD', basis: 'split_and_div_adjusted', normalization: 'pct_return',
} as unknown as PerfComparisonBlock

test('range options come from interactive.ranges with fallback defaults', () => {
  assert.deepEqual(perfRangeOptions(block), ['1M', '3M', '6M', 'YTD', '1Y'])
  const withSpec = { ...block, interactive: { ranges: ['5D', '1Y'] } }
  assert.deepEqual(perfRangeOptions(withSpec), ['5D', '1Y'])
})

test('perfRangeDays understands the labeled ranges', () => {
  assert.equal(perfRangeDays('1M', new Date('2026-06-12T00:00:00Z')), 30)
  assert.equal(perfRangeDays('YTD', new Date('2026-06-12T00:00:00Z')), 162)
  assert.equal(perfRangeDays('5Y', new Date('2026-06-12T00:00:00Z')), 1825)
  assert.equal(perfRangeDays('bogus', new Date('2026-06-12T00:00:00Z')), null)
})

test('perfSeriesQuery uses listings only, pct_return normalization', () => {
  const query = perfSeriesQuery(block, 'YTD', new Date('2026-06-12T00:00:00Z'))
  assert.ok(query)
  assert.deepEqual(query.subject_refs.map((r) => r.id), ['l-1'])
  assert.equal(query.normalization, 'pct_return')
})

test('seriesFromPerfResponse converts bars to chart series named by listing', () => {
  const response = {
    query: {} as never,
    results: [{
      listing: { kind: 'listing', id: 'l-1' },
      outcome: {
        outcome: 'available',
        data: { bars: [
          { ts: '2026-01-02T00:00:00Z', close: 0 },
          { ts: '2026-01-03T00:00:00Z', close: 4.2 },
        ] },
      },
    }],
  } as unknown as GetSeriesResponse
  const series = seriesFromPerfResponse(response)
  assert.equal(series.length, 1)
  assert.equal(series[0].points.length, 2)
  assert.equal(series[0].points[1].y, 4.2)
  assert.equal(series[0].points[1].x, '2026-01-03')
})
```

- [ ] **Step 2: Run to verify failure**, then implement `perfComparisonSeries.ts`:

```ts
// Pure plumbing for the live perf_comparison chart: block → range options,
// range label → day span, block+range → ONE batched series query
// (pct_return normalization so multi-subject series share a % y-axis), and
// response → SeriesChart-ready series named by listing.

import type { Series } from './types.ts'
import type { PerfComparisonBlock } from './types.ts'
import type { GetSeriesResponse, NormalizedSeriesQuery } from '../symbol/series.ts'
import { formatSubjectRefShort } from './subjectRef.ts'

const DEFAULT_RANGES: ReadonlyArray<string> = ['1M', '3M', '6M', 'YTD', '1Y']

const FIXED_RANGE_DAYS: Readonly<Record<string, number>> = {
  '5D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function perfRangeOptions(block: PerfComparisonBlock): ReadonlyArray<string> {
  const ranges = block.interactive?.ranges
  return ranges !== undefined && ranges.length > 0 ? ranges : DEFAULT_RANGES
}

export function perfRangeDays(range: string, now: Date): number | null {
  if (range === 'YTD') {
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
    return Math.max(7, Math.floor((now.getTime() - yearStart) / DAY_MS))
  }
  return FIXED_RANGE_DAYS[range] ?? null
}

export function perfSeriesQuery(
  block: PerfComparisonBlock,
  range: string,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = block.subject_refs.filter(
    (ref): ref is (typeof block.subject_refs)[number] & { kind: 'listing' } =>
      ref.kind === 'listing',
  )
  const days = perfRangeDays(range, now)
  if (listings.length === 0 || days === null) return null
  return {
    subject_refs: listings,
    range: {
      start: new Date(now.getTime() - days * DAY_MS).toISOString(),
      end: now.toISOString(),
    },
    interval: '1d',
    basis: 'split_and_div_adjusted',
    normalization: 'pct_return',
  }
}

export function seriesFromPerfResponse(response: GetSeriesResponse): ReadonlyArray<Series> {
  const series: Series[] = []
  for (const entry of response.results) {
    if (entry.outcome.outcome !== 'available') continue
    series.push({
      name: formatSubjectRefShort(entry.listing),
      unit: '%',
      points: entry.outcome.data.bars.map((bar) => ({
        x: bar.ts.slice(0, 10),
        y: bar.close,
      })),
    })
  }
  return series
}
```

- [ ] **Step 3: Run tests** — Expected: PASS.

- [ ] **Step 4: Rewrite `PerfComparison.tsx`** keeping the metadata card as fallback when no listings/series:

```tsx
import { useState, type ReactElement } from 'react'
import type { PerfComparisonBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { LabelValueCell } from './LabelValueCell.tsx'
import { SubjectChipList } from './SubjectChipList.tsx'
import { perfNormalizationLabel } from './perfComparison.ts'
import { SeriesChart } from './SeriesChart.tsx'
import { SegmentedToggle } from '../symbol/SegmentedToggle.tsx'
import { useFetched } from '../symbol/useFetched.ts'
import { fetchSeries } from '../symbol/series.ts'
import {
  perfRangeOptions,
  perfSeriesQuery,
  seriesFromPerfResponse,
} from './perfComparisonSeries.ts'
import type { Series } from './types.ts'

type PerfComparisonProps = { block: PerfComparisonBlock }

export function PerfComparison({ block }: PerfComparisonProps): ReactElement {
  const ranges = perfRangeOptions(block)
  const [range, setRange] = useState<string>(
    ranges.includes(block.default_range) ? block.default_range : ranges[0],
  )
  const fetchKey = `${block.id}|${range}`
  const state = useFetched<ReadonlyArray<Series>>(fetchKey, async (_key, signal) => {
    const query = perfSeriesQuery(block, range, new Date())
    if (query === null) return { kind: 'unavailable', reason: 'no listing subjects in block' }
    const response = await fetchSeries(query, { signal })
    const series = seriesFromPerfResponse(response)
    if (series.length === 0) return { kind: 'unavailable', reason: 'no series available' }
    return { kind: 'ready', data: series }
  })

  return (
    <ChartCard
      testId={`block-perf-comparison-${block.id}`}
      blockKind="perf_comparison"
      title={block.title}
      dataAttrs={{
        'data-default-range': block.default_range,
        'data-basis': block.basis,
        'data-normalization': block.normalization,
        'data-active-range': range,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubjectChipList
          testId={`block-perf-comparison-${block.id}-subjects`}
          keyPrefix={`${block.id}-subj`}
          subjects={block.subject_refs}
          dense
        />
        <SegmentedToggle
          options={ranges.map((value) => ({ value, label: value }))}
          value={range}
          onChange={setRange}
          ariaLabel="Performance range"
          testIdPrefix={`block-perf-comparison-${block.id}-range`}
        />
      </div>
      {state.kind === 'ready' ? (
        <SeriesChart
          testId={`block-perf-comparison-${block.id}-chart`}
          ariaLabel={`${range} performance comparison`}
          series={state.data}
        />
      ) : (
        <dl className="grid grid-cols-3 gap-2 text-xs text-muted">
          <LabelValueCell label="Range">{range}</LabelValueCell>
          <LabelValueCell label="Basis">{block.basis}</LabelValueCell>
          <LabelValueCell label="Normalization">{perfNormalizationLabel(block.normalization)}</LabelValueCell>
        </dl>
      )}
    </ChartCard>
  )
}
```

(Adapt `state.kind` to `useFetched`'s actual discriminant, same as Task 3. If existing `PerfComparison` tests assert the metadata grid, keep them passing via the fallback branch — fetch in tests will be unavailable.)

- [ ] **Step 5: Web tests + typecheck + commit**

```bash
cd web && npm test && npm run typecheck
git add web/src/blocks && git commit -m "feat(web): perf_comparison block renders live range-switchable chart"
```

---

### Task 8: Symbol Overview hero chart (extended windows + crosshair)

Upgrade the Overview performance card: windows `5D/1M/6M/YTD/1Y/5Y`, taller `SeriesChart` (gets Task 6 crosshair for free) instead of the bare `Sparkline`.

**Files:**
- Modify: `web/src/symbol/series.ts:107-113` (extend `PriceWindow`)
- Modify: `web/src/pages/symbol/OverviewSection.tsx:47-51,267-291`
- Test: `web/src/symbol/series.test.ts` (window table)

- [ ] **Step 1: Extend the window table** in `series.ts`:

```ts
export type PriceWindow = '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y'

export const PRICE_WINDOW_DAYS: Record<PriceWindow, number> = {
  '5D': 7,
  '1M': 30,
  '6M': 180,
  // YTD is resolved at query time; 365 here is the safe upper bound used only
  // if a caller indexes the table directly.
  YTD: 365,
  '1Y': 365,
  '5Y': 1825,
}

export function priceWindowDays(window: PriceWindow, now: Date = new Date()): number {
  if (window !== 'YTD') return PRICE_WINDOW_DAYS[window]
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
  return Math.max(7, Math.floor((now.getTime() - yearStart) / (24 * 60 * 60 * 1000)))
}
```

Add a test in `series.test.ts` asserting `priceWindowDays('YTD', new Date('2026-06-12T00:00:00Z')) === 162` and `priceWindowDays('5Y') === 1825`.

- [ ] **Step 2: Update `OverviewSection`** — `PRICE_WINDOW_OPTIONS` lists all six; the series fetch uses `priceWindowDays(priceWindow)` instead of `PRICE_WINDOW_DAYS[priceWindow]`; replace `PriceSparkline`'s `Sparkline` with `SeriesChart`:

```tsx
import { SeriesChart } from '../../blocks/SeriesChart.tsx'

function PriceSparkline({ bars, windowLabel }: { bars: NormalizedBar[]; windowLabel: string }) {
  const first = bars[0].close
  const last = bars[bars.length - 1].close
  return (
    <div className="flex flex-col gap-2">
      <SeriesChart
        testId="overview-hero-chart"
        ariaLabel={`${windowLabel} price line from ${formatPrice(first)} to ${formatPrice(last)}`}
        series={[{
          name: 'Close',
          points: bars.map((bar) => ({ x: bar.ts.slice(0, 10), y: bar.close })),
        }]}
        height={200}
      />
      <div className="flex items-center justify-between text-xs num text-muted">
        <span>{formatPrice(first)}</span>
        <span>{bars.length} bars</span>
        <span>{formatPrice(last)}</span>
      </div>
    </div>
  )
}
```

(`SeriesChart` height prop flows into `computeSeriesGeometry`; the svg's Tailwind class `h-40` stays the layout height — acceptable. Single series ⇒ gradient fill + crosshair.)

- [ ] **Step 3: Web tests + typecheck + commit**

```bash
cd web && npm test && npm run typecheck
git add web/src/symbol/series.ts web/src/symbol/series.test.ts web/src/pages/symbol/OverviewSection.tsx
git commit -m "feat(web): symbol overview hero chart with 5D-5Y windows and crosshair"
```

---

### Task 9: Investment Memo playbook (services/analyze)

Playbooks are pure data (`services/analyze/src/playbook.ts`); the section runner generates blocks per `block_hint` generically. Add the video's flagship memo: thesis → financial health → growth → risks → ownership → verdict.

**Files:**
- Modify: `services/analyze/src/playbook.ts:38-88`
- Test: `services/analyze/test/playbook.test.ts`

- [ ] **Step 1: Write failing test** (append, matching the file's existing style):

```ts
test("investment_memo playbook resolves with verdict section last", () => {
  const resolved = resolveAnalyzePlaybookRequest({ playbook_id: "investment_memo" });
  assert.equal(resolved.playbook.name, "Investment memo");
  const sectionIds = resolved.playbook.sections.map((section) => section.section_id);
  assert.deepEqual(sectionIds.slice(-1), ["final_verdict"]);
  assert.ok(resolved.prompt.includes("Final verdict"));
});
```

- [ ] **Step 2: Run** — `cd services/analyze && npm test` — Expected: FAIL (unknown playbook).

- [ ] **Step 3: Add the playbook** to `ANALYZE_PLAYBOOKS` (after `peer_comparison`):

```ts
  Object.freeze({
    playbook_id: "investment_memo",
    version: 1,
    name: "Investment memo",
    description:
      "Full investment memo: thesis, financial health, growth, risks, ownership, and a final verdict with rating and conviction.",
    default_instructions:
      "Write a complete investment memo. Lead with the investment thesis. Cover financial health and profitability, growth drivers, downside risks, and ownership signals (institutional holders, insider activity). Close with a final verdict: rating (Buy/Hold/Sell), conviction (low/medium/high), and the investor profile the position suits.",
    default_source_categories: Object.freeze(["filings", "transcripts", "news"]),
    sections: Object.freeze([
      section("investment_thesis", "Investment thesis", true, "rich_text"),
      section("financial_health", "Financial health & profitability", true, "metric_row"),
      section("revenue_trend", "Revenue trend", false, "line_chart"),
      section("growth_drivers", "Growth drivers", true, "rich_text"),
      section("downside_risks", "Downside risks", true, "table"),
      section("ownership_signals", "Ownership & insider signals", true, "rich_text"),
      section("analyst_overview", "Analyst overview", false, "section"),
      section("price_targets", "Price targets", false, "section"),
      section("final_verdict", "Final verdict", true, "metric_row"),
    ]),
  }),
```

- [ ] **Step 4: Run service tests** — Expected: PASS. Also run `cd services/analyze && npm test 2>&1 | tail -5` for the full suite (template-runner tests iterate playbooks; confirm none hard-code the playbook count — fix the fixture list if one does).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/playbook.ts services/analyze/test/playbook.test.ts
git commit -m "feat(analyze): investment memo playbook with final verdict section"
```

---

### Task 10: Analyze section-progress rail (video TOC)

`AnalyzePage` already lists the selected playbook's sections statically (lines 281-290). Upgrade it into a status-aware TOC: while a memo generates show per-section pending state; once `memoRun` lands, check off sections whose title matches a generated `section` block (or a block whose `title` matches).

**Files:**
- Create: `web/src/analyze/sectionProgress.ts` (pure)
- Create: `web/src/analyze/SectionProgressList.tsx`
- Modify: `web/src/pages/AnalyzePage.tsx:281-290` (swap static list for the component)
- Test: `web/src/analyze/sectionProgress.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sectionProgress } from './sectionProgress.ts'

const sections = [
  { section_id: 'thesis', title: 'Investment thesis', required: true, block_hint: 'rich_text' },
  { section_id: 'verdict', title: 'Final verdict', required: true, block_hint: 'metric_row' },
] as const

test('idle: all sections pending', () => {
  const rows = sectionProgress(sections, 'idle', null)
  assert.deepEqual(rows.map((r) => r.state), ['pending', 'pending'])
})

test('generating: all sections running', () => {
  const rows = sectionProgress(sections, 'generating', null)
  assert.deepEqual(rows.map((r) => r.state), ['running', 'running'])
})

test('complete: sections with a matching block title are done, others skipped', () => {
  const rows = sectionProgress(sections, 'complete', [
    { title: 'Investment thesis' },
    { title: 'Margin bridge' },
  ])
  assert.deepEqual(rows.map((r) => r.state), ['done', 'skipped'])
})
```

- [ ] **Step 2: Run to verify failure**, then implement `sectionProgress.ts`:

```ts
// TOC state for a playbook memo. Matching is by case-insensitive title:
// the template runner titles generated blocks after the playbook sections,
// so title equality is the contract we can check client-side.

type PlaybookSectionLike = { readonly section_id: string; readonly title: string }
type BlockTitleLike = { readonly title?: string }

export type SectionProgressState = 'pending' | 'running' | 'done' | 'skipped'
export type SectionProgressRow = {
  section_id: string
  title: string
  state: SectionProgressState
}

export function sectionProgress(
  sections: ReadonlyArray<PlaybookSectionLike>,
  phase: 'idle' | 'generating' | 'complete',
  blocks: ReadonlyArray<BlockTitleLike> | null,
): ReadonlyArray<SectionProgressRow> {
  return sections.map((section) => {
    if (phase === 'idle') return row(section, 'pending')
    if (phase === 'generating') return row(section, 'running')
    const matched =
      blocks !== null &&
      blocks.some(
        (block) => block.title !== undefined && block.title.toLowerCase() === section.title.toLowerCase(),
      )
    return row(section, matched ? 'done' : 'skipped')
  })
}

function row(section: PlaybookSectionLike, state: SectionProgressState): SectionProgressRow {
  return { section_id: section.section_id, title: section.title, state }
}
```

- [ ] **Step 3: Component** `SectionProgressList.tsx`:

```tsx
import type { ReactElement } from 'react'
import type { SectionProgressRow, SectionProgressState } from './sectionProgress.ts'

const DOT_CLASS: Readonly<Record<SectionProgressState, string>> = {
  pending: 'border-line-strong bg-surface-2',
  running: 'border-accent bg-accent animate-pulse',
  done: 'border-positive bg-positive',
  skipped: 'border-line bg-surface',
}

const GLYPH: Readonly<Record<SectionProgressState, string>> = {
  pending: '',
  running: '',
  done: '✓',
  skipped: '–',
}

export function SectionProgressList({ rows }: { rows: ReadonlyArray<SectionProgressRow> }): ReactElement {
  return (
    <ul data-testid="analyze-section-progress" className="mt-2 flex flex-col gap-1.5 text-sm">
      {rows.map((item) => (
        <li key={item.section_id} data-state={item.state} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none text-on-accent ${DOT_CLASS[item.state]}`}
          >
            {GLYPH[item.state]}
          </span>
          <span className={item.state === 'done' ? 'text-fg' : 'text-fg-soft'}>{item.title}</span>
        </li>
      ))}
    </ul>
  )
}
```

(If `text-on-accent` is not a defined token in `index.css`, use `text-white`.)

- [ ] **Step 4: Integrate in `AnalyzePage`** — replace the static `<ul>` in the Sections card with:

```tsx
              <SectionProgressList
                rows={sectionProgress(
                  selectedPlaybook.sections,
                  status === 'Generating…' ? 'generating' : memoRun ? 'complete' : 'idle',
                  memoRun?.blocks ?? null,
                )}
              />
```

(Read the surrounding `generateMemo` to confirm the exact in-flight `status` string it sets, and use that literal; if generation status is tracked another way, derive `'generating'` from that.)

- [ ] **Step 5: Web tests + typecheck + commit**

```bash
cd web && npm test && npm run typecheck
git add web/src/analyze web/src/pages/AnalyzePage.tsx
git commit -m "feat(web): status-aware section progress rail on Analyze"
```

---

## Final verification

- [ ] `cd web && npm test && npm run typecheck && npm run lint`
- [ ] `cd services/analyze && npm test`
- [ ] `git push` (per session close protocol)
