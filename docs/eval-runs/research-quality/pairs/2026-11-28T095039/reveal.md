# Blinded comparison 2026-11-28T095039: baseline 2026-11-28T092215 vs candidate 2026-11-25T014547

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T092215 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T014547 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 1052707412.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| missing-cash-flow | baseline | candidate | no |
| peer-two | baseline | candidate | no |
| cause-in-evidence | baseline | candidate | no |
| follow-up-memory | baseline | candidate | no |
| missing-segments | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| peer-three | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| segment-drill-down | baseline | candidate | no |
| single-latest-quarter | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 16/20 | 20/20 | +4 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 10/20 | 20/20 | +10 over 10 pairs | — (no pairs) |
| counterarguments | 10/20 | 19/20 | +9 over 10 pairs | — (no pairs) |
| no_invented_numbers | 20/24 | 24/24 | +4 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 13/20 | +6 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| peer-two | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| cause-in-evidence | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| follow-up-memory | +1 | +1 | -1 | +1 | +1 | +1 | +1 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| peer-three | 0 | 0 | -1 | +1 | +1 | 0 | 0 |
| margin-trend-loss-quarter | +1 | +1 | -1 | +1 | +2 | +1 | +1 |
| segment-drill-down | 0 | 0 | -1 | +2 | +1 | +1 | +1 |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | 0 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | 0 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | 0 | 0 | +1 |

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
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 1 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 4 | 0 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 4 | 0 |
| operational_failure | 2 | 0 |

## Labels and notes per question

- **missing-cash-flow**: A (baseline): operational_failure; B (candidate): none. Notes: A shows only the engine's gaps; its commentary is unavailable. B says plainly that there is no cash-flow statement, labels its TTM income sums (which check out) as accrual, not cash, and says what data would be needed.
- **peer-two**: A (baseline): none; B (candidate): none. Notes: B covers FY and latest-quarter growth and margins, states NVDA's five-month staleness, and grounds counterpoints in AMD's Q2 FY25 charge and net-over-operating income. Its figures are uncited (spot checks match) and it computes 5x/20x ratios. A is a cited ranking list with no stated period mismatch.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): none. Notes: B gives AMD's own attribution (the ~$800M MI308 export-control charge), dated to the 8-K Ex. 99.1 of 2025-08-05, and sizes it with labelled arithmetic that checks out. Its figures are uncited. A falls into the 'cause unknown' trap.
- **follow-up-memory**: A (baseline): weak_conclusion, unstated_gap; B (candidate): none. Notes: In A's last turn the commentary cites only AMD's operating and net income, plus unverified views. B decomposes the 50.5-point operating-margin gap into gross margin and opex, and traces the YTD price path and growth series (all checked). It states the calendar mismatch; its figures are uncited, and it claims a 54.0% AMD gross margin for four quarters when its own table shows three.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: A gives total revenue without saying segments are unavailable. B says plainly that there is no AMD segment split, offers consolidated revenue only, and correctly treats the MI308 charge as not being revenue.
- **fiscal-year-trap**: A (candidate): none; B (baseline): none. Notes: Both state the fiscal mismatch. A gives the exact fiscal dates, a calendar-closer NVDA FY2026 alternative and growth context (all correct but uncited); B is a bare cited ranking.
- **peer-three**: A (candidate): none; B (baseline): none. Notes: A shows FY, latest-quarter and TTM tables, states the calendar and staleness mismatch, and flags AMD's charge-depressed base. Its figures are uncited (TTM recomputes correctly). B ranks single quarters five months apart with only a generic caveat. Neither notes AAPL's different industry.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): wrong_period, missing_counterpoint, unstated_gap, operational_failure. Notes: A gives all eight quarters in order (every margin recomputes), shows the Q2 FY25 loss, and gives AMD's filed attribution as AMD's. B covers only two quarters, hits its model-call limit, and leaves the loss quarter out.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): none. Notes: B gives the Q4 FY2026 segment table (it sums to $62.1B) and the 88.9% Data Center concentration, and says segment data covers only one quarter. A returns only total revenue.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: A gives the QoQ and YoY direction for every line (all recompute), plus the segment mix and the quarter's seven-month staleness, with figures uncited. B restates the cited Q4 figures with no sequential direction.
- **ticker-page-compare**: A (baseline): none; B (candidate): none. Notes: Both lead with AAPL. B aligns the periods to TTM, states the five-month staleness, and adds AAPL's flattered net-income base, with uncited figures. A is cited and grounds its profit-pool counterpoint, but doesn't call out the fiscal mismatch.
- **what-changed-gross-margin**: A (candidate): none; B (baseline): none. Notes: Both say the cause is not on file. A quantifies the dip, shows the squeeze came at the gross line (opex flat) and shows the Q2 recovery to 72.4%, all of which recompute. B cites only the gross-profit dollars and wrongly calls Q1 FY26 'the latest quarter'.

Scores digest: `a599b6714580f80fea9860d8d360cf4bd95612519f4ff0578c7985187b99865a`.
