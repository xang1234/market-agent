# Blinded comparison 2026-11-25T050659: baseline 2026-11-25T014331 vs candidate 2026-11-25T040243

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014331 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T040243 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 3420406396.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| what-changed-gross-margin | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| peer-three | baseline | candidate | no |
| missing-segments | baseline | candidate | no |
| single-latest-quarter | baseline | candidate | no |
| cause-in-evidence | candidate | baseline | no |
| follow-up-memory | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | no |
| ticker-page-compare | baseline | candidate | no |
| peer-two | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| missing-cash-flow | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 13/20 | 20/20 | +7 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 9/20 | 20/20 | +11 over 10 pairs | — (no pairs) |
| counterarguments | 10/20 | 20/20 | +10 over 10 pairs | — (no pairs) |
| no_invented_numbers | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| decision_useful | 4/20 | 19/20 | +15 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | 0 | +2 |
| peer-three | +2 | +1 | -1 | +1 | +1 | 0 | +1 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | +1 |
| peer-two | 0 | 0 | -1 | +1 | 0 | 0 | +1 |
| segment-drill-down | 0 | +1 | -1 | +2 | +2 | +1 | +2 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 3 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 8 | 0 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **what-changed-gross-margin**: A (candidate): none; B (baseline): wrong_period, weak_conclusion. Notes: A shows the full 8-quarter gross margin trajectory including the Q2–Q4 FY2026 recovery and states plainly that no NVDA cause is on file, though without source citations; B links its verified figures to sources but mislabels Q1 FY2026 as the latest quarter and cuts off before showing the subsequent recovery.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): wrong_period, weak_conclusion, missing_counterpoint. Notes: A lays out all eight quarters in order, highlights Q2 FY2025's -$134M operating loss with AMD's ~$800M MI308 export-control attribution and notes recent gains are gradual, lacking only source links; B hits its read limit and returns only FY2025's annual 9.78% margin plus unavailable Q1/Q2 FY2024 queries.
- **peer-three**: A (baseline): wrong_subject, wrong_period, weak_conclusion; B (candidate): none. Notes: B covers all three companies across annual and quarterly periods while calling out fiscal-calendar differences, NVDA's Q1 dip, and AMD's Q2 FY2025 base distortion (though omitting source links and AAPL's consumer-electronics industry difference); A omits AMD entirely and compares NVDA's Q4 FY2026 quarter against AAPL's full FY2025.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B plainly states that AMD segment revenue is not on file and gives only verified consolidated revenue; A returns consolidated FY2025 revenue ($34.7B) with a generic no-10-K disclaimer without stating that segment data is unavailable.
- **single-latest-quarter**: A (baseline): weak_conclusion; B (candidate): none. Notes: B covers Q4 FY2026 with QoQ and YoY growth, margin progression, the 88.9% Data Center mix, and the seven-month staleness gap, lacking only source links; A links its Q4 and FY2026 figures to sources but omits Q3 FY2026, QoQ direction, and segment concentration.
- **cause-in-evidence**: A (candidate): none; B (baseline): weak_conclusion. Notes: A cites and dates AMD's Q2 FY2025 8-K Exhibit 99.1 attribution (~$800M MI308 export-control charges), tests the gross margin drop and Q3 rebound, and flags line-item uncertainty; B links its Q2 numbers to sources but misses the filed explanation and claims the data does not show why.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): none. Notes: B maintains context across all three turns, aligns YTD price returns, decomposes the 50.5-point operating margin gap into gross margin (~20 pts) and opex scale (~30 pts), and flags AMD's $800M base effect and NVDA's five-month reporting lag; A links verified figures but never calls out the FY2026/FY2025 calendar mismatch and only remarks on AMD's net income exceeding operating income on turn 3.
- **fiscal-year-trap**: A (baseline): none; B (candidate): none. Notes: Both answers name the exact year-ends and flag the fiscal-calendar mismatch, with A linking both figures to sources; B adds the eight-month shift, NVDA's +61% FY2026 jump to $209.9B versus AAPL's +6.4% growth, and missing FY2024 NVDA context.
- **ticker-page-compare**: A (baseline): none; B (candidate): none. Notes: B explicitly calls out both the Sep/Jan fiscal-year mismatch and NVDA's five-month quarterly lag while adding growth rates, Data Center mix, and valuation gaps (though lacking source links and adding a brief unasked AMD aside); A links all figures to sources and notes scale vs. margins but fails to call out the fiscal-calendar mismatch.
- **peer-two**: A (baseline): weak_conclusion; B (candidate): none. Notes: B compares annual, quarterly, TTM, and price trajectories while calling out AMD's Q2 FY2025 $800M base distortion, NVDA's Q1 dip, reporting-date staleness, and the quote/bar discrepancy (without source links); A links annual figures and notes the fiscal-year/cash-flow mismatch but omits growth rates, quarterly trends, and actual YTD return figures in text.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): none. Notes: B delivers the complete Q4 FY2026 segment breakdown showing 88.9% Data Center concentration and plainly notes the absence of prior-period segment history and segment margins (without source links); A returns only consolidated FY2026 revenue ($209.9B) and omits the Q4 segment data without stating it.
- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both answers honestly state that AMD's operating cash flow, capex, and free cash flow are unavailable and avoid passing off net income as FCF; A additionally provides accurate income-statement context while explicitly refusing to estimate FCF from it.

Scores digest: `1ec6f77679ebbd144b4cf459d8ce40f9232e99843565aadbf635d70ac6d3e25d`.
