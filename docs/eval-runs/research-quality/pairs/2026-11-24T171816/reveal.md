# Blinded comparison 2026-11-24T171816: baseline 2026-11-24T170920 vs candidate 2026-11-24T171327

**Incomplete review:** 100 applicable cells were left unscored, so totals and deltas cover the scored cells only.

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-11-24T170920 | yes | `97520ee7ef0f` | `f0500d6c4a81` | `bf84b34e9c65` | `a28c268f8c6c` |
| candidate | 2026-11-24T171327 | yes | `f0500d6c4a81` | `f0500d6c4a81` | `bf84b34e9c65` | `a28c268f8c6c` |

Seed: 1614539951.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| missing-cash-flow | candidate | baseline | no |
| standout-annual | candidate | baseline | no |
| history-analysis | baseline | candidate | no |
| segment-drill-down | baseline | candidate | no |
| peer-three | candidate | baseline | no |
| missing-segments | candidate | baseline | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| fiscal-year-trap | candidate | baseline | no |
| peer-two | baseline | candidate | no |
| follow-up-memory | candidate | baseline | no |
| ticker-page-compare | candidate | baseline | no |
| single-latest-quarter | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |
| what-changed-gross-margin | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 0/0 | 0/0 | — (no pairs) | — (no pairs) |
| comparable_periods | 0/0 | 0/0 | — (no pairs) | — (no pairs) |
| figures_match_sources | 0/0 | 0/0 | — (no pairs) | — (no pairs) |
| conclusions_justified | 13/24 | 19/24 | +6 over 12 pairs | — (no pairs) |
| counterarguments | 11/24 | 14/24 | +3 over 12 pairs | — (no pairs) |
| no_invented_numbers | 25/28 | 25/28 | 0 over 14 pairs | — (no pairs) |
| decision_useful | 0/0 | 0/0 | — (no pairs) | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers | decision_useful |
|---|---|---|---|---|---|---|---|
| missing-cash-flow | — | — | — | — | — | 0 | — |
| standout-annual | — | — | — | +1 | +1 | 0 | — |
| history-analysis | — | — | — | +1 | +1 | 0 | — |
| segment-drill-down | — | — | — | 0 | 0 | 0 | — |
| peer-three | — | — | — | +1 | -2 | 0 | — |
| missing-segments | — | — | — | — | — | 0 | — |
| margin-trend-loss-quarter | — | — | — | +1 | 0 | 0 | — |
| fiscal-year-trap | — | — | — | 0 | 0 | 0 | — |
| peer-two | — | — | — | 0 | +2 | 0 | — |
| follow-up-memory | — | — | — | 0 | 0 | 0 | — |
| ticker-page-compare | — | — | — | +1 | 0 | 0 | — |
| single-latest-quarter | — | — | — | +1 | +1 | 0 | — |
| cause-in-evidence | — | — | — | 0 | 0 | 0 | — |
| what-changed-gross-margin | — | — | — | 0 | 0 | 0 | — |

## Confounded pairs (not attributed to the change)

None.

## Not compared

None: both arms answered every planned question.

## Unscored cells

