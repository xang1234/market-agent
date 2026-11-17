# Agents page: thesis monitoring

A memo's investment thesis becomes a thesis agent. Each run assesses every condition over the analyst agent's evidence, certified figures by F id and stored claims by C id, and the Agents page shows each condition's assessments over time.

## Preconditions

- `$V doctor` passes on the commit under test.
- The subject has certified figures on file and its 10-K claims loaded (the boot recipe's three fixtures, with `$V import` first).
- A model answers, for Generate memo, Suggest conditions and each run. With none, `--stored` opens the subject's newest stored memo and `--conditions=FILE` types the conditions (a JSON list of `statement`, `falsifier`, `horizon`). A run still asks a model about each narrative condition whose last checked assessment, if any, was on other evidence, and a model must stay configured.

## Journey

```bash
$V agents NVDA                                    # Generate memo, draft conditions, run twice
$V agents NVDA --stored --conditions=conds.json   # no memo or draft model call
```

Symbol page, Analyze, Investment memo, Generate memo (or Open), Monitor this thesis, Create agent, View, Suggest conditions (or Add condition), Save thesis, then Run twice.

## Pass

- The thesis field on the Agents page holds every checked passage of the memo's investment thesis section, its verified inferences and figures, and no unverified inference or text of another section.
- After the first run, each condition shows one assessment citing F or C refs, or reading "Not enough evidence". A cited F ref reads as its certified figure, with its value and formula, and opens the verified calculation; the facts it read sit under it as inputs.
- After the second, each shows two dated assessments, newest first.
- At 390 px wide, with the sidebar collapsed, nothing on the page scrolls sideways, the thesis editor and the open history included.
- `report.json` passes, and `assessed.png` and `history.png` show every condition open.

## Also check by hand

- A condition no stored source covers reads "Not enough evidence" with the fixed note and no words of the model's.
- A memo with no investment thesis section offers no Monitor this thesis button and says "This memo has no investment thesis section to monitor."
- A watchlist universe reads `watchlist: <name>` in the roster, and the cadence menu offers hourly and daily only.
- Scheduled runs: with `AGENT_SCHEDULER_INTERVAL_MS=10000` and an hourly agent's last run two hours back, a new dated assessment appears with no click.
- Tab reaches each condition's summary, where Enter opens it.

## Lease takeover

A run whose lease expired and was taken over must commit nothing (#661). Start the stack with the hold runtime, which holds the first run of the agent named in `.dev/lease-hold/hold` to finish analyze, for at most five minutes:

```bash
echo "DEV_API_RUNTIME_MODULE=$PWD/.claude/skills/verify-market-agent/scripts/hold-runtime.ts" >> .env.dev
echo "AGENT_SCHEDULER_INTERVAL_MS=5000" >> .env.dev
$V up
$V lease-race run-now             # a held run-now
$V lease-race scheduled           # a held scheduled run
$V lease-race run-now --thesis    # a held thesis run
```

Each passes when the newer run completes, the held run's row reads failed with "agent run claim expired", the held run-now answers with that row (or the scheduler logs the held run `superseded`), the watermark names the newer run, and only the newer run's activity or assessment is stored. Remove both lines from `.env.dev` afterwards. `report.json` for each run is in `.dev/verify/lease-race-<mode>[-thesis]-<stamp>/`.

## Evidence

`.dev/verify/agents-<TICKER>-<stamp>/`: `report.json` (checks, timings, and each run's model calls from `.dev/logs/dev-api.log`, failed attempts included, as the memo's count does), `memo.json`, `handoff.png`, `drafted.png`, `assessed.png`, `history.png`, `narrow.png`, `final.png`, and `page.txt`.
