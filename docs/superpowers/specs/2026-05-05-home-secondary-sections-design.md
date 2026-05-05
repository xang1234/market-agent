# Home Secondary Sections Design

## Scope

This spec covers `fra-qp2`: the four secondary sections on Home — market pulse, watchlist movers, agent summaries, saved screens (UI label "Pinned screens") — plus the `/v1/home/summary` HTTP surface that joins them with the existing finding feed. It does NOT change the finding feed (`fra-9y5`), the ranker (`fra-64z`), the deep-link helper (`fra-525`), or the still-open card-click wiring (`fra-7vn.4.1`).

## Architecture

Server-side composition lives in `services/home/`. Each section is a focused function, callable in isolation, then orchestrated by `getHomeSummary` and exposed over `/v1/home/summary`. This matches the sibling pattern (`finding-feed-repo.ts` / `ranker.ts`) and keeps the bead from inventing a new truth layer: every section reads existing services or existing tables.

The deliberate split:

- **DB-backed** (raw SQL via `QueryExecutor`): `getHomeAgentSummaries` joins `agents` / `agent_run_logs` / `findings`. This mirrors `finding-feed-repo.ts`, which already queries those tables directly rather than going through `services/agents`. Keeps the bead independent of the agents-service shape.
- **Service-module-backed**: `getHomeWatchlistMovers` calls `findDefaultManualWatchlistId` + `listMembers` from `services/watchlists`. The watchlists package is the canonical owner of those queries.
- **DI-backed**: `getHomeMarketPulse` and `getHomeWatchlistMovers` take a `quoteProvider` callable. Quotes come from external adapters in `services/market`, not the DB, so the home layer stays adapter-agnostic.
- **Repository-backed**: `getHomeSavedScreens` takes a `ScreenRepository`. The current repo is in-memory; the contract is stable, so a future DB-backed repo slots in unchanged.

## Section Contracts

### Market Pulse

`getHomeMarketPulse({ pulse_subjects, quoteProvider, now })` returns `HomeMarketPulse`:

- Input `pulse_subjects: ReadonlyArray<ListingSubjectRef>` is config — there is no DB seed for canonical indices/ETFs in this repo today, so the home layer accepts the list as a dependency rather than inventing one. The default constant `DEFAULT_HOME_PULSE_SUBJECTS = []` is intentionally empty so a misconfigured deployment fails loudly; production wiring supplies SPY/QQQ/DIA/IWM/VIX listing UUIDs.
- Output: one row per pulse subject with `listing`, `price`, `prev_close`, `change_abs`, `change_pct`, `session_state`, `delay_class`, `as_of`, `currency`. All fields come straight from `NormalizedQuote`; we do not reshape them.
- Order is stable: input order preserved. No ranking — pulse is a reference strip, not a discovery surface.

If `quoteProvider` returns no quote for a requested ref, that row is omitted with a structured `omitted: { ref, reason }` sibling array, so the UI can show a "no data" badge without inventing fields.

### Watchlist Movers

`getHomeWatchlistMovers(db, { user_id, quoteProvider, limit, now })` returns `HomeWatchlistMovers`:

- Resolves `findDefaultManualWatchlistId(db, user_id)`. If the user has no default manual watchlist (`WatchlistNotFoundError`), the function returns `{ rows: [], reason: "no_default_watchlist" }`. The caller distinguishes "user has no list" from "list is empty."
- Fetches members via `listMembers(db, watchlist_id)`, filters to `kind === "listing"`. Non-listing members (themes, portfolios) are not "movers" — the market quote contract is listing-bound.
- Calls `quoteProvider` once with the listing refs. Sorts by `Math.abs(change_pct)` descending, ties broken by `change_pct` descending (positive moves edge out negatives at equal magnitude), then by `listing.id` ascending. Truncates to `limit` (default 5, max 20).
- Each row exposes `listing`, signed `change_abs` and `change_pct`, `price`, `session_state`, `delay_class`, `as_of`, `currency`. The UI uses the sign of `change_pct` for up/down styling.
- Members the quote provider couldn't price are surfaced in the same `omitted` sidecar pattern as market pulse.