- missing-cash-flow A correct_companies
- missing-cash-flow B correct_companies
- standout-annual A correct_companies
- standout-annual A comparable_periods
- standout-annual A figures_match_sources
- standout-annual A decision_useful
- standout-annual B correct_companies
- standout-annual B comparable_periods
- standout-annual B figures_match_sources
- standout-annual B decision_useful
- history-analysis A correct_companies
- history-analysis A comparable_periods
- history-analysis A figures_match_sources
- history-analysis A decision_useful
- history-analysis B correct_companies
- history-analysis B comparable_periods
- history-analysis B figures_match_sources
- history-analysis B decision_useful
- segment-drill-down A correct_companies
- segment-drill-down A comparable_periods
- segment-drill-down A figures_match_sources
- segment-drill-down A decision_useful
- segment-drill-down B correct_companies
- segment-drill-down B comparable_periods
- segment-drill-down B figures_match_sources
- segment-drill-down B decision_useful
- peer-three A correct_companies
- peer-three A comparable_periods
- peer-three A figures_match_sources
- peer-three A decision_useful
- peer-three B correct_companies
- peer-three B comparable_periods
- peer-three B figures_match_sources
- peer-three B decision_useful
- missing-segments A correct_companies
- missing-segments B correct_companies
- margin-trend-loss-quarter A correct_companies
- margin-trend-loss-quarter A comparable_periods
- margin-trend-loss-quarter A figures_match_sources
- margin-trend-loss-quarter A decision_useful
- margin-trend-loss-quarter B correct_companies
- margin-trend-loss-quarter B comparable_periods
- margin-trend-loss-quarter B figures_match_sources
- margin-trend-loss-quarter B decision_useful
- fiscal-year-trap A correct_companies
- fiscal-year-trap A comparable_periods
- fiscal-year-trap A figures_match_sources
- fiscal-year-trap A decision_useful
- fiscal-year-trap B correct_companies
- fiscal-year-trap B comparable_periods
- fiscal-year-trap B figures_match_sources
- fiscal-year-trap B decision_useful
- peer-two A correct_companies
- peer-two A comparable_periods
- peer-two A figures_match_sources
- peer-two A decision_useful
- peer-two B correct_companies
- peer-two B comparable_periods
- peer-two B figures_match_sources
- peer-two B decision_useful
- follow-up-memory A correct_companies
- follow-up-memory A comparable_periods
- follow-up-memory A figures_match_sources
- follow-up-memory A decision_useful
- follow-up-memory B correct_companies
- follow-up-memory B comparable_periods
- follow-up-memory B figures_match_sources
- follow-up-memory B decision_useful
- ticker-page-compare A correct_companies
- ticker-page-compare A comparable_periods
- ticker-page-compare A figures_match_sources
- ticker-page-compare A decision_useful
- ticker-page-compare B correct_companies
- ticker-page-compare B comparable_periods
- ticker-page-compare B figures_match_sources
- ticker-page-compare B decision_useful
- single-latest-quarter A correct_companies
- single-latest-quarter A comparable_periods
- single-latest-quarter A figures_match_sources
- single-latest-quarter A decision_useful
- single-latest-quarter B correct_companies
- single-latest-quarter B comparable_periods
- single-latest-quarter B figures_match_sources
- single-latest-quarter B decision_useful
- cause-in-evidence A correct_companies
- cause-in-evidence A comparable_periods
- cause-in-evidence A figures_match_sources
- cause-in-evidence A decision_useful
- cause-in-evidence B correct_companies
- cause-in-evidence B comparable_periods
- cause-in-evidence B figures_match_sources
- cause-in-evidence B decision_useful
- what-changed-gross-margin A correct_companies
- what-changed-gross-margin A comparable_periods
- what-changed-gross-margin A figures_match_sources
- what-changed-gross-margin A decision_useful
- what-changed-gross-margin B correct_companies
- what-changed-gross-margin B comparable_periods
- what-changed-gross-margin B figures_match_sources
- what-changed-gross-margin B decision_useful

## Turns

| question | turn | baseline | candidate |
|---|---|---|---|
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| standout-annual | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| history-analysis | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| peer-three | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| missing-segments | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| single-latest-quarter | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
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
| weak_conclusion | 0 | 0 |
| missing_counterpoint | 0 | 0 |
| unstated_gap | 0 | 0 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **missing-cash-flow**: A (candidate): none; B (baseline): none. Notes: Both engine gaps.
- **standout-annual**: A (candidate): none; B (baseline): none. Notes: A: cash conversion lowest of 10 years, tempered by FCF. B: FY2025 vs FY2026 figures, no conclusion drawn.
- **history-analysis**: A (baseline): none; B (candidate): none. Notes: A: FY2023-26 trends, no conclusion. B: cash conversion lowest of 10 years, op margin peak elsewhere.
- **segment-drill-down**: A (baseline): none; B (candidate): none. Notes: Both show only total revenue; seeded segments not shown, gap unstated.
- **peer-three**: A (candidate): none; B (baseline): none. Notes: A: full ranking, no counterpoint. B: NVDA not computed (call limit), quarters, AMD gross-margin counterpoint.
- **missing-segments**: A (candidate): none; B (baseline): none. Notes: Both show AMD total revenue without saying segments are unavailable.
- **margin-trend-loss-quarter**: A (candidate): none; B (baseline): none. Notes: A: two quarters, loss not shown. B: no figures.
- **fiscal-year-trap**: A (candidate): none; B (baseline): none. Notes: Both state the year-end mismatch.
- **peer-two**: A (baseline): none; B (candidate): none. Notes: A one-sided. B: period caveat and AMD net-above-operating counterpoint.
- **follow-up-memory**: A (candidate): none; B (baseline): none. Notes: Both turn 3 one-sided rankings, price-only caveats earlier.
- **ticker-page-compare**: A (candidate): none; B (baseline): none. Notes: A: AAPL revenue base as counterpoint. B: net income only, thin, counterpoint on profit base.
- **single-latest-quarter**: A (candidate): none; B (baseline): none. Notes: A: cash conversion weakest year cuts against. B: three figures, data-gap caveat.
- **cause-in-evidence**: A (candidate): none; B (baseline): none. Notes: Both miss AMD's filed cause; net income offsets operating loss.
- **what-changed-gross-margin**: A (candidate): none; B (baseline): none. Notes: Neither states margin levels in prose; no counterpoint.

Scores digest: `df05da3c6287b0718d0aab5a1e2e2d1c595e035fb2f017097b44214f09c2b799`.
