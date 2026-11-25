# Blinded comparison 2026-11-25T050702: baseline 2026-11-25T015316 vs candidate 2026-11-25T041338

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T015316 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T041338 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 4014993636.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| missing-cash-flow | baseline | candidate | no |
| missing-segments | baseline | candidate | no |
| follow-up-memory | baseline | candidate | no |
| single-latest-quarter | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | no |
| peer-three | baseline | candidate | no |
| peer-two | baseline | candidate | no |
| segment-drill-down | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 16/20 | 20/20 | +4 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 9/20 | 20/20 | +11 over 10 pairs | — (no pairs) |
| counterarguments | 13/20 | 20/20 | +7 over 10 pairs | — (no pairs) |
| no_invented_numbers | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| decision_useful | 4/20 | 19/20 | +15 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| missing-segments | 0 | — | — | — | — | +1 | — |
| follow-up-memory | 0 | 0 | -1 | +1 | 0 | 0 | +1 |
| single-latest-quarter | 0 | 0 | -1 | +1 | 0 | 0 | +1 |
| margin-trend-loss-quarter | 0 | +1 | -1 | +1 | +1 | 0 | +2 |
| cause-in-evidence | 0 | 0 | -1 | +2 | +1 | 0 | +2 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | +1 |
| peer-three | +2 | 0 | -1 | +1 | 0 | 0 | +1 |
| peer-two | 0 | +1 | -1 | +2 | +2 | 0 | +2 |
| segment-drill-down | 0 | +1 | -1 | +2 | +2 | +1 | +2 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | 0 | 0 | +2 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 1 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 8 | 0 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Both answers clearly state that AMD's operating cash flow, capex, and free cash flow are unavailable and do not pass off net income as FCF, with B providing accurate annual, quarterly, and TTM income-statement context.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B plainly states that AMD segment revenue is missing from the data on file and lists verified consolidated revenue; A returns only consolidated FY2025 revenue ($34.7B) with a generic no-10-K note without addressing the missing segment breakdown.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): none. Notes: B aligns overlapping Q4 quarters across all three turns, decomposes the ~50-point operating margin gap into gross margin (~20 pts) and opex (~30 pts), and contrasts AMD's filed $800M charge with NVDA's unexplained Q1 dip (lacking source links and loosely calling Jan vs. Jun 'seven months older'); A links all verified figures and flags the fiscal-year mismatch and AMD's NI > OI caveat, but leaves turn 3 thin on growth and margin drivers.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: A delivers full Q4 FY2026 QoQ and YoY comparisons, margin recovery from Q1, the 88.9% Data Center concentration, and data-staleness/valuation gaps (without source links); B links Q4/FY2026 figures and YTD return to sources and flags January staleness, but omits Q3 FY2026, QoQ direction, and segment mix.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): wrong_period, weak_conclusion. Notes: A presents all eight quarters in order, highlights Q2 FY2025's -$134M operating loss with AMD's $800M MI308 attribution and notes gross margin drove most of the expansion (without source links); B links FY2025 and Q3–Q4 FY2025 margins to sources and infers earlier weakness, but hits its read limit and misses six quarters including the Q2 FY2025 loss.
- **cause-in-evidence**: A (candidate): none; B (baseline): weak_conclusion. Notes: A cites and dates AMD's Q2 FY2025 8-K Exhibit 99.1 attribution (~$800M MI308 export-control charges, ~10.4% of revenue), verifies the gross margin drop and Q3 rebound, and flags line-item assumptions; B links its Q2 numbers to sources but misses the filed explanation and claims the evidence does not say why.
- **ticker-page-compare**: A (baseline): none; B (candidate): none. Notes: B explicitly flags the fiscal-calendar mismatch and NVDA's two missing recent quarters while adding growth rates, AAPL's TTM totals and seasonality, NVDA's 89% Data Center share, and valuation gaps (without source links); A links verified annual figures and contrasts margins with AAPL's larger operating income, but never calls out the Sep/Jan fiscal-calendar mismatch.
- **peer-three**: A (baseline): wrong_subject, weak_conclusion; B (candidate): none. Notes: B compares all three companies across annual, quarterly, and TTM bases while calling out calendar staleness, NVDA's Q1 dip, AMD's $800M charge, and AAPL's seasonality (without source links or noting AAPL's different industry); A links verified single-quarter figures and notes the quarter mismatch and scale-vs-margin trade-off, but omits AMD completely.
- **peer-two**: A (baseline): weak_conclusion, missing_counterpoint; B (candidate): none. Notes: B compares annual, quarterly, TTM, and price trends while flagging reporting-date staleness, AMD's $800M base effect, NVDA's Q1 dip, and the quote/bar discrepancy (without source links); A links verified annual and YTD price figures to sources but hits its model-call limit before adding any synthesis, calendar caveat, or counterpoint.
- **segment-drill-down**: A (candidate): none; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: A gives the complete Q4 FY2026 segment breakdown showing 88.9% Data Center dominance (larger than Q2 FY2026 total company revenue) and plainly notes missing prior-period and profitability detail (without source links); B returns only consolidated FY2026 revenue ($209.9B) and misses the seeded Q4 segment data without stating the gap.
- **what-changed-gross-margin**: A (baseline): weak_conclusion; B (candidate): none. Notes: B gives the full 8-quarter gross margin series showing the 12.5-point Q1 FY2026 drop and Q2–Q4 recovery while refusing to speculate or extrapolate from AMD's filing (without source links); A links Q1/Q4/Q1 figures to sources and notes YoY gross profit dollars still grew, but stops at Q1 FY2026 and omits the recovery.
- **fiscal-year-trap**: A (baseline): none; B (candidate): none. Notes: Both flag the Sep/Jan fiscal-year mismatch, with A linking both figures to sources; B quantifies the eight-month gap and NVDA's +61% FY2026 surge to $209.9B (noting AAPL FY2025 is still ~2x NVDA FY2026), though it slips once by asserting NVDA FY2025 grew over FY2024 without FY2024 on file.

Scores digest: `d0a5b7c6978a43680ed9f184efd1de8bd8fc482a152627f42cd4ea0fa2331848`.
