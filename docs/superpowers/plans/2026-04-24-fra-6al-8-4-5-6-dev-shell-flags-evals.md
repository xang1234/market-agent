# fra-6al.8.4 / fra-6al.8.5 / fra-6al.8.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-command hybrid dev shell, shared env-backed dev flags, and an initial `evals/golden/` scaffold so the remaining P0.6 acceptance criteria are satisfied.

**Architecture:** Keep the repo’s current multi-package shape. Use a repo script plus Docker Compose for infra only, host-run Node/Vite processes for app packages, a lightweight `services/dev-api` placeholder process for missing backend surfaces, and a small shared backend flag helper plus a small web flag helper. Keep eval work intentionally skeletal: directories, docs, and starter schema only.

**Tech Stack:** Bash, Docker Compose, Node 22+ with `--experimental-strip-types`, Vite, PostgreSQL, Redis, Node test runner.

---

## File Map

- Create: `scripts/dev-shell.sh`
  Responsibility: single entrypoint with `up`, `down`, and `status`.
- Create: `docker-compose.dev.yml`
  Responsibility: Postgres and Redis containers only.
- Create: `.env.dev.example`
  Responsibility: documented defaults for ports, connection strings, and flags.
- Modify: `.gitignore`
  Responsibility: ignore `.dev/` runtime state and local `.env.dev`.
- Create: `services/shared/src/devFlags.ts`
  Responsibility: backend/service flag parsing and defaults.
- Create: `services/dev-api/package.json`
  Responsibility: package metadata and test script.
- Create: `services/dev-api/README.md`
  Responsibility: placeholder-service scope and usage.
- Create: `services/dev-api/src/http.ts`
  Responsibility: placeholder routes and health endpoint.
- Create: `services/dev-api/src/dev.ts`
  Responsibility: runnable server entrypoint using env config.
- Create: `services/dev-api/test/devFlags.test.ts`
  Responsibility: backend flag parsing coverage.
- Create: `services/dev-api/test/http.test.ts`
  Responsibility: placeholder server coverage.
- Create: `services/chat/src/dev.ts`
  Responsibility: runnable chat server entrypoint.
- Modify: `services/chat/package.json`
  Responsibility: add `dev` script.
- Create: `services/resolver/src/dev.ts`
  Responsibility: runnable resolver server entrypoint with `pg.Pool`.
- Modify: `services/resolver/package.json`
  Responsibility: add `dev` script.
- Create: `web/src/devFlags.ts`
  Responsibility: frontend/Vite flag parsing and defaults.
- Create: `web/src/devFlags.test.ts`
  Responsibility: frontend flag parsing coverage.
- Modify: `web/src/pages/HomePage.tsx`
  Responsibility: minimal sample flag consumer proving frontend wiring.
- Create: `evals/golden/README.md`
  Responsibility: scaffold purpose and future PX.1 ownership.
- Create: `evals/golden/cases/.gitkeep`
  Responsibility: committed cases directory.
- Create: `evals/golden/results/.gitkeep`
  Responsibility: committed results directory.
- Create: `evals/golden/case.schema.json`
  Responsibility: starter shape for future golden cases.
- Modify: `README.md`
  Responsibility: document dev shell usage.
- Modify: `services/chat/README.md`
  Responsibility: mention `npm run dev`.
- Modify: `services/resolver/README.md`
  Responsibility: mention `npm run dev`.

## Task 1: Add Failing Flag-Parsing Tests

**Files:**
- Create: `services/shared/src/devFlags.ts`
- Create: `services/dev-api/test/devFlags.test.ts`
- Create: `web/src/devFlags.ts`
- Create: `web/src/devFlags.test.ts`
- Test: `services/dev-api/test/devFlags.test.ts`
- Test: `web/src/devFlags.test.ts`

- [ ] **Step 1: Write the failing backend flag tests**

Create `services/dev-api/test/devFlags.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readDevFlags } from "../../shared/src/devFlags.ts";

test("readDevFlags uses safe defaults when env is unset", () => {
  const flags = readDevFlags({});

  assert.deepEqual(flags, {
    placeholderApiEnabled: true,
    showDevBanner: false,
  });
});

test("readDevFlags parses boolean-like env values", () => {
  const flags = readDevFlags({
    MA_FLAG_PLACEHOLDER_API: "off",
    MA_FLAG_SHOW_DEV_BANNER: "1",
  });

  assert.deepEqual(flags, {
    placeholderApiEnabled: false,
    showDevBanner: true,
  });
});
```

