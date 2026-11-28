# Blinded comparison 2026-11-28T095041: baseline 2026-11-28T093231 vs candidate 2026-11-25T035542

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-28T093231 | yes | `b0ee9f28c009` | `b0ee9f28c009` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T035542 | yes | `defab76cc1f2` | `defab76cc1f2` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 2033317482.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| missing-segments | baseline | candidate | no |
| single-latest-quarter | candidate | baseline | no |
| margin-trend-loss-quarter | baseline | candidate | no |
| follow-up-memory | baseline | candidate | no |
| ticker-page-compare | baseline | candidate | no |
| cause-in-evidence | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| segment-drill-down | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |
| fiscal-year-trap | baseline | candidate | no |
| peer-three | candidate | baseline | no |
| peer-two | baseline | candidate | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 24/24 | 24/24 | 0 over 12 pairs | — (no pairs) |
| comparable_periods | 14/20 | 19/20 | +5 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 10/20 | 19/20 | +9 over 10 pairs | — (no pairs) |
| counterarguments | 10/20 | 19/20 | +9 over 10 pairs | — (no pairs) |
| no_invented_numbers | 20/24 | 24/24 | +4 over 12 pairs | — (no pairs) |
| decision_useful | 6/20 | 18/20 | +12 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-segments | 0 | — | — | — | — | +1 | — |
| single-latest-quarter | 0 | 0 | -1 | +1 | +1 | +1 | +1 |
| margin-trend-loss-quarter | 0 | +2 | -1 | +2 | +2 | +1 | +2 |
| follow-up-memory | 0 | +1 | -1 | +1 | +1 | 0 | +1 |
| ticker-page-compare | 0 | 0 | -1 | 0 | +1 | 0 | 0 |
| cause-in-evidence | 0 | 0 | -1 | +1 | 0 | 0 | +2 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| segment-drill-down | 0 | 0 | -1 | +2 | +1 | +1 | +1 |
| what-changed-gross-margin | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| fiscal-year-trap | 0 | 0 | -1 | +1 | +1 | 0 | +2 |
| peer-three | 0 | +1 | -1 | +1 | +1 | 0 | +1 |
| peer-two | 0 | +1 | -1 | 0 | +1 | 0 | +1 |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

None.

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 1 | 0 |
| unsupported_figure | 0 | 0 |
| invented_figure | 0 | 0 |
| weak_conclusion | 8 | 1 |
| missing_counterpoint | 2 | 0 |
| unstated_gap | 4 | 0 |
| operational_failure | 4 | 0 |

## Labels and notes per question

- **missing-segments**: A (baseline): unstated_gap, operational_failure; B (candidate): none. Notes: A shows only total revenue with no commentary and never says the segment split is missing. B says plainly no AMD segment data is on file, invents no segment figures, and adds consolidated history plus the filed MI308 charge as context.
- **single-latest-quarter**: A (candidate): none; B (baseline): weak_conclusion, unstated_gap. Notes: A gives QoQ and YoY for every line, the segment mix, the sequential slowdown from +22.0% to +8.9%, and a clear list of gaps; its figures are internally consistent but uncited. B cites three figures, makes an unverified pricing-power claim, and omits the quarter-over-quarter direction without saying so.
- **margin-trend-loss-quarter**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap, operational_failure; B (candidate): none. Notes: A returns an annual margin and gaps for the wrong quarters (Q1/Q2 FY2024) with no commentary. B lays out all eight quarters in order (they sum to the FY2025 totals), shows the Q2 FY2025 loss, attributes the MI308 charge to AMD's filing, and tests that the charge does not fully explain the dip (~8.7% ex-charge); figures are uncited.
- **follow-up-memory**: A (baseline): weak_conclusion; B (candidate): none. Notes: Both keep NVDA and AMD and use the right YTD window. A's last turn ranks figures without explaining them or the fiscal offset; B decomposes the margin gap into gross margin vs expense intensity, adjusts for AMD's filed charge, states the time offset and what the evidence does not establish. B's figures check out arithmetically but are uncited.
- **ticker-page-compare**: A (baseline): weak_conclusion; B (candidate): weak_conclusion. Notes: A ranks cited margins without calling out the Sep vs Jan fiscal mismatch and adds a speculative AAPL view. B is richer (growth, latest quarters, seasonality, matched price moves) but says NVDA revenue is 'still accelerating' when sequential growth slowed, and puts the quarter offset at seven months when it is about five.
- **cause-in-evidence**: A (candidate): none; B (baseline): weak_conclusion. Notes: A gives AMD's filed attribution (8-K Ex. 99.1, 2025-08-05) with quotes, sizes how much the $800M charge explains, flags the $264M opex rise and the booking assumption, and shows the recovery. B says the evidence does not show the driver, which is the trap when the cause is in evidence.
- **missing-cash-flow**: A (candidate): none; B (baseline): operational_failure. Notes: Both state there is no cash flow data and invent nothing. A explains why net income is not a stand-in and offers trailing income figures as clearly labelled context; B gives no commentary.
- **segment-drill-down**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap, operational_failure; B (candidate): none. Notes: A shows only total revenue with no commentary. B gives the Q4 FY2026 segment table that sums to total revenue, calls out ~89% Data Center concentration and states that segment history is missing.
- **what-changed-gross-margin**: A (candidate): none; B (baseline): none. Notes: Both report the drop to ~60.5% and say the cause is not in the data. A also shows the rebound to 72.4% the next quarter (a one-quarter event) and warns against reading AMD's charge across; B shows no recovery and is thinner.
- **fiscal-year-trap**: A (baseline): weak_conclusion; B (candidate): none. Notes: Both state the mismatch. A only ranks the two figures; B quantifies the eight-month offset, adds the better-aligned NVDA FY2026 comparison (~2.0x) and growth rates, and notes AAPL FY2026 is incomplete; its figures are uncited.
- **peer-three**: A (candidate): none; B (baseline): weak_conclusion. Notes: A states every fiscal offset, adds growth, prior-year margins and latest quarters, and flags AMD's Q2 FY2025 charge as flattering comparisons; its 'AMD has the lowest margins' line ignores AMD's higher gross margin than AAPL. B ranks cited figures without calling out the offsets. Neither notes AAPL's different industry.
- **peer-two**: A (baseline): none; B (candidate): none. Notes: A ranks cited margins and returns but does not call out the fiscal offset or develop a counterpoint. B adds growth, latest quarters, the AMD charge distortion, the NVDA data age and a gaps list; its figures are uncited and its price move is from 2025-12-01, not YTD.

Scores digest: `2e0c7d16f50465d7b02c262348309da919e9db207e5249c2c2ccccf2fed636f9`.
