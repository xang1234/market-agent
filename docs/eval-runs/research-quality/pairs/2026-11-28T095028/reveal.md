# Blinded comparison 2026-11-28T095028: baseline 2026-11-28T092215 vs candidate 2026-11-28T092744

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T092215 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-28T092744 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2900746139.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| cause-in-evidence | candidate | baseline | no |
| ticker-page-compare | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| follow-up-memory | baseline | candidate | no |
| peer-three | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| peer-two | baseline | candidate | no |
| missing-cash-flow | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| missing-segments | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 23/24 | 24/24 | +1 over 12 pairs | — (no pairs) |
| comparable_periods | 17/20 | 19/20 | +2 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 15/20 | -5 over 10 pairs | — (no pairs) |
| conclusions_justified | 13/20 | 18/20 | +5 over 10 pairs | — (no pairs) |
| counterarguments | 11/20 | 19/20 | +8 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 24/24 | +3 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 9/20 | +2 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| cause-in-evidence | 0 | 0 | 0 | 0 | +1 | 0 | 0 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | 0 |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | 0 | 0 |
| follow-up-memory | +1 | 0 | 0 | +1 | 0 | 0 | 0 |
| peer-three | 0 | 0 | 0 | 0 | +1 | 0 | 0 |
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| peer-two | 0 | +1 | 0 | 0 | +1 | 0 | 0 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | 0 | 0 | 0 |
| segment-drill-down | 0 | 0 | 0 | +1 | +1 | +1 | 0 |
| margin-trend-loss-quarter | 0 | 0 | -1 | +1 | +2 | +1 | +1 |
| missing-segments | 0 | — | — | — | — | +1 | — |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 0 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 4 | 1 |
| missing_counterpoint | 1 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 3 | 0 |

## Labels and notes per question

- **cause-in-evidence**: A (candidate): weak_conclusion; B (baseline): weak_conclusion. Notes: Neither cites AMD's own MI308 export-control charge explanation; both say the cause is not in hand. A at least sizes the cost base (opex ~42% vs ~40% gross margin) and grounds the net-income counterpoint; B only restates the figures.
- **ticker-page-compare**: A (candidate): none; B (baseline): none. Notes: A states the four-month fiscal-year offset and the missing cash-flow data, and adds the price-return context; B names each period but never calls out the mismatch. A has a couple of unlinked derived figures.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion. Notes: Neither gives the quarter-over-quarter direction the question implies. A breaks down the cost steps and grounds its counterpoint in the missing cash data; B restates figures and its counterpoint is flagged as unverified.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): none. Notes: On the final turn A cites only AMD's two figures and leans on an unverified NVDA view; B lays out scale, margins and returns for both and explains why operating margin is the cleaner comparison. Neither notes the one-month fiscal-year offset.
- **peer-three**: A (baseline): none; B (candidate): none. Notes: Same table; B quantifies the gaps and makes the five-month period offset a concrete counterpoint, while A only mentions it in passing. Neither flags AAPL's different industry.
- **fiscal-year-trap**: A (candidate): none; B (baseline): none. Notes: Both flag the unaligned fiscal years; A quantifies it (about eight months) and the scale gap and notes no growth or margin is available. B is a bare ranking with a generic caveat.
- **peer-two**: A (baseline): none; B (candidate): none. Notes: B states the one-month fiscal-year offset, the profit dollars, the missing cash flow and a grounded AMD net-vs-operating counterpoint; A is a ranking list whose AMD point is marked unverified. B's 6x ratio runs against the 'in words' expectation but is correct.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both refuse to invent a number. A explains the missing inputs for both periods; B has no commentary, only the engine's gap lines.
- **what-changed-gross-margin**: A (baseline): none; B (candidate): none. Notes: B states the margin drop and sizes it sequentially and year over year, including the sequential fall in gross profit on higher revenue; A cites only gross profit dollars and leaves the margins in the block. Both say the cause isn't shown. B's derived percentages are unlinked.
- **segment-drill-down**: A (baseline): unstated_gap, operational_failure; B (candidate): none. Notes: Neither produces the segment split the expectation says is in evidence. A gives no commentary at all; B at least says the breakdown isn't available and why that limits a mix view.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): weak_conclusion, missing_counterpoint, unstated_gap. Notes: A says it can't cover eight quarters and correctly infers that earlier FY2025 quarters ran below the 9.78% full-year margin, which points at the weak patch. B shows two FY2026 quarters as 'rising' without saying six quarters, and the loss quarter, are missing.
- **missing-segments**: A (baseline): unstated_gap, operational_failure; B (candidate): none. Notes: B states plainly that the segment split is unavailable and invents nothing; A gives only the total, with no commentary and no statement of the gap.

Scores digest: `065767985681d878169d45f4eee743ba38755c3f7024c7e0ed5cde2da8b619d6`.
