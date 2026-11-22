# Blinded comparison 2026-11-22T013611: baseline 2026-11-22T011233 vs candidate 2026-11-22T012904

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-22T011233 | yes | `30e0be7c87bc` | `30e0be7c87bc` | `2a1d31d1c787` | `8fe68201b0a9` |
| candidate | 2026-11-22T012904 | yes | `14bd0ee68b02` | `14bd0ee68b02` | `2a1d31d1c787` | `8fe68201b0a9` |

Seed: 825956786.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| fiscal-year-trap | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | no |
| single-latest-quarter | baseline | candidate | no |
| peer-two | baseline | candidate | no |
| ticker-page-compare | baseline | candidate | no |
| missing-cash-flow | baseline | candidate | no |
| follow-up-memory | candidate | baseline | no |
| peer-three | candidate | baseline | no |
| segment-drill-down | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| missing-segments | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 24/24 | 24/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 13/20 | 14/20 | +1 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 20/20 | 0 over 10 pairs | — (no pairs) |
| conclusions_justified | 15/20 | 13/20 | -2 over 10 pairs | — (no pairs) |
| counterarguments | 11/20 | 14/20 | +3 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 21/24 | 0 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 6/20 | -1 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| fiscal-year-trap | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cause-in-evidence | 0 | +1 | 0 | 0 | 0 | 0 | 0 |
| single-latest-quarter | 0 | 0 | 0 | 0 | +1 | 0 | 0 |
| peer-two | 0 | 0 | 0 | -1 | -2 | 0 | -1 |
| ticker-page-compare | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| follow-up-memory | 0 | 0 | 0 | -1 | 0 | 0 | -1 |
| peer-three | 0 | 0 | 0 | +1 | +2 | 0 | +1 |
| segment-drill-down | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| what-changed-gross-margin | 0 | 0 | 0 | -1 | 0 | 0 | -1 |
| margin-trend-loss-quarter | 0 | 0 | 0 | 0 | +2 | 0 | +1 |
| missing-segments | 0 | — | — | — | — | 0 | — |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 1 | 1 |
| missing_counterpoint | 4 | 3 |
| unstated_gap | 3 | 3 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **cause-in-evidence**: A (baseline): none; B (candidate): none. Notes: Neither cites AMD's filed export-control charge; both say the cause is not shown. B compares Q1 with Q2.
- **peer-two**: A (baseline): none; B (candidate): missing_counterpoint.
- **follow-up-memory**: A (candidate): missing_counterpoint; B (baseline): missing_counterpoint. Notes: Scored on turn 3. A's turn 3 is figures only.
- **peer-three**: A (candidate): none; B (baseline): missing_counterpoint.
- **segment-drill-down**: A (candidate): weak_conclusion, missing_counterpoint, unstated_gap; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: Both show only total revenue, with no segment figures and no gap stated.
- **margin-trend-loss-quarter**: A (candidate): unstated_gap; B (baseline): missing_counterpoint, unstated_gap. Notes: Both show four of eight quarters and miss the Q2 FY2025 loss. A writes a second, untyped counter-inference and also the 'nothing cuts against' note, which is wrong.
- **missing-segments**: A (candidate): unstated_gap; B (baseline): unstated_gap.

Scores digest: `c65b58b736e4bbb684a523c17ec004b363b7ab5314daca9b44a731828855596f`.
