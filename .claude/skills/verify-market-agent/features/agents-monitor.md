# Agents page: thesis monitoring

A memo's investment thesis becomes a thesis agent. Each run assesses every condition over the analyst agent's evidence, certified figures by F id and stored claims by C id, and the Agents page shows each condition's assessments over time.

## Preconditions

- `$V doctor` passes on the commit under test.
- The subject has certified figures on file and its 10-K claims loaded (the boot recipe's three fixtures, with `$V import` first).
- A model answers, for Generate memo, Suggest conditions and each run. With none, `--stored` opens the subject's newest stored memo and `--conditions=FILE` types the conditions (a JSON list of `statement`, `falsifier`, `horizon`). Each run still needs a model unless its evidence matches the last assessment's.

## Journey

```bash
$V agents NVDA                                    # Generate memo, draft conditions, run twice
$V agents NVDA --stored --conditions=conds.json   # no memo or draft model call
```

Symbol page, Analyze, Investment memo, Generate memo (or Open), Monitor this thesis, Create agent, View, Suggest conditions (or Add condition), Save thesis, then Run twice.

## Pass

- The thesis field on the Agents page holds every text passage of the memo's investment thesis section and none of another section's.
- After the first run, each condition shows one assessment citing F or C refs, or reading "Not enough evidence".
- After the second, each shows two dated assessments, newest first.
- `report.json` passes, and `assessed.png` and `history.png` show every condition open.

## Also check by hand

- A condition no stored source covers reads "Not enough evidence" with the fixed note and no words of the model's.
- A watchlist universe reads `watchlist: <name>` in the roster, and the cadence menu offers hourly and daily only.
- Scheduled runs: with `AGENT_SCHEDULER_INTERVAL_MS=10000` and an hourly agent's last run two hours back, a new dated assessment appears with no click.
- At 390 px wide the history reads with no horizontal scroll, and Tab reaches each condition's summary, where Enter opens it.

## Evidence

`.dev/verify/agents-<TICKER>-<stamp>/`: `report.json` (checks, timings, and each run's model calls from `.dev/logs/dev-api.log`, failed attempts included, as the memo's count does), `memo.json`, `handoff.png`, `drafted.png`, `assessed.png`, `history.png`, `final.png`, and `page.txt`.
