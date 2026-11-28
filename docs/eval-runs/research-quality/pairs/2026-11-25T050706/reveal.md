# Blinded comparison 2026-11-25T050706: baseline 2026-11-25T015316 vs candidate 2026-11-25T043106

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T015316 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T043106 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 683706805.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| peer-two | baseline | candidate | yes |
| missing-segments | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | yes |
| cause-in-evidence | baseline | candidate | yes |
| what-changed-gross-margin | baseline | candidate | yes |
| missing-cash-flow | baseline | candidate | no |
| single-latest-quarter | candidate | baseline | yes |
| segment-drill-down | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | yes |
| follow-up-memory | candidate | baseline | yes |
| fiscal-year-trap | baseline | candidate | yes |
| peer-three | candidate | baseline | yes |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | 0 over 3 pairs | +2 over 9 pairs |
| comparable_periods | 15/20 | 19/20 | +1 over 1 pair | +3 over 9 pairs |
| figures_match_sources | 20/20 | 9/20 | -1 over 1 pair | -10 over 9 pairs |
| conclusions_justified | 12/20 | 19/20 | +2 over 1 pair | +5 over 9 pairs |
| counterarguments | 13/20 | 18/20 | +1 over 1 pair | +4 over 9 pairs |
| no_invented_numbers | 22/24 | 21/24 | +2 over 3 pairs | -3 over 9 pairs |
| decision_useful | 5/20 | 15/20 | +1 over 1 pair | +9 over 9 pairs |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-segments | 0 | — | — | — | — | +1 | — |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| segment-drill-down | 0 | +1 | -1 | +2 | +1 | +1 | +1 |

## Confounded pairs (not attributed to the change)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| peer-two | 0 | +1 | -2 | +2 | +2 | -2 | +2 |
| ticker-page-compare | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| what-changed-gross-margin | 0 | 0 | -1 | 0 | 0 | 0 | 0 |
| single-latest-quarter | 0 | 0 | -1 | 0 | 0 | 0 | 0 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +1 | +1 | 0 | +1 |
| follow-up-memory | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| peer-three | +2 | 0 | -1 | 0 | 0 | -1 | +1 |

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-haiku-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-haiku-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 3 | 1 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 1 |
| weak_conclusion | 5 | 1 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 1 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **peer-two**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure, invented_figure. Notes: A cites all FY and YTD price figures cleanly, but hits its model-call limit with zero synthesis, no counterarguments, and no mention of the fiscal-year mismatch. B delivers rich fundamental, segment, charge, price, and quote-mismatch analysis without source links, but wrongly claims NVDA's margins "slipped about 2 points at the gross level in FY2026" when the data shows a 4.2-point drop from 75.0% to 70.8% (operating margin fell 2.2 points).
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A plainly states AMD segment revenue is absent, reports all consolidated totals accurately, and clarifies the Q2 FY2025 $800M MI308 charge is not segment revenue. B invents nothing but returns only FY2025 consolidated revenue and a no-10-K note without stating that segment data is missing.
- **ticker-page-compare**: A (baseline): wrong_period; B (candidate): wrong_period, unsupported_figure. Notes: Neither answer explicitly calls out the Sep-vs-Jan fiscal-calendar mismatch despite naming the dates. A links every FY metric to sources and contrasts NVDA's margins with AAPL's larger operating income, while B lacks source links but adds quarterly growth, exact AAPL TTM sums, dividend exclusion, price bars, and quote-feed discrepancies.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): unsupported_figure. Notes: B directly attributes Q2 FY2025's -$134M operating loss to AMD's ~$800M MI308 export-control charge and rigorously decomposes the -$940M QoQ swing into gross-profit compression and an unexplained +$264M implied opex increase, lacking only source links and the filing date. A cites Q2 figures cleanly but misses the filed explanation and claims the evidence does not say why.
- **what-changed-gross-margin**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both accurately quantify NVDA's Q1 FY2026 gross margin drop to 60.5% and honestly state the cause is not in the data, though both omit the Q2 FY2026 recovery to 72.4%. A edges ahead on source links and avoids mislabeling the period, while B adds FY2025 margin context and warns against conflating AMD's MI308 charge without linking figures to sources.
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Both honestly report that AMD free cash flow data is unavailable and invent no figures. B adds helpful context explaining why net income ($4,174M FY2025; $1,480M Q2 FY2026) cannot substitute for cash flow.
- **single-latest-quarter**: A (candidate): unsupported_figure; B (baseline): none. Notes: A covers QoQ/YoY income-statement metrics, FY2026 margin progression, Q4 segment mix (88.9% Data Center), and quote-vs-bar discrepancies, but provides no source links and slightly garbles "Q1 step-up". B links every FY2026, Q4 FY2026, and YTD price figure to sources and flags the January staleness against August pricing, though it omits QoQ direction and segment mix.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): unsupported_figure. Notes: B reports the exact Q4 FY2026 segment breakdown (Data Center $55,200M / 88.9%) and states that prior-period and full-year segment data are unavailable, lacking only source links. A fails to retrieve the seeded segments and returns only FY2026 consolidated revenue without mentioning segments.
- **margin-trend-loss-quarter**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion. Notes: A shows all eight quarters Q3 FY2024-Q2 FY2026 accurately in order, cites AMD's Q2 FY2025 8-K for the ~$800M MI308 charge with an ~8.7% ex-charge check, and flags missing opex detail, lacking only source links. B hits its read limit after retrieving only FY2025 and Q3-Q4 FY2025, missing six of the eight quarters including the loss quarter.
- **follow-up-memory**: A (candidate): unsupported_figure; B (baseline): none. Notes: Both maintain NVDA and AMD across all three turns with accurate YTD returns and calendar caveats; A lacks source links but delivers a far deeper Turn 3 evidence breakdown (growth, quarterly margins, scale, segments, price) and explicitly corrects two minor Turn 2 misstatements. B links every figure cleanly and flags AMD's NI-above-OI quirk and fiscal-year offset, but omits growth, quarterly trends, and actionable gaps.
- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both catch the Jan-vs-Sep FY2025 calendar mismatch; A links both figures to sources, while B lacks source links but quantifies the 3.2x ratio, $285.7B gap, four-month overlap, and NVDA FY2026 ($209,911M) cross-check.
- **peer-three**: A (candidate): unsupported_figure, weak_conclusion, unstated_gap; B (baseline): wrong_subject, weak_conclusion. Notes: A covers all three companies across FY, prior FY, and latest quarter with NVDA recency and AMD charge caveats, but lacks source links, leaves valuation/segment gaps unstated, and garbles AAPL's operating margin as "mid-to-high-30s to low-30s" (actual 30.0%-34.5%). B cites NVDA and AAPL cleanly and notes the different quarters, but omits AMD completely.

Scores digest: `be1835955a950bc08a951a102ad7e7b26201ac387028a150254ab0194cf37857`.
