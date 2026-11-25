# Blinded comparison 2026-11-25T020219: baseline 2026-11-25T015316 vs candidate 2026-11-25T015253

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-25T015316 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |
| candidate | 2026-11-25T015253 | yes | `060549c18984` | `060549c18984` | `2a1d31d1c787` | `9714d6e9321f` |

Seed: 3753058800.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| fiscal-year-trap | baseline | candidate | no |
| cause-in-evidence | baseline | candidate | no |
| segment-drill-down | candidate | baseline | no |
| follow-up-memory | candidate | baseline | no |
| ticker-page-compare | baseline | candidate | no |
| peer-three | candidate | baseline | no |
| missing-segments | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| missing-cash-flow | candidate | baseline | no |
| single-latest-quarter | baseline | candidate | no |
| peer-two | baseline | candidate | no |
| what-changed-gross-margin | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 22/24 | 24/24 | +2 over 12 pairs | — (no pairs) |
| comparable_periods | 16/20 | 20/20 | +4 over 10 pairs | — (no pairs) |
| figures_match_sources | 20/20 | 10/20 | -10 over 10 pairs | — (no pairs) |
| conclusions_justified | 10/20 | 19/20 | +9 over 10 pairs | — (no pairs) |
| counterarguments | 13/20 | 19/20 | +6 over 10 pairs | — (no pairs) |
| no_invented_numbers | 21/24 | 24/24 | +3 over 12 pairs | — (no pairs) |
| decision_useful | 6/20 | 19/20 | +13 over 10 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| fiscal-year-trap | 0 | 0 | -1 | 0 | +1 | 0 | +1 |
| cause-in-evidence | 0 | 0 | -1 | +2 | 0 | 0 | +2 |
| segment-drill-down | 0 | +1 | -1 | +2 | +1 | +1 | +1 |
| follow-up-memory | 0 | 0 | -1 | 0 | +1 | +1 | +1 |
| ticker-page-compare | 0 | +1 | -1 | 0 | 0 | 0 | +1 |
| peer-three | +2 | 0 | -1 | +1 | 0 | 0 | +2 |
| missing-segments | 0 | — | — | — | — | +1 | — |
| margin-trend-loss-quarter | 0 | +1 | -1 | +1 | 0 | 0 | +1 |
| missing-cash-flow | 0 | — | — | — | — | 0 | — |
| single-latest-quarter | 0 | 0 | -1 | 0 | 0 | 0 | +1 |
| peer-two | 0 | +1 | -1 | +2 | +2 | 0 | +2 |
| what-changed-gross-margin | 0 | 0 | -1 | +1 | +1 | 0 | +1 |

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
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| margin-trend-loss-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 1 | 0 |
| wrong_period | 4 | 0 |
| unsupported_figure | 0 | 10 |
| invented_figure | 0 | 0 |
| weak_conclusion | 7 | 1 |
| missing_counterpoint | 3 | 0 |
| unstated_gap | 3 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **fiscal-year-trap**: A (baseline): none; B (candidate): unsupported_figure. Notes: Both catch the fiscal-year mismatch; B quantifies the 4-month overlap and adds NVDA FY2026 (2.0x vs 3.2x), growth, and margin context without source links, while A cites both FY2025 figures cleanly with a brief calendar-offset warning.
- **cause-in-evidence**: A (baseline): weak_conclusion; B (candidate): unsupported_figure. Notes: B cites AMD's dated 8-K Exhibit 99.1 attribution of ~$800M MI308 export-control charges, shows gross profit drove the $940M operating swing, and caveats its illustrative add-back, lacking citations on statement figures. A links its figures and notes positive net income vs operating loss, but misses the filed 8-K and claims the evidence does not say why.
- **segment-drill-down**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap. Notes: A reports all five Q4 FY2026 segments accurately, highlights ~89% Data Center concentration, and notes no prior-period segment data exist, without source links. B fails to retrieve the Q4 segment breakdown and returns only FY2026 consolidated revenue.
- **follow-up-memory**: A (candidate): unsupported_figure; B (baseline): unstated_gap. Notes: A delivers a thorough Turn 3 decomposition (splitting the 50.4-pt operating margin gap into 20.9-pt GM and 29.6-pt cost ratio, testing the MI308 add-back, and correctly noting AMD's three quarters at 54.0% GM), though without source links. B cites all figures accurately and calls out the differing fiscal year-ends in Turn 3, but omits growth rates, NVDA's 2026 staleness, valuation gaps, and AMD's MI308 filing.
- **ticker-page-compare**: A (baseline): wrong_period; B (candidate): unsupported_figure. Notes: B explicitly flags misaligned year-ends and NVDA's 5-month staleness, adds quarterly/TTM growth, seasonality, 88.9% Data Center concentration, and quote caveats, without source links. A links all figures cleanly and notes AAPL's larger operating income pool, but never calls out the Sep-vs-Jan fiscal-calendar mismatch.
- **peer-three**: A (candidate): unsupported_figure; B (baseline): wrong_subject, weak_conclusion. Notes: A covers all three companies on FY, TTM, and latest-quarter revenue and margins with growth, MI308 distortion, seasonality, and NVDA staleness caveats, without source links. B cites its figures and flags differing quarters and AAPL's revenue scale, but omits AMD completely after hitting its model-call limit.
- **missing-segments**: A (baseline): unstated_gap; B (candidate): none. Notes: B plainly states AMD has no segment revenue on file and distinguishes the MI308 $800M charge from segment sales. A invents nothing but returns consolidated FY2025 revenue and a no-10-K note without stating that segment data is unavailable.
- **margin-trend-loss-quarter**: A (candidate): unsupported_figure; B (baseline): wrong_period, weak_conclusion. Notes: A covers all eight quarters Q3 FY2024-Q2 FY2026, attributes Q2 FY2025's -$134M loss to AMD's 8-K MI308 charges, and caveats its rough add-back and unexplained post-Q2 step-up, without source links. B cites FY2025 and Q3-Q4 FY2025 cleanly and infers weaker earlier quarters, but misses six of the eight requested quarters due to its read limit.
- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both clearly state AMD's cash flow inputs and free cash flow are unavailable without inventing figures, with A explicitly warning that income-statement earnings cannot substitute for FCF while providing exact TTM and FY2025 context.
- **single-latest-quarter**: A (baseline): weak_conclusion; B (candidate): unsupported_figure, weak_conclusion. Notes: B provides QoQ/YoY growth, margin-driver split, 88.9% Data Center mix, and quote caveats without source links, though calling 64.9% a record operating margin in the data is slightly contradicted by Q1 FY2025 (64.92% vs 64.90%). A cites all figures cleanly and flags the Jan-to-Aug staleness vs modest YTD return, but omits QoQ/YoY direction and segment mix.
- **peer-two**: A (baseline): wrong_period, weak_conclusion, missing_counterpoint; B (candidate): unsupported_figure. Notes: B compares NVDA FY2026 and AMD TTM with growth, margin trends, 88.9% Data Center mix, AMD's MI308 distortion, 5-month reporting gap, and quote caveats, without source links. A links all financial and YTD price figures cleanly, but hits its model-call limit and leaves out all analytical commentary, counterpoints, and fiscal-year mismatch warnings.
- **what-changed-gross-margin**: A (candidate): unsupported_figure; B (baseline): weak_conclusion, missing_counterpoint. Notes: A isolates the Q1 FY2026 squeeze to gross profit, confirms the Q2-Q4 recovery to 74.4%, and refuses to extrapolate AMD's filing, lacking source links. B links its figures cleanly and avoids mislabeling Q1 FY2026 as latest, but omits the Q2-Q4 recovery entirely.

Scores digest: `98309decf404dc68e427b10ead77aa7b0b9739a8b02ecdcd1846af1ac554eb37`.
