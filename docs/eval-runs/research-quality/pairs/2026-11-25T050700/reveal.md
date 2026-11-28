# Blinded comparison 2026-11-25T050700: baseline 2026-11-25T014811 vs candidate 2026-11-25T040734

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014811 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T040734 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 654943444.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| single-latest-quarter | candidate | baseline | no |
| peer-two | baseline | candidate | no |
| cause-in-evidence | candidate | baseline | no |
| fiscal-year-trap | baseline | candidate | no |
| ticker-page-compare | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| follow-up-memory | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| missing-cash-flow | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |
| missing-segments | candidate | baseline | no |
| peer-three | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 13/20 | 20/20 | +7 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 8/20 | -12 over 10 pairs | — (no pairs) |
| conclusions_justified | 9/20 | 20/20 | +11 over 10 pairs | — (no pairs) |
| counterarguments | 10/20 | 20/20 | +10 over 10 pairs | — (no pairs) |
| no_invented_numbers | 22/24 | 20/24 | -2 over 12 pairs | — (no pairs) |
| decision_useful | 5/20 | 19/20 | +14 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| peer-two | 0 | +1 | -1 | +1 | 0 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| ticker-page-compare | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| segment-drill-down | 0 | +1 | -1 | +2 | +2 | +1 | +2 |
| follow-up-memory | 0 | +1 | -2 | +1 | +1 | -2 | +1 |
| margin-trend-loss-quarter | 0 | +2 | -2 | +2 | +2 | -2 | +2 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| peer-three | +2 | +1 | -1 | +1 | +1 | 0 | +1 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 2 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 2 |
| weak_conclusion | 8 | 0 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: A gives Q4 FY2026 with QoQ and YoY growth, opex leverage, the 88.9% Data Center mix, Q1's V-shaped margin dip, and the seven-month staleness gap (without source links); B links Q4 and FY2026 figures to sources but omits Q3 FY2026, QoQ direction, and segment mix.
- **peer-two**: A (baseline): weak_conclusion; B (candidate): none. Notes: B compares annual, quarterly, TTM, and price performance while flagging NVDA's reporting lag, Q1 dip, and AMD's $800M base effect (without source links); A links verified annual figures and notes AMD's NI > OI caveat, but never calls out the FY2026/FY2025 fiscal-calendar mismatch and omits growth and quarterly trends.
- **cause-in-evidence**: A (candidate): none; B (baseline): weak_conclusion. Notes: A cites and dates AMD's Q2 FY2025 8-K Exhibit 99.1 attribution (~$800M MI308 export-control charges), checks the $676M QoQ gross profit drop and Q3 rebound, and flags line-item assumptions; B links its Q2 numbers to sources but misses the filed explanation and claims the data does not say why.
- **fiscal-year-trap**: A (baseline): none; B (candidate): none. Notes: Both flag the Sep/Jan fiscal-year mismatch, with A linking both verified figures to sources; B quantifies the eight-month shift, NVDA's +61% FY2026 surge, and the closer quarterly alignment (Q3 FY2025–Q2 FY2026) needed for a fair comparison.
- **ticker-page-compare**: A (baseline): none; B (candidate): none. Notes: Both cover AAPL and NVDA and flag the fiscal-calendar difference, with A linking all annual figures to sources; B adds growth rates, latest quarters, AAPL's TTM totals and seasonality, NVDA's 89% Data Center concentration, and the five-month staleness and valuation gaps.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): none. Notes: B gives the full Q4 FY2026 segment table showing 88.9% Data Center concentration and states plainly that no other periods are on file (without source links); A returns only consolidated FY2026 revenue ($209.9B) and misses the seeded Q4 segment breakdown without stating the gap.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): invented_figure. Notes: B gives a deep turn-3 margin and growth decomposition while flagging calendar mismatches and synthetic-looking volume, but gets a 0 on no_invented_numbers because turn 2 states NVDA's latest-quarter operating income is 'roughly 40x' AMD's ($40.3B vs. $1.6B) when $40,300M / $1,610M is 25.0x; A links all figures accurately but misses the FY2026/FY2025 mismatch and leaves turn 3 thin.
- **margin-trend-loss-quarter**: A (candidate): invented_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint. Notes: A covers all eight quarters and AMD's $800M MI308 filing while B hits its read limit and returns only FY2025's 9.78% margin, but A gets a 0 on no_invented_numbers for stating revenue is 'up about 21%' from Q2 FY2025 to Q2 FY2026 (7,685 to 11,200), when 7,685 to 11,200 is +45.7% (+21.1% is Q3 FY2025's 9,246 to 11,200).
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Both answers plainly state that AMD's cash flow inputs are missing and refuse to substitute net income for FCF, with B adding accurate consolidated earnings context and noting share count is also missing.
- **what-changed-gross-margin**: A (candidate): none; B (baseline): wrong_period, weak_conclusion. Notes: A documents the 12.5-point Q1 FY2026 drop, the immediate Q2 rebound to 72.4%, and the absence of any NVDA filed explanation (without source links); B links Q1/Q4/Q1 figures to sources but mislabels Q1 FY2026 as the latest quarter and omits the subsequent recovery.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A plainly states that AMD segment revenue is unavailable and provides only verified consolidated revenue; B returns consolidated FY2025 revenue ($34.7B) with a generic no-10-K note without stating that segment data is missing.
- **peer-three**: A (candidate): none; B (baseline): wrong_subject, weak_conclusion. Notes: A covers all three companies across annual, quarterly, and TTM periods while noting fiscal-calendar differences, NVDA's Q1 dip, and AMD's $800M charge (lacking source links and AAPL's different industry); B links verified single-quarter figures for NVDA and AAPL but omits AMD completely and does not call out the five-month gap between their quarters.

Scores digest: `d82c4441096a0bd857abfb2ed53c4deb2172ab36e796f3e01f55d2b21033f001`.