- [ ] **Step 2: Write the failing frontend flag tests**

Create `web/src/devFlags.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readWebDevFlags } from "./devFlags";

test("readWebDevFlags uses safe defaults when Vite env is unset", () => {
  const flags = readWebDevFlags({});

  assert.deepEqual(flags, {
    placeholderApiEnabled: true,
    showDevBanner: false,
  });
});

test("readWebDevFlags parses Vite-prefixed boolean-like env values", () => {
  const flags = readWebDevFlags({
    VITE_MA_FLAG_PLACEHOLDER_API: "0",
    VITE_MA_FLAG_SHOW_DEV_BANNER: "true",
  });

  assert.deepEqual(flags, {
    placeholderApiEnabled: false,
    showDevBanner: true,
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api
node --experimental-strip-types --test test/devFlags.test.ts
```

Expected: FAIL because `../../shared/src/devFlags.ts` does not exist yet.

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web
node --experimental-strip-types --test src/devFlags.test.ts
```

Expected: FAIL because `./devFlags` does not exist yet.

- [ ] **Step 4: Implement the minimal flag helpers**

Create `services/shared/src/devFlags.ts`:

```ts
export type DevFlags = {
  placeholderApiEnabled: boolean;
  showDevBanner: boolean;
};

export function readDevFlags(env: Record<string, string | undefined>): DevFlags {
  return {
    placeholderApiEnabled: parseBoolean(env.MA_FLAG_PLACEHOLDER_API, true),
    showDevBanner: parseBoolean(env.MA_FLAG_SHOW_DEV_BANNER, false),
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "on":
    case "yes":
      return true;
    case "0":
    case "false":
    case "off":
    case "no":
      return false;
    default:
      return fallback;
  }
}
```

Create `web/src/devFlags.ts`:

```ts
export type WebDevFlags = {
  placeholderApiEnabled: boolean;
  showDevBanner: boolean;
};

export function readWebDevFlags(env: Record<string, string | undefined>): WebDevFlags {
  return {
    placeholderApiEnabled: parseBoolean(env.VITE_MA_FLAG_PLACEHOLDER_API, true),
    showDevBanner: parseBoolean(env.VITE_MA_FLAG_SHOW_DEV_BANNER, false),
  };
}

export const webDevFlags = readWebDevFlags(import.meta.env as Record<string, string | undefined>);

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "on":
    case "yes":
      return true;
    case "0":
    case "false":
    case "off":
    case "no":
      return false;
    default:
      return fallback;
  }
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api
node --experimental-strip-types --test test/devFlags.test.ts
```

Expected: PASS.

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web
node --experimental-strip-types --test src/devFlags.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the flag helpers**

```bash
git add \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/shared/src/devFlags.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api/test/devFlags.test.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web/src/devFlags.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web/src/devFlags.test.ts
git commit -m "feat(dev): add shared dev flag parsers"
```

## Task 2: Add the Placeholder Dev API Package

**Files:**
- Create: `services/dev-api/package.json`
- Create: `services/dev-api/README.md`
- Create: `services/dev-api/src/http.ts`
- Create: `services/dev-api/src/dev.ts`
- Create: `services/dev-api/test/http.test.ts`
- Test: `services/dev-api/test/http.test.ts`

- [ ] **Step 1: Write the failing placeholder-server tests**

Create `services/dev-api/test/http.test.ts`:

```ts
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createDevApiServer } from "../src/http.ts";

