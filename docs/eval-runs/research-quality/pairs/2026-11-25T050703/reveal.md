# Blinded comparison 2026-11-25T050703: baseline 2026-11-25T014331 vs candidate 2026-11-25T041853

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014331 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T041853 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2959567345.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| peer-three | candidate | baseline | yes |
| cause-in-evidence | baseline | candidate | yes |
| ticker-page-compare | baseline | candidate | yes |
| single-latest-quarter | candidate | baseline | yes |
| segment-drill-down | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| missing-segments | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | yes |
| margin-trend-loss-quarter | candidate | baseline | yes |
| follow-up-memory | baseline | candidate | yes |
| what-changed-gross-margin | baseline | candidate | yes |
| peer-two | baseline | candidate | yes |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | 0 over 3 pairs | +2 over 9 pairs |
| comparable_periods | 13/20 | 20/20 | +1 over 1 pair | +6 over 9 pairs |
| figures_match_sources | 20/20 | 9/20 | -1 over 1 pair | -10 over 9 pairs |
| conclusions_justified | 10/20 | 19/20 | +2 over 1 pair | +7 over 9 pairs |
| counterarguments | 11/20 | 19/20 | +1 over 1 pair | +7 over 9 pairs |
| no_invented_numbers | 22/24 | 22/24 | +2 over 3 pairs | -2 over 9 pairs |
| decision_useful | 6/20 | 15/20 | +1 over 1 pair | +8 over 9 pairs |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| segment-drill-down | 0 | +1 | -1 | +2 | +1 | +1 | +1 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| missing-segments | 0 | — | — | — | — | +1 | — |

## Confounded pairs (not attributed to the change)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| peer-three | +2 | +1 | -1 | +1 | +1 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +1 | +1 | 0 | +2 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | +1 |
| single-latest-quarter | 0 | 0 | -1 | 0 | +1 | 0 | 0 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| margin-trend-loss-quarter | 0 | +2 | -2 | +2 | +2 | -2 | +1 |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | 0 | +1 |
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| peer-two | 0 | 0 | -1 | +1 | 0 | 0 | +1 |

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 5 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 1 |
| weak_conclusion | 7 | 1 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **peer-three**: A (candidate): unsupported_figure; B (baseline): wrong_subject, wrong_period, weak_conclusion. Notes: A covers all three companies across both fiscal-year and latest-quarter tables with fiscal-calendar caveats and AMD charge context, though its figures lack source links and it misses the industry difference. B cites every figure it shows, but omits AMD entirely and compares NVDA Q4 FY2026 against AAPL full-year FY2025.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): unsupported_figure, weak_conclusion. Notes: B finds and properly attributes AMD's filed 8-K explanation (~$800M MI308 export-control charge) and checks the ex-charge margin (~8.7%), though it lacks source links on financial figures and slips logically by calling $800M larger than the $940M operating-income swing. A cites Q2 FY2025 metrics cleanly but falls into the trap of claiming the data does not explain why.
- **ticker-page-compare**: A (baseline): wrong_period; B (candidate): unsupported_figure. Notes: A links every FY figure to sources and notes both profit-pool and margin counterpoints, but never calls out the Sep-vs-Jan fiscal-calendar mismatch and drops the price-return numbers. B covers FY, latest quarter, segments, price action, timing mismatch (though misstating the 5-month quarterly gap as ~7 months), and quote discrepancies, but provides no source links.
- **single-latest-quarter**: A (candidate): unsupported_figure; B (baseline): none. Notes: A delivers QoQ/YoY income-statement comparisons, full Q4 FY2026 segment mix (88.9% Data Center), share-price context, and quote-vs-bar checks, but lacks source citations. B links every FY2026 and Q4 FY2026 figure to sources and states cash-flow/EPS gaps cleanly, but omits segment mix and growth comparisons.
- **segment-drill-down**: A (candidate): unsupported_figure; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: A provides the complete Q4 FY2026 segment breakdown (Data Center $55,200M / 88.9%) and states that historical segment data is missing, lacking only source links. B fails to retrieve the seeded segment data and outputs only FY2026 consolidated revenue without addressing segments.
- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both answers honestly report that AMD cash-flow data is missing and fabricate no figures. A additionally clarifies that net income is not a substitute for free cash flow and specifies the filings required.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B explicitly states that AMD segment revenue is unavailable in the file and notes that the $800M MI308 charge is not a segment revenue figure. A invents nothing but returns only consolidated FY2025 revenue and a no-10-K note without plainly stating that segment data is missing.
- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both catch the Jan-vs-Sep FY2025 calendar mismatch; A links both figures directly to sources, while B lacks source links but adds the 3.19x ratio, $285.7B gap, explicit eight-month offset, and an NVDA FY2026 ($209,911M) cross-check showing the ranking holds.
- **margin-trend-loss-quarter**: A (candidate): unsupported_figure, invented_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint. Notes: A covers all eight quarters Q3 FY2024-Q2 FY2026 with the Q2 FY2025 loss and MI308 explanation, but states AMD gross margin in surrounding quarters was "about 45%" when the data shows 50.2% in Q1 FY2025 (3,735/7,438) and 53.6% in Q3 FY2025 (4,953/9,246). B hits its read limit and returns only FY2025 annual operating margin (9.78%) plus two irrelevant Q1/Q2 FY2024 gaps.
- **follow-up-memory**: A (baseline): wrong_period, weak_conclusion; B (candidate): unsupported_figure. Notes: A maintains both companies across all three turns and cites every figure cleanly, but Turn 3 commentary barely explains the differences and skips the fiscal-calendar mismatch. B synthesizes scale, margins, growth, YTD returns, and the 5-month timing mismatch (even self-correcting its Turn 2 remark on AMD's Q2 FY25 base effect), lacking only source links.
- **what-changed-gross-margin**: A (baseline): wrong_period, weak_conclusion; B (candidate): unsupported_figure. Notes: Both honestly state the data does not explain NVDA's Q1 FY2026 gross margin drop to 60.5%; A cites every figure but mislabels Q1 FY2026 as "the latest quarter" and omits the Q2 recovery. B shows the Q2 FY2026 recovery to 72.4% and warns against misapplying AMD's MI308 disclosure, though without source links.
- **peer-two**: A (baseline): weak_conclusion; B (candidate): unsupported_figure. Notes: A links every FY figure to sources and notes fiscal-year and cash-flow caveats, but comments on "modestly different" YTD returns without displaying any price figures. B compares FY, quarterly, margin trends, AMD's Q2 FY25 charge, price bars, and quote discrepancies (only misstating the 5-month quarterly staleness gap as ~7 months), but lacks source links.

Scores digest: `a3371c6099f228757a9fb04a5e8a6efef0cd226638bea9911b7bd2b49636f30f`.
