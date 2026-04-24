# fra-6al.8.4 / fra-6al.8.5 / fra-6al.8.6 Dev Shell, Flags, and Golden Scaffold Design

## Scope

Implement the remaining P0.6 acceptance items that are still open under
`fra-6al.8`:

- `fra-6al.8.4` full-stack local dev shell
- `fra-6al.8.5` shared dev feature-flag harness
- `fra-6al.8.6` golden-eval scaffold

This spec covers:
- a repo-script entrypoint for local stack orchestration
- Docker-managed Postgres and Redis for development
- host-managed app and placeholder service processes
- one shared env-backed feature-flag source
- the initial `evals/golden/` directory layout

This spec does not cover:
- a full root workspace or monorepo build system
- containerizing every app process
- a remote or persistent flag service
- a real eval runner, nightly schedule, or drift report generation
- implementation of future backend APIs beyond lightweight placeholders

## Context

The repo currently has:
- standalone package roots for `db/`, `web/`, `services/resolver/`,
  `services/observability/`, and `services/chat/`
- CI coverage for the existing packages
- Postgres-backed schema and observability helpers
- a stub chat SSE route

What is still missing from the parent `fra-6al.8` acceptance criteria:
- one command to boot a usable local stack
- a feature-flag harness for unfinished work
- a committed golden-eval scaffold for later PX.1 expansion

There is no root `package.json`, no existing process supervisor, and no
documented dev shell. The design therefore needs to add coordination
without prematurely imposing a full workspace toolchain.

## Goals

- Provide a single repo script that boots the local development stack.
- Use Docker only for infra dependencies that clearly benefit from it now:
  Postgres and Redis.
- Start current app processes on the host in a predictable, inspectable way.
- Include placeholder backend processes/endpoints where future surfaces do
  not exist yet so the shell represents the intended stack shape.
- Standardize development flags from one shared env source with safe
  defaults across web and service processes.
- Commit an `evals/golden/` starter tree that PX.1 can extend without path
  churn.

## Non-Goals

- Production deployment or production process management.
- A generic plugin system for flags.
- A complete backend-for-frontend implementation.
- An eval runner that writes `eval_run_results`.
- Frontend UI for toggling flags.

## Chosen Approach

Use a hybrid repo-script shell:

- `scripts/dev-shell.sh` is the single user-facing entrypoint.
- `docker-compose.dev.yml` manages only `postgres` and `redis`.
- host processes are launched by the shell script and tracked via files in a
  repo-local `.dev/` directory.
- a small placeholder service package handles not-yet-built backend surface
  placeholders instead of forcing unrelated functionality into existing
  packages.
- one root env example file documents shared dev config, including feature
  flags.

Why this approach:
- it matches the existing repo layout
- it avoids adding a root workspace before the codebase needs one
- it keeps dev infra explicit and debuggable
- it satisfies the acceptance criteria without scope creep

## Dev Shell Design (`fra-6al.8.4`)

### Entry Point

Add:
- `scripts/dev-shell.sh`

Supported commands:
- `up`
- `down`
- `status`

Behavior:
- `up` starts infra dependencies, creates `.dev/`, loads env values, then
  launches host processes if they are not already running
- `down` stops host processes via PID files and tears down Docker services
- `status` prints a compact view of running processes, ports, and log files

### Infrastructure Containers

Add:
- `docker-compose.dev.yml`

Containers:
- `postgres`
- `redis`

Ports should be explicit and documented so the host processes can connect
deterministically.

### Host Processes

The shell should launch these host-managed processes:
- `web` via the existing Vite dev server
- `chat` service HTTP server
- `resolver` service HTTP server
- `api-placeholder` service HTTP server

Logs and PID files live under `.dev/`, for example:
- `.dev/logs/web.log`
- `.dev/logs/chat.log`
- `.dev/pids/web.pid`

### Placeholder Service