### Agent Summaries

`getHomeAgentSummaries(db, { user_id, window_hours, now })` returns `HomeAgentSummaries`:

- Single SQL pass over enabled agents for the user, joined to:
  - the latest row in `agent_run_logs` per agent (via `lateral` or distinct-on),
  - aggregate finding counts over the last `window_hours` (default 24, max 168) — total, plus split by severity bucket `high_or_critical` and `critical` only,
  - the most recent `severity in ('high','critical')` finding per agent for headline/finding_id/created_at.
- Disabled agents are excluded — same SQL contract as `finding-feed-repo.ts` (`a.enabled = true`). Agents with no runs and no findings still appear; their summary carries `last_run: null` and zero counts so the UI can show "never run" rather than dropping the agent.
- Order: agents with at least one critical finding in window first, then by `last_run.ended_at` desc (nulls last), then `agent.created_at` desc, then `agent_id` asc. The `agent.created_at` tie-breaker means agents with identical run timestamps still have a stable order driven by who's newest.
- No prose. No LLM call. Counts and the latest finding's existing headline are already deterministic state.

### Saved Screens

`getHomeSavedScreens({ user_id, listSavedScreens, limit })` returns `HomeSavedScreens`:

- Takes a `HomeSavedScreensProvider = (user_id) => Promise<ReadonlyArray<ScreenSubject>>` rather than a `ScreenRepository`. The screener service has no user_id on `ScreenSubject` today and `ScreenRepository.list()` returns all screens globally — calling it from Home would leak other users' saved screens. By taking a focused provider, Home forces the composition root to make a deliberate user-scoping decision; the dev wiring returns `[]` until a follow-up bead (fra-aln) adds a `user_id` column to `ScreenSubject` and a `listForUser` method.
- Sorts the provider's output by `updated_at desc` and takes the first `limit` (default 5, max 20). Sorting lives in the home layer rather than relying on the provider so the contract is self-contained.
- Each row carries `screen_id`, `name`, `updated_at`, a `filter_summary: string` (a short, deterministic projection of `definition` — count of filters and which dimensions they hit), and a `replay_target: { kind: "screen", id: screen_id }` SubjectRef so the UI can deep-link without inventing a new route format.
- Internal field name in payloads: `saved_screens`. The HomePage UI may label the section "Pinned screens" without us adding a pinning concept; the data layer stays honest about what it is.
- Live screener replay does NOT happen here. Showing row counts would couple Home to the screener executor and its delay-class handling; that belongs on detail open or a later preview bead.

### Summary Orchestrator

`getHomeSummary(db, deps, { user_id, ... })` returns `HomeSummary`:

```
{
  findings: { cards: HomeFindingCard[] },
  market_pulse: HomeMarketPulse,
  watchlist_movers: HomeWatchlistMovers,
  agent_summaries: HomeAgentSummaries,
  saved_screens: HomeSavedScreens,
  generated_at: string,
}
```

`findings.cards` is `rankHomeCards(await listHomeFindingCards(db, { user_id }), { now })` — reusing existing functions verbatim. The four secondary sections run in parallel with `Promise.all`. One section's failure propagates as a thrown error; partial responses are not part of v1 (matches the "all sections render with live data" verification bar).

## HTTP Surface

`createHomeServer(db, deps)` exposes a single route in v1: `GET /v1/home/summary`. The handler:

- Reads `x-user-id` (matches `services/watchlists/src/http.ts`).
- Calls `getHomeSummary` with the request user_id.
- Returns 200 with the `HomeSummary` envelope.
- Maps `HomeFindingFeedError` and validation errors to 400; UUID-shape errors on `user_id` to 401 (header parsing); everything else propagates as 500. No partial-success body.

