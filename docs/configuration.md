# Configuration

Everything lives in `.env.dev`. Copy it from `.env.dev.example`, which documents every field. This page covers the settings you are most likely to change.

The app starts with no keys at all. Without keys, market surfaces show as unavailable and AI features have no model. Each key below turns on one part of the app.

## Data keys

| Variable | Turns on | Without it |
|---|---|---|
| `POLYGON_API_KEY` | Ticker discovery, live quotes, and price bars | Unknown tickers resolve as not found. Market surfaces show as unavailable. |
| `SEC_EDGAR_USER_AGENT` | On-demand SEC company-facts ingestion for statements and key stats | No new fundamentals are fetched. Use a string you control, for example `market-agent-dev you@example.com`. |

## Models

Chat, Analyze, analyst-grid reader columns, and narrative thesis checks need a model. Numeric thesis checks do not.

Set models on the in-app **Settings** page or in `.env.dev`. Settings-page changes apply without a restart.

A model is named `<channel>/<model>`. Declare channels in `LLM_CHANNELS`, then give each channel its own `LLM_<NAME>_*` fields:

```bash
LLM_CHANNELS=anthropic
LLM_ANTHROPIC_PROTOCOL=anthropic
LLM_ANTHROPIC_API_KEY=sk-ant-...
LLM_ANTHROPIC_MODELS=claude-sonnet-5-5,claude-haiku-5-5
LITELLM_MODEL=anthropic/claude-sonnet-5-5
JUDGE_LITELLM_MODEL=anthropic/claude-haiku-5-5
```

`LLM_<NAME>_PROTOCOL` is `anthropic`, `openai`, or `openai-compatible`. An `openai-compatible` channel also needs `LLM_<NAME>_BASE_URL`, which covers DeepSeek, OpenCode Go, and any other OpenAI-style endpoint. `.env.dev.example` has worked examples for each.

| Variable | Used for |
|---|---|
| `LITELLM_MODEL` | Every call that has no more specific setting |
| `LITELLM_FALLBACK_MODELS` | Comma-separated models to try when the main one fails or refuses |
| `EXTRACTION_LITELLM_MODEL` | SEC 8-K and earnings-release extraction, analyst-grid reader columns, and chat's metric scope proposal. Falls back to `LITELLM_MODEL`. |
| `JUDGE_LITELLM_MODEL` | The judge that checks each analyst inference in a chat answer. It has no fallback. When it is unset, chat shows figures but no inferences. |

With `LLM_USAGE_LOG=true`, which `DEV_MODE=analyst` sets, each model call writes one log line with its channel, model, latency, and token counts. The numbers here are an example:

```
[llm] anthropic/claude-sonnet-5-5 2140ms tokens in=8123 out=912 (reasoning=388) total=9035
```

### Chat tuning

| Variable | Effect |
|---|---|
| `CHAT_SCOPE_PROPOSAL=off` | Skips the short model call that picks which metrics and facets a question asks for. A follow-up then keeps the previous scope, except for any period it names. |
| `CHAT_TRACE_DIR` | Writes a trace of each answer turn, including the judge's verdicts, to this directory. Each judged turn also logs one `[chat] judge` line. |
| `CHAT_VERIFICATION_MODE=display_unverified` | Shows answers that fail verification, labelled **Unverified** with the reasons, and never saves them. The default, `strict`, shows only an error. The chat server refuses this value when `NODE_ENV=production`. |

### Reasoning models

The app finds reasoning models in pi-ai's model catalog, matched by base URL and model id. Chat answers ask for `low` effort. Thread titles ask for the lowest effort the model allows. To get effort control for a model newer than the catalog, list it in `LLM_<NAME>_REASONING_MODELS`.

An `anthropic` channel calls the Claude Messages API directly. It turns prompt caching on, sends no temperature, and passes effort through adaptive thinking.

## Verified financial answers

Each surface can take its numbers from the financial engine, which plans a calculation, binds it to stored facts, and computes it with exact fractions. The engine is off by default.