Create a minimal placeholder service package rather than modifying resolver
or chat to impersonate unrelated APIs.

Suggested package:
- `services/dev-api/`

Responsibilities:
- respond on a predictable local port
- serve JSON stubs for not-yet-built backend surfaces that the local stack
  wants to advertise
- provide a health/status endpoint for shell verification

This package is intentionally temporary-but-real: it gives the dev shell a
stable target without polluting domain services.

### Shell Verification Contract

`status` should show:
- whether Postgres is up
- whether Redis is up
- whether each host process is running
- the port bound by each process
- the log file path for each process

The shell documentation should include a smoke-test flow from a clean
checkout.

## Feature Flag Design (`fra-6al.8.5`)

### Shared Source of Truth

Add a root example env file:
- `.env.dev.example`

This file documents:
- connection settings needed by the dev shell
- development feature flags

Feature-flag naming convention:
- canonical service-side names: `MA_FLAG_*`
- web-facing names derived by the shell: `VITE_MA_FLAG_*`

This keeps one logical flag namespace while respecting Vite’s env exposure
rules.

### Flag Semantics

Flags are read from environment variables with safe defaults.

Scope:
- boolean flags only for this bead
- simple parsing of `true/false`, `1/0`, `on/off`
- unknown or unset values fall back to defaults

### Readers

Add:
- one small Node/TypeScript helper for services/scripts
- one small web helper for frontend consumers

Responsibilities:
- define available dev flags and defaults
- parse env values consistently
- expose a typed lookup surface

This bead stops at the harness. It does not require broad adoption across
the app, but it should include at least one sample flag path to prove the
wiring works end to end.

## Golden Scaffold Design (`fra-6al.8.6`)

Add:
- `evals/golden/README.md`
- `evals/golden/cases/`
- `evals/golden/results/`
- one starter schema/example file describing the intended case shape

The scaffold should explain:
- what a golden case represents
- where future result artifacts land
- that PX.1 owns actual runner logic and nightly execution

The scaffold must be lightweight and commit cleanly without introducing
scheduled jobs or heavy data.

## Testing Strategy

### Automated

Add tests for:
- flag parsing/defaulting behavior
- placeholder service health/route behavior

Where practical, keep tests package-local and aligned with the repo’s
existing `node --experimental-strip-types --test` pattern.

### Manual / Smoke Verification

Document and run:
1. `./scripts/dev-shell.sh up`
2. verify Postgres and Redis containers are running
3. verify `web`, `chat`, `resolver`, and `dev-api` host processes are up
4. verify `./scripts/dev-shell.sh status` reports ports and log paths
5. verify one sample flag can be flipped through env config
6. verify the golden scaffold exists on disk with the documented layout
7. run `./scripts/dev-shell.sh down`

## File Map

Likely new files:
- `scripts/dev-shell.sh`
- `docker-compose.dev.yml`
- `.env.dev.example`
- `services/dev-api/package.json`
- `services/dev-api/README.md`
- `services/dev-api/src/http.ts`
- `services/dev-api/test/http.test.ts`
- `services/shared/flags.ts` or a similarly small service-side helper path
- `web/src/devFlags.ts` or a similarly small web helper path
- `evals/golden/README.md`
- `evals/golden/cases/`
- `evals/golden/results/`
- `evals/golden/case.schema.json` (or equivalent starter descriptor)

Likely modified files:
- `README.md`
- package READMEs for affected services

## Acceptance Criteria

These beads are complete when:
- one repo script boots the development stack with a single command
- the stack includes Postgres, Redis, current host app processes, and a
  placeholder backend process
- the shell exposes `up`, `down`, and `status`
- feature flags are documented from one root env source and parsed with safe
  defaults across backend and frontend helpers
- at least one sample flag path proves the harness wiring works
- `evals/golden/` exists with a lightweight documented starter structure
- automated tests cover the new code paths
- the dev shell smoke flow is documented and verified
