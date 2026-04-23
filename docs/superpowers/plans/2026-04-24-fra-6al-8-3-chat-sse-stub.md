# fra-6al.8.3 Chat SSE Stub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `services/chat` package that serves the stub SSE route `GET /v1/chat/threads/:threadId/stream`, validates `run_id`, emits an immediate `turn.started`, then periodic heartbeats until disconnect.

**Architecture:** Mirror the existing `services/resolver` package with a plain Node `http` server and Node test runner. Keep the implementation narrow: one exported `createChatServer()` factory, one route matcher for the stream endpoint, deterministic stub event payloads, and cleanup logic that clears the heartbeat timer when the client closes the connection.

**Tech Stack:** Node 22+ `node:http`, TypeScript-in-place via `--experimental-strip-types`, Node test runner, built-in `fetch`.

---

## File Map

- Create: `services/chat/package.json`
  Responsibility: package metadata plus `npm test`.
- Create: `services/chat/README.md`
  Responsibility: describe the stub route and how to run tests.
- Create: `services/chat/src/http.ts`
  Responsibility: route matching, validation, SSE headers, event writing, heartbeat cleanup, `createChatServer()`.
- Create: `services/chat/test/http.test.ts`
  Responsibility: integration-style coverage over a real local server.

## Task 1: Add Failing Route-Matching Tests

**Files:**
- Create: `services/chat/package.json`
- Create: `services/chat/test/http.test.ts`
- Test: `services/chat/test/http.test.ts`

- [ ] **Step 1: Create the package manifest**
- [ ] **Step 2: Write the failing tests for `400` and `404`**
- [ ] **Step 3: Run the tests to verify RED**
- [ ] **Step 4: Commit the test scaffold**

## Task 2: Implement the Minimal Route and Initial SSE Event

**Files:**
- Create: `services/chat/src/http.ts`
- Modify: `services/chat/test/http.test.ts`
- Test: `services/chat/test/http.test.ts`

- [ ] **Step 1: Write the next failing tests for SSE headers and `turn.started`**
- [ ] **Step 2: Run the tests to verify RED**
- [ ] **Step 3: Implement the minimal server**
- [ ] **Step 4: Run the tests to verify GREEN**
- [ ] **Step 5: Commit the minimal route**

## Task 3: Add Heartbeat Streaming, Cleanup, and README

**Files:**
- Modify: `services/chat/src/http.ts`
- Modify: `services/chat/test/http.test.ts`
- Create: `services/chat/README.md`
- Test: `services/chat/test/http.test.ts`

- [ ] **Step 1: Write the failing heartbeat test**
- [ ] **Step 2: Run the tests to verify RED**
- [ ] **Step 3: Extend `services/chat/src/http.ts` with heartbeat scheduling and cleanup**
- [ ] **Step 4: Add package documentation**
- [ ] **Step 5: Run the tests to verify GREEN**
- [ ] **Step 6: Commit the heartbeat behavior and docs**

## Task 4: Final Verification and Bead Closure

**Files:**
- Verify only

- [ ] **Step 1: Run the package test suite**
- [ ] **Step 2: Run a manual streaming probe**
- [ ] **Step 3: Close the bead after verification**
- [ ] **Step 4: Land the session per repo instructions**
