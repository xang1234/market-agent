# Home Feed Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the service-layer Home feed read model for cross-agent finding dedupe and ranking.

**Architecture:** Add a new `services/home` package. `finding-feed-repo.ts` queries user-scoped enabled-agent findings and dedupes by claim cluster. `ranker.ts` is a pure deterministic scorer that orders cards by recency, severity, and injected user affinity.

**Tech Stack:** TypeScript, Node built-in test runner, service-local `QueryExecutor` shape matching existing packages.

---

## File Structure

- Create `services/home/package.json`
  - Defines the package and `npm test` script.
- Create `services/home/src/types.ts`
  - Shared Home card, source row, severity, and query-executor types.
- Create `services/home/src/finding-feed-repo.ts`
  - Validates requests, maps DB rows, groups findings by dedupe key, and returns deduped cards.
- Create `services/home/src/ranker.ts`
  - Computes recency/severity/affinity scores and returns ranked cards.
- Create `services/home/src/index.ts`
  - Re-exports public service APIs.
- Create `services/home/test/finding-feed-repo.test.ts`
  - Covers `fra-9y5`.
- Create `services/home/test/ranker.test.ts`
  - Covers `fra-64z`.

## Task 1: Cross-Agent Finding Query + Cluster Dedupe (`fra-9y5`)

**Files:**
- Create: `services/home/package.json`
- Create: `services/home/src/types.ts`
- Create: `services/home/src/finding-feed-repo.ts`
- Create: `services/home/src/index.ts`
- Create: `services/home/test/finding-feed-repo.test.ts`

- [ ] **Step 1: Claim the bead**

Run: `bd update fra-9y5 --status in_progress`

Expected: bead status changes to in progress.

- [ ] **Step 2: Write failing tests**

Create `services/home/test/finding-feed-repo.test.ts` with tests that:
- seed three fake finding rows sharing one `claim_cluster_ids[0]`
- assert `listHomeFindingCards` returns one card with `contributing_finding_count = 3`
- assert SQL filters by `agents.user_id`, `agents.enabled = true`
- assert unclustered findings return singleton cards
- assert malformed row JSON fails loudly

- [ ] **Step 3: Verify RED**

Run: `node --experimental-strip-types --test services/home/test/finding-feed-repo.test.ts`

Expected: fails because `../src/finding-feed-repo.ts` does not exist.

- [ ] **Step 4: Implement minimal package and repository**

Create:
- `services/home/package.json`
- `services/home/src/types.ts`
- `services/home/src/finding-feed-repo.ts`
- `services/home/src/index.ts`

Implementation rules:
- Query `findings f join agents a on a.agent_id = f.agent_id`.
- Filter `a.user_id = $1::uuid` and `a.enabled = true`.
- Left join `claim_clusters` using the primary sorted claim cluster id from each finding.
- Use dedupe key `claim_cluster:<cluster_id>` or `finding:<finding_id>`.
- Pick primary finding by severity rank desc, `created_at` desc, `finding_id` asc.
- Sort output by primary `created_at` desc, then `home_card_id` asc.
- Freeze returned arrays/objects.

- [ ] **Step 5: Verify GREEN**

Run: `node --experimental-strip-types --test services/home/test/finding-feed-repo.test.ts`

Expected: all finding-feed tests pass.

- [ ] **Step 6: Commit Task 1**

Run:
```bash
git add services/home/package.json services/home/src/types.ts services/home/src/finding-feed-repo.ts services/home/src/index.ts services/home/test/finding-feed-repo.test.ts .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "feat: add home finding feed dedupe"
```

## Task 2: Home Ranking (`fra-64z`)

**Files:**
- Create: `services/home/src/ranker.ts`
- Create: `services/home/test/ranker.test.ts`
- Modify: `services/home/src/index.ts`

- [ ] **Step 1: Claim the bead**

Run: `bd update fra-64z --status in_progress`

Expected: bead status changes to in progress.

- [ ] **Step 2: Write failing tests**

Create `services/home/test/ranker.test.ts` with tests that:
- assert critical severity outranks a low-severity high-affinity card by default
- assert recent cards outrank stale cards when severity and affinity match
- assert configurable weights can make affinity dominate
- assert tie-breakers are deterministic

- [ ] **Step 3: Verify RED**

Run: `node --experimental-strip-types --test services/home/test/ranker.test.ts`

Expected: fails because `../src/ranker.ts` does not exist.

- [ ] **Step 4: Implement ranker**

Create `services/home/src/ranker.ts` exporting:
- `rankHomeCards(cards, options)`
- `scoreHomeCard(card, options)`
- `DEFAULT_HOME_RANKING_WEIGHTS`

Implementation rules:
- Severity values: `low=0.25`, `medium=0.5`, `high=0.75`, `critical=1`.
- Recency score: exponential decay using configurable half-life hours.
- Clamp affinity to `[0, 1]`.
- Score with configurable weights.
- Critical floor: if compared against non-critical cards, critical cards win unless the non-critical score exceeds by `critical_override_margin`.
- Tie-break by score desc, severity rank desc, created_at desc, `home_card_id` asc.

- [ ] **Step 5: Verify GREEN**

Run: `node --experimental-strip-types --test services/home/test/ranker.test.ts`

Expected: all ranker tests pass.

- [ ] **Step 6: Run full Home service tests**

Run: `cd services/home && npm test`

Expected: all Home tests pass.

- [ ] **Step 7: Commit Task 2**

Run:
```bash
git add services/home/src/ranker.ts services/home/test/ranker.test.ts services/home/src/index.ts .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "feat: rank home finding cards"
```

## Task 3: Close Beads And Push

**Files:**
- Modify: `.beads/issues.jsonl`
- Modify: `.beads/interactions.jsonl`

- [ ] **Step 1: Run verification**

Run:
```bash
node --experimental-strip-types --test services/home/test/finding-feed-repo.test.ts
node --experimental-strip-types --test services/home/test/ranker.test.ts
(cd services/home && npm test)
git diff --check
```

Expected: tests pass and diff check has no output.

- [ ] **Step 2: Close beads**

Run:
```bash
bd close fra-9y5 --reason "Implemented Home finding query and cluster dedupe"
bd close fra-64z --reason "Implemented configurable Home ranking"
```

Expected: both child beads are closed.

- [ ] **Step 3: Commit bead closure**

Run:
```bash
git add .beads/issues.jsonl .beads/interactions.jsonl
git commit -m "chore: close home feed ranking beads"
```

- [ ] **Step 4: Push branch**

Run:
```bash
git pull --rebase
bd sync
git push -u origin feat/fra-7vn-4-home-feed-ranking
git status --short --branch
```

Expected: push succeeds; `bd sync` may fail because this repo's `bd` binary does not expose `sync`.

## Self-Review

- Spec coverage: Task 1 covers cross-agent finding query and cluster dedupe; Task 2 covers configurable ranking with recency, severity, and user affinity.
- Placeholder scan: no placeholder text remains.
- Type consistency: `HomeFindingCard`, `HomeRankingWeights`, `listHomeFindingCards`, and `rankHomeCards` are consistently named across tasks.
