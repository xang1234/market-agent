# Home Card Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit Home card destination metadata and pure frontend route helpers for deterministic deep-links.

**Architecture:** The Home service parses optional `preferred_surface` metadata into `HomeCardDestination`. The web layer converts valid destinations to existing routes without heuristics.

**Tech Stack:** TypeScript, Node built-in test runner, React Router route helper conventions.

---

## File Structure

- Modify `services/home/src/types.ts`
  - Add `HomeCardDestination`, symbol tabs, and Analyze intents.
- Modify `services/home/src/finding-feed-repo.ts`
  - Parse `preferred_surface` and attach `destination` to each card.
- Modify `services/home/test/finding-feed-repo.test.ts`
  - Add service destination parser tests.
- Create `web/src/home/deepLinks.ts`
  - Convert destinations to existing route paths.
- Create `web/src/home/deepLinks.test.ts`
  - Cover symbol, Analyze, theme, and none destination paths.

## Task 1: Service Destination Metadata

**Files:**
- Modify: `services/home/src/types.ts`
- Modify: `services/home/src/finding-feed-repo.ts`
- Modify: `services/home/test/finding-feed-repo.test.ts`

- [ ] **Step 1: Claim the bead**

Run: `bd update fra-525 --status in_progress`

Expected: bead status changes to in progress.

- [ ] **Step 2: Write failing service tests**

Add tests to `services/home/test/finding-feed-repo.test.ts` for explicit symbol earnings destination, missing destination fallback, and invalid symbol tab rejection.

- [ ] **Step 3: Verify RED**

Run: `node --experimental-strip-types --test services/home/test/finding-feed-repo.test.ts`

Expected: fails because `destination` is not on `HomeFindingCard`.

- [ ] **Step 4: Implement service destination parsing**

Update types and repository:
- `HomeCardDestination` union.
- `preferred_surface` row field.
- `parseHomeCardDestination`.
- Card fallback `{ kind: "none", reason: "missing_destination" }`.

- [ ] **Step 5: Verify GREEN**

Run: `node --experimental-strip-types --test services/home/test/finding-feed-repo.test.ts`

Expected: all Home feed repository tests pass.

## Task 2: Frontend Route Helper

**Files:**
- Create: `web/src/home/deepLinks.ts`
- Create: `web/src/home/deepLinks.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Add tests for:
- symbol earnings destination -> `/symbol/<encoded-ref>/earnings`
- Analyze memo destination -> `/analyze?subject=kind:id&intent=memo`
- theme destination -> `null`
- none destination -> `null`

- [ ] **Step 2: Verify RED**

Run: `cd web && npm test -- src/home/deepLinks.test.ts`

Expected: fails because `deepLinks.ts` does not exist.

- [ ] **Step 3: Implement route helper**

Create `web/src/home/deepLinks.ts` using existing `subjectRouteParam` and `analyzePathForSubject`.

- [ ] **Step 4: Verify GREEN**

Run: `cd web && npm test -- src/home/deepLinks.test.ts`

Expected: deep-link tests pass.

## Task 3: Verification, Close, Push

- [ ] **Step 1: Run verification**

Run:
```bash
node --experimental-strip-types --test services/home/test/finding-feed-repo.test.ts
cd web && npm test -- src/home/deepLinks.test.ts
git diff --check
```

- [ ] **Step 2: Commit implementation**

Run:
```bash
git add docs/superpowers/specs/2026-05-05-home-card-deep-links-design.md docs/superpowers/plans/2026-05-05-home-card-deep-links.md services/home/src/types.ts services/home/src/finding-feed-repo.ts services/home/test/finding-feed-repo.test.ts web/src/home/deepLinks.ts web/src/home/deepLinks.test.ts .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "feat: add home card deep links"
```

- [ ] **Step 3: Close bead and push**

Run:
```bash
bd close fra-525 --reason "Implemented explicit Home card deep-link destinations"
git add .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "chore: close home deep-link bead"
git pull --rebase
bd sync
git push
git status --short --branch
```

Expected: push succeeds; `bd sync` may fail because this repo's `bd` binary does not expose `sync`.

## Self-Review

- Spec coverage: service metadata, route helper, missing metadata fallback, and invalid metadata validation are covered.
- Placeholder scan: no placeholder text remains.
- Type consistency: destination names match between service and web tests.
