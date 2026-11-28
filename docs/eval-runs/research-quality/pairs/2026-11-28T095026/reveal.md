# Blinded comparison 2026-11-28T095026: baseline 2026-11-28T090115 vs candidate 2026-11-28T090113

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T090115 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-28T090113 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 1733745936.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| single-latest-quarter | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| peer-two | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |
| peer-three | baseline | candidate | no |
| missing-segments | candidate | baseline | no |
| follow-up-memory | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 24/24 | 24/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 15/20 | 20/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 18/20 | -2 over 10 pairs | — (no pairs) |
| conclusions_justified | 12/20 | 18/20 | +6 over 10 pairs | — (no pairs) |
| counterarguments | 10/20 | 19/20 | +9 over 10 pairs | — (no pairs) |
| no_invented_numbers | 20/24 | 24/24 | +4 over 12 pairs | — (no pairs) |
| decision_useful | 6/20 | 9/20 | +3 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| single-latest-quarter | 0 | 0 | -1 | 0 | +1 | +1 | 0 |
| cause-in-evidence | 0 | 0 | 0 | 0 | 0 | 0 | +1 |
| margin-trend-loss-quarter | 0 | +1 | 0 | +1 | +1 | +1 | +1 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| peer-two | 0 | +1 | 0 | 0 | +1 | 0 | 0 |
| fiscal-year-trap | 0 | 0 | 0 | +1 | +1 | 0 | +1 |
| ticker-page-compare | 0 | +1 | 0 | +1 | +2 | 0 | 0 |
| what-changed-gross-margin | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| peer-three | 0 | +1 | 0 | +1 | +1 | 0 | 0 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| segment-drill-down | 0 | 0 | 0 | +1 | +1 | +1 | 0 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 7 | 2 |
| missing_counterpoint | 3 | 0 |
| unstated_gap | 4 | 0 |
| operational_failure | 3 | 0 |

## Labels and notes per question

- **single-latest-quarter**: A (candidate): none; B (baseline): unstated_gap. Notes: A ties margins to cost structure and states plainly that there is no cash flow or prior-quarter comparison; two derived dollar gaps are uncited. B restates the figures, adds the YTD price, and does not flag that the quarter-over-quarter direction is missing.
- **cause-in-evidence**: A (candidate): weak_conclusion; B (baseline): weak_conclusion. Notes: Neither surfaces AMD's own filed attribution (MI308 export-control charges); both stop at the tautology that costs exceeded gross profit. A shows the arithmetic and the net-income counterpoint more fully; B is thinner.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): weak_conclusion, unstated_gap. Notes: Both have only two of the eight quarters and miss the Q2 FY2025 loss quarter. A says plainly it cannot describe an eight-quarter trend; B presents a two-quarter rise without saying six quarters are missing.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both show the cash flow gaps and invent nothing. A explains why free cash flow cannot be computed; B gives no commentary at all.
- **peer-two**: A (baseline): missing_counterpoint; B (candidate): none. Notes: A is a ranking list that ignores the price-return block and has no real counterpoint. B states the one-month fiscal offset, quantifies gaps, contrasts the small return gap with the fundamental gap, and lists the gaps; its 'already priced in' remark goes past the data.
- **fiscal-year-trap**: A (candidate): none; B (baseline): weak_conclusion. Notes: Both state the fiscal-year mismatch. A quantifies it (eight months), sizes the gap and uses timing as the counterpoint; B only ranks the two numbers.
- **ticker-page-compare**: A (baseline): weak_conclusion, missing_counterpoint; B (candidate): none. Notes: A lists rankings without calling out the Sep vs Jan fiscal mismatch and mentions YTD returns without giving them. B states the four-month offset, gives returns and margin gaps, and offers a grounded counterpoint on operating-income dollars.
- **what-changed-gross-margin**: A (candidate): none; B (baseline): none. Notes: Both show the drop to 60.52% and say the cause is not in the data. A quantifies YoY and sequential moves (gross profit fell $2.0B on higher revenue); B lists the same figures with less analysis.
- **peer-three**: A (baseline): weak_conclusion; B (candidate): none. Notes: A uses fiscal years but does not call out the mismatched year ends and rests on an unverified scale view. B uses latest quarters, states the five-month offset as its counterpoint, and works the gross-to-operating gaps; neither notes AAPL's different industry.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap, operational_failure. Notes: A says plainly segment data is unavailable and gives only total revenue. B shows the total with no commentary and never says the segment split is missing.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): none. Notes: Both keep NVDA and AMD across turns. A's last turn only ranks figures; B's explains the differences, states the fiscal offset and the AMD below-the-line counterpoint, but its last-turn figures are uncited (values all match the blocks).
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap, operational_failure; B (candidate): weak_conclusion. Notes: Neither gives the segment split the expectation says is in evidence. A shows only total revenue with no commentary; B at least says the split is unavailable and that concentration could be hidden.

Scores digest: `7ae421dcc2c2b53a9208abe8747f33d920b4085943a644f4fdac28dcbce4ee53`.
