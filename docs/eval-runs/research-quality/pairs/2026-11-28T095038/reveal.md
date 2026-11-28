# Blinded comparison 2026-11-28T095038: baseline 2026-11-28T091335 vs candidate 2026-11-25T013902

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T091335 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T013902 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2082205782.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| ticker-page-compare | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| missing-segments | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| peer-three | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| peer-two | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| follow-up-memory | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| cause-in-evidence | baseline | candidate | no |
| what-changed-gross-margin | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 21/24 | 23/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 15/20 | 20/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 9/20 | 19/20 | +10 over 10 pairs | — (no pairs) |
| counterarguments | 12/20 | 19/20 | +7 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 24/24 | +3 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 12/20 | +5 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| ticker-page-compare | 0 | 0 | -1 | +1 | 0 | 0 | 0 |
| margin-trend-loss-quarter | +1 | +1 | -1 | +1 | +1 | 0 | +1 |
| missing-segments | +1 | — | — | — | — | +1 | — |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| peer-three | 0 | +1 | -1 | +1 | +2 | 0 | 0 |
| segment-drill-down | +1 | +1 | -1 | +2 | +1 | +1 | +1 |
| peer-two | 0 | +1 | -1 | +1 | 0 | 0 | 0 |
| single-latest-quarter | 0 | 0 | -1 | 0 | +1 | +1 | +1 |
| follow-up-memory | -1 | +1 | -1 | +1 | 0 | 0 | 0 |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | 0 | 0 | 0 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 4 | 0 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 1 | 0 |

## Labels and notes per question

- **ticker-page-compare**: A (candidate): none; B (baseline): none. Notes: A puts AAPL first, uses trailing four quarters to handle the calendars, and adds growth, NVDA concentration and stale-data and quote caveats. Its figures check out but none are linked. B is cited rankings with a scale counterpoint and a brief period note.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): none. Notes: A gives all eight quarters in order, shows the -$134M loss and attributes it to AMD's MI308 filing. Its add-back (8.7%) shows the charge doesn't explain the whole dip. Its figures are uncited. B covers only two of the eight quarters, and says so.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A says AMD segments aren't on file and invents none. B returns total revenue without saying segments are missing.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both leave FCF unavailable without substituting net income. A explains why and refuses to back into a number; B's commentary is unavailable.
- **peer-three**: A (baseline): missing_counterpoint; B (candidate): none. Notes: A ranks mismatched fiscal years without flagging it. B uses trailing four quarters, adds growth and trend context and notes AMD's MI308 base effect. Its ratios check out but are unlinked. Neither notes AAPL's different industry.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): none. Notes: B gives the expected Q4 FY2026 split (Data Center $55.2B, 88.9%), which sums to $62.1B, notes the concentration and states the data limits. A returns only total revenue.
- **peer-two**: A (candidate): none; B (baseline): none. Notes: A sets the fiscal years side by side with growth, latest quarters, the MI308 base effect, the recency gap and price action. Its figures are unlinked, and its line about the base effect flattering FY2025 is muddled. B is cited rankings with an AMD net-vs-operating caveat, and doesn't call out the period mismatch.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion, unstated_gap. Notes: A gives QoQ and YoY with margins, mix and caveats, and the arithmetic checks out. Its claim of 'record-high margins on file' is wrong for gross margin (Q1 FY2025 was 78.4%). B restates the figures, gives no QoQ direction, and was cut off at the model-call limit.
- **follow-up-memory**: A (baseline): none; B (candidate): none. Notes: Both keep NVDA and AMD and give the right YTD returns. B's final turn compares latest quarters with the recency gap stated, sequential growth roughly aligned to the calendar, and a volume-data artifact flag. It is unlinked and brings AAPL into turn 1. A's final turn is cited rankings with an AMD net-vs-operating caveat.
- **fiscal-year-trap**: A (candidate): none; B (baseline): weak_conclusion. Notes: Both state the fiscal mismatch. A sizes the gap, offers a closer-in-time FY2026 comparison and names the missing FY2024 figure; B only ranks.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): none. Notes: B gives AMD's own attribution (MI308 export controls, about $800M), cited to the 8-K exhibit and dated, and shows the hit landed in gross profit with an add-back marked illustrative. A falls into the trap of calling the cause unknown.
- **what-changed-gross-margin**: A (baseline): none; B (candidate): none. Notes: B shows the drop and the recovery over six quarters, the cost-of-revenue jump and the operating margin effect, and it rightly declines to borrow AMD's cause. A gives two quarters of dollars and says the cause isn't shown.

Scores digest: `286b9598e4bfd23473031577b634c99c6d2ba9b96f7b05138a3b18e85126dc7b`.