The dev composition root in `services/home/src/dev.ts` listens on `HOME_PORT` (default 4334) using a `pg.Pool` for DB access, an empty quote provider, and an empty saved-screens provider. The Vite dev server proxies `/v1/home/*` to that origin (configurable via `HOME_ORIGIN`).

Adding more routes (e.g. per-section endpoints) is a future bead. A single summary route satisfies the verification contract without entangling the handler layer with section-specific paging concerns this bead doesn't need.

## Types

New types in `services/home/src/types.ts` (or split into `secondary-sections.ts` if `types.ts` grows past readability):

- `HomeMarketPulseRow`, `HomeMarketPulse`
- `HomeWatchlistMoverRow`, `HomeWatchlistMovers`
- `HomeAgentSummaryRow`, `HomeAgentSummaries`, `HomeAgentLastRun`
- `HomeSavedScreenRow`, `HomeSavedScreens`
- `HomeSummary`
- `HomeQuoteProvider` — `(refs: ReadonlyArray<ListingSubjectRef>) => Promise<ReadonlyArray<NormalizedQuote>>`
- `HomeSavedScreensProvider` — `(user_id: string) => Promise<ReadonlyArray<ScreenSubject>>`
- `HomeSectionsDeps` — `{ quoteProvider, listSavedScreens, pulse_subjects? }`

`ListingSubjectRef` and `NormalizedQuote` are imported from `services/market` rather than re-declared.

## Errors And Limits

- All limits clamp via dedicated assertion helpers, mirroring `resolveLimit` in `finding-feed-repo.ts`.
- All UUIDs are validated at function entry with the same regex used in the existing repo.
- DB query failures, repo failures, and quote-provider failures throw — they don't degrade silently. The orchestrator's `Promise.all` is intentional: if one section fails, the response fails. A future bead can split into per-section endpoints if partial-degradation becomes a product requirement.
- `user_id` is REQUIRED everywhere. There is no anonymous Home.

## Testing

Per-section service tests (no real DB / quote provider / repo):

- Market pulse: preserves input order; omits and reports unpriced refs; rejects non-listing refs.
- Watchlist movers: empty default-watchlist returns the structured "no_default_watchlist" reason; non-listing members ignored; sort by `|change_pct|` is stable across ties; limit clamped.
- Agent summaries: enabled-only contract enforced via SQL match (mirrors `finding-feed-repo.test.ts`); zero-run agents still surface; window cutoff respected; critical-first order.
- Saved screens: limit/sort delegated to repo; filter_summary is deterministic given a fixed definition; long names truncated.
- Summary: composes the four + finding feed; one section's throw aborts; `generated_at` matches injected clock.

HTTP tests:

- Missing `x-user-id` → 401.
- Bad UUID → 400.
- Happy path → 200 with the envelope shape.

Frontend tests:

- `summaryView.test.ts` — pure presentation helpers (formatters, direction, empty-state copy, agent headline rules).
- `summaryClient.test.ts` — fetch threading: x-user-id header, error mapping, response body cleanup on non-ok.
- `HomePage.test.tsx` — renders each `LoadState` branch via `renderToString`; an integration block uses `jsdom` + `react-dom/client` + `act()` to verify (a) fetch on mount produces ready state, (b) non-200 fetch surfaces error UI, and (c) a stale fetch resolution after a userId switch does NOT overwrite the new user's ready state.

Full integrated stack (real DB + adapters + UI) is out of scope: the project does not yet have a Home gateway and adding one would balloon the bead.

## Self-Review

- Placeholder scan: no placeholders.
- Scope check: explicitly limited to the four secondary sections + `/v1/home/summary`. Card-click behavior (`fra-7vn.4.1`) is unchanged.
- "No new truth layer" check: every section reads an existing service, table, or DI-supplied dependency. The only new persistence concept considered (pin flag) was rejected.
- Ambiguity check: pulse universe is config-driven; movers are listing-only and signed; agent summaries are deterministic counts; saved screens do not run live screens.
