# Development

## Requirements

- Node 22.19 or later with npm (`.nvmrc` pins 22.19.0, the version CI uses)
- `lsof`, which macOS and most Linux distributions include
- Docker with Docker Compose, for Postgres 15 and MinIO. UI mode does not need it.
- About 3 GB of free disk for images and packages
- Python 3.11 or later, or `uv`, only if you turn on `ENABLE_UNOFFICIAL_DEV_PROVIDERS`

## Start the stack

```bash
cp .env.dev.example .env.dev
./scripts/dev-shell.sh up        # first run installs packages, pulls images, runs migrations and seeds
./scripts/dev-shell.sh status    # every service and its state
```

Open <http://localhost:5173>. Change `WEB_PORT` in `.env.dev` to use another port.

In a fresh worktree, `./scripts/dev-shell.sh install` runs `npm ci` for every package, as CI does, without starting anything.

### Profiles

`DEV_PROFILE` picks which services run.

- `full` (the default) runs the web app and 11 services as separate HTTP processes. Analyze, Agents, and themes run inside dev-api. `dev-providers` starts only with `ENABLE_UNOFFICIAL_DEV_PROVIDERS=true`, and the discovery worker only with `DISCOVERY_ENABLED=true`. The other packages are libraries or command-line tools.
- `chat` runs one process, `services/app`, that serves the web UI, chat, resolver, dev-api, market, and fundamentals on `WEB_PORT`, plus Postgres. The other services are parked. `status` lists them as `parked`, their API routes answer `503`, and their tabs do not load.

### Sign in

dev-shell signs you in as a stable mock user, so your watchlists, threads, and portfolios persist across runs. After **Sign out**, the top bar shows **Sign in** to return. Set `VITE_MA_FLAG_DEV_AUTO_LOGIN=false` to start signed out.

Signed out, symbol pages and Screener still load, without watchlist or save actions. Home, Chat, Analyze, Analyst Grids, Agents, Review, Settings, Discovery, and the evidence inspector need a session.

### Stop the stack

```bash
./scripts/dev-shell.sh down
```

`down` keeps the Postgres and MinIO volumes. To wipe all local state:

```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev down -v
```

## Development modes

Each mode reuses the golden conversation's fixtures in `services/chat/test/golden/`: a frozen NVDA, AMD, and AAPL dataset and recorded model replies. A loop pulls in only what it tests. Frozen facts go through the same validation as live ingestion.

| Mode | Command | Model | Data | Use it for |
|---|---|---|---|---|
| UI | `DEV_PROFILE=chat DEV_MODE=ui ./scripts/dev-shell.sh up` | replayed | replayed | Block rendering and layout. No database, services, keys, or network. |
| No keys | `DEV_PROFILE=chat DEV_NO_KEYS=true ./scripts/dev-shell.sh up` | recorded replies | frozen | Offline work and the browser smoke test |
| Traces | `DEV_PROFILE=chat DEV_NO_KEYS=traces ./scripts/dev-shell.sh up` | recorded answer-lab replies | frozen | UI work on real answers, and the eval loop, with no model |
| Analyst | `DEV_PROFILE=chat DEV_MODE=analyst ./scripts/dev-shell.sh up` | your live model | frozen | Tuning prompts, block rules, and reasoning |
| Data | `DEV_MODE=data ./scripts/dev-shell.sh up` | your live model | live providers | Checking the golden conversation against live data |

The golden conversation has three turns. Ask them in a new thread, word for word:

1. Analyze NVDA
2. Compare it with AMD YTD
3. Explain the differences and show the evidence

### UI mode

The app serves the web UI and replays the golden conversation's recorded API traffic from `services/app/fixtures/golden-conversation.replay.json`. The replay covers threads, all three turns' streams, the reloaded messages, and the evidence lookups. It builds no services and starts no containers. Any request that was not recorded answers `404` and names the request, including evidence for a figure nobody opened during capture.

