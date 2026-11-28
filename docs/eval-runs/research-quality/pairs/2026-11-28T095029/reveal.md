# Blinded comparison 2026-11-28T095029: baseline 2026-11-28T092744 vs candidate 2026-11-28T093231

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T092744 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-28T093231 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 3270739920.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| follow-up-memory | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |
| margin-trend-loss-quarter | baseline | candidate | no |
| missing-segments | baseline | candidate | no |
| missing-cash-flow | candidate | baseline | no |
| segment-drill-down | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| peer-three | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | no |
| peer-two | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |
| fiscal-year-trap | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 23/24 | 24/24 | +1 over 12 pairs | — (no pairs) |
| comparable_periods | 15/20 | 20/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 14/20 | -6 over 10 pairs | — (no pairs) |
| conclusions_justified | 8/20 | 18/20 | +10 over 10 pairs | — (no pairs) |
| counterarguments | 7/20 | 19/20 | +12 over 10 pairs | — (no pairs) |
| no_invented_numbers | 19/24 | 23/24 | +4 over 12 pairs | — (no pairs) |
| decision_useful | 6/20 | 9/20 | +3 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| follow-up-memory | 0 | 0 | 0 | +1 | +1 | +1 | 0 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | +2 | 0 | +1 |
| margin-trend-loss-quarter | +1 | +2 | -1 | +2 | +2 | +1 | +1 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| segment-drill-down | 0 | 0 | 0 | +1 | +1 | +1 | 0 |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | +1 | 0 |
| peer-three | 0 | +1 | -1 | +1 | +2 | 0 | 0 |
| ticker-page-compare | 0 | +1 | 0 | +1 | +1 | 0 | 0 |
| peer-two | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| cause-in-evidence | 0 | 0 | 0 | 0 | 0 | -1 | 0 |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +1 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 1 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 6 | 2 |
| missing_counterpoint | 4 | 0 |
| unstated_gap | 4 | 0 |
| operational_failure | 2 | 0 |

## Labels and notes per question

- **follow-up-memory**: A (candidate): none; B (baseline): unstated_gap. Notes: A's last turn traces every margin gap to cited figures, states the ~1-month fiscal-year offset and gives a data-grounded counterpoint (AMD net income above operating income). B lists rankings with labelled-unverified views and has no gap notes in the scored turn.
- **what-changed-gross-margin**: A (baseline): weak_conclusion, missing_counterpoint; B (candidate): none. Notes: Both say the cause is not in the data. A only lists the three margins; B quantifies the 12.5-pt sequential and 17.8-pt YoY drop and the revenue-vs-gross-profit divergence, all checked correct, though several derived figures are uncited.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap, operational_failure; B (candidate): none. Notes: A returns only the FY2025 annual margin plus two gaps and no commentary. B shows the Q2 FY2025 -1.74% loss quarter and says plainly that only 3 of 8 points are on file, but it does not cite AMD's filed explanation.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: A gives total revenue without saying the segment split is unavailable. B says so plainly and invents no segment figures.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both show the engine's FCF gaps and invent nothing. A adds a clear refusal to estimate; B's commentary is unavailable.
- **segment-drill-down**: A (candidate): weak_conclusion; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: Neither surfaces the Q4 FY2026 segment facts that the expectation says are in evidence. A at least says the breakdown is unavailable and flags concentration risk; B returns only total revenue.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: Neither gives the quarter-over-quarter direction. A states that gap and grounds its cash-conversion counterpoint; its $5.9B/$4.9B derivations are right but uncited. B restates the figures with thin, generic inferences.
- **peer-three**: A (candidate): none; B (baseline): missing_counterpoint. Notes: A states the fiscal-calendar mismatch, checks AMD gross vs operating margin and AAPL's dollar earnings power (ratios correct, some uncited). B lists the periods without calling out the mismatch and offers no counterpoint. Neither notes AAPL's different industry.
- **ticker-page-compare**: A (baseline): weak_conclusion; B (candidate): none. Notes: B states the four-month fiscal offset, computes the correct margin gaps and grounds a counterpoint in AAPL's higher operating income. A ranks three metrics and leans on unverified views about price returns that its text doesn't show.
- **peer-two**: A (candidate): none; B (baseline): none. Notes: A gives a fuller, correct analysis with the fiscal-offset caveat, but it computes the scale ratios (6x/37x/27x) the expectation asked to state in words, and leaves some figures uncited. B ranks the figures cleanly but doesn't call out the period mismatch.
- **cause-in-evidence**: A (candidate): weak_conclusion; B (baseline): weak_conclusion. Notes: Both miss AMD's filed MI308 export-control attribution, which is in evidence. A states outright that no management statement is on file; B says only that the data shown lacks the driver. Both note that positive net income offset the operating loss.
- **fiscal-year-trap**: A (baseline): none; B (candidate): none. Notes: Both state the eight-month fiscal mismatch. B adds a correct 3.2x / 31% sizing and a counterpoint grounded in the timing (the $285.7B gap is uncited); A is a bare ranking.

Scores digest: `dcb4aa62db70c30e630756bf2cc7ada84bbeacf07c42728539586d253c368be2`.
