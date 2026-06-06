# S3/MinIO Bootstrap Hang Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `services/evidence/test/docker-minio.ts` impossible to hang — a hung/absent Docker daemon makes the S3 tests skip, a broken MinIO bootstrap fails fast with a clear reason — by bounding every `spawnSync` and the readiness S3 client.

**Architecture:** Add a `timeout` to the `docker` `spawnSync` wrapper, funnel command-result handling through a pure, testable `interpretDockerResult` (throws a clear error on timeout/failure), make `dockerAvailable` return `false` on a timed-out probe (skip path), and give the readiness `S3Client` connection/request timeouts. Unit-test the pure interpreter and the probe via an injected fake spawn.

**Tech Stack:** Node `--experimental-strip-types` + `node:test`, `node:child_process.spawnSync`, `@aws-sdk/client-s3` + `@smithy/node-http-handler`.

---

## File Structure

- `services/evidence/test/docker-minio.ts` — **Modify.** Add timeout constants; thread a `timeoutMs` through `run`; add an injectable `SpawnFn`/`defaultSpawn` seam; add the exported pure `interpretDockerResult`; make `dockerAvailable` accept an injected spawn and return `false` on timeout; route `startMinio`/`stopMinio` through the bounded `run` + `interpretDockerResult`; add a `requestHandler` with timeouts to the readiness `S3Client`.
- `services/evidence/test/docker-minio.test.ts` — **Create.** Unit tests (no Docker) for `interpretDockerResult` and `dockerAvailable(fakeSpawn)`.

No CI workflow change: this only touches existing evidence test files.

---

## Task 1: Pure result interpreter + bounded spawn seam (failing test first)

**Files:**
- Create: `services/evidence/test/docker-minio.test.ts`
- Modify: `services/evidence/test/docker-minio.ts`

- [ ] **Step 1: Write the failing unit test**

Create `services/evidence/test/docker-minio.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { interpretDockerResult, dockerAvailable } from "./docker-minio.ts";

test("interpretDockerResult throws a clear timeout error on an ETIMEDOUT result", () => {
  const result = { status: null, error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" }) };
  assert.throws(() => interpretDockerResult(result, "run", 90_000), /docker run failed: timed out after 90000ms/);
});

test("interpretDockerResult surfaces stderr on a non-zero exit", () => {
  const result = { status: 1, stderr: "boom", stdout: "" };
  assert.throws(() => interpretDockerResult(result, "port", 15_000), /boom/);
});

test("interpretDockerResult is a no-op on success", () => {
  assert.doesNotThrow(() => interpretDockerResult({ status: 0, stdout: "ok" }, "run", 90_000));
});

test("dockerAvailable returns false when the probe times out", () => {
  const fakeSpawn = () => ({ status: null, error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
  assert.equal(dockerAvailable(fakeSpawn), false);
});

test("dockerAvailable returns false on a non-zero probe and true on success", () => {
  assert.equal(dockerAvailable(() => ({ status: 1 })), false);
  assert.equal(dockerAvailable(() => ({ status: 0 })), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd services/evidence && node --experimental-strip-types --test 'test/docker-minio.test.ts'
```
Expected: FAIL — `interpretDockerResult` is not exported, and `dockerAvailable` does not accept a spawn argument (so the injected-fake cases fail or it has no such export shape).

- [ ] **Step 3: Add the timeout constants, spawn seam, and interpreter**

In `services/evidence/test/docker-minio.ts`, replace the existing `run` and `dockerAvailable` (lines 18-24):

```ts
function run(command: string, args: string[]) {
  return spawnSync(command, args, { encoding: "utf8" });
}

export function dockerAvailable(): boolean {
  return run("docker", ["version", "--format", "{{.Server.Version}}"]).status === 0;
}
```

with:

```ts
const DOCKER_PROBE_TIMEOUT_MS = 10_000; // `docker version` probe (dockerAvailable)
const DOCKER_CMD_TIMEOUT_MS = 15_000; // `docker port` / `docker rm` — fast commands
const DOCKER_RUN_TIMEOUT_MS = 90_000; // `docker run` — may pull the pinned image

type SpawnResult = {
  status: number | null;
  error?: Error;
  stdout?: string;
  stderr?: string;
};

type SpawnFn = (command: string, args: string[], timeoutMs: number) => SpawnResult;

const defaultSpawn: SpawnFn = (command, args, timeoutMs) =>
  spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs });

function run(command: string, args: string[], timeoutMs: number): SpawnResult {
  return defaultSpawn(command, args, timeoutMs);
}

// Turn a spawnSync result into a clear failure. A timed-out command parks the
// event loop until killed, so it surfaces here as `error` (ETIMEDOUT) with a
// null status; a normal failure surfaces as a non-zero status.
export function interpretDockerResult(result: SpawnResult, action: string, timeoutMs: number): void {
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    const reason = timedOut ? `timed out after ${timeoutMs}ms` : result.error.message;
    throw new Error(`docker ${action} failed: ${reason}`);
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

export function dockerAvailable(spawn: SpawnFn = defaultSpawn): boolean {
  const result = spawn("docker", ["version", "--format", "{{.Server.Version}}"], DOCKER_PROBE_TIMEOUT_MS);
  return !result.error && result.status === 0;
}
```

(`spawnSync` and `assert` are already imported at the top of the file.)

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd services/evidence && node --experimental-strip-types --test 'test/docker-minio.test.ts'
```
Expected: PASS — all five tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/evidence/test/docker-minio.ts services/evidence/test/docker-minio.test.ts
git commit -m "test(evidence): bound docker spawn + testable result interpreter for minio bootstrap (fra-n7el)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Route bootstrap commands through the bounded run + interpreter

**Files:**
- Modify: `services/evidence/test/docker-minio.ts`

- [ ] **Step 1: Bound `startMinio`**

Replace the body of `startMinio` (the `run`/`assert.equal` calls — currently lines ~30-54) so each `docker` call passes a timeout and goes through `interpretDockerResult`:

```ts
function startMinio(containerName: string): { hostPort: string } {
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "-e",
    `MINIO_ROOT_USER=${MINIO_USER}`,
    "-e",
    `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
    "-p",
    "127.0.0.1::9000",
    MINIO_IMAGE,
    "server",
    "/data",
  ], DOCKER_RUN_TIMEOUT_MS);
  interpretDockerResult(result, "run", DOCKER_RUN_TIMEOUT_MS);

  const portResult = run("docker", ["port", containerName, "9000/tcp"], DOCKER_CMD_TIMEOUT_MS);
  interpretDockerResult(portResult, "port", DOCKER_CMD_TIMEOUT_MS);
  const match = portResult.stdout?.trim().match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${portResult.stdout?.trim()}`);
  return { hostPort: match[1] };
}
```

- [ ] **Step 2: Bound `stopMinio`**

Replace `stopMinio` (currently lines ~56-58) so cleanup is also bounded (failures stay ignored — cleanup is best-effort):

```ts
function stopMinio(containerName: string): void {
  run("docker", ["rm", "--force", containerName], DOCKER_CMD_TIMEOUT_MS);
}
```

- [ ] **Step 3: Run the existing test file to confirm nothing regressed**

Run:
```bash
cd services/evidence && node --experimental-strip-types --test 'test/docker-minio.test.ts'
```
Expected: PASS — the unit tests still pass (the interpreter/probe logic is unchanged; this task only rewires the callers).

- [ ] **Step 4: Type-check the helper compiles under strip-types by importing it**

Run:
```bash
cd services/evidence && node --experimental-strip-types -e "import('./test/docker-minio.ts').then(() => console.log('imports ok'))"
```
Expected: prints `imports ok` (no syntax/parse error from the rewired `startMinio`/`stopMinio`).

- [ ] **Step 5: Commit**

```bash
git add services/evidence/test/docker-minio.ts
git commit -m "test(evidence): route minio bootstrap commands through bounded run + interpreter (fra-n7el)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Bound the readiness S3 client

**Files:**
- Modify: `services/evidence/test/docker-minio.ts`

- [ ] **Step 1: Import the request handler**

