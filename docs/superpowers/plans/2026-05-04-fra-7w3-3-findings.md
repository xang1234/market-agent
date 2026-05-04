# fra-7w3.3 Finding Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P5.3 finding service: explainable severity scoring, schema-valid finding summary blocks, and sealed-snapshot-backed finding persistence.

**Architecture:** Extend the existing `services/agents` package from P5.1 with three focused modules. `severity-scorer.ts` is pure and deterministic. `finding-summary-blocks.ts` builds block-schema-compatible summaries. `finding-generator.ts` composes sealed snapshot metadata with severity and summary blocks, then inserts a `findings` row.

**Tech Stack:** TypeScript on Node `--experimental-strip-types`, existing `services/agents` package, existing web block schema JSON for block validation, pg-style `QueryExecutor`.

---

### Task 1: Severity Scorer (`fra-3de`)

**Files:**
- Create: `services/agents/src/severity-scorer.ts`
- Test: `services/agents/test/severity-scorer.test.ts`
- Modify: `services/agents/src/index.ts`

- [x] Write failing golden tests for low, medium, high, and critical findings.
- [x] Verify tests fail because `severity-scorer.ts` is missing.
- [x] Implement deterministic component scoring for evidence, impact, and thesis relevance.
- [x] Verify focused tests pass.
- [x] Close `fra-3de`.

### Task 2: Summary Blocks (`fra-n6a`)

**Files:**
- Create: `services/agents/src/finding-summary-blocks.ts`
- Test: `services/agents/test/finding-summary-blocks.test.ts`
- Modify: `services/agents/src/index.ts`

- [x] Write failing tests that generated `finding_card` blocks validate against `web/src/blocks/blockSchema.json`.
- [x] Verify tests fail because generator is missing.
- [x] Implement finding-card block generation with no raw document text fields.
- [x] Verify focused tests pass.
- [x] Close `fra-n6a`.

### Task 3: Finding Generator (`fra-ios`)

**Files:**
- Create: `services/agents/src/finding-generator.ts`
- Test: `services/agents/test/finding-generator.test.ts`
- Modify: `services/agents/src/index.ts`

- [x] Write failing tests that generating a finding requires `snapshot_id` and inserts the row with `summary_blocks`.
- [x] Verify tests fail because generator is missing.
- [x] Implement `generateFinding` around the existing `findings` table.
- [x] Verify focused tests pass.
- [x] Close `fra-ios`.

### Task 4: Parent Verification And Landing

**Files:**
- Modify: bead metadata only.

- [x] Run `npm test` in `services/agents`.
- [x] Run relevant block schema coverage through `services/agents/test/finding-summary-blocks.test.ts`.
- [x] Run `git diff --check`.
- [x] Close `fra-7w3.3`.
- [ ] Commit, pull/rebase, attempt `bd sync`, push, and verify branch is up to date.