async function startServer(t: TestContext, env: Record<string, string | undefined> = {}) {
  const server = createDevApiServer(env);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("health endpoint reports ok plus parsed flags", async (t) => {
  const base = await startServer(t, { MA_FLAG_SHOW_DEV_BANNER: "true" });

  const response = await fetch(`${base}/healthz`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.flags, {
    placeholderApiEnabled: true,
    showDevBanner: true,
  });
});

test("placeholder route returns 503 when placeholder API is disabled", async (t) => {
  const base = await startServer(t, { MA_FLAG_PLACEHOLDER_API: "false" });

  const response = await fetch(`${base}/v1/dev/placeholders`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.error, "placeholder api disabled");
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api
node --experimental-strip-types --test test/http.test.ts
```

Expected: FAIL because `../src/http.ts` and the package do not exist yet.

- [ ] **Step 3: Implement the minimal placeholder API**

Create `services/dev-api/package.json`:

```json
{
  "name": "dev-api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": ">=22.6.0"
  },
  "scripts": {
    "dev": "node --experimental-strip-types src/dev.ts",
    "test": "node --experimental-strip-types --test \"test/**/*.test.ts\""
  }
}
```

Create `services/dev-api/src/http.ts`:

```ts
import { createServer, type Server, type ServerResponse } from "node:http";
import { readDevFlags } from "../../shared/src/devFlags.ts";

export function createDevApiServer(env: Record<string, string | undefined> = process.env): Server {
  const flags = readDevFlags(env);

  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      respondJson(res, 200, { status: "ok", service: "dev-api", flags });
      return;
    }

    if (req.method === "GET" && req.url === "/v1/dev/placeholders") {
      if (!flags.placeholderApiEnabled) {
        respondJson(res, 503, { error: "placeholder api disabled" });
        return;
      }

      respondJson(res, 200, {
        placeholders: ["home-feed", "agents-feed", "analyze-run"],
      });
      return;
    }

    respondJson(res, 404, { error: "not found" });
  });
}

function respondJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
```

Create `services/dev-api/src/dev.ts`:

```ts
import { createDevApiServer } from "./http.ts";

const host = process.env.DEV_API_HOST ?? "127.0.0.1";
const port = Number(process.env.DEV_API_PORT ?? "4312");
const server = createDevApiServer(process.env);

