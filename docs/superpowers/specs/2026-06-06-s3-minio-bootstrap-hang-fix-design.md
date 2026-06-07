# Fix S3 object-store integration test hang

**Bead:** fra-n7el
**Date:** 2026-06-06

## Problem

`services/evidence/test/s3-object-store.integration.test.ts` can hang `npm test` when
Docker is detected but the MinIO bootstrap never completes. The test helper
`services/evidence/test/docker-minio.ts` shells out to `docker` via:

```ts
function run(command: string, args: string[]) {
  return spawnSync(command, args, { encoding: "utf8" });   // no timeout
}
```

`spawnSync` is **synchronous** — it parks the event loop in native code until the child
exits. So when any `docker` call blocks (an unresponsive daemon on `docker version`, a
stuck image pull on `docker run`, a hung `docker port`), the event loop is frozen and
node:test's own `{ timeout: 120000 }` (a `setTimeout` racing the test promise) can never
fire. The result is an indefinite hang rather than a timeout.

A secondary, latent vector: the readiness `S3Client` in `bootstrapMinio` is constructed
with no request timeout, so `waitForMinio`'s poll loop assumes each `client.send` resolves
or rejects. Against a black-holed endpoint, a single `client.send` could stall the loop.

## Goal

No environment can make the S3 integration tests hang. A hung/absent Docker daemon makes
the tests **skip**; a Docker daemon that is present but whose MinIO bootstrap fails or
stalls makes them **fail fast with a clear reason**. The tests still run normally when
Docker + MinIO work.

## Design (`services/evidence/test/docker-minio.ts`)

### 1. Timeout constants

```ts
const DOCKER_PROBE_TIMEOUT_MS = 10_000;  // `docker version` (dockerAvailable probe)
const DOCKER_CMD_TIMEOUT_MS = 15_000;    // `docker port` / `docker rm` (fast commands)
const DOCKER_RUN_TIMEOUT_MS = 90_000;    // `docker run` (may pull the pinned image)
```

### 2. Bounded `run`

```ts
function run(command: string, args: string[], timeoutMs: number) {
  return spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs });
}
```

On timeout `spawnSync` kills the child and returns `{ status: null, error: <ETIMEDOUT>, … }`.

### 3. Pure, testable result interpreter

```ts
type SpawnResult = { status: number | null; error?: Error; stdout?: string; stderr?: string };

export function interpretDockerResult(result: SpawnResult, action: string, timeoutMs: number): void {
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    const reason = timedOut ? `timed out after ${timeoutMs}ms` : result.error.message;
    throw new Error(`docker ${action} failed: ${reason}`);
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
```

This is the single place that turns a stalled/failed bootstrap command into a **clear,
fast failure**. `startMinio` routes `docker run` (with `DOCKER_RUN_TIMEOUT_MS`) and
`docker port` (with `DOCKER_CMD_TIMEOUT_MS`) through it.

### 4. `dockerAvailable` → skip on hang

```ts
export function dockerAvailable(spawn: SpawnFn = defaultSpawn): boolean {
  const result = spawn("docker", ["version", "--format", "{{.Server.Version}}"], DOCKER_PROBE_TIMEOUT_MS);
  return !result.error && result.status === 0;
}
```

A hung daemon → `spawnSync` returns an ETIMEDOUT `error` after 10s → `false` → the four
S3 tests hit their existing `t.skip(...)` path. The `spawn` parameter (default = the real
`run`) exists only so the skip-on-timeout branch is unit-testable; the integration test
calls `dockerAvailable()` unchanged.

### 5. `stopMinio` cleanup

`docker rm --force` runs through `run(..., DOCKER_CMD_TIMEOUT_MS)`; failures stay ignored
(cleanup is best-effort, as today).

### 6. Bounded readiness client

In `bootstrapMinio`, give the readiness `S3Client` a request handler with connection and
request timeouts so `waitForMinio` can't stall on a black-holed endpoint:

```ts
import { NodeHttpHandler } from "@smithy/node-http-handler";  // present via @aws-sdk/client-s3 (v4.6.1)

const client = new S3Client({
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({ connectionTimeout: 2_000, requestTimeout: 5_000 }),
});
```

Each failed `ListBucketsCommand` poll now rejects within seconds, so the existing
120-attempt × 500ms loop in `waitForMinio` stays honestly bounded (~60s) and then throws.

## Testing

New unit test `services/evidence/test/docker-minio.test.ts` (no Docker required):

- `interpretDockerResult`:
  - timeout result `{ status: null, error: Object.assign(new Error("kill"), { code: "ETIMEDOUT" }) }` → throws `/timed out after \d+ms/`.
  - non-zero result `{ status: 1, stderr: "boom" }` → throws `/boom/`.
  - success `{ status: 0 }` → does not throw.
- `dockerAvailable(fakeSpawn)`:
  - fake returns `{ status: null, error: { code: "ETIMEDOUT" } }` → `false`.
  - fake returns `{ status: 0 }` → `true`.
  - fake returns `{ status: 1 }` → `false`.

These pin the logic that converts a hang into skip-or-fast-fail. The real-Docker
integration tests in `s3-object-store.integration.test.ts` are unchanged and still run
when bootstrap succeeds.

## Out of scope

- The actual content of the S3 round-trip / checksum tests (unchanged).
- `db/test/docker-pg.ts` — a separate harness with its own `dockerAvailable`; not in this
  bug's scope.

## Decisions

- **Probe hang → skip; bootstrap hang → fail loudly.** An environment without a usable
  Docker daemon skips (no false failures); a daemon that is present but whose MinIO setup
  is broken surfaces a clear error rather than silently skipping coverage.
- **Bound both the `spawnSync` calls and the readiness HTTP client** — close the certain
  (event-loop-blocking) and the latent (black-holed-endpoint) hang vectors together.
