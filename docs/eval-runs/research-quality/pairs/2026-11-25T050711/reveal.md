# Blinded comparison 2026-11-25T050711: baseline 2026-11-25T015316 vs candidate 2026-11-25T045609

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T015316 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T045609 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 3096076744.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| peer-three | baseline | candidate | yes |
| margin-trend-loss-quarter | baseline | candidate | yes |
| segment-drill-down | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | yes |
| missing-segments | candidate | baseline | no |
| follow-up-memory | candidate | baseline | yes |
| ticker-page-compare | baseline | candidate | yes |
| peer-two | candidate | baseline | yes |
| fiscal-year-trap | candidate | baseline | yes |
| what-changed-gross-margin | baseline | candidate | yes |
| single-latest-quarter | candidate | baseline | yes |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | 0 over 3 pairs | +2 over 9 pairs |
| comparable_periods | 15/20 | 20/20 | +2 over 1 pair | +3 over 9 pairs |
| figures_match_sources | 20/20 | 9/20 | -2 over 1 pair | -9 over 9 pairs |
| conclusions_justified | 12/20 | 20/20 | +2 over 1 pair | +6 over 9 pairs |
| counterarguments | 9/20 | 20/20 | +2 over 1 pair | +9 over 9 pairs |
| no_invented_numbers | 22/24 | 22/24 | 0 over 3 pairs | 0 over 9 pairs |
| decision_useful | 4/20 | 19/20 | +2 over 1 pair | +13 over 9 pairs |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| segment-drill-down | 0 | +2 | -2 | +2 | +2 | -1 | +2 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| missing-segments | 0 | — | — | — | — | +1 | — |

## Confounded pairs (not attributed to the change)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| peer-three | +2 | 0 | -1 | +1 | +1 | 0 | +1 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +1 | +1 | 0 | +2 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| follow-up-memory | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| ticker-page-compare | 0 | +1 | -1 | 0 | +1 | 0 | +1 |
| peer-two | 0 | 0 | -1 | +2 | +2 | 0 | +2 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +2 |
| what-changed-gross-margin | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| single-latest-quarter | 0 | 0 | -1 | 0 | 0 | 0 | +1 |

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-opus-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 3 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 1 |
| weak_conclusion | 5 | 0 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **peer-three**: A (baseline): wrong_subject, weak_conclusion; B (candidate): unsupported_figure. Notes: B covers all three companies across latest quarter, full year, and TTM scale while flagging NVDA's 5-month lag and margin anomalies (lacking source links and an explicit note that AAPL is consumer electronics). A links AAPL Q3 FY26 and NVDA Q4 FY26 cleanly and notes the different quarters, but drops AMD due to call limits.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion; B (candidate): unsupported_figure. Notes: B lays out all eight quarters (Q3 FY24-Q2 FY26), attributes Q2 FY25's -$134M loss to AMD's ~$800M MI308 disclosure, and shows margins plateauing as OpEx stays ~39-40% of revenue (lacking source links). A hits read limits, returning only FY25 (9.78%) and Q3-Q4 FY25 (13.74%, 14.08%), missing the Q2 FY25 loss and both FY26 quarters.
- **segment-drill-down**: A (candidate): unsupported_figure, invented_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap. Notes: A gives the full Q4 FY26 segment table (Data Center $55,200M / 88.9%) and flags single-quarter and staleness limits, but states a wrong computed figure in prose: "$8.90 of every $9" (98.9%) instead of 88.9% ($8.89 of every $10, or $8.00 of every $9; 55,200/62,100 in company-data.md), and lacks source links. B misses the segment data entirely, returning only FY26 total revenue ($209.9B).
- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both state plainly that AMD cash flow data (OCF, CapEx, FCF) is absent without substituting net income. A adds verified OI/NI context and explains why accrual earnings diverge from FCF, while B reports structured missing-input gaps.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): unsupported_figure. Notes: B quotes AMD's 2025-08-05 8-K attribution of ~$800M MI308 export-control charges, quantifies the add-back (8.7% OM) and +$264M OpEx step-up, and shows the Q3 FY25-Q2 FY26 recovery (table figures lack source links). A links Q2 figures cleanly but falls into the trap of saying the evidence does not explain why the operating loss occurred.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A plainly states AMD segment data is unavailable and provides verified consolidated totals plus the MI308 8-K note. B invents no numbers but returns only FY25 consolidated revenue ($34.7B) and a generic no-10-K note without stating segment data is missing.
- **follow-up-memory**: A (candidate): unsupported_figure; B (baseline): none. Notes: Both preserve NVDA+AMD across turns 2-3 and compute exact YTD returns (+5.8% vs +3.2%). On the scored final turn, A decomposes the matched-quarter 50.8-pt OM gap into 20.4 pts GM and 30.4 pts OpEx/rev, contrasts 2025 shocks, and quantifies AMD's NI>OI distortion (without source links; note a minor Turn 1 QoQ/YoY wording slip on the 12.5-pt GM drop), while B links all FY figures and notes AMD's NI>OI but skips OpEx leverage, growth, and export-control shocks.
- **ticker-page-compare**: A (baseline): wrong_period; B (candidate): unsupported_figure. Notes: Both identify AAPL as primary and add NVDA. B compares FY, TTM, and latest quarters, flags NVDA's two-quarter staleness, DC concentration, seasonality, and quote discrepancies (lacking source links), whereas A links FY figures cleanly but never calls out the Sep-vs-Jan fiscal-year mismatch.
- **peer-two**: A (candidate): unsupported_figure; B (baseline): weak_conclusion, missing_counterpoint. Notes: A compares NVDA and AMD across scale, growth, margins, one-off shocks, mix, and price action while flagging the 5-month NVDA lag and price-bar anomalies, lacking only source links. B links all 18 FY and YTD price figures accurately but omits all analytical commentary after hitting model call limits.
- **fiscal-year-trap**: A (candidate): unsupported_figure; B (baseline): none. Notes: Both flag the 8-month offset between NVDA FY25 and AAPL FY25, but A realigns NVDA Q4 FY25-Q3 FY26 ($187,142M) to show AAPL's lead narrows from 3.2x to 2.2x and contrasts growth (+6.4% vs +61%), lacking only source links. B links the two FY25 figures cleanly but stops at noting the offset windows.
- **what-changed-gross-margin**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both state honestly that no cause for NVDA's Q1 FY26 GM drop (73.0% to 60.5%) is in the data, and A cleanly links Q1 FY26, Q4 FY25, and Q1 FY25 without mislabeling Q1 FY26 as latest. B adds the full Q2-Q4 recovery to 74.4% and sizes the ~$5.5B GP shortfall, lacking only source links.
- **single-latest-quarter**: A (candidate): unsupported_figure; B (baseline): none. Notes: A delivers full QoQ/YoY tables, operating leverage (~85% incremental OM), GM recovery, DC 88.9% concentration, and prominent 7-month staleness and price-feed warnings (lacking source links). B links Q4 FY26, FY26, and YTD price figures cleanly and smartly flags the modest +5.81% return and January staleness, but omits QoQ direction and segment drivers.

Scores digest: `14f9aaa7451af66821f5a5419bb42c08f6458a53505b389a359dff60af518da7`.