Add to the imports at the top of `services/evidence/test/docker-minio.ts` (after the `@aws-sdk/client-s3` import):

```ts
import { NodeHttpHandler } from "@smithy/node-http-handler";
```

- [ ] **Step 2: Give the readiness client connection/request timeouts**

In `bootstrapMinio`, replace the `S3Client` construction (currently lines ~82-87):

```ts
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    forcePathStyle: true,
  });
```

with:

```ts
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    forcePathStyle: true,
    // Bound each request so a black-holed endpoint makes waitForMinio's poll
    // loop reject within seconds instead of stalling.
    requestHandler: new NodeHttpHandler({ connectionTimeout: 2_000, requestTimeout: 5_000 }),
  });
```

- [ ] **Step 3: Confirm the helper still imports cleanly**

Run:
```bash
cd services/evidence && node --experimental-strip-types -e "import('./test/docker-minio.ts').then(() => console.log('imports ok'))"
```
Expected: prints `imports ok` (the `@smithy/node-http-handler` import resolves).

- [ ] **Step 4: Commit**

```bash
git add services/evidence/test/docker-minio.ts
git commit -m "test(evidence): bound readiness S3 client request timeouts for minio (fra-n7el)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification (real Docker), close bead, push, PR

- [ ] **Step 1: Run the full evidence suite with Docker up**

```bash
cd services/evidence && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)|round-trips|docker-minio|s3"
```
Expected: `fail 0`. The S3 integration tests (`round-trips bytes…`, etc.) still run and pass against real MinIO; the new `docker-minio.test.ts` unit tests pass.

- [ ] **Step 2: Sanity-check the skip path (Docker reachable but probe bounded)**

Confirm the probe still reports Docker as available in a healthy environment (so tests are not wrongly skipped):
```bash
cd services/evidence && node --experimental-strip-types -e "import('./test/docker-minio.ts').then(m => console.log('dockerAvailable:', m.dockerAvailable()))"
```
Expected: prints `dockerAvailable: true` when the daemon is healthy.

- [ ] **Step 3: Close the bead and push**

```bash
bd close fra-n7el --reason="Bounded every docker spawnSync (probe→skip, bootstrap→fail-fast via interpretDockerResult) and gave the readiness S3 client connection/request timeouts, so the S3 integration tests can no longer hang the event loop. Unit-tested the interpreter + probe; integration tests still run on real MinIO."
git push -u origin feat/fra-n7el-s3-minio-hang
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --title "Fix S3 object-store integration test hang (fra-n7el)" --body "$(cat <<'EOF'
## Summary
- The MinIO bootstrap helper shelled out to docker via `spawnSync` with **no timeout**. A blocking docker call (unresponsive daemon, stuck image pull) parks the event loop synchronously, so node:test's per-test timeout can never fire → indefinite hang.
- Every docker `spawnSync` is now bounded. A timed-out **probe** (`docker version`) makes `dockerAvailable()` return false → S3 tests skip; a timed-out/failed **bootstrap** command throws a clear error via the new pure `interpretDockerResult` → fail fast. The readiness S3Client also gets connection/request timeouts so a black-holed endpoint can't stall the poll loop.

## Test Plan
- [x] New `docker-minio.test.ts` unit tests (no Docker): `interpretDockerResult` (timeout → clear error, non-zero → stderr, success → no-op) and `dockerAvailable(fakeSpawn)` (timeout/non-zero → false, success → true)
- [x] `services/evidence` npm test green with Docker up — S3 integration tests still run against real MinIO

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Docker required for Task 4 only.** Tasks 1-3 are pure unit/compile checks and need no Docker.
- **Why `interpretDockerResult` is exported:** it's the single point that converts a stalled/failed bootstrap command into a clear, fast failure, and it's the main unit-tested seam. Keep it pure (no spawn inside).
- **Probe vs bootstrap asymmetry is intentional:** `dockerAvailable` swallows a timeout into `false` (skip); `startMinio` rethrows via `interpretDockerResult` (fail). Don't unify them.
- **`@smithy/node-http-handler`** is already installed (v4.6.1, via `@aws-sdk/client-s3` 3.1039.0); no new dependency.
