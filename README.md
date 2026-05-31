# commodities-agent

> A commodities analyst terminal adapted from `xang1234/market-agent`, focused on copper and iron ore market calls, licensed research, price subscriptions, event-impact analysis, and analyst-reviewed internal distribution.

[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node 22](https://img.shields.io/badge/Node-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL 15](https://img.shields.io/badge/Postgres-15-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis 7](https://img.shields.io/badge/Redis-7-dc382d?logo=redis&logoColor=white)](https://redis.io)
[![MinIO / S3](https://img.shields.io/badge/Object%20Store-MinIO%20%2F%20S3-c72e49?logo=minio&logoColor=white)](https://min.io)

## What It Is

`commodities-agent` is a specialized fork for commodities trading institution analysts. V1 is anchored on copper and iron ore, with workflows for daily calls, report-change digests, supply shocks, China demand checks, curve/spread explanations, and forecast-vs-market reviews.

The product keeps the reference repo's strongest architectural ideas:

- Evidence plane with entitlement-aware source handling.
- Snapshot-sealed `Block[]` outputs with citations and provenance.
- Deterministic services for market data, balances, event impact, and briefs.
- Tool-bundle policy with reader-only raw document access separated from analyst-facing tools.
- Background agents that draft, monitor, and alert without issuing autonomous trade instructions.

The goal is decision support from one day to three months out. Agents draft and surface material changes; analysts inspect sources, edit, approve, and publish internal briefs.

## Core Concepts

Commodity subject identity replaces equity identity:

- `commodity`, `benchmark`, `contract`, `curve`, `region`, `delivery_point`, `asset`, `producer`, `route`, `market_theme`
- retained workspace subjects: `portfolio`, `screen`
- legacy equity kinds remain parseable only for migration compatibility

Decision horizons are standardized as `1d`, `1w`, `1m`, and `3m`.

The non-RAG intelligence layer is the event-impact graph. It maps report deltas, news, internal notes, inventory changes, price/curve moves, and disruptions to commodity subjects by channel, direction, horizon, confidence, magnitude, and driver type.

## Analyst Surfaces

- **Morning Call Board**: copper and iron ore driver summaries, price/curve moves, alerts, watch items, latest published brief, and outcome reminders.
- **Commodity Detail**: overview, prices and curves, balances, reports and news, impact graph, and forecasts.
- **Chat Copilot**: structured commodity tool bundles and typed blocks rather than markdown-only answers.
- **Analyze**: repeatable playbook runs for daily calls, supply shocks, report deltas, curve moves, China demand watch, and forecast reviews.
- **Agents**: specialist cadence, source coverage, run history, event findings, and alert rules.
- **Brief Publishing**: draft, source inspection, analyst edits, signoff, internal distribution, and immutable published snapshots.

## Services Added Or Adapted

- `services/shared`: commodity `SubjectRef` kinds and decision horizons.
- `services/market`: normalized commodity quote, curve, and spread contracts.
- `services/balances`: supply-demand snapshots across mine supply, disruptions, inventories, port stocks, margins, flows, freight, and house forecasts.
- `services/impact`: event-impact driver normalization and ranking.
- `services/briefs`: daily-call draft and publish contracts with analyst signoff.
- `services/analyze`: commodities playbooks.
- `services/agents`: commodity impact channels and horizons for severity scoring.
- `services/tools`: commodities tool registry, prompt templates, reader/analyst audience separation, approval gates, budgets, and commodity quote fast path.
- `web/src/blocks`: commodities block schema and renderers.
- `web/src/pages/HomePage.tsx`: Morning Call Board copy and layout labels.

## Public API Direction

The fork is moving toward these API families:

- Subject APIs: `/v1/subjects/resolve`, `/v1/subjects/hydrate`
- Market APIs: `/v1/markets/latest`, `/v1/markets/series`, `/v1/markets/curve`, `/v1/markets/spreads`, `/v1/markets/inventory`
- Balance and impact APIs: `/v1/balances/snapshot`, `/v1/balances/changes`, `/v1/impact/events`, `/v1/impact/drivers`, `/v1/impact/graph`
- Daily-call APIs: `/v1/briefs/daily`, `/v1/briefs/{briefId}`, `/v1/briefs/{briefId}/publish`, `/v1/briefs/{briefId}/outcomes`

## Tool Bundles

The commodity tool registry defines these analyst bundles:

- `commodity_quote_lookup`
- `curve_analysis`
- `report_delta_analysis`
- `event_impact_analysis`
- `balance_snapshot`
- `daily_call_run`
- `forecast_assumption_review`
- `alert_management`

Reader-only raw document tools remain available inside report, event, and daily-call bundles for extraction workers. Analyst-facing tools receive structured report deltas, events, claims, summaries, and source references, not raw licensed content handles.

## Getting Started

Prerequisites:

- Node >= 22.19
- Docker and Docker Compose
- PostgreSQL 15, Redis 7, and MinIO via the dev compose stack
- Optional Python >= 3.11 or `uv` for local provider sidecars inherited from the reference repo

Setup:

```bash
cp .env.dev.example .env.dev
./scripts/dev-shell.sh up
./scripts/dev-shell.sh status
```

When `up` completes, open <http://localhost:5173>.

## Verification

Focused commodity contract checks can be run without the full web dependency install:

```bash
node --experimental-strip-types --test services/shared/test/subject-ref.test.ts services/analyze/test/playbook.test.ts services/agents/test/severity-scorer.test.ts services/market/test/commodity-contract.test.ts services/balances/test/balance-snapshot.test.ts services/impact/test/event-impact.test.ts services/briefs/test/daily-call.test.ts
cd services/tools && node --experimental-strip-types --test test/*.test.ts
TSX_TSCONFIG_PATH=web/tsconfig.app.json node --experimental-strip-types --test web/src/blocks/blockSchemaSync.test.ts web/src/blocks/defaultBlockRegistry.test.ts
```

## Boundaries

This is a research and decision-support system, not a trading platform. It does not execute trades, produce autonomous trade instructions, or bypass analyst review. Live positions, hedge books, and execution workflows are out of scope for V1.

Licensed content may be stored and summarized only for authorized internal users with provenance and entitlement controls retained.
