# Blinded comparison 2026-11-25T040602: baseline 2026-11-25T040056 vs candidate 2026-11-25T035542

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T040056 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T035542 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 1441940962.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| ticker-page-compare | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | no |
| missing-cash-flow | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| missing-segments | baseline | candidate | no |
| follow-up-memory | baseline | candidate | no |
| peer-three | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| peer-two | baseline | candidate | no |
| margin-trend-loss-quarter | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 15/20 | 20/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 12/20 | 19/20 | +7 over 10 pairs | — (no pairs) |
| counterarguments | 5/20 | 20/20 | +15 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 24/24 | +3 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 20/20 | +13 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| ticker-page-compare | 0 | +1 | -1 | -1 | 0 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +2 | 0 | +2 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | +2 | 0 | +1 |
| single-latest-quarter | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| follow-up-memory | 0 | +1 | -1 | 0 | +2 | +1 | +1 |
| peer-three | +2 | 0 | -1 | +1 | +1 | 0 | +1 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| segment-drill-down | 0 | 0 | -1 | +2 | +2 | +1 | +2 |
| peer-two | 0 | +1 | -1 | 0 | +2 | 0 | +1 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | 0 | +2 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 2 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 0 |
| weak_conclusion | 5 | 1 |
| missing_counterpoint | 6 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **ticker-page-compare**: A (candidate): unsupported_figure, weak_conclusion; B (baseline): wrong_period. Notes: A covers annual, quarterly, TTM, segment, and price comparisons and calls out the misaligned periods, though it lacks source links, misstates the Jan-to-Jun lag as 'about seven months' (actual: five), and calls NVDA's +8.9% QoQ 'still accelerating' (down from +22.0% in Q3). B cites all ten figures to sources and frames the margin-vs-scale counterpoint cleanly without unbacked price claims, but fails to call out the Sep-vs-Jan fiscal-calendar mismatch and omits growth, latest quarters, and price numbers.
- **cause-in-evidence**: A (baseline): weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B cites and dates AMD's Q2 2025 8-K Ex. 99.1 (2025-08-05) for the ~$800M MI308 export-control charge, separates the ~$264M unexplained opex jump leaving ex-charge margin (~8.7%) below Q1 (10.8%), and traces the rebound through Q2 FY2026, lacking only source links on its financial figures. A cites six Q2 FY2025 numbers accurately but provides zero explanation or commentary after hitting its model-call limit.
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Both correctly cover AMD and state plainly that cash flow data is unavailable without inventing numbers or substituting net income. B additionally explains why net income cannot proxy for FCF and gives verified TTM and Q2 FY2026 income-statement context.
- **what-changed-gross-margin**: A (candidate): unsupported_figure; B (baseline): weak_conclusion, missing_counterpoint. Notes: A quantifies the 12.5-point drop to 60.5%, traces the full Q2-Q4 recovery to 74.4%, and refuses to read AMD's export-control charge across to NVDA, lacking only source links. B links all figures to sources and states the cause is unknown, but wrongly calls Q1 FY2026 'the latest quarter' and omits the Q2-Q4 recovery entirely.
- **single-latest-quarter**: A (candidate): unsupported_figure; B (baseline): none. Notes: A covers QoQ/YoY growth, clean margin expansion math, 88.9% Data Center mix, sequential deceleration (+22.0% to +8.9%), quote mismatch, and upfront 7-month staleness, lacking only source citations. B links all FY2026 and Q4 FY2026 figures to sources and notes Q4 margins beat FY levels, but omits QoQ direction, segment mix, and data staleness.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B states plainly that AMD segment data is absent, gives verified consolidated revenue, and notes the dated Q2 FY2025 8-K MI308 mention provides no segment sales. A invents no numbers but returns only FY2025 revenue ($34.7B) and a generic no-10-K notice without stating that segment data is unavailable.
- **follow-up-memory**: A (baseline): missing_counterpoint, unstated_gap; B (candidate): unsupported_figure. Notes: On Turn 3, B rigorously decomposes the 50.4-point operating margin gap (59% opex intensity vs 41% gross margin), tracks YTD price checkpoints, tests AMD's FY2025 margins ex-$800M charge, notes the 5-month latest-quarter lag, and separates established vs unestablished claims, lacking only source citations. A links every Turn 3 figure including YTD returns to sources, but stays one-sided with no counterpoints, omits the fiscal-calendar offset, and leaves key explanatory gaps unstated.
- **peer-three**: A (baseline): wrong_subject, weak_conclusion; B (candidate): unsupported_figure. Notes: B covers all three companies across annual and latest-quarter periods, states the exact 5-month calendar lag, and highlights NVDA's unexplained Q1 dip, AMD's $800M MI308 distortion, and AAPL's Q1 seasonality, though it lacks source links and omits AAPL's different industry. A cites its NVDA and AMD figures cleanly and notes their periods differ, but omits AAPL completely after hitting its model-call limit.
- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both catch the fiscal-year-end mismatch between NVDA FY2025 (Jan 2025) and AAPL FY2025 (Sep 2025), with A linking both figures to sources. B is much more decision-useful because it quantifies the eight-month offset, compares closer-overlapping NVDA FY2026 ($209,911M, halving the ratio from 3.2x to 2.0x), and contrasts growth rates (+61% vs +6%), lacking only source citations.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): unsupported_figure. Notes: B delivers the complete Q4 FY2026 segment table showing 88.9% Data Center concentration (Gaming <8% of Data Center) and explains why single-quarter segment coverage prevents attributing +58% YoY company growth by segment, lacking only source citations. A returns only consolidated FY2026 revenue ($209.9B) without segment figures or stating that segments were omitted.
- **peer-two**: A (baseline): missing_counterpoint; B (candidate): unsupported_figure. Notes: B compares annual, latest-quarter, growth, and price returns with grounded counterpoints (NVDA's two-quarter lag, 89% Data Center concentration, unexplained Q1 dip; AMD's $800M MI308 charge and NI > OI; quote mismatch), lacking only source citations. A links all ten annual and YTD price figures to sources, but omits the fiscal-calendar offset, latest quarters, growth rates, and any counterpoint after hitting its model-call limit.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B charts all eight quarters Q3 FY2024-Q2 FY2026 in order, attributes the Q2 FY2025 -$134M loss to AMD's ~$800M MI308 filing while noting ex-charge margin (~8.7%) still lagged surrounding quarters, and traces the ~4-point gross margin recovery, lacking only source citations. A returns only annual FY2025 operating margin (9.78%) and out-of-range Q1-Q2 FY2024 gaps after hitting its read limit.

Scores digest: `b67f907efd5051f1ae665a0ea0179b67531aae8f86724ad2c0ca761407fe9527`.
