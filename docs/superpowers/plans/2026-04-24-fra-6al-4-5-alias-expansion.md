# fra-6al.4.5 Alias Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand issuer former-name aliases into explicit issuer plus active listing candidates without changing deterministic legal-name resolution.

**Architecture:** Keep the expansion inside `services/resolver/src/lookup.ts`, where name candidate lookup already owns issuer-name matching. Legal-name rows continue to build issuer-only candidates; former-name rows additionally fetch active listings for matched issuers and merge them into an ambiguous envelope.

**Tech Stack:** TypeScript, Node test runner, Postgres integration tests through existing Docker harness.

---

## File Structure

- Modify `services/resolver/src/envelope.ts`: add a named confidence constant for alias-expanded listing candidates.
- Modify `services/resolver/src/lookup.ts`: add active listing lookup for alias-matched issuers, candidate merge/dedupe helpers, and a conservative ambiguity axis.
- Modify `services/resolver/test/lookup.test.ts`: add red/green tests for Google-style alias expansion and legal-name determinism.
- Modify `services/resolver/test/http.test.ts`: keep HTTP stubs compatible with any new listing lookup query if needed.

## Task 1: Add Alias Expansion Tests

**Files:**
- Modify: `services/resolver/test/lookup.test.ts`

- [ ] **Step 1: Write failing alias expansion test**

Add a test that seeds `Alphabet Inc.` with former name `Google`, one active common-stock listing `GOOG`, then calls `resolveByNameCandidate(client, "Google")` and expects an ambiguous envelope with issuer plus listing candidates.

- [ ] **Step 2: Write legal-name determinism guard**

Add a test that seeds Apple with a listing, resolves `Apple Inc.`, and asserts it remains a resolved issuer with no listing candidate expansion.

- [ ] **Step 3: Verify red**

Run:

```bash
npm test -- test/lookup.test.ts
```

Expected: the Google alias test fails because the current code returns a resolved issuer-only envelope.

## Task 2: Implement Alias Listing Expansion

**Files:**
- Modify: `services/resolver/src/envelope.ts`
- Modify: `services/resolver/src/lookup.ts`

- [ ] **Step 1: Add confidence constant**

Add `CONFIDENCE_NAME_ALIAS_LISTING = 0.8` in `envelope.ts`.

- [ ] **Step 2: Fetch active listings for alias issuer rows**

In `resolveByNameCandidate`, after matched rows are deduped, identify rows with `match_reason === "former_name"` and fetch active listings for those issuer IDs with the same active-window predicate used by ticker lookup.

- [ ] **Step 3: Merge candidates conservatively**

Build issuer candidates as today, build listing candidates from active listings, dedupe by `{kind}:{id}`, sort by confidence descending, and return:

- `resolved` only when there is exactly one issuer-only candidate.
- `ambiguous` when expansion yields issuer plus listing candidates or multiple issuers/listings.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test -- test/lookup.test.ts
```

Expected: lookup tests pass.

## Task 3: Run Quality Gates and Close Bead

**Files:**
- Modify: `.beads/issues.jsonl`

- [ ] **Step 1: Run resolver gates**

Run:

```bash
npm test
```

from `services/resolver`.

- [ ] **Step 2: Close bead**

Run:

```bash
bd close fra-6al.4.5 --reason "Implemented alias target expansion across identity levels: former-name aliases now return issuer plus active listing candidates without silently choosing a share class, while legal-name hits remain deterministic issuer resolutions. Verified with resolver tests."
bd sync
```

- [ ] **Step 3: Commit and push**

Stage only intended resolver, plan, and bead files; commit with:

```bash
git commit -m "feat(resolver): expand issuer aliases to listings"
git push
```
