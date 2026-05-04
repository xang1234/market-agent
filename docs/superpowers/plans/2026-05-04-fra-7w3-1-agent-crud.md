# fra-7w3.1 Agent CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P5.1 agent service contract: durable agent definitions, cadence compilation, transactional watermark advancement, and approval-gated create-agent flow.

**Architecture:** Add a focused `services/agents` package that wraps the existing `agents` table and existing tool approval interceptor. Keep DB schema changes out of scope unless tests prove the current schema cannot satisfy the contract. Build small modules with explicit validation so later queue-runner, findings, and dynamic-watchlist work can consume stable service functions.

**Tech Stack:** TypeScript on Node `--experimental-strip-types`, `pg`-style `QueryExecutor`, existing resolver `SubjectRef` validation, existing tools approval interceptor.

---

### Task 1: Agent Model And Repository (`fra-td3`)

**Files:**
- Create: `services/agents/package.json`
- Create: `services/agents/src/agent-repo.ts`
- Create: `services/agents/src/index.ts`
- Test: `services/agents/test/agent-repo.test.ts`

- [ ] Write failing tests for creating static and dynamic-universe agents.
- [ ] Verify tests fail because `agent-repo.ts` does not exist.
- [ ] Implement validation, insert/list/get/update/disable helpers around `agents`.
- [ ] Verify focused tests pass.
- [ ] Close `fra-td3` after verification.

### Task 2: Cadence Compiler (`fra-dqz`)

**Files:**
- Create: `services/agents/src/cadence.ts`
- Test: `services/agents/test/cadence.test.ts`
- Modify: `services/agents/src/agent-repo.ts`
- Modify: `services/agents/src/index.ts`

- [ ] Write failing tests for `hourly`, `daily`, `on-filing`, and unsupported cadence rejection.
- [ ] Verify tests fail because compiler is missing.
- [ ] Implement a typed schedule contract and call it from agent validation.
- [ ] Verify cadence and agent repo tests pass.
- [ ] Close `fra-dqz` after verification.

### Task 3: Transactional Watermark Advance (`fra-q0x`)

**Files:**
- Create: `services/agents/src/watermarks.ts`
- Test: `services/agents/test/watermarks.test.ts`
- Modify: `services/agents/src/index.ts`

- [ ] Write failing tests for commit order and rollback-on-failure.
- [ ] Verify tests fail because helper is missing.
- [ ] Implement `advanceWatermarksWithSideEffects` using `begin`, caller side effect callback, `update agents set watermarks`, and `commit`/`rollback`.
- [ ] Verify focused tests pass.
- [ ] Close `fra-q0x` after verification.

### Task 4: Approval-Gated Create Agent (`fra-7dn`)

**Files:**
- Create: `services/agents/src/create-agent-approval.ts`
- Test: `services/agents/test/create-agent-approval.test.ts`
- Modify: `services/agents/src/index.ts`

- [ ] Write failing tests that analyst-originated create-agent returns `pending_action_id` and does not insert an enabled agent.
- [ ] Write failing tests that approval application creates an enabled agent from the pending action.
- [ ] Verify tests fail because approval helper is missing.
- [ ] Implement create-intent and approval-application helpers using `services/tools` pending action shape.
- [ ] Verify focused tests and `services/tools` approval tests pass.
- [ ] Close `fra-7dn` after verification.

### Task 5: Parent Verification And Landing

**Files:**
- Modify: bead metadata only.

- [ ] Run all `services/agents` tests.
- [ ] Run `services/tools` tests.
- [ ] Run relevant broad non-Docker service tests.
- [ ] Use `superpowers:requesting-code-review`.
- [ ] Fix any Critical/Important review issues.
- [ ] Close `fra-7w3.1`.
- [ ] Commit, pull/rebase, attempt `bd sync`, push, and verify branch is up to date.