A new thread restarts the replay. Concurrent tabs share one replay session. Pages whose services are parked, such as Home, Screener, Analyst Grids, and Review, show no data in this mode.

To recapture after an API or block change, start on a fresh database and run these from the repo root:

```bash
DEV_CAPTURE_FILE=$PWD/services/app/fixtures/golden-conversation.replay.json DEV_PROFILE=chat DEV_NO_KEYS=true ./scripts/dev-shell.sh up
(cd web && npm run e2e)
./scripts/dev-shell.sh down
```

### No-keys mode

The golden conversation works offline. Other questions have no recorded reply and fail. The LLM settings in `.env.dev` are ignored.

### Traces mode

Like no-keys mode, but the replies are the recorded answers to the eval's 12 questions (14 turns) in `services/chat/test/answer-lab/traces`. `up` writes them to `.dev/trace-replies.json`. Ask a traced question word for word, or run all of them in a few seconds:

```bash
EVAL_MODEL=fixture/recorded node --experimental-strip-types scripts/research-quality-eval.ts run
cd web && node --experimental-strip-types scripts/inspect-threads.ts [--theme light|dark] <report.md>
```

The second command screenshots each thread. The replies are as recorded, so they predate later prompt changes.

### Analyst mode

The frozen data, answered by the model in `.env.dev`. Startup fails fast and prints why unless `LLM_CHANNELS` and `LITELLM_MODEL` name a model it can deploy. See [Configuration](configuration.md#models) for model setup and the `[llm]` log line.

### Data mode

Live Polygon, SEC, and model calls. Startup fails fast without `POLYGON_API_KEY`, `SEC_EDGAR_USER_AGENT`, and a model it can deploy.

```bash
DEV_MODE=data ./scripts/dev-shell.sh up
cd services/chat && npm run golden:live [base URL]
```

`golden:live` runs the three golden turns against the running stack and checks structure only: every turn completes, and the chart, metric row, and comparison table appear. Live figures and wording vary, so it checks nothing finer.

Chat reads persisted facts only, so the check first warms NVDA and AMD. It resolves each ticker through Polygon, then reads its key stats and eight quarterly income statements from SEC, which persists them. Reruns read the persisted data back. The check stops before any turn if a company cannot be warmed.

SEC facts stored before 2026-10-16 lack the proofs the financial engine checks, and reads never fetch them again. Run the backfill once per database to re-fetch those filings, prove the facts they still state, replace the income facts they contradict, and add the cash flow and balance sheet for each income period on file. It skips the frozen golden dataset.

```bash
cd services/fundamentals
DATABASE_URL=... SEC_EDGAR_USER_AGENT=... npm run backfill:sec-statements
```

### Keep frozen and live data apart

Frozen modes need a database without provider-hydrated NVDA, AMD, or AAPL. Data mode refuses a database that a frozen mode seeded, because the frozen facts would let a live check pass without touching Polygon or SEC. Reset with `docker compose -f docker-compose.dev.yml --env-file .env.dev down -v` when you switch.

## Tests

Each package runs its own suite:

```bash
cd services/chat && npm test && npm run typecheck
```

`npm test` does not type-check. CI does, so also run `npm run typecheck` in each package you change.

The browser smoke test in `web/e2e/` runs against a UI-mode or no-keys stack:

```bash
cd web && npx playwright install chromium && npm run e2e
```

Set `E2E_BASE_URL` if `WEB_PORT` is not 5173. CI runs it against both stacks: UI mode with the committed fixture, and the real no-keys backend, which also catches a stale fixture.

## Where things live

See [Architecture](architecture.md) for the service map. Design decisions are in [`docs/adr/`](adr/). Domain terms such as `SubjectRef` are defined in [`CONTEXT.md`](../CONTEXT.md). Conventions for AI-assisted contributions are in [`AGENTS.md`](../AGENTS.md).
