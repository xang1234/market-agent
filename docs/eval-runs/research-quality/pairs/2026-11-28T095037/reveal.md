# Blinded comparison 2026-11-28T095037: baseline 2026-11-28T090115 vs candidate 2026-11-25T011555

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T090115 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T011555 | yes | `0fbc2ef668f7` | `0fbc2ef668f7` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2275815136.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| missing-cash-flow | candidate | baseline | no |
| ticker-page-compare | candidate | baseline | no |
| missing-segments | candidate | baseline | no |
| peer-two | baseline | candidate | no |
| what-changed-gross-margin | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| follow-up-memory | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |
| segment-drill-down | candidate | baseline | no |
| fiscal-year-trap | candidate | baseline | no |
| peer-three | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 24/24 | 24/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 16/20 | 20/20 | +4 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 13/20 | 18/20 | +5 over 10 pairs | — (no pairs) |
| counterarguments | 12/20 | 19/20 | +7 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 24/24 | +3 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 17/20 | +10 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| ticker-page-compare | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| peer-two | 0 | +1 | -1 | 0 | 0 | 0 | +1 |
| what-changed-gross-margin | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| margin-trend-loss-quarter | 0 | 0 | -1 | +1 | +1 | +1 | +2 |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| segment-drill-down | 0 | 0 | -1 | +2 | +1 | +1 | +1 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| peer-three | 0 | +1 | -1 | -1 | +1 | 0 | +1 |
| single-latest-quarter | 0 | 0 | -1 | 0 | 0 | 0 | +1 |

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
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 4 | 2 |
| missing_counterpoint | 0 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 3 | 0 |

## Labels and notes per question

- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both refuse to report a free cash flow figure. A explains why net income isn't a stand-in and gives the income-statement context; B shows only the engine's gap lines, with no commentary.
- **ticker-page-compare**: A (candidate): none; B (baseline): none. Notes: A states the fiscal-year and latest-quarter offsets, adds growth and the price data with a quote-mismatch caveat, but none of its figures link to a source. B is a cited ranking that names periods without calling out the mismatch, and was cut short at the model-call limit.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap, operational_failure. Notes: A says plainly that AMD segment data is absent and invents no split; B gives only the total, with no commentary and no statement of the gap.
- **peer-two**: A (baseline): none; B (candidate): none. Notes: B states the staggered reporting, flags AMD's year-over-year comparison as flattered by the Q2 FY2025 charge, and checks out arithmetically, but nothing links to a source. A is a cited ranking with one grounded AMD point and no period caveat. B's '20x' runs against the 'in words' expectation.
- **what-changed-gross-margin**: A (baseline): none; B (candidate): none. Notes: Both say the cause is not in the data. B adds the recovery, traces the dip to cost of revenue rather than opex, and declines to borrow AMD's explanation, but its figures are unlinked; A is a cited restatement with a gross-profit counterpoint.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): weak_conclusion, unstated_gap. Notes: A shows all eight quarters, keeps the Q2 FY2025 loss visible, gives it as AMD's attribution and labels its add-back as its own arithmetic. B covers two quarters as a 'rise' and never says the other six are missing.
- **follow-up-memory**: A (candidate): none; B (baseline): weak_conclusion. Notes: A's final turn breaks the margin gap into opex ratio and gross margin, separates explained from unexplained dips and states the period misalignment. It also corrects its own turn-2 error (11.7% should be 14.1%), and its figures are unlinked. B's final turn is a cited ranking whose AMD point is marked unverified.
- **cause-in-evidence**: A (candidate): none; B (baseline): weak_conclusion. Notes: A gives the MI308 export-control charge as AMD's own attribution, sizes it and notes what stays unexplained, though it gives no source link or filing date. B says the evidence doesn't show the driver, which is the trap.
- **segment-drill-down**: A (candidate): none; B (baseline): unstated_gap, operational_failure. Notes: A gives the Q4 FY2026 segment split that sums to revenue and notes the Data Center concentration (unlinked). B gives only the FY total, with no commentary.
- **fiscal-year-trap**: A (candidate): none; B (baseline): none. Notes: Both flag the unaligned fiscal years. A sizes the offset, adds a closer-in-time FY2026 comparison and states the missing NVDA FY2024 figure, with unlinked figures. B is a bare ranking with a generic caveat.
- **peer-three**: A (candidate): weak_conclusion; B (baseline): none. Notes: A states the period offset and the AMD base effect, but says NVDA revenue 'nearly doubled' from $44.1B to $62.1B (about +41%) and nothing links to a source. B is a cited annual ranking whose periods (Jan, Dec, Sep year ends) are named but not called mismatched. Neither notes AAPL's different industry.
- **single-latest-quarter**: A (candidate): weak_conclusion; B (baseline): weak_conclusion. Notes: A gives the quarter-over-quarter and year-over-year direction, mix and data gaps, but says most of the 380bp operating-margin gain came from gross margin when only 140bp did. B gives a cited one-period snapshot with no quarter-over-quarter direction.

Scores digest: `1272710ef5bd566ed1cb2b527666b8b49909629fd59a3bf7dc3892e241ad445c`.
