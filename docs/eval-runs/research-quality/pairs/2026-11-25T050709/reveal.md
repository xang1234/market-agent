# Blinded comparison 2026-11-25T050709: baseline 2026-11-25T014811 vs candidate 2026-11-25T044649

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014811 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T044649 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 4089716825.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| peer-three | candidate | baseline | yes |
| single-latest-quarter | baseline | candidate | yes |
| segment-drill-down | candidate | baseline | no |
| peer-two | baseline | candidate | yes |
| cause-in-evidence | candidate | baseline | yes |
| ticker-page-compare | candidate | baseline | yes |
| follow-up-memory | candidate | baseline | yes |
| missing-cash-flow | candidate | baseline | no |
| what-changed-gross-margin | candidate | baseline | yes |
| margin-trend-loss-quarter | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | yes |
| missing-segments | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | 0 over 4 pairs | +2 over 8 pairs |
| comparable_periods | 14/20 | 20/20 | +4 over 2 pairs | +2 over 8 pairs |
| figures_match_sources | 20/20 | 10/20 | -2 over 2 pairs | -8 over 8 pairs |
| conclusions_justified | 11/20 | 20/20 | +4 over 2 pairs | +5 over 8 pairs |
| counterarguments | 8/20 | 20/20 | +4 over 2 pairs | +8 over 8 pairs |
| no_invented_numbers | 22/24 | 24/24 | +2 over 4 pairs | 0 over 8 pairs |
| decision_useful | 3/20 | 19/20 | +4 over 2 pairs | +12 over 8 pairs |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| segment-drill-down | 0 | +2 | -1 | +2 | +2 | +1 | +2 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | 0 | +2 |
| missing-segments | 0 | — | — | — | — | +1 | — |

## Confounded pairs (not attributed to the change)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| peer-three | +2 | +1 | -1 | +1 | +2 | 0 | +1 |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | +2 |
| peer-two | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| ticker-page-compare | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| follow-up-memory | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +2 |

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 4 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 0 |
| weak_conclusion | 6 | 0 |
| missing_counterpoint | 3 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **peer-three**: A (candidate): unsupported_figure; B (baseline): wrong_subject, wrong_period, weak_conclusion, missing_counterpoint. Notes: A covers all three companies on TTM and latest-quarter bases and flags NVDA's 5-month lag and company-specific margin anomalies (lacking source links and an explicit note that AAPL is consumer electronics). B drops AMD due to call limits and compares NVDA Q4 FY26 with AAPL Q3 FY26 without calling out the 5-month gap.
- **single-latest-quarter**: A (baseline): weak_conclusion; B (candidate): unsupported_figure. Notes: B provides full QoQ/YoY analysis, accurate multi-quarter GM trajectory (noting 74.4% remains below early FY25's 78.4%/75.1%), operating leverage, segment concentration, and the 7-month staleness flag, lacking only source links. A links Q4 FY26 and FY26 figures cleanly but omits QoQ direction and analytical takeaways.
- **segment-drill-down**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap. Notes: A reports the exact Q4 FY26 segment split (Data Center $55.2B / 88.9%), highlights concentration risk, and flags single-quarter and post-Jan 2026 limits, lacking only source links. B misses the segment data on file entirely, returning only FY26 consolidated revenue ($209.9B) and a generic no-10-K message.
- **peer-two**: A (baseline): none; B (candidate): unsupported_figure. Notes: A links every FY26/FY25 figure cleanly and adds a sharp counterpoint that AMD's NI ($4.2B) exceeding OI ($3.4B) makes net margin overstate operating profitability, but omits growth rates and quarterly trajectories. B covers growth, margin trends, one-off shocks, mix, and price-data flaws while explicitly flagging the 5-month latest-quarter gap, lacking only source links.
- **cause-in-evidence**: A (candidate): unsupported_figure; B (baseline): weak_conclusion. Notes: A quotes AMD's 2025-08-05 8-K attribution of ~$800M MI308 export-control charges, quantifies the add-back (~8.7% OM) and +$264M OpEx increase, and shows the Q3-Q2 FY26 recovery (table figures lack source links). B links Q2 figures cleanly but falls into the trap of saying the data does not explain why the operating loss happened.
- **ticker-page-compare**: A (candidate): unsupported_figure; B (baseline): none. Notes: Both identify AAPL as primary, add NVDA, and flag the Sep-vs-Jan fiscal-year mismatch. A adds an overlapping Oct-Dec 2025 quarter comparison, growth trajectories, NVDA's 7-month staleness, and price-data caveats (without source links), whereas B links FY figures cleanly but omits growth and quarterly context.
- **follow-up-memory**: A (candidate): unsupported_figure; B (baseline): none. Notes: Both keep NVDA+AMD across turns 2-3 and compute exact YTD returns (+5.81% vs +3.17%). A's final turn decomposes the 50-pt OM gap into GM and OpEx/rev (9.5% vs 39.6%), contrasts the 2025 margin dips, and flags price-bar anomalies without source links; B links every FY/YTD figure and notes AMD's NI>OI but skips growth, OpEx leverage, and the export-control shock.
- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both plainly report that AMD cash flow data (OCF, CapEx, FCF) is missing without passing off net income as FCF. A adds verified OI/NI context with a clear explanation of why accrual earnings are not cash flow, while B reports structured missing-input gaps.
- **what-changed-gross-margin**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion. Notes: Both honestly state that no cause for NVDA's Q1 FY26 GM drop (73.0% to 60.5%) is in the data, but A shows all eight quarters including the Q2-Q4 recovery to 74.4% and sizes the ~$5.5B GP shortfall without source links. B links Q1 FY26/Q4 FY25/Q1 FY25 accurately but mislabels Q1 FY26 as the latest quarter and omits the recovery.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B tracks all eight quarters (Q3 FY24-Q2 FY26), attributes Q2 FY25's -$134M loss to AMD's ~$800M MI308 disclosure, and shows margins plateauing as OpEx tracks revenue at ~39.6% (lacking source links). A hits read limits, omits all eight quarters on file, and outputs only FY25 annual margin (9.78%) with no commentary.
- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both catch the 8-month fiscal-year mismatch between NVDA FY25 and AAPL FY25, but B realigns NVDA Q4 FY25-Q3 FY26 ($187,142M) to show AAPL's lead narrows from 3.2x to 2.2x and contrasts growth (+61% vs +6.4%), lacking only source links. A links the two figures cleanly but stops at stating the periods do not match.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B states plainly that AMD segment data is unavailable and gives verified consolidated figures plus the MI308 8-K note. A invents no numbers but returns only FY25 consolidated revenue ($34.7B) and a generic no-10-K note without stating segment data is missing.

Scores digest: `bbf3a941e5dd195221f2d309d851de667a261f5883cc5fab9949b8f26fdcc0e6`.
