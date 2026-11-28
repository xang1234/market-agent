# Blinded comparison 2026-11-25T050708: baseline 2026-11-25T014331 vs candidate 2026-11-25T043700

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014331 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T043700 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2202628138.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| single-latest-quarter | candidate | baseline | yes |
| fiscal-year-trap | baseline | candidate | yes |
| missing-segments | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | yes |
| margin-trend-loss-quarter | baseline | candidate | yes |
| peer-three | baseline | candidate | yes |
| follow-up-memory | candidate | baseline | yes |
| missing-cash-flow | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | yes |
| ticker-page-compare | candidate | baseline | yes |
| segment-drill-down | baseline | candidate | no |
| peer-two | baseline | candidate | yes |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | 0 over 3 pairs | +2 over 9 pairs |
| comparable_periods | 13/20 | 20/20 | +2 over 1 pair | +5 over 9 pairs |
| figures_match_sources | 20/20 | 10/20 | -1 over 1 pair | -9 over 9 pairs |
| conclusions_justified | 10/20 | 19/20 | +2 over 1 pair | +7 over 9 pairs |
| counterarguments | 8/20 | 20/20 | +2 over 1 pair | +10 over 9 pairs |
| no_invented_numbers | 22/24 | 24/24 | +2 over 3 pairs | 0 over 9 pairs |
| decision_useful | 3/20 | 19/20 | +2 over 1 pair | +14 over 9 pairs |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-segments | 0 | — | — | — | — | +1 | — |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| segment-drill-down | 0 | +2 | -1 | +2 | +2 | +1 | +2 |

## Confounded pairs (not attributed to the change)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| single-latest-quarter | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +2 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | 0 | +2 |
| peer-three | +2 | +1 | -1 | +1 | +1 | 0 | +1 |
| follow-up-memory | 0 | 0 | -1 | +1 | +1 | 0 | +2 |
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| ticker-page-compare | 0 | +1 | -1 | 0 | +1 | 0 | +1 |
| peer-two | 0 | 0 | -1 | 0 | +1 | 0 | +1 |

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 5 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 0 |
| weak_conclusion | 7 | 1 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **single-latest-quarter**: A (candidate): unsupported_figure, weak_conclusion; B (baseline): weak_conclusion. Notes: A delivers full QoQ/YoY context, operating leverage, segment mix, and the 7-month staleness flag, though it lacks source links and wrongly calls Q4 GM (74.4%) the best of all eight quarters (Q1-Q3 FY25 were 74.6%-78.4%) and above FY25 (75.0%). B cites every verified figure cleanly but omits QoQ direction and segment/leverage drivers.
- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both catch the fiscal-year mismatch, but B quantifies its impact by aligning NVDA Q3 FY25-Q2 FY26 ($165,218M, shrinking AAPL lead from 3.2x to 2.5x) and contrasts profit/growth gaps. A cites its two figures cleanly but stops at stating the dates differ.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A plainly states AMD segment data is absent and provides verified consolidated context plus the MI308 8-K note. B invents no numbers but returns only consolidated FY25 revenue ($34.7B) and a generic no-10-K note without stating segment data is missing.
- **cause-in-evidence**: A (candidate): unsupported_figure; B (baseline): weak_conclusion. Notes: A correctly attributes the Q2 FY25 loss to the ~$800M MI308 export-control charge in AMD's 2025-08-05 8-K, quantifies the +$264M OpEx step-up, and shows the Q3-Q2 FY26 rebound, lacking only source links on table figures. B cites Q2 numbers cleanly but falls into the trap of claiming the data does not say why the loss occurred.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B lays out all eight quarters (Q3 FY24-Q2 FY26), flags Q2 FY25's -$134M loss with AMD's MI308 attribution, and shows margins plateauing as OpEx tracks revenue at ~39.6%, though table figures lack source links. A fails to pull any of the eight quarters due to read limits and returns only FY25 annual margin (9.78%).
- **peer-three**: A (baseline): wrong_subject, wrong_period, weak_conclusion; B (candidate): unsupported_figure. Notes: B covers all three companies on TTM and latest-quarter bases, flags the 5-month NVDA lag and one-off distortions (though it omits that AAPL is consumer electronics and lacks source links). A hits call limits, drops AMD completely, and pairs NVDA Q4 FY26 against AAPL FY25.
- **follow-up-memory**: A (candidate): unsupported_figure; B (baseline): weak_conclusion. Notes: Both preserve NVDA+AMD across all three turns and compute exact YTD returns (+5.8% vs +3.2%), but A's final turn bridges the 50.5-pt operating margin gap (20.4 pts GM + 30.1 pts OpEx/rev) and compares 2025 shocks and NI/OI distortions, lacking only source links. B cites every figure cleanly but its final commentary barely goes beyond noting AMD's NI exceeds OI.
- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both honestly state that AMD cash flow data (OCF, CapEx, FCF) is missing without substituting net income. A adds helpful accrual-vs-cash explanation and verified income-statement context while B reports structured missing-input gaps.
- **what-changed-gross-margin**: A (baseline): wrong_period, weak_conclusion; B (candidate): unsupported_figure. Notes: Both state honestly that the cause of NVDA's Q1 FY26 GM drop (73.0% to 60.5%) is absent, but B shows the full eight-quarter series including the Q2-Q4 recovery to 74.4% and sizes the ~$5.5B GP hit without source links. A cites Q1 FY26/Q4 FY25/Q1 FY25 accurately but wrongly calls Q1 FY26 the latest quarter and omits the recovery.
- **ticker-page-compare**: A (candidate): unsupported_figure; B (baseline): wrong_period. Notes: Both identify AAPL as primary and add NVDA, but A explicitly calls out the Sep-vs-Jan fiscal-year mismatch and NVDA's two-quarter staleness alongside quarterly growth, seasonality, and concentration (lacking source links). B links all FY figures cleanly but never flags the Sep-vs-Jan fiscal-calendar mismatch.
- **segment-drill-down**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): unsupported_figure. Notes: B presents the exact Q4 FY26 segment breakdown (Data Center $55.2B / 88.9%), highlights concentration risk, and flags single-quarter and staleness limits, lacking only source links. A completely misses the segment data on file, returning only annual FY26 revenue ($209.9B) and a generic no-10-K note.
- **peer-two**: A (baseline): none; B (candidate): unsupported_figure. Notes: A links every FY26/FY25 figure cleanly and flags the fiscal-year and cash-flow gaps, but omits growth rates, quarterly margin trajectories, and numeric price returns in text. B delivers growth, margin-shock analysis, mix, and price caveats across NVDA and AMD, lacking only source links.

Scores digest: `a9fe3d38bc36efd516e7cb0e00b7bb0b915a2ce95f818152a6d833252e7c85ab`.
