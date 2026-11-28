# Blinded comparison 2026-11-28T095030: baseline 2026-11-28T093231 vs candidate 2026-11-28T093742

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T093231 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-28T093742 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2558644281.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| follow-up-memory | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| peer-two | candidate | baseline | no |
| margin-trend-loss-quarter | baseline | candidate | no |
| cause-in-evidence | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| peer-three | baseline | candidate | no |
| fiscal-year-trap | candidate | baseline | no |
| missing-segments | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| ticker-page-compare | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 21/24 | 22/24 | +1 over 12 pairs | — (no pairs) |
| comparable_periods | 13/20 | 18/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 15/20 | -5 over 10 pairs | — (no pairs) |
| conclusions_justified | 9/20 | 17/20 | +8 over 10 pairs | — (no pairs) |
| counterarguments | 10/20 | 18/20 | +8 over 10 pairs | — (no pairs) |
| no_invented_numbers | 20/24 | 24/24 | +4 over 12 pairs | — (no pairs) |
| decision_useful | 7/20 | 10/20 | +3 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| follow-up-memory | 0 | +1 | -1 | +1 | 0 | 0 | 0 |
| segment-drill-down | 0 | 0 | 0 | +1 | +1 | +1 | +1 |
| peer-two | 0 | +1 | 0 | +1 | 0 | 0 | 0 |
| margin-trend-loss-quarter | 0 | +1 | 0 | +1 | +1 | +1 | +1 |
| cause-in-evidence | 0 | 0 | -1 | 0 | +1 | 0 | 0 |
| single-latest-quarter | 0 | 0 | 0 | +1 | +1 | +1 | 0 |
| peer-three | 0 | +1 | 0 | +1 | +2 | 0 | 0 |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +1 |
| missing-segments | +1 | — | — | — | — | +1 | — |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| ticker-page-compare | 0 | +1 | -1 | +1 | +1 | 0 | 0 |
| what-changed-gross-margin | 0 | 0 | -1 | 0 | 0 | 0 | 0 |

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
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
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
| weak_conclusion | 6 | 2 |
| missing_counterpoint | 3 | 0 |
| unstated_gap | 4 | 0 |
| operational_failure | 1 | 0 |

## Labels and notes per question

- **follow-up-memory**: A (baseline): none; B (candidate): none. Notes: Both keep NVDA, add AMD and chart YTD. B's last turn states the one-month year-end gap, sizes scale vs profit (6.0x revenue, 37x operating income) and notes the market hasn't rewarded the fundamentals gap; A only lists rankings. B has a few uncited derived gaps and a visible strike-through correction.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): weak_conclusion. Notes: Neither gives the Q4 FY2026 segment split the expectation says is in evidence. A returns only total revenue with no comment; B at least says segments are unavailable and that the total can't show concentration.
- **peer-two**: A (candidate): none; B (baseline): none. Notes: A states the fiscal-year gap, the cash-flow gaps and that the market isn't pricing the profit gap as a return gap. B is a ranking list that names periods but doesn't call out the mismatch. A uses a 6.0x ratio where the expectation asked for words.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): none. Notes: Neither has the eight quarters or the Q2 FY2025 loss. A silently returns an annual figure and two FY2024 gaps with no comment; B says plainly that the data can't support a trend.
- **cause-in-evidence**: A (candidate): weak_conclusion; B (baseline): weak_conclusion. Notes: Both fall into the trap of saying the cause isn't in evidence, when AMD's MI308 attribution is. A does more with the figures: gross margin about 40%, implied opex about $3.2B (uncited), and positive net income as a counterpoint. B is a thin version of the same.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion, unstated_gap. Notes: Neither gives the QoQ direction. A says no prior period is on file, breaks down the cost structure, and flags the stale quarter and missing cash flow. B gives three figures plus an unsupported 'operating leverage' claim.
- **peer-three**: A (baseline): missing_counterpoint; B (candidate): none. Notes: A ranks annual figures across mismatched fiscal years without flagging it and has no counterpoint. B uses latest quarters, states the five-month staleness of NVDA's quarter and checks every ratio. Neither notes AAPL's different industry.
- **fiscal-year-trap**: A (candidate): none; B (baseline): weak_conclusion. Notes: Both state the eight-month fiscal mismatch. A sizes the gap (3.2x, 31%, one uncited $285.7B) and explains the effect; B only ranks.
- **missing-segments**: A (candidate): none; B (baseline): unstated_gap. Notes: A says the segment split is unavailable and invents nothing. B returns total revenue without saying segments are missing.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both show the FCF gaps without substituting net income. A explains them; B's commentary is unavailable.
- **ticker-page-compare**: A (candidate): none; B (baseline): weak_conclusion. Notes: A states the four-month calendar gap and sets the near-equal net income against AAPL's larger operating income. Four of its derived gaps are uncited. B ranks margins, doesn't call out the mismatch, and adds an unsupported AAPL 'revenue stream' view.
- **what-changed-gross-margin**: A (baseline): none; B (candidate): none. Notes: Both show the drop, say the cause isn't in the data, and note gross profit still rose YoY. B also quantifies the growth rates and point changes (two uncited); A is terser.

Scores digest: `d4b08233038dd41c7106dedaa42af5bf531f789d3bfdfa9390fa598ee4a8622f`.
