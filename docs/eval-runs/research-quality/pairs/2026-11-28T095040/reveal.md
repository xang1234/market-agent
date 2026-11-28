# Blinded comparison 2026-11-28T095040: baseline 2026-11-28T092744 vs candidate 2026-11-25T015253

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T092744 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T015253 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2199235756.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| peer-two | candidate | baseline | no |
| peer-three | baseline | candidate | no |
| segment-drill-down | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| ticker-page-compare | candidate | baseline | no |
| fiscal-year-trap | baseline | candidate | no |
| follow-up-memory | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |
| margin-trend-loss-quarter | baseline | candidate | no |
| missing-segments | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 24/24 | 24/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 15/20 | 20/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 10/20 | 20/20 | +10 over 10 pairs | — (no pairs) |
| counterarguments | 7/20 | 19/20 | +12 over 10 pairs | — (no pairs) |
| no_invented_numbers | 20/24 | 24/24 | +4 over 12 pairs | — (no pairs) |
| decision_useful | 5/20 | 19/20 | +14 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| peer-two | 0 | +1 | -1 | 0 | +1 | 0 | +1 |
| peer-three | 0 | +1 | -1 | 0 | +2 | 0 | +1 |
| segment-drill-down | 0 | 0 | -1 | +2 | +1 | +1 | +1 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| ticker-page-compare | 0 | +1 | -1 | +1 | +1 | 0 | +1 |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +2 |
| follow-up-memory | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | +2 | 0 | +2 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | +1 | +2 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| cause-in-evidence | 0 | 0 | -1 | +1 | 0 | +1 | +2 |

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
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 1 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 7 | 0 |
| missing_counterpoint | 4 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 1 | 0 |

## Labels and notes per question

- **peer-two**: A (candidate): none; B (baseline): none. Notes: A covers growth, mix, AMD's attributed MI308 charge and the recency gap, all numerically consistent but uncited; B ranks cited figures and never calls out the period mismatch.
- **peer-three**: A (baseline): missing_counterpoint; B (candidate): none. Notes: B states the fiscal calendars differ, adds TTM, growth and AMD's distorted comp quarter (uncited but consistent); A ranks cited fiscal-year figures with no counterpoint and no mismatch callout.
- **segment-drill-down**: A (candidate): none; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: A gives the full Q4 FY2026 segment table (it sums to 62,100, Data Center 88.9%) and notes what's missing; B returns only total revenue.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: A says there's no cash-flow statement and explicitly says net income is not FCF; B gives only engine gap lines, with 'commentary unavailable'.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: A gives QoQ and YoY tables, margins, segment mix and staleness caveats (every figure I checked is consistent, but uncited); B restates cited Q4 figures with no QoQ direction.
- **ticker-page-compare**: A (candidate): none; B (baseline): weak_conclusion. Notes: A puts AAPL first, states the unaligned year-ends and the recency gap, and adds growth and seasonality; B's view on similar YTD returns cites no AAPL return, and it never calls out the period mismatch.
- **fiscal-year-trap**: A (baseline): none; B (candidate): none. Notes: Both state the mismatch. B shows the overlap is only four months and that the better-aligned NVDA year moves the ratio from 3.2x to 2.0x; A only ranks.
- **follow-up-memory**: A (candidate): none; B (baseline): weak_conclusion. Notes: A splits the operating-margin gap into its gross and cost parts, quantifies AMD's charge and states the gaps. Its FY2024 AMD operating income of $401M looks inconsistent with B's Q10 quarterlies (724+871 in H2 alone). B only re-ranks cited figures.
- **what-changed-gross-margin**: A (baseline): weak_conclusion, missing_counterpoint; B (candidate): none. Notes: B shows the drop, the opex proxy and the recovery to 72.4%, and says the cause isn't on file without borrowing AMD's; A lists three cited margins and says the cause isn't shown.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): none. Notes: B gives all eight quarters, shows the -$134M loss and attributes it to AMD's 8-K; A returns an annual margin and two gap lines with no commentary.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A says plainly there's no AMD segment data and gives totals; B shows total revenue without saying segments are unavailable.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): none. Notes: B gives AMD's own attribution (8-K Ex 99.1, 2025-08-05, about $800M of MI308 charges) with consistent arithmetic; A says the data doesn't show the cause, which is the trap.

Scores digest: `3870b7ac21e056246755acb36cb549923baf761ba4211a15dcd2c08baba7fb02`.
