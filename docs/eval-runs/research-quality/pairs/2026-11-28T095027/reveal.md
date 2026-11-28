# Blinded comparison 2026-11-28T095027: baseline 2026-11-28T091335 vs candidate 2026-11-28T092215

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T091335 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-28T092215 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 1734837465.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| peer-two | baseline | candidate | no |
| missing-segments | baseline | candidate | no |
| single-latest-quarter | candidate | baseline | no |
| peer-three | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | no |
| segment-drill-down | candidate | baseline | no |
| fiscal-year-trap | candidate | baseline | no |
| follow-up-memory | baseline | candidate | no |
| missing-cash-flow | candidate | baseline | no |
| margin-trend-loss-quarter | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 24/24 | 24/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 17/20 | 20/20 | +3 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 14/20 | -6 over 10 pairs | — (no pairs) |
| conclusions_justified | 13/20 | 18/20 | +5 over 10 pairs | — (no pairs) |
| counterarguments | 9/20 | 19/20 | +10 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 23/24 | +2 over 12 pairs | — (no pairs) |
| decision_useful | 5/20 | 9/20 | +4 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| peer-two | 0 | +1 | 0 | 0 | +1 | 0 | 0 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| peer-three | 0 | +1 | 0 | 0 | +2 | 0 | 0 |
| cause-in-evidence | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| ticker-page-compare | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| segment-drill-down | 0 | 0 | 0 | +1 | +1 | +1 | 0 |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| margin-trend-loss-quarter | 0 | 0 | -1 | 0 | +1 | 0 | 0 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 5 | 2 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 2 | 0 |
| operational_failure | 1 | 0 |

## Labels and notes per question

- **peer-two**: A (baseline): none; B (candidate): none. Notes: B quantifies the gaps, states the Jan vs Dec fiscal-year mismatch and lists the cash-flow and 10-K gaps; A gives ranking lines and never calls out the period mismatch.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: A shows only total revenue and never says segment data is unavailable; B says it plainly and invents no split.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: A analyses the cost structure (correct but uncited derived figures) and gives a specific cash-conversion counterpoint; B restates the engine figures with one generic caveat. Neither gives the QoQ direction.
- **peer-three**: A (candidate): none; B (baseline): missing_counterpoint. Notes: A (latest quarters) computes the margin gaps correctly and flags the five-month NVDA period lag; B (fiscal years) lists periods without calling out the mismatch and has no counterpoint. Neither notes AAPL's different industry.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): weak_conclusion. Notes: Both say the cause is not in the data and miss AMD's filed MI308 export-control attribution. B adds correct opex arithmetic and a cited net-income counterpoint.
- **what-changed-gross-margin**: A (candidate): none; B (baseline): weak_conclusion. Notes: A quantifies the 12.5-point QoQ and 17.8-point YoY drops and says the cause isn't on file; B never states the margin figures in its commentary, though it also says the cause isn't shown. Neither shows the recovery.
- **ticker-page-compare**: A (baseline): none; B (candidate): none. Notes: Both are sound and state the Sep vs Jan year-ends. B adds the gap sizes, both YTD returns and a dollar-profit counterpoint, but neither names a trigger that would change the view.
- **segment-drill-down**: A (candidate): weak_conclusion; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: Neither gives the Data Center segment breakdown the expectation says exists. A at least states the gap; B returns only total revenue with no comment.
- **fiscal-year-trap**: A (candidate): none; B (baseline): none. Notes: Both state the fiscal-year mismatch. A sizes the gap (3.2x, uncited $285.7B) and explains which NVDA year would align; B only ranks the two.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): none. Notes: On 'explain the differences', A only re-ranks; B quantifies the margin gaps, flags AMD's net-above-operating oddity and the period offset. B's derived 2.64-point gap is uncited.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: A says plainly that FCF can't be computed and why; B shows only the engine gap lines, with 'commentary unavailable'.
- **margin-trend-loss-quarter**: A (baseline): none; B (candidate): none. Notes: Both have only two of eight quarters and say so, so neither shows the Q2 FY2025 loss. B's counterpoint (could be a dip within a longer decline) is more specific; its 0.17-point delta is uncited.

Scores digest: `ef45a02633d2fad7e31adaba81cf4b5aafe77210bdfb63639d581a10c02ae39e`.
