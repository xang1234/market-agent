# Architecture

market-agent is a TypeScript monorepo: a React 19 web app, 27 Node packages and one Python package under `services/`, Postgres 15, and MinIO for raw document blobs. Each Node package has its own `package.json` and test suite. In development, `scripts/dev-shell.sh` runs the web app and 11 of these packages as HTTP processes, plus `dev-providers` and the discovery worker when they are turned on. Analyze, Agents, and themes run inside dev-api. The rest are libraries or command-line tools.

```mermaid
flowchart LR
  subgraph Sources
    polygon[Polygon]
    sec[SEC EDGAR]
    bundle[Weekly reference bundle]
    free[Free fallbacks<br/>Nasdaq, OpenFIGI, GLEIF, Stooq]
  end

  subgraph Ingestion
    resolver
    market
    fundamentals
    evidence
    sa[screener-artifacts]
  end

  subgraph Research
    chat
    analyze
    grids[analyst-grids]
    agents
    discovery
    fe[financial-engine]
  end

  db[(Postgres)]
  llm[llm<br/>model channels]
  web[web<br/>React 19 + Vite]

  polygon --> resolver & market
  sec --> fundamentals & evidence
  free --> resolver & market
  bundle --> sa
  resolver & market & fundamentals & evidence & sa --> db
  db --> chat & analyze & grids & agents & discovery
  fe --- chat & analyze & grids & agents
  chat & analyze & grids & agents & discovery --> llm
  agents --> notifications
  web --> chat & analyze & grids & agents & discovery & screener & home
  screener & home --> db
```

## How a chat answer is built

Chat answers from stored facts, not from the web or the model's memory. A chat turn works like this:

1. The resolver turns each company in the question into a canonical `SubjectRef`, a typed UUID. An ambiguous name becomes a clarifying question instead of a guess.
2. Chat reads only facts already stored in Postgres: SEC company facts, Polygon prices, and extracted filing claims. It fetches year-to-date price bars on demand. SEC facts are stored when a symbol page first reads them.
3. Code builds the metric rows, charts, and tables from those facts by a fixed rule, with no model involved. Each value cites its fact by id.
4. The model writes the narrative as structured assertions. A check rejects any assertion whose references, bindings, or comparison results do not match the evidence. The accepted ones render through fixed templates, so every figure in the prose is a value from the evidence, never the model's wording. The model's own words survive only inside a labelled inference.
5. The snapshot service stages a manifest of every fact, claim, document, and series the answer used. It checks each one against the logged tool-call results, adds required disclosures such as delayed pricing or low coverage, and seals the manifest. Chat then shows the answer. When a judge is configured, a placeholder marks each inference while the judge reads it.
6. When `JUDGE_LITELLM_MODEL` is set, a separate judge model checks each inference against the observations it rests on. An inference appears only once the judge finds it entailed. A failed or late verdict leaves it hidden. With no judge, chat shows no inferences.
7. Chat saves the message after the seal and the judge are done.
8. The web app renders blocks, never raw Markdown. A block that makes a claim about its values is labelled verified, source-linked, or not verified. Figures are linked to their fact or price series where one can be sealed. Clicking a linked figure opens the evidence inspector on its sealed provenance.

When a surface runs the financial engine in `enforce` mode, its calculations (margins, growth, ratios, thresholds) come from `services/financial-engine`. The engine binds a typed plan to stored facts and computes with exact fractions in `services/financial-core`. Anything it cannot verify appears as a named gap. In chat, only questions that name a metric reach the engine today ([#398](https://github.com/xang1234/market-agent/issues/398)). See [Configuration](configuration.md#verified-financial-answers).

## Services

| Service | Owns |
|---|---|
| `web` | The React app |
| `app` | One process that serves the web app and the chat-profile services, and replays recorded traffic in UI mode |
| `dev-api` | The local backend-for-frontend: auth, settings, themes, the evidence inspector, and the Analyze and Agents routes |
| `resolver` | Identity: issuers, instruments, listings, and themes |
| `market` | Quotes, bars, and adjusted price series |
| `fundamentals` | SEC company-facts ingestion and statement normalization |
| `evidence` | Documents, claims, events, facts, XBRL and non-GAAP extraction, and the fact review queue |
| `screener` | Filter and rank queries over the universe |
| `screener-artifacts` | Import of the weekly reference bundle into Postgres |
| `chat` | Thread storage, the per-thread turn coordinator, the SSE stream, the answer builder, and the inference judge |
| `tools` | The analyst's tools, their budgets, and approval checks |
| `llm` | Model channels, fallbacks, and the Settings-page config file |
| `snapshot` | Evidence manifest staging, verification, and disclosures |
| `financial-core` | Pure financial semantics: plan schemas, exact arithmetic, and the metric catalog |
| `financial-engine` | Planning, input binding, execution, and recovery of verified calculations |
| `analyze` | Analyze memo playbooks |
| `analyst-grids` | Company-by-column research grids, including model-read document columns |
| `agents` | Agent CRUD, scheduling, thesis assessment, and alert rules |
| `notifications` | Delivery of fired alerts |
| `discovery` | Discovery campaigns, behind `DISCOVERY_ENABLED` |
| `home` | The findings feed, market pulse, and agent summaries |
| `watchlists`, `portfolio`, `themes` | User lists, research holdings, and theme membership |
| `artifact`, `summary`, `observability`, `shared` | Shared libraries: add-to-chat artifacts, titles and headlines, run logs, and HTTP helpers |
| `dev-providers` | An optional yfinance and Finviz fallback for local development (Python) |

## Repository layout

| Path | Holds |
|---|---|
| `web/` | The React app and its Playwright tests in `web/e2e/` |
| `services/` | The packages in the table above |
| `db/` | The schema pack, migrations, and seeds |
| `spec/` | The product spec, the database schema, the OpenAPI contract, the block schema, the tool registry, and the financial plan and result schemas |
| `scripts/` | `dev-shell.sh`, the research-quality eval, and repo-wide contract tests |
| `docker-compose.dev.yml` | Postgres 15 and MinIO for development |
| `.env.dev.example` | The main settings, with comments |

## Further reading

- [`docs/adr/`](adr/) holds the design decisions, such as [session coordinator hosting](adr/0004-session-coordinator-hosting.md) and the [filing extraction boundary](adr/0003-filing-extraction-boundary.md).
- [`CONTEXT.md`](../CONTEXT.md) defines the domain terms.
- [`docs/engineering/`](engineering/) holds working notes and the research-quality eval.