Set each of `CHAT_FINANCIAL_MODE`, `ANALYZE_FINANCIAL_MODE`, `GRID_FINANCIAL_MODE`, and `THESIS_FINANCIAL_MODE` to one of two values:

- `off` shows legacy numbers, labelled legacy.
- `enforce` shows only certified calculations. Anything the engine cannot verify appears as a gap, never as prose.

The engine checks each SEC fact's proof. Facts stored before 2026-10-16 have none and show as gaps until you run the SEC proof backfill described in [Development](development.md#data-mode).

For chat, only questions that name a metric reach the engine today. Other questions use the standard path until [#398](https://github.com/xang1234/market-agent/issues/398) lands. The financial columns in Analyst Grids (cash flow, net income, balance sheet, and ratios) show no coverage while `GRID_FINANCIAL_MODE` is `off`.

`FINANCIAL_WORKER_ENABLED=true` starts a worker in dev-api that recovers interrupted financial runs.

With any surface on, a service refuses to start until the schema and version registry are ready. Any other value stops startup.

## Screener universe

`SCREENER_CANDIDATE_SOURCE` picks what the screener serves:

- `reported`, the default, lists companies whose SEC facts the app has stored, with margins, P/E, and growth from reported annual figures.
- `vendor` lists the US universe from a weekly reference import, about 10,000 listings. Vendor rows have no margins or P/E, and show a price only when a quote is stored.

The vendor universe comes from the weekly reference bundle that [`xang1234/stock-screener`](https://github.com/xang1234/stock-screener) publishes. Import it on the host that runs the dev stack:

```bash
./scripts/dev-shell.sh reference-import            # import the latest bundle. An unchanged bundle is a no-op.
./scripts/dev-shell.sh reference-import --status   # latest run per market, and the last run that imported data
./scripts/dev-shell.sh reference-import --force    # re-ingest an unchanged bundle
```

The bundle publishes on Saturdays around 08:10 ET. To schedule the import, add a crontab line set to a later time in the host's own time zone:

```
30 10 * * 6 cd /path/to/market-agent && ./scripts/dev-shell.sh reference-import >> .dev/logs/reference-import.log 2>&1
```

The command exits non-zero with a clear message when Postgres is not running. Every run that reaches the bundle records a row in `artifact_ingestion_ledger`, keyed by the bundle's sha256, with status `succeeded`, `partial`, or `failed`. A download or connection failure shows only in the log and the exit code.

## Free fallback data sources

These sources fill gaps when the paid providers miss. They are off by default. Free public endpoints have tight quotas, so turn on only the ones you need.

| Variable | What it adds |
|---|---|
| `NASDAQ_TRADER_REFERENCE_ENABLED=true` | Validates unknown US-listed tickers against the Nasdaq Trader symbol directories |
| `OPENFIGI_REFERENCE_ENABLED=true` | FIGI and ISIN metadata. `OPENFIGI_API_KEY` is optional and raises the rate limit. |
| `GLEIF_REFERENCE_ENABLED=true` | LEI and legal-entity metadata, when the legal-name match is unambiguous |
| `STOOQ_MARKET_ENABLED=true` | Daily end-of-day bars for `1d` requests |
| `ENABLE_UNOFFICIAL_DEV_PROVIDERS=true` | A yfinance and Finviz fallback for local development, through `services/dev-providers` |

Nasdaq Trader, OpenFIGI, and GLEIF are free reference enrichment sources. They fill missing identity fields only and never overwrite an SEC, Polygon, or local value. Stooq EOD bars are not realtime quotes or intraday bars.

### Open datasource coverage verification

To check the whole fallback path without network calls, run the fixture smoke test:

```bash
node --experimental-strip-types --test scripts/open-datasource-coverage.test.ts
```

It covers a paid reference miss that falls through to Nasdaq, OpenFIGI, and GLEIF enrichment, then a paid market-bars miss that falls through to Stooq.

## Discovery campaigns

Discovery is off (`DISCOVERY_ENABLED=false`) until its release review passes. See [Discovery campaigns: safe rollout and operations](discovery-campaigns-operations.md).
