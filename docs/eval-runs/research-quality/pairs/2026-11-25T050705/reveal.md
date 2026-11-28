# Blinded comparison 2026-11-25T050705: baseline 2026-11-25T014811 vs candidate 2026-11-25T042337

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014811 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T042337 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 294152878.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| missing-segments | candidate | baseline | no |
| margin-trend-loss-quarter | baseline | candidate | no |
| cause-in-evidence | candidate | baseline | yes |
| missing-cash-flow | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | yes |
| follow-up-memory | baseline | candidate | yes |
| ticker-page-compare | baseline | candidate | yes |
| peer-two | candidate | baseline | yes |
| single-latest-quarter | baseline | candidate | yes |
| peer-three | candidate | baseline | yes |
| what-changed-gross-margin | baseline | candidate | yes |
| segment-drill-down | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | 0 over 4 pairs | +2 over 8 pairs |
| comparable_periods | 13/20 | 19/20 | +3 over 2 pairs | +3 over 8 pairs |
| figures_match_sources | 20/20 | 6/20 | -2 over 2 pairs | -12 over 8 pairs |
| conclusions_justified | 10/20 | 17/20 | +4 over 2 pairs | +3 over 8 pairs |
| counterarguments | 11/20 | 19/20 | +3 over 2 pairs | +5 over 8 pairs |
| no_invented_numbers | 22/24 | 16/24 | +2 over 4 pairs | -8 over 8 pairs |
| decision_useful | 6/20 | 15/20 | +2 over 2 pairs | +7 over 8 pairs |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-segments | 0 | — | — | — | — | +1 | — |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | 0 | +1 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| segment-drill-down | 0 | +1 | -1 | +2 | +1 | +1 | +1 |

## Confounded pairs (not attributed to the change)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| follow-up-memory | 0 | 0 | -2 | 0 | +1 | -2 | +1 |
| ticker-page-compare | 0 | 0 | -1 | -1 | 0 | 0 | 0 |
| peer-two | 0 | +1 | -2 | 0 | 0 | -2 | +1 |
| single-latest-quarter | 0 | 0 | -2 | +1 | +1 | -2 | +1 |
| peer-three | +2 | +1 | -2 | 0 | +1 | -2 | +1 |
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | 0 |

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 5 | 1 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 4 |
| weak_conclusion | 7 | 3 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A explicitly states that AMD segment revenue is absent from the file, lists accurate consolidated totals, and clarifies that the $800M MI308 charge is not segment revenue. B invents nothing but returns only consolidated FY2025 revenue and a no-10-K note without plainly stating segment data is missing.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B presents all eight quarters Q3 FY2024-Q2 FY2026 accurately in order, attributes the Q2 FY2025 -1.7% dip to AMD's filed ~$800M MI308 charge, and flags missing drivers for the Q3 step-up, lacking only source links. A hits its read limit and returns only FY2025 annual operating margin (9.78%) plus two irrelevant Q1/Q2 FY2024 gaps.
- **cause-in-evidence**: A (candidate): unsupported_figure; B (baseline): weak_conclusion. Notes: A directly answers why by quoting AMD's earnings release on the ~$800M MI308 export-control charge, checks Q1-to-Q2 revenue (+$247M), gross profit (-$676M), and ex-charge operating margin (~8.7%), and states line-item/bridge limits, though without source links or filing date. B cites Q2 FY2025 figures cleanly but misses the filed explanation and claims the data does not say why.
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Both honestly report that AMD cash-flow data is missing without fabricating numbers. B additionally notes that accrual net and operating income cannot stand in for free cash flow and specifies the filings needed.
- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both flag the Jan-vs-Sep FY2025 calendar mismatch; A links both figures directly to sources, while B lacks source links but adds the 3.2x ratio, $285.7B gap, four-month overlap, and an NVDA FY2026 ($209,911M) cross-check showing AAPL remains ~2.0x larger.
- **follow-up-memory**: A (baseline): wrong_period; B (candidate): wrong_period, unsupported_figure, invented_figure. Notes: A tracks both companies across all three turns and links every figure cleanly, though Turn 3 skips the fiscal-calendar mismatch and lacks a counterpoint on NVDA. B gives a far richer six-part synthesis, but leaves an unverifiable "+44.8%" for NVDA Q4 FY25 YoY growth in its first table (no Q4 FY24 exists; even 39,331/26,044-1 is +51.0%) before withdrawing it and misstates AMD Q1 FY25's end date as 2024-12-28 (actual: 2025-03-29).
- **ticker-page-compare**: A (baseline): none; B (candidate): unsupported_figure, weak_conclusion. Notes: A cites all FY metrics cleanly, contrasts margin quality against scale ($112.5B vs $112.0B net income), and explicitly calls out the Sep-vs-Jan calendar mismatch, though it omits price numbers and growth. B adds quarterly, segment, and price context without source links, but falsely states that YTD returns cannot be calculated from the daily bars (2025-12-31 through 2026-08-31 are present).
- **peer-two**: A (candidate): unsupported_figure, invented_figure, weak_conclusion; B (baseline): wrong_period, weak_conclusion. Notes: A covers FY, quarterly, TTM, AMD's Q2 FY25 charge, prices, and quote discrepancies, but lacks source links and wrongly states NVDA's operating margin is "about 46 points higher" under its FY/quarterly table where the actual gap is 50.4 points FY (60.2% vs 9.8%) and 50.5 points latest quarter (64.9% vs 14.4%). B cites every FY figure cleanly, but skips the fiscal-calendar mismatch and refers to "close" YTD share returns without showing any price figures.
- **single-latest-quarter**: A (baseline): weak_conclusion; B (candidate): unsupported_figure, invented_figure. Notes: A links every FY2026 and Q4 FY2026 figure to sources and states cash-flow/EPS/consensus gaps, but omits QoQ direction and segment mix. B provides QoQ/YoY tables, sequential-slowdown analysis, segments, and quote checks without source links, but wrongly claims operating income grew "about 1.3x as fast as revenue year over year" (actual YoY ratio is 67.7%/57.9% = 1.17x; 1.33x is the QoQ ratio).
- **peer-three**: A (candidate): unsupported_figure, invented_figure, weak_conclusion; B (baseline): wrong_subject, wrong_period, weak_conclusion. Notes: A covers all three companies across FY and latest quarter with calendar caveats, but lacks source links and gives two wrong figures: AAPL gross margin "in the mid-40s to mid-50s" (actual data is 46.2%-47.2% across all periods; FY25 46.9%, Q3 FY26 47.1%) and NVDA FY2026 revenue "about 5x" AMD FY2025 (actual 209,911/34,669 = 6.1x). B cites NVDA and AAPL cleanly, but omits AMD completely and does not flag the 5-month period mismatch.
- **what-changed-gross-margin**: A (baseline): wrong_period, weak_conclusion; B (candidate): unsupported_figure. Notes: Both honestly report that the data does not explain NVDA's Q1 FY2026 gross margin drop to 60.5%; A links every figure to sources but mislabels Q1 FY2026 as "the latest quarter" and omits the Q2 recovery. B shows the prior-quarter trend and Q2 FY2026 recovery to 72.4% while warning not to conflate AMD's 8-K, lacking only source links.
- **segment-drill-down**: A (candidate): unsupported_figure; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: A gives the exact Q4 FY2026 segment split (Data Center $55,200M / 88.9%) and states historical segment data is unavailable, lacking only source links. B fails to retrieve the seeded segments and returns only FY2026 consolidated revenue without addressing segments.

Scores digest: `c72d63398a96599d950512691d8301621b097c9f52858089e3bd8c9f00c0b186`.
