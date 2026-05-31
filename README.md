# market-agent

> A finance-research terminal where you screen the market, dig into any company, put an AI analyst to work over the evidence, and let background agents watch your theses — and every number on screen traces back to a source you can click into.

![Home — findings feed, market pulse, watchlist movers, agent summaries, saved screens](docs/screenshots/home.png)

[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node 22](https://img.shields.io/badge/Node-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL 15](https://img.shields.io/badge/Postgres-15-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis 7](https://img.shields.io/badge/Redis-7-dc382d?logo=redis&logoColor=white)](https://redis.io)
[![MinIO / S3](https://img.shields.io/badge/Object%20Store-MinIO%20%2F%20S3-c72e49?logo=minio&logoColor=white)](https://min.io)
[![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

---

## What it is

`market-agent` is a desktop-style research terminal for investors and analysts. You search a company, pull up its fundamentals and price history, screen the broader universe for ideas, and ask questions of an AI analyst — all in one workspace, without juggling a dozen tabs and spreadsheets.

Three things you can do with it:

- **Explore markets and companies** on fast, deterministic surfaces — quotes, charts, SEC-normalized financials, earnings, holders, and signals.
- **Ask an AI analyst** in a persistent chat workspace and get back structured, interactive answers — tables, charts, and metric rows with citations, not a wall of text.
- **Run background agents** that monitor your investment theses around the clock, raise findings, and alert you when something changes.

What sets it apart is the evidence promise: this is **not a chatbot with charts**. Every number you see — in a chart, a table, or a sentence of analysis — is pinned to a source you can click into and inspect. Open any figure and you get its provenance: where it came from, how it was computed, and the original document behind it.

![Chat — analyst replies stream as structured, interactive blocks with citations](docs/screenshots/chat-thread.png)

---

## What you can do

### Home
Land on a findings-first feed that aggregates what your agents have surfaced (deduplicated so the same story doesn't repeat across agents), alongside a market-pulse strip, your watchlist movers, recent agent activity, and your saved screens. _(Pictured above.)_

### Symbol detail
Type any ticker into the top search and land on a full company workspace with five tabs:

- **Overview** — KPI tiles and a performance chart with source provenance.
- **Financials** — income statement (as reported / as restated) and segment revenue share, pivotable by business or geography.
- **Earnings** — the last eight quarters, analyst consensus, and price targets.
- **Holders** — institutional holders and insider transactions.
- **Signals** — sentiment trend, recent claim clusters, and theme rationale.

| | |
|---|---|
| ![Symbol / Overview](docs/screenshots/symbol-overview.png) **Overview** | ![Symbol / Financials](docs/screenshots/symbol-financials.png) **Financials** |
| ![Symbol / Earnings](docs/screenshots/symbol-earnings.png) **Earnings** | ![Symbol / Signals](docs/screenshots/symbol-signals.png) **Signals** |

### Chat
Open a research thread and ask the analyst anything about a company, a comparison, or a theme. Replies stream in as structured, interactive blocks — tables, charts, metric rows — with citations attached, never raw markdown. Click any figure to open its evidence. Threads persist, so you can pick up where you left off.

### Screener
![Screener — filter the universe and save screens](docs/screenshots/screener.png)

Filter the universe by asset type, sector, venue, price, change %, and volume, plus fundamentals like market cap, P/E, gross/operating/net margin, and revenue YoY. Sort, paginate, and save a screen — saved screens become reusable universes for watchlists, agents, and Analyze.

### Analyze
![Analyze — guided memo playbooks](docs/screenshots/analyze.png)

Run guided memo playbooks such as *Earnings quality*, *Variant view*, or *Peer comparison*. Tune the instructions and the source categories, generate a memo, inspect the evidence behind it, rerun it, compare against earlier runs, and hand the result off into a chat thread.

### Agents
![Agents — thesis agents with cadence, universe, and run history](docs/screenshots/agents.png)

Create a thesis agent: give it a name, a thesis, a cadence (daily / weekly / on-demand), and a universe (specific names, or a dynamic universe driven by a screen, theme, or portfolio). The agent ingests new evidence on its schedule, scores it against your thesis, raises findings to Home, and alerts you by email, web push, or digest. Run history and live activity are visible per agent.

### Watchlists & Portfolio
Build manual watchlists, or dynamic ones that track a screen, theme, or portfolio. Keep research-scoped holdings (not a brokerage account) and see them overlaid across the surfaces above.

### Evidence inspector
On any number, claim, event, or source, open the inspector to see provenance rows, quality badges, links to the original source, and related evidence — the receipts behind everything on screen.

---

## Getting started

### Prerequisites

- **Node ≥ 22.19**
- **Docker + Docker Compose** (runs Postgres, Redis, and MinIO for you)
- ~3 GB free for images and dependencies
- *(Optional)* Python ≥ 3.11 or `uv`, only if you enable the unofficial local-dev data fallback

### Setup

```bash
cp .env.dev.example .env.dev      # safe defaults; ports + flags
./scripts/dev-shell.sh up         # first run installs packages, pulls images, runs migrations + seeds
./scripts/dev-shell.sh status     # confirm everything is running
```

When `up` completes, open **<http://localhost:5173>**.

### Bring your own keys & models

The terminal works out of the box, but a few keys unlock live data and the AI features. Add them to `.env.dev`:

- **`POLYGON_API_KEY`** — stock ticker discovery and live quotes/bars. Without it, unknown tickers resolve as not-found and market surfaces show as unavailable.
- **`SEC_EDGAR_USER_AGENT`** — on-demand SEC company-facts ingestion for statements and key stats (use a string you control, e.g. `market-agent-dev you@example.com`).
- **LLM models** — required for Chat, Analyze, and Agents. Configure channels in the in-app **Settings** page, or via the `.env.dev` fields `LLM_CHANNELS`, `LLM_<NAME>_*`, `LITELLM_MODEL`, `LITELLM_FALLBACK_MODELS`, and `AGENT_LITELLM_MODEL`. Settings-page changes are picked up without restarting.
- **`ENABLE_UNOFFICIAL_DEV_PROVIDERS=true`** — optional yfinance/Finviz fallback for local dev when the primary provider misses.

### Signing in (dev)

The "Sign in" button in the top bar (and inside the auth panel) sets a stable mock user in development, so your watchlists, threads, and portfolios persist across runs. Protected surfaces — **Chat**, **Analyze**, and **Agents** — require it; Home, Symbol detail, and Screener are browsable without signing in.

### Tear down

```bash
./scripts/dev-shell.sh down
```

This stops the services and containers while keeping your Postgres and MinIO volumes. To wipe all local dev state:

```bash
docker compose -f docker-compose.dev.yml --env-file .env.dev down -v
```

---

## Project structure

```
market-agent/
├── web/                       React 19 + Vite frontend (the UI)
├── services/
│   ├── resolver/              identity (issuer / instrument / listing / theme)
│   ├── market/                quotes, bars, normalized & adjusted series
│   ├── fundamentals/          SEC company-facts ingestion + statement normalization
│   ├── evidence/              docs · claims · events · facts · XBRL & non-GAAP extraction
│   ├── screener/              filter / rank queries over the universe
│   ├── home/                  findings dedupe + ranking + market pulse
│   ├── agents/                CRUD · scheduling · alert eval · finding generation
│   ├── notifications/         email · web push · digest delivery
│   ├── chat/                  thread coordinator + analyst runtime
│   ├── snapshot/              manifest staging + verification
│   ├── observability/         drift monitoring (npm run drift:monitor)
│   ├── analyze/               Analyze tab memo workflow
│   ├── artifact/              shared artifact model (add-to-chat)
│   ├── themes/ summary/ portfolio/ watchlists/ tools/ shared/ dev-api/
├── db/                        schema pack, migrations, seeds
├── docs/                      screenshots + reference docs
├── scripts/                   dev-shell.sh + helpers
├── docker-compose.dev.yml     Postgres 15 · Redis 7 · MinIO
└── .env.dev.example           ports + flags
```

---

## What it isn't

`market-agent` is a **research** system, not a trading platform. It deliberately does not:

- execute brokerage orders or run any trading workflow
- stream live market data inside an already-answered chat message
- let the analyst browse the open web
- treat tweets, Reddit posts, or news articles as authoritative facts

---

## Contributing

Conventions for AI-assisted contributions live in [`AGENTS.md`](AGENTS.md).
