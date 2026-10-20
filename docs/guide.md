# User guide

A tour of every page in market-agent. To run the app, see the [quickstart](../README.md#quickstart).

## Home

Home opens on the findings your agents raised. Findings that tell the same story across agents appear once. Beside the feed are a market-pulse strip, your watchlist movers, recent agent activity, and your saved screens.

## Symbol pages

Type a ticker or company name into the top search to open its page. It has five tabs:

- **Overview** shows key stats and a performance chart, each with its source.
- **Financials** shows the income statement, as reported or as restated, and segment revenue by business or geography.
- **Earnings** shows the last eight quarters, analyst consensus, and price targets.
- **Holders** shows institutional holders and insider transactions.
- **Signals** shows the sentiment trend, recent claim clusters, and theme rationale.

## Chat

Ask the analyst about a company, a comparison, or a theme. Answers stream in as charts, tables, metric rows, and a short narrative. Threads persist, so you can return to one later.

Chat answers from facts already stored in the app. It does not browse the web. Code builds the charts and tables from those facts, and the model writes only the narrative. Figures in the narrative and the metric rows link to their fact or price series where one can be sealed. The rest show as plain text. A block that makes a claim about its values carries a label: **verified** for a certified calculation, **source-linked** when its values are the facts it cites, or **not verified**. A separate judge model checks each inference, and chat shows an inference only once the judge accepts it. [Architecture](architecture.md#how-a-chat-answer-is-built) explains each step.

## Evidence inspector

Click a linked figure, claim, event, or source to open the inspector. It shows the provenance rows, quality badges, a link to the original document, and related evidence.

## Screener

Filter the universe by asset type, sector, venue, price, change, and volume. Add fundamentals such as market cap, P/E, margins, and revenue growth. With the weekly vendor universe turned on, you can also filter by forward P/E, ROIC, 3-month and 1-year performance, RSI, and distance from the 52-week high. Sort, page through, and save a screen. A saved screen becomes a reusable universe for watchlists, agents, and Analyze.

By default the screener lists companies whose SEC facts the app has stored. It can serve about 10,000 US listings from a weekly reference import instead, with fewer fundamentals. See [Configuration](configuration.md#screener-universe).

## Analyze

Analyze writes a memo from a playbook: **Earnings quality**, **Variant view**, **Peer comparison**, or **Investment memo**. Edit the instructions and the source categories, then generate. You can inspect the evidence behind a memo, rerun it, compare it with earlier runs, and send it to a chat thread.

A finished single-company memo offers **Monitor this thesis**. It starts a new agent with the memo's company and an editable thesis.

## Analyst Grids

A grid puts companies in rows and metrics or a research question in columns. Pick a universe: manual tickers, a saved screen, a watchlist, a portfolio, or one company's peers. Then pick columns. Most read stored facts, such as market cap, revenue, and diluted EPS. A **Question** column has a model read each company's documents and answer one question. The financial columns (cash flow, net income, balance sheet, and ratios) need `GRID_FINANCIAL_MODE` turned on.

## Agents

An agent watches a company or a universe on a schedule. Give it a name, a thesis, a cadence, and what it covers.

For an agent that tracks one company, open **Thesis conditions** and write one to five statements to monitor. For each, say what would disprove it and over what time horizon. **Suggest conditions** drafts them for you to edit before you save.

Each run marks every condition **supported**, **challenged**, or **unresolved**, with evidence links, the assessment method, and model provenance.

- A numeric condition compares a calculation that the financial engine verifies against your threshold, with no model. A condition on a metric without a verified definition, on a point-in-time value, or on a unit or period that the definition does not support stays unresolved and raises no alert.
- A narrative condition uses the model set in Settings.
- Missing evidence gives an unresolved result. A model failure fails the run instead of inventing a result.

A new supported or challenged state appears on Home and fires the agent's alert rules. Evidence the agent already saw stays quiet.

Each save creates a thesis version, and the panel shows the latest 20 assessments and versions. If someone saves a newer version while you edit, your draft stays and **Load saved version** replaces it on request.

Agents read evidence already stored in the app: up to 100 claims, and up to 50 authoritative facts for each tracked metric, unit, and period type. They do not start a new web crawl. A numeric condition reads the latest fiscal period public at the run's cutoff, and stays unresolved when that period ended more than the maximum age before the cutoff.

An agent with no saved thesis conditions keeps the earlier workflow, including multi-company universes.

## Watchlists and portfolio

Build a manual watchlist, or a dynamic one that follows a screen, a theme, or a portfolio. The watchlist rail on the left shows quotes for its members. A portfolio holds research positions. It is not a brokerage account.

## Review

The review queue lists candidate facts that extraction was not confident about. A reviewer can correct a candidate, then approve or reject it. An approved fact is stored as authoritative.

## Settings

Settings holds model channels and the model for each role. Changes apply without a restart. See [Configuration](configuration.md#models).

## Discovery campaigns

Discovery turns a research brief into a reviewed shortlist of candidates, each with sealed evidence. It is off by default until its release review passes. See [Discovery campaigns: safe rollout and operations](discovery-campaigns-operations.md).

## What market-agent does not do

market-agent is for research, not trading. It does not:

- place orders or run any trading workflow
- update an answered chat message with live prices
- let the chat analyst browse the open web
- treat tweets, Reddit posts, or news articles as authoritative facts