server.listen(port, host, () => {
  console.log(`dev-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
```

Create `services/dev-api/README.md`:

```md
# Dev API

Tracking beads: `fra-6al.8.4`, `fra-6al.8.5`.

This package provides lightweight placeholder routes so the local dev shell
can expose the intended backend stack shape before the real services land.

## Commands

```bash
cd services/dev-api
npm test
npm run dev
```
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api
npm install
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit the placeholder API**

```bash
git add \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/shared/src/devFlags.ts
git commit -m "feat(dev): add placeholder api service"
```

## Task 3: Add Runnable Chat and Resolver Dev Entrypoints

**Files:**
- Create: `services/chat/src/dev.ts`
- Modify: `services/chat/package.json`
- Create: `services/resolver/src/dev.ts`
- Modify: `services/resolver/package.json`

- [ ] **Step 1: Add the chat dev entrypoint**

Create `services/chat/src/dev.ts`:

```ts
import { createChatServer } from "./http.ts";

const host = process.env.CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.CHAT_PORT ?? "4310");
const server = createChatServer();

server.listen(port, host, () => {
  console.log(`chat listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
```

Update `services/chat/package.json` scripts:

```json
"scripts": {
  "dev": "node --experimental-strip-types src/dev.ts",
  "test": "node --experimental-strip-types --test \"test/**/*.test.ts\""
}
```

- [ ] **Step 2: Add the resolver dev entrypoint**

Create `services/resolver/src/dev.ts`:

```ts
import { Pool } from "pg";
import { createResolverServer } from "./http.ts";

const host = process.env.RESOLVER_HOST ?? "127.0.0.1";
const port = Number(process.env.RESOLVER_PORT ?? "4311");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for resolver dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const server = createResolverServer(pool);

server.listen(port, host, () => {
  console.log(`resolver listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
```

Update `services/resolver/package.json` scripts:

```json
"scripts": {
  "dev": "node --experimental-strip-types src/dev.ts",
  "test": "node --experimental-strip-types --test \"test/**/*.test.ts\""
}
```

- [ ] **Step 3: Verify the entrypoints start**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/chat
node --experimental-strip-types src/dev.ts
```

Expected: logs `chat listening on http://127.0.0.1:4310`.

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/resolver
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/market_agent node --experimental-strip-types src/dev.ts
```

Expected: logs `resolver listening on http://127.0.0.1:4311` once Postgres is available.

- [ ] **Step 4: Commit the dev entrypoints**

```bash
git add \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/chat/src/dev.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/chat/package.json \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/resolver/src/dev.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/resolver/package.json
git commit -m "feat(dev): add service dev entrypoints"
```

## Task 4: Add the Hybrid Dev Shell and Sample Web Flag Consumer

**Files:**
- Create: `scripts/dev-shell.sh`
- Create: `docker-compose.dev.yml`
- Create: `.env.dev.example`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `services/chat/README.md`
- Modify: `services/resolver/README.md`
- Modify: `web/src/pages/HomePage.tsx`

- [ ] **Step 1: Write the sample web flag consumer**

Modify `web/src/pages/HomePage.tsx` to import `webDevFlags` and conditionally render:

```ts
import { webDevFlags } from '../devFlags'
```

And add:

```tsx
{webDevFlags.showDevBanner ? (
  <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
    Dev banner flag is enabled. Placeholder services are expected in the local stack.
  </div>
) : null}
```

- [ ] **Step 2: Add the env example and ignore rules**

Create `.env.dev.example`:

```dotenv
DEV_POSTGRES_PORT=54329
DEV_REDIS_PORT=63791
WEB_PORT=5173
CHAT_PORT=4310
RESOLVER_PORT=4311
DEV_API_PORT=4312
DEV_POSTGRES_USER=postgres
DEV_POSTGRES_PASSWORD=postgres
DEV_POSTGRES_DB=market_agent
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/market_agent
REDIS_URL=redis://127.0.0.1:63791
MA_FLAG_PLACEHOLDER_API=true
MA_FLAG_SHOW_DEV_BANNER=false
```

Update `.gitignore`:

```gitignore
.dev/
.env.dev
web/node_modules/
```

- [ ] **Step 3: Add Docker Compose for Postgres and Redis**

Create `docker-compose.dev.yml`:

```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: ${DEV_POSTGRES_USER}
      POSTGRES_PASSWORD: ${DEV_POSTGRES_PASSWORD}
      POSTGRES_DB: ${DEV_POSTGRES_DB}
    ports:
      - "${DEV_POSTGRES_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DEV_POSTGRES_USER} -d ${DEV_POSTGRES_DB}"]
      interval: 2s
      timeout: 2s
      retries: 20

  redis:
    image: redis:7-alpine
    ports:
      - "${DEV_REDIS_PORT}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 20
```

- [ ] **Step 4: Add the repo dev-shell script**

Create `scripts/dev-shell.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env.dev.example"
fi

set -a
source "$ENV_FILE"
set +a

DEV_DIR="$ROOT/.dev"
LOG_DIR="$DEV_DIR/logs"
PID_DIR="$DEV_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

ensure_install() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    (cd "$dir" && npm install)
  fi
}

start_process() {
  local name="$1"
  local dir="$2"
  local command="$3"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    return
  fi

  (
    cd "$dir"
    nohup bash -lc "$command" >"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )
}

wait_for_postgres() {
  for _ in $(seq 1 30); do
    if docker compose -f "$ROOT/docker-compose.dev.yml" --env-file "$ENV_FILE" exec -T postgres \
      pg_isready -U "$DEV_POSTGRES_USER" -d "$DEV_POSTGRES_DB" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "postgres did not become ready" >&2
  exit 1
}

up() {
  ensure_install "$ROOT/db"
  ensure_install "$ROOT/web"
  ensure_install "$ROOT/services/chat"
  ensure_install "$ROOT/services/resolver"
  ensure_install "$ROOT/services/dev-api"

  docker compose -f "$ROOT/docker-compose.dev.yml" --env-file "$ENV_FILE" up -d
  wait_for_postgres
  (cd "$ROOT/db" && npm run migrate -- up)
  (cd "$ROOT/db" && npm run seed)

  export VITE_MA_FLAG_PLACEHOLDER_API="$MA_FLAG_PLACEHOLDER_API"
  export VITE_MA_FLAG_SHOW_DEV_BANNER="$MA_FLAG_SHOW_DEV_BANNER"

  start_process web "$ROOT/web" "npm run dev -- --host 127.0.0.1 --port $WEB_PORT"
  start_process chat "$ROOT/services/chat" "npm run dev"
  start_process resolver "$ROOT/services/resolver" "npm run dev"
  start_process dev-api "$ROOT/services/dev-api" "npm run dev"

  status
}

down() {
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -e "$pid_file" ]] || continue
    pid="$(cat "$pid_file")"
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  done
  docker compose -f "$ROOT/docker-compose.dev.yml" --env-file "$ENV_FILE" down
}

status() {
  printf "postgres  127.0.0.1:%s\n" "$DEV_POSTGRES_PORT"
  printf "redis     127.0.0.1:%s\n" "$DEV_REDIS_PORT"
  printf "web       http://127.0.0.1:%s  log=%s\n" "$WEB_PORT" "$LOG_DIR/web.log"
  printf "chat      http://127.0.0.1:%s  log=%s\n" "$CHAT_PORT" "$LOG_DIR/chat.log"
  printf "resolver  http://127.0.0.1:%s  log=%s\n" "$RESOLVER_PORT" "$LOG_DIR/resolver.log"
  printf "dev-api   http://127.0.0.1:%s  log=%s\n" "$DEV_API_PORT" "$LOG_DIR/dev-api.log"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *)
    echo "Usage: ./scripts/dev-shell.sh <up|down|status>" >&2
    exit 1
    ;;
esac
```

- [ ] **Step 5: Document the shell**

Update `README.md` to include:

```md
## Local Dev Shell

```bash
cp .env.dev.example .env.dev
./scripts/dev-shell.sh up
./scripts/dev-shell.sh status
./scripts/dev-shell.sh down
```
```

Update `services/chat/README.md` and `services/resolver/README.md` with
their `npm run dev` commands.

- [ ] **Step 6: Verify the dev shell**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub
bash -n scripts/dev-shell.sh
cp .env.dev.example .env.dev
./scripts/dev-shell.sh up
./scripts/dev-shell.sh status
curl -s http://127.0.0.1:4312/healthz
./scripts/dev-shell.sh down
```

Expected:
- shell syntax check passes
- Postgres and Redis containers come up
- `status` prints ports and log paths
- `/healthz` returns `{"status":"ok",...}`
- `down` stops the stack cleanly

- [ ] **Step 7: Commit the shell and docs**

```bash
git add \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/scripts/dev-shell.sh \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/docker-compose.dev.yml \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/.env.dev.example \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/.gitignore \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/README.md \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/chat/README.md \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/resolver/README.md \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web/src/devFlags.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web/src/devFlags.test.ts \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web/src/pages/HomePage.tsx
git commit -m "feat(dev): add local stack shell"
```

## Task 5: Add the Golden-Eval Scaffold and Final Verification

**Files:**
- Create: `evals/golden/README.md`
- Create: `evals/golden/cases/.gitkeep`
- Create: `evals/golden/results/.gitkeep`
- Create: `evals/golden/case.schema.json`

- [ ] **Step 1: Add the scaffold files**

Create `evals/golden/README.md`:

```md
# Golden Evals

Tracking bead: `fra-6al.8.6`.

This directory is the committed starter scaffold for the golden-eval
surface. PX.1 will add the real runner, nightly execution, and
`eval_run_results` integration.

## Layout

- `cases/` stores versioned golden cases
- `results/` stores generated eval artifacts
- `case.schema.json` describes the starter case shape
```

Create `evals/golden/case.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GoldenEvalCase",
  "type": "object",
  "required": ["id", "category", "prompt"],
  "properties": {
    "id": { "type": "string" },
    "category": { "type": "string" },
    "prompt": { "type": "string" },
    "expected": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "additionalProperties": false
}
```

Create empty markers:

```bash
mkdir -p evals/golden/cases evals/golden/results
touch evals/golden/cases/.gitkeep evals/golden/results/.gitkeep
```

- [ ] **Step 2: Verify the scaffold exists**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub
find evals/golden -maxdepth 2 -type f | sort
```

Expected output includes:
- `evals/golden/README.md`
- `evals/golden/case.schema.json`
- `evals/golden/cases/.gitkeep`
- `evals/golden/results/.gitkeep`

- [ ] **Step 3: Commit the scaffold**

```bash
git add \
  /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/evals/golden
git commit -m "chore(evals): add golden scaffold"
```

- [ ] **Step 4: Final verification and bead closure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/services/dev-api
npm test

cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub/web
node --experimental-strip-types --test src/devFlags.test.ts

cd /Users/admin/Documents/Work/market-agent/.worktrees/fra-6al-8-3-chat-sse-stub
./scripts/dev-shell.sh up
./scripts/dev-shell.sh status
./scripts/dev-shell.sh down
bd close fra-6al.8.4 --reason "Completed"
bd close fra-6al.8.5 --reason "Completed"
bd close fra-6al.8.6 --reason "Completed"
git pull --rebase
bd sync
git push
git status
```

Expected:
- automated tests pass
- dev shell smoke flow passes
- all three beads close
- branch pushes cleanly
- final `git status` is clean and up to date
