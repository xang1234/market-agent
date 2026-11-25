# Blinded comparison 2026-11-25T020210: baseline 2026-11-25T014331 vs candidate 2026-11-25T013902

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T014331 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T013902 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 3567899577.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| what-changed-gross-margin | candidate | baseline | no |
| single-latest-quarter | baseline | candidate | no |
| segment-drill-down | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | no |
| ticker-page-compare | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| peer-two | candidate | baseline | no |
| follow-up-memory | baseline | candidate | no |
| missing-segments | baseline | candidate | no |
| missing-cash-flow | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| peer-three | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 13/20 | 20/20 | +7 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 10/20 | 19/20 | +9 over 10 pairs | — (no pairs) |
| counterarguments | 9/20 | 19/20 | +10 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 24/24 | +3 over 12 pairs | — (no pairs) |
| decision_useful | 5/20 | 19/20 | +14 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| what-changed-gross-margin | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| single-latest-quarter | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| segment-drill-down | 0 | +1 | -1 | +2 | +1 | +1 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | +1 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | 0 | +2 |
| peer-two | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | +1 | +1 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| peer-three | +2 | +1 | -1 | +1 | +1 | 0 | +2 |

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
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 6 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 0 |
| weak_conclusion | 7 | 1 |
| missing_counterpoint | 5 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **what-changed-gross-margin**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint. Notes: A traces the 12.5-point Q1 FY2026 drop, subsequent Q2-Q4 recovery to 74.4%, and missing cause cleanly, though its figures lack source citations. B links its figures to sources but stops at a model-call limit, omits the Q2-Q4 recovery, and mislabels Q1 FY2026 as the latest quarter.
- **single-latest-quarter**: A (baseline): weak_conclusion; B (candidate): unsupported_figure, weak_conclusion. Notes: B delivers QoQ/YoY growth, 88.9% Data Center concentration, staleness and quote-mismatch caveats, though it lacks source links and inaccurately calls Q4 FY2026 margins record-high (Q1 FY2025 had higher gross, operating, and net margins). A cites its figures cleanly but omits QoQ/YoY direction and segment mix.
- **segment-drill-down**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap. Notes: A breaks down all five Q4 FY2026 segments accurately, highlights 88.9% Data Center concentration, and notes the single-quarter coverage limit, without source links. B fails to retrieve the segment table on file and returns only FY2026 consolidated revenue.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): unsupported_figure. Notes: B correctly cites AMD's dated 8-K Exhibit 99.1 attribution of ~$800M MI308 export-control charges, quantifies the gross-profit drop and Q3 rebound, and caveats its illustrative add-back, though statement figures lack citations. A links its figures but misses the filed 8-K in evidence and claims the data does not say why.
- **ticker-page-compare**: A (baseline): wrong_period; B (candidate): unsupported_figure. Notes: B aligns periods via TTM, explicitly flags the Sep-vs-Jan fiscal-year mismatch and NVDA's 5-month staleness, and adds growth, concentration, and quote caveats, though without source links. A links all figures and notes AAPL's larger operating profit pool, but compares FY2025 AAPL with FY2026 NVDA without calling out the fiscal-calendar mismatch.
- **margin-trend-loss-quarter**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint. Notes: A lays out all eight quarters Q3 FY2024-Q2 FY2026, explains Q2 FY2025's -$134M loss via AMD's filing while showing an $800M add-back still sits below trend, without source citations. B hits its read limit after returning only FY2025 and unavailable Q1-Q2 FY2024 periods, missing the entire eight-quarter series.
- **peer-two**: A (candidate): unsupported_figure; B (baseline): none. Notes: A provides fuller decision context—growth rates, latest quarters, TTM, NVDA's 89% Data Center mix, AMD's MI308 base distortion, and price/quote caveats—without source links. B links all figures and calls out the fiscal-year mismatch and missing cash flow, but omits growth rates, quarterly momentum, and price return values in prose.
- **follow-up-memory**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): unsupported_figure. Notes: B maintains context cleanly and backs Turn 3 with margin, growth, calendar-aligned sequential, recency, and price-artifact evidence, though without source links. A cites every figure accurately across all three turns, but Turn 3 never calls out the fiscal-year mismatch, omits 2026 NVDA staleness/valuation gaps, and offers only a narrow OI-vs-NI comment.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B states plainly that AMD segment data is not on file and distinguishes the MI308 8-K charge from segment revenue. A invents nothing but returns consolidated FY2025 revenue and a no-10-K note without actually stating that segment revenue is unavailable.
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Both answers avoid inventing numbers and clearly state that AMD's cash flow inputs and free cash flow are unavailable, with B adding consolidated income-statement context while explicitly noting it cannot substitute for FCF.
- **fiscal-year-trap**: A (candidate): unsupported_figure; B (baseline): none. Notes: Both answers catch the fiscal-year mismatch; A quantifies the 8-month offset and adds NVDA FY2026 (~2x gap vs 3.2x) and growth context without source links, whereas B cites both FY2025 figures cleanly with a brief calendar-offset note.
- **peer-three**: A (baseline): wrong_subject, wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B covers all three companies on TTM, latest-quarter, and full-year growth with margin trends and data caveats, lacking source citations. A hits its model-call limit, omits AMD completely, and compares a single NVDA quarter (Q4 FY2026) against a full AAPL fiscal year (FY2025).

Scores digest: `933ea51463aaf3247ab9439edd0f30f803360b34b225896c037251c741802b1a`.
