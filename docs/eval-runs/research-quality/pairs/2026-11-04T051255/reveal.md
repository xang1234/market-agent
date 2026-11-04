# Blinded comparison 2026-11-04T051255: baseline 2026-11-04T042741 vs candidate 2026-11-04T051003

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-04T042741 | yes | `1d50d7f9972c` | `1d50d7f9972c` | `4593f805836e` | `c4b7310681cc` |
| candidate | 2026-11-04T051003 | yes | `15138b39e8a2` | `15138b39e8a2` | `4593f805836e` | `c4b7310681cc` |

Seed: 724620807.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| segment-drill-down | baseline | candidate | no |
| single-latest-quarter | baseline | candidate | no |
| ticker-page-compare | candidate | baseline | no |
| peer-two | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| missing-cash-flow | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |
| peer-three | baseline | candidate | no |
| missing-segments | candidate | baseline | no |
| follow-up-memory | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 23/24 | 23/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 15/20 | 16/20 | +1 over 10 pairs | — (no pairs) |
| figures_match_sources | 16/20 | 16/20 | 0 over 10 pairs | — (no pairs) |
| conclusions_justified | 13/20 | 14/20 | +1 over 10 pairs | — (no pairs) |
| counterarguments | 9/20 | 8/20 | -1 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 21/24 | 0 over 12 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers |
|---|---|---|---|---|---|---|
| segment-drill-down | 0 | 0 | 0 | 0 | 0 | 0 |
| single-latest-quarter | 0 | 0 | 0 | 0 | -1 | 0 |
| ticker-page-compare | 0 | 0 | 0 | 0 | 0 | 0 |
| peer-two | 0 | 0 | 0 | 0 | -1 | 0 |
| fiscal-year-trap | 0 | 0 | 0 | 0 | 0 | 0 |
| missing-cash-flow | 0 | — | — | — | — | 0 |
| what-changed-gross-margin | 0 | 0 | 0 | 0 | 0 | 0 |
| peer-three | 0 | +1 | 0 | 0 | 0 | 0 |
| missing-segments | 0 | — | — | — | — | 0 |
| follow-up-memory | 0 | 0 | 0 | 0 | +1 | 0 |
| margin-trend-loss-quarter | 0 | 0 | 0 | 0 | 0 | 0 |
| cause-in-evidence | 0 | 0 | 0 | +1 | 0 | 0 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| what-changed-gross-margin | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| cause-in-evidence | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 5 | 4 |
| missing_counterpoint | 4 | 4 |
| unstated_gap | 2 | 2 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **segment-drill-down**: A (baseline): weak_conclusion, unstated_gap; B (candidate): weak_conclusion, unstated_gap. Notes: Identical refusal: segment data is seeded and expected, but the answer calls it a capability limit and shows none.
- **single-latest-quarter**: A (baseline): none; B (candidate): none. Notes: Same engine block. A closes on a specific counterpoint from the QoQ series; B only has 'uneven' inside its takeaway.
- **ticker-page-compare**: A (candidate): none; B (baseline): none. Notes: Both state the quarters differ, both counter with Apple's larger revenue base.
- **peer-two**: A (baseline): none; B (candidate): none. Notes: Same block and comparisons. A's counterpoint is grounded in AMD's growth figure; B's is the period mismatch its takeaway already said, so a caveat.
- **fiscal-year-trap**: A (candidate): weak_conclusion, missing_counterpoint; B (baseline): weak_conclusion, missing_counterpoint. Notes: Identical table with no commentary: end dates shown, the eight-month mismatch not stated.
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: Identical honest gap.
- **what-changed-gross-margin**: A (candidate): weak_conclusion, missing_counterpoint; B (baseline): weak_conclusion, missing_counterpoint. Notes: Both ask which comparison instead of answering; equivalent wording.
- **peer-three**: A (baseline): none; B (candidate): none. Notes: A never says the quarters end at different dates; B does. Each has a specific counterpoint. Neither notes Apple's different industry.
- **missing-segments**: A (candidate): unstated_gap; B (baseline): unstated_gap. Notes: Identical: no figure invented, but framed as a capability limit rather than AMD's segment data being absent.
- **follow-up-memory**: A (candidate): none; B (baseline): none. Notes: Scored on the last turn. A adds a specific counterpoint that one price window with no fundamentals does not show business differences; B only separates the charge from the window.
- **margin-trend-loss-quarter**: A (candidate): weak_conclusion, missing_counterpoint; B (baseline): weak_conclusion, missing_counterpoint. Notes: Identical table with no commentary; the loss quarter is visible, no conclusion is drawn.
- **cause-in-evidence**: A (candidate): missing_counterpoint; B (baseline): weak_conclusion, missing_counterpoint. Notes: Both quote AMD's attribution, cited and dated. A's plan also shows the gross margin drop the charge explains; B's does not.

Scores digest: `a2f9192596f64554be1581445bb56adb4abc910c04557363bcfcc9c765ded449`.
