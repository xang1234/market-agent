# Configuration

Everything lives in `.env.dev`. Copy it from `.env.dev.example`, which documents every field. This page covers the settings you are most likely to change.

The app starts with no keys at all. Without keys, market surfaces show as unavailable and AI features have no model. Each key below turns on one part of the app.

## Data keys

| Variable | Turns on | Without it |
|---|---|---|
| `POLYGON_API_KEY` | Ticker discovery, live quotes, and price bars | Unknown tickers resolve as not found. Market surfaces show as unavailable. |
| `SEC_EDGAR_USER_AGENT` | On-demand SEC company-facts ingestion for statements, key stats and Analyze memo issuers | No new fundamentals are fetched, and Analyze memos read only facts already stored. Use a string you control, for example `market-agent-dev you@example.com`. |

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
| `AGENT_LITELLM_MODEL` | The analyst agent's tool loop in chat. Falls back to `LITELLM_MODEL`. |
| `ANALYZE_LITELLM_MODEL` | The same tool loop writing an Analyze memo's sections. Falls back to `AGENT_LITELLM_MODEL`, then `LITELLM_MODEL`. |
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

The financial engine plans a calculation, binds it to stored facts, and computes it with exact fractions. Anything it cannot verify appears as a gap, never as prose.

Chat figures, Analyze memos, grid columns, thesis conditions and Discovery criteria always use the engine.

The engine checks each SEC fact's proof. Facts stored before 2026-10-16 have none and show as gaps until you run the SEC proof backfill described in [Development](development.md#data-mode).

In chat, the engine computes every figure an answer shows ([#398](https://github.com/xang1234/market-agent/issues/398)). When the scope model reads the question, the answer adds a note for parts of it the plan did not calculate, such as a benchmark index, or EPS growth when the plan computes EPS alone.

dev-api runs a worker that recovers interrupted financial runs. It is on by default, and `FINANCIAL_WORKER_ENABLED=false` turns it off.

The per-surface `*_FINANCIAL_MODE` variables are gone. A service that finds one still set logs a warning at startup and ignores it.

Chat, the dev API, analyst grids and the Discovery worker refuse to start until the schema and version registry are ready.

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

After the import, the same command fills the CIK of every issuer still missing one from SEC's [`company_tickers.json`](https://www.sec.gov/files/company_tickers.json), matched by ticker, because the bundle carries none and fundamentals reads SEC facts only for an issuer with a CIK. It needs `SEC_EDGAR_USER_AGENT`, keeps the download in `.dev/company_tickers.json` for a day, and prints `fill-ciks: filled=… reassigned=… held_with_data=… already_set=… skipped_duplicate=… unmatched=…`. SEC lists a company's first ticker at its rank and files its other share classes and ETNs under the same CIK further down, so the CIK goes to the issuer of the first-listed ticker, and every other issuer of that CIK's tickers is skipped. A CIK that any other issuer holds moves to the right one (`reassigned`), unless that issuer holds data read from SEC by the CIK: SEC facts, filings and the claims on them, Form 4 rows, or a companyfacts download (`held_with_data`, logged with the issuer). On a tie the issuer that holds the CIK keeps it, and an issuer that holds another CIK keeps that one. An ETF is usually unmatched, since SEC's list holds few funds. To run only the fill: `(cd services/fundamentals && npm run fill:ciks -- --file ../../.dev/company_tickers.json)`.

Last, it merges each issuer that holds a company's listing apart from the issuer holding the company's SEC identity onto that issuer (`services/fundamentals/src/issuer-splits.ts`, #597), and prints `issuer-splits: merged=… skipped=…` with a line per merge or skip. A frozen golden issuer whose ticker another issuer lists merges into that issuer, unless that issuer holds another CIK, so the ticker keeps live prices and SEC filings. Once any golden issuer is no longer the only issuer listing its own ticker, as before and after such a merge, each golden issuer that still is moves its instruments onto a new issuer of its name, printing a `moved` line, and then merges into it the same way (#716). A fresh frozen stack, whose golden issuers each alone list their own ticker, stays frozen. A filing's figure then retires the golden figure for its metric and period. A statement read at the golden cutoff still returns the golden figure, but the financial engine's selection there (Calls, certified figures) shows a gap for that period, since it skips a retired figure whatever the cutoff and the filing's figure postdates the cutoff. A second holder of a CIK, with or without leading zeros, merges into the first. An issuer with no CIK whose ticker SEC files under another issuer's CIK merges into it when the two go by one name once legal forms and share classes are dropped, as GOOG's "Alphabet Inc" and GOOGL's "Alphabet Inc. Class A Common Stock" do. An ETN or fund a sponsor files under its own CIK goes by another name and stays apart, as does "X Holdings" beside "X Inc". Each merge moves the listings and every row keyed by the issuer. The kept issuer keeps the merged issuer's names as former names, and takes the plain name when the other only adds a share class. A pair whose rows clash where the merge cannot combine them, such as two active facts for one period and source, stays apart, and a `skipped issuer` line names the index they clash on. The other pairs still merge and the run exits 0. The run then stores each CIK without leading zeros, except one that a pair left apart also holds. `(cd services/fundamentals && npm run repair:issuer-splits -- --file ../../.dev/company_tickers.json --census)` lists the merges and writes nothing.

The command exits non-zero with a clear message when Postgres is not running. Every run that reaches the bundle records a row in `artifact_ingestion_ledger`, keyed by the bundle's sha256, with status `succeeded`, `partial`, or `failed`. A download or connection failure shows only in the log and the exit code.

## Daily earnings releases

```bash
./scripts/dev-shell.sh daily-releases
```

Starts Postgres and MinIO if needed, then runs three idempotent steps from `services/evidence`, each picking up where the last run stopped:

1. `backfill:sec-8k -- --tracked --since-days 7`: new 8-Ks of every issuer that already has one stored, one SEC submissions request per issuer. The week of lookback catches up a missed run.
2. `extract:non-gaap`: the non-GAAP reconciliations of new releases, from the stored bytes, with no SEC request or model call.
3. `extract:earnings-releases -- --limit 300`: management's explanations and guidance, one model call and one SEC fetch per release. `DAILY_RELEASE_LIMIT` sets the cap, so a backlog drains over several days.

A failed step does not stop the later ones, but the command exits non-zero. Each run prints `=== <time> daily releases start` and `exit <status>`. A step that left a filing unread retries it on the next run.

To run it daily, use launchd rather than cron, because launchd runs a job missed while the Mac slept once it wakes. Save this as `~/Library/LaunchAgents/com.market-agent.daily-releases.plist`, then run `launchctl load` on it. Use a checkout outside `~/Documents`, which macOS blocks launchd jobs from reading.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.market-agent.daily-releases</string>
  <key>ProgramArguments</key><array><string>/path/to/market-agent/scripts/dev-shell.sh</string><string>daily-releases</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/path/to/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>45</integer></dict>
  <key>StandardOutPath</key><string>/path/to/market-agent/.dev/logs/daily-releases.log</string>
  <key>StandardErrorPath</key><string>/path/to/market-agent/.dev/logs/daily-releases.log</string>
</dict></plist>
```

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
