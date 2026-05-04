# Dynamic Watchlists & Portfolio Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build service-layer read models for dynamic watchlist derivation and portfolio overlay composition.

**Architecture:** Dynamic watchlist membership is resolved on demand from the source definition in `watchlists.mode` and `watchlists.membership_spec`, with no row-cache persistence. Portfolio overlay composition is a pure merge of base subject rows and P1.5 overlay inputs, preserving each portfolio/base-currency contribution separately.

**Tech Stack:** TypeScript on Node's built-in test runner, service-local `QueryExecutor` database adapters, existing screener/theme/agent/portfolio domain modules.

---

## File Structure

- Create `services/watchlists/src/dynamic-membership.ts`
  - Owns dynamic watchlist lookup, membership-spec validation, mode-specific derivation, deterministic ordering, and provenance metadata.
- Create `services/watchlists/test/dynamic-membership.test.ts`
  - Covers screen replay, theme/portfolio/agent mirroring, no cache writes, and deterministic ordering.
- Create `services/portfolio/src/overlay-composer.ts`
  - Owns pure composition of arbitrary base subject rows with overlay inputs.
- Create `services/portfolio/test/overlay-composer.test.ts`
  - Covers multi-portfolio contributions, currency separation, and distinct watchlist/held states.

## Task 1: Dynamic Watchlist Resolver (`fra-6ol`)

**Files:**
- Create: `services/watchlists/test/dynamic-membership.test.ts`
- Create: `services/watchlists/src/dynamic-membership.ts`

- [ ] **Step 1: Claim the bead**

Run: `bd update fra-6ol --status in_progress`

Expected: bead status changes to in progress.

- [ ] **Step 2: Write failing dynamic membership tests**

Create `services/watchlists/test/dynamic-membership.test.ts` with tests for:
- screen mode replays the current screen definition on each resolve
- theme mode mirrors `theme_memberships`
- portfolio mode mirrors `portfolio_holdings`
- agent mode mirrors a static agent universe
- derived members are deterministically ordered
- resolver does not write to `watchlist_members`

- [ ] **Step 3: Run tests to verify RED**

Run: `node --experimental-strip-types --test services/watchlists/test/dynamic-membership.test.ts`

Expected: fails because `../src/dynamic-membership.ts` does not exist.

- [ ] **Step 4: Implement minimal resolver**

Create `services/watchlists/src/dynamic-membership.ts` exporting:
- `resolveDynamicWatchlistMembers(deps, request)`
- `DynamicWatchlistDeps`
- `DynamicWatchlistMember`
- `DynamicWatchlistMembership`

Implementation rules:
- read `watchlists` by `watchlist_id` and `user_id`
- derive manual mode from `watchlist_members`
- derive theme mode from `theme_memberships`
- derive portfolio mode from `portfolio_holdings`
- derive screen mode via injected screen repository and screener executor
- derive agent mode from injected agent loader and support static universes first
- sort by `subject_ref.kind`, then `subject_ref.id`
- include `source` and `freshness` metadata
- do not insert/update/delete cached membership rows

- [ ] **Step 5: Run watchlist tests to verify GREEN**

Run: `node --experimental-strip-types --test services/watchlists/test/dynamic-membership.test.ts`

Expected: all dynamic membership tests pass.

- [ ] **Step 6: Run full watchlist suite**

Run: `cd services/watchlists && npm test`

Expected: all watchlist tests pass.

- [ ] **Step 7: Commit Task 1**

Run:
```bash
git add docs/superpowers/plans/2026-05-04-fra-7vn-7-dynamic-watchlists.md services/watchlists/test/dynamic-membership.test.ts services/watchlists/src/dynamic-membership.ts .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "feat: derive dynamic watchlist memberships"
```

## Task 2: Portfolio Overlay Composer (`fra-bup`)

**Files:**
- Create: `services/portfolio/test/overlay-composer.test.ts`
- Create: `services/portfolio/src/overlay-composer.ts`

- [ ] **Step 1: Claim the bead**

Run: `bd update fra-bup --status in_progress`

Expected: bead status changes to in progress.

- [ ] **Step 2: Write failing overlay composition tests**

Create `services/portfolio/test/overlay-composer.test.ts` with tests for:
- one base subject row receives separate contributions from multiple portfolios
- different base currencies remain separate contributions
- watchlist state on the base row remains distinct from held state in contributions
- rows without holdings still appear with an empty contribution list

- [ ] **Step 3: Run tests to verify RED**

Run: `node --experimental-strip-types --test services/portfolio/test/overlay-composer.test.ts`

Expected: fails because `../src/overlay-composer.ts` does not exist.

- [ ] **Step 4: Implement minimal composer**

Create `services/portfolio/src/overlay-composer.ts` exporting:
- `composePortfolioOverlayRows(baseRows, overlayInputs)`
- `PortfolioOverlayRow`
- `OverlayBaseRow`

Implementation rules:
- key by `subject_ref.kind + ":" + subject_ref.id`
- preserve each `OverlayContribution` unchanged
- never aggregate or net currencies
- return one output row per base row in original base-row order
- keep base row fields separate from portfolio overlay fields

- [ ] **Step 5: Run portfolio overlay composer tests to verify GREEN**

Run: `node --experimental-strip-types --test services/portfolio/test/overlay-composer.test.ts`

Expected: all overlay composer tests pass.

- [ ] **Step 6: Run full portfolio suite**

Run: `cd services/portfolio && npm test`

Expected: all portfolio tests pass.

- [ ] **Step 7: Commit Task 2**

Run:
```bash
git add services/portfolio/test/overlay-composer.test.ts services/portfolio/src/overlay-composer.ts .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "feat: compose portfolio overlays for subject rows"
```

## Task 3: Integration Verification And Bead Closure

**Files:**
- Modify: `.beads/issues.jsonl`
- Modify: `.beads/interactions.jsonl`

- [ ] **Step 1: Run focused service suites**

Run:
```bash
(cd services/watchlists && npm test)
(cd services/portfolio && npm test)
```

Expected: all tests pass.

- [ ] **Step 2: Run dependent service suites**

Run:
```bash
(cd services/screener && npm test)
(cd services/themes && npm test)
(cd services/agents && npm test)
```

Expected: all tests pass, with existing Docker/Postgres skips acceptable.

- [ ] **Step 3: Check whitespace**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Close beads**

Run:
```bash
bd close fra-6ol --reason "Implemented dynamic watchlist membership resolver with tests"
bd close fra-bup --reason "Implemented portfolio overlay composer with tests"
bd close fra-7vn.7 --reason "Completed dynamic watchlist and portfolio overlay service read models"
```

Expected: child beads and parent bead are closed.

- [ ] **Step 5: Commit bead closure**

Run:
```bash
git add .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "chore: close dynamic watchlist beads"
```

- [ ] **Step 6: Push branch**

Run:
```bash
git pull --rebase
bd sync
git push -u origin feat/fra-7vn-7-dynamic-watchlists
git status --short --branch
```

Expected: push succeeds; `bd sync` may be unavailable in this repository and should be reported if it fails; status shows branch up to date with origin.

## Self-Review

- Spec coverage: screen, agent, theme, and portfolio derivation modes are covered by Task 1; portfolio overlay composition, multi-portfolio separation, no silent FX netting, and distinct watchlist/held state are covered by Task 2.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain.
- Type consistency: exported names used in tests match the planned implementation names.
