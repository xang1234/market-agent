# Blinded comparison 2026-10-27T110325: baseline 2026-10-27T090923 vs candidate 2026-10-27T091232

## Runs

| arm | run | complete | revision | runner | question set | dataset |
|---|---|---|---|---|---|---|
| baseline | 2026-10-27T090923 | yes | `a6775dcd4a1d` | `eab912452001` | `4593f805836e` | `916dda987c9d` |
| candidate | 2026-10-27T091232 | yes | `6fb050433e55` | `eab912452001` | `4593f805836e` | `916dda987c9d` |

Seed: 3854528687.

## Mapping

| question | A | B | confounded |
|---|---|---|---|
| single-latest-quarter | candidate | baseline | no |
| missing-segments | candidate | baseline | no |
| peer-two | candidate | baseline | no |
| segment-drill-down | baseline | candidate | no |
| missing-cash-flow | baseline | candidate | no |
| follow-up-memory | candidate | baseline | no |
| what-changed-gross-margin | baseline | candidate | no |
| ticker-page-compare | baseline | candidate | no |
| fiscal-year-trap | baseline | candidate | no |
| margin-trend-loss-quarter | candidate | baseline | no |
| peer-three | candidate | baseline | no |
| cause-in-evidence | candidate | baseline | no |

## Totals by criterion

Each arm's total covers that arm's own scored cells, including questions the other arm didn't answer. Deltas are
candidate minus baseline over the pairs both arms answered and scored: confounded over pairs where a turn names a
different model in each arm or an arm's model wasn't recorded, attributed over the rest.

| criterion | baseline (own scored cells) | candidate (own scored cells) | attributed delta | confounded delta |
|---|---|---|---|---|
| correct_companies | 19/24 | 20/24 | +1 over 12 pairs | — (no pairs) |
| comparable_periods | 12/20 | 11/20 | -1 over 10 pairs | — (no pairs) |
| figures_match_sources | 11/20 | 13/20 | +2 over 10 pairs | — (no pairs) |
| conclusions_justified | 10/20 | 10/20 | 0 over 10 pairs | — (no pairs) |
| counterarguments | 7/20 | 7/20 | 0 over 10 pairs | — (no pairs) |
| no_invented_numbers | 19/24 | 19/24 | 0 over 12 pairs | — (no pairs) |

## Per-question deltas (candidate minus baseline)

| question | correct_companies | comparable_periods | figures_match_sources | conclusions_justified | counterarguments | no_invented_numbers |
|---|---|---|---|---|---|---|
| single-latest-quarter | 0 | 0 | 0 | 0 | 0 | 0 |
| missing-segments | 0 | — | — | — | — | 0 |
| peer-two | 0 | -1 | 0 | 0 | -1 | -1 |
| segment-drill-down | 0 | 0 | 0 | 0 | 0 | 0 |
| missing-cash-flow | 0 | — | — | — | — | 0 |
| follow-up-memory | 0 | 0 | 0 | -1 | -1 | 0 |
| what-changed-gross-margin | 0 | 0 | 0 | 0 | 0 | 0 |
| ticker-page-compare | 0 | -1 | +1 | -1 | 0 | 0 |
| fiscal-year-trap | 0 | 0 | 0 | 0 | 0 | 0 |
| margin-trend-loss-quarter | 0 | 0 | 0 | 0 | 0 | 0 |
| peer-three | +1 | +1 | +1 | +2 | +2 | +1 |
| cause-in-evidence | 0 | 0 | 0 | 0 | 0 | 0 |

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
| missing-segments | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| peer-two | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| segment-drill-down | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| missing-cash-flow | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| follow-up-memory | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 2 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| follow-up-memory | 3 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| what-changed-gross-margin | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| ticker-page-compare | 1 | completed, `anthropic/claude-sonnet-5-5` | completed, `anthropic/claude-sonnet-5-5` |
| fiscal-year-trap | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| margin-trend-loss-quarter | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |
| peer-three | 1 | completed, none (no model wrote it) | completed, `anthropic/claude-sonnet-5-5` |
| cause-in-evidence | 1 | completed, none (no model wrote it) | completed, none (no model wrote it) |

## Failure labels

Questions carrying each label, per arm; `operational_failure` is set wherever an arm gave no answer.

| label | baseline | candidate |
|---|---|---|
| wrong_subject | 0 | 0 |
| wrong_period | 1 | 2 |
| unsupported_figure | 0 | 2 |
| invented_figure | 0 | 0 |
| weak_conclusion | 6 | 7 |
| missing_counterpoint | 4 | 3 |
| unstated_gap | 3 | 3 |
| operational_failure | 0 | 0 |

## Labels and notes per question

- **single-latest-quarter**: A (candidate): none; B (baseline): none. Notes: [buy-side] Both deliver the right Q4 FY2026 P&L and margins, reconciled to sources, with a data-grounded counterpoint that sequential growth slowed (8.94% vs 21.96%). A shows the full QoQ series; B dates the quarter (ended 2026-01-25) on every citation. Effectively a tie. [sell-side] Both are accurate and cite every figure. A labels quarters as fiscal (Q4 FY2026) and shows the 21.96% prior-quarter QoQ figure behind its slowdown counterpoint. B writes 'Q4 2026' and 'Q1 2025' with no FY prefix, and its source for Q1 2025 ends April 2024, the kind of label a reader takes for a calendar quarter. [retail] Both are accurate and cite every figure, and both give a specific counterpoint (sequential growth slowed from 21.96% to 8.94%). B is much easier for me to read: $62.1B instead of USD 62,100,000,000.00, the quarter's end date (Jan 2026) stated, and no repeated tables. A is correct but the numbers bury the point.
- **missing-segments**: A (candidate): none; B (baseline): none. Notes: [buy-side] Identical: both decline to give AMD segment figures and invent none. The refusal is framed as a capability limit rather than saying AMD segment data is absent, but nothing is fabricated. [sell-side] Same text in both. Neither invents a segment number, but neither names AMD or says the data is unavailable; both frame it as a capability limit. [retail] The two are identical. Neither invents a segment number, but both frame the gap as a calculation they can't do instead of saying plainly that AMD segment data isn't available, and neither names AMD. As an investor I come away not knowing whether the data exists.
- **peer-two**: A (candidate): wrong_period, unsupported_figure; B (baseline): none. Notes: [buy-side] A compares mismatched latest quarters, then prints margin differences against AMD Q4 FY2025, which it never shows (74.40-54.02 is 20.38, not 20.42), and it omits price performance without saying so. B gives the latest fiscal years with end dates, states the calendar mismatch, adds price returns, and offers a dated, cited bear point on AMD's ~$800M MI308 charge. B is position-ready; A doesn't reconcile. [sell-side] A compares NVDA Q4 FY2026 with AMD Q2 FY2026, then prints margin gaps against an AMD Q4 FY2025 it never shows (20.42pp, not the 20.38pp its own table gives), and it has no price performance. B uses fiscal years, states the Jan versus Dec year ends, and grounds its counterpoint in AMD's dated MI308 charge. B's price returns (6.6%/3.58%) cite only 'price series' and don't match the 5.81%/3.17% YTD figures in Q6. [retail] B compares full fiscal years with end dates, says the periods don't line up, adds price performance, and offers a concrete counterpoint (AMD's ~$800M export-control charge may depress its margins). A compares unaligned quarters, and its pp-difference lines are labelled against AMD Q4 FY2025, which isn't shown, so they don't match the table (e.g. 74.40-54.02 is 20.38, not 20.42). A also has no price data. B's price window ('Dec 2025 to Aug 2026') is vague, so I can't verify those returns.
- **segment-drill-down**: A (baseline): weak_conclusion; B (candidate): weak_conclusion. Notes: [buy-side] Identical non-answers: both refuse NVDA's segment breakdown even though the Data Center segment ($55.2B) is in evidence. That implies the data is out of reach when it isn't. Neither is usable. [sell-side] Same refusal in both, though NVDA segment facts exist (Data Center $55.2B). That is a non-answer, and it misstates why the data can't be shown. [retail] The two are identical refusals, even though NVDA segment data exists. Nothing in either is usable: no Data Center figure and no note on how concentrated revenue is. Both suggest the request can't be met instead of answering it.
- **missing-cash-flow**: A (baseline): none; B (candidate): none. Notes: [buy-side] Both state plainly that OCF and capex are missing, so FCF is blocked, and neither substitutes net income. B also says it defaulted to the latest fiscal year, which is marginally clearer. Tie. [sell-side] Both state the OCF, capex and FCF gaps plainly and don't pass net income off as FCF. B adds that it defaulted to the latest fiscal year, a small plus for period clarity. [retail] Both state honestly that operating cash flow and capex are missing, so free cash flow can't be computed, and neither passes off net income as FCF. B also says it defaulted to the latest fiscal year, which helps a little. Labels like 'missing_input' and 'blocked_by_dependency' read as system jargon to a retail reader.
- **follow-up-memory**: A (candidate): weak_conclusion; B (baseline): none. Notes: [buy-side] Both keep NVDA, add AMD and use an exact YTD window (Dec 2025 close to Aug 2026 close). A's final turn explains the differences with price returns and one AMD quote only, so the 'differences' answer is thin. B brings annual fundamentals for both, states the fiscal-year mismatch, and notes that the stock-return lead is far narrower than the fundamental lead: a real, data-grounded counterpoint. [sell-side] A's last two turns show only YTD price returns and the AMD quote, with no fundamentals for either company, so 'explain the differences' gets a thin answer. B carries fiscal-year fundamentals for both, states the Jan/Dec fiscal-year mismatch, and gives specific counterpoints: the AMD export charge, and a return lead narrower than the fundamental lead. [retail] Both keep NVDA, add AMD, and use the correct YTD window (5.81% vs 3.17%). For 'explain the differences and show the evidence', A only repeats the price returns and the AMD quote. B lays out the fundamentals for both with fiscal-year end dates and states the mismatch. It also makes a useful point: the stock-return lead is far narrower than the fundamental lead. B is the one I could act on. A rightly says the 2025 export charge doesn't explain the 2026 return.
- **what-changed-gross-margin**: A (baseline): weak_conclusion, missing_counterpoint, unstated_gap; B (candidate): weak_conclusion, missing_counterpoint, unstated_gap. Notes: [buy-side] Both ask a clarifying question instead of answering. The obvious QoQ drop to ~60.5% from ~73% is never shown, and neither says the cause is not in the data. Identical value: none. [sell-side] Both ask a clarifying question where the prior-quarter comparison is the obvious default, so neither reports the Q1 FY2026 margin drop to ~60.5%. The periods they offer are correctly labelled. [retail] Both answer with a clarifying question that is close to word-for-word the same. The question was clear enough to default to the prior quarter, so I get no margin figures, no mention of the drop to ~60.5%, and no note that the cause isn't in the data.
- **ticker-page-compare**: A (baseline): none; B (candidate): weak_conclusion. Notes: [buy-side] A keeps AAPL primary, uses fiscal years with end dates, and states the 4-month calendar offset. B ranks margins across quarters about 5 months apart after saying the margin comparison is 'not covered', and garbles it as 'Apple's lead over NVIDIA'. That self-contradiction erodes trust. Neither offers a real bear point. [sell-side] A keeps AAPL as primary and uses fiscal years, saying they end 4 months apart (Sep vs Jan), which is correct; its price returns cite only 'price series'. B sets AAPL Q3 FY2026 (ends about June 2026) against NVDA Q4 FY2026 (ends Jan 2026) under matching 'FY2026' labels. Its 'not covered' line about 'Apple's lead in each margin' is garbled, and it compares margins anyway. [retail] A is the one I'd want: full fiscal years with end dates, the 4-month offset stated, price returns, and a grounded counterpoint (the share-price gains were similar despite NVDA's stronger fundamentals). Its price window is vague, though. B is a wall of unaligned quarterly numbers with no price data, and its 'Not covered: Apple Inc.'s lead ... in each margin' line is garbled, since Apple leads on no margin.
- **fiscal-year-trap**: A (baseline): weak_conclusion, missing_counterpoint; B (candidate): weak_conclusion, missing_counterpoint. Notes: [buy-side] Identical: correct FY2025 revenues, and both refuse to rank them because the periods differ, which avoids the trap. But neither gives the end dates (Jan vs Sep 2025) or any interpretation. [sell-side] Identical. The revenues are right and nothing is ranked, but the mismatch shows up only as a gap code. Neither gives the end dates (Jan 2025 vs Sep 2025, eight months apart), so a reader still sees two columns both headed 'FY2025'. [retail] The two are identical. Both show both FY2025 revenues and decline to rank them because the periods differ, which is honest. But they put both under one 'FY2025' column and never say the years end 8 months apart (Jan vs Sep). A retail reader wouldn't understand the 'cohort members cover different periods' note.
- **margin-trend-loss-quarter**: A (candidate): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap; B (baseline): wrong_period, weak_conclusion, missing_counterpoint, unstated_gap. Notes: [buy-side] Identical raw series labelled only 'N quarters before latest', with no fiscal quarter names or dates, so it can't be tied to a calendar. The -1.74% loss quarter is visible but not discussed, and AMD's filed MI308 explanation goes uncited. [sell-side] Identical. The -1.74% quarter isn't hidden, but every quarter is labelled only as 'n before latest', with no fiscal quarter names, and there is no trend commentary or reference to AMD's filed explanation. [retail] The two are identical bare lists using 'fiscal quarter N before latest' instead of named quarters, so I can't tell which quarter lost money. They don't hide the -1.74% quarter, but there is no trend description and no mention of AMD's filed explanation. Not usable without more work.
- **peer-three**: A (candidate): unsupported_figure; B (baseline): weak_conclusion, missing_counterpoint. Notes: [buy-side] A covers all three companies and flags that the quarters are misaligned. But its 'difference' lines reference AMD Q4 FY2025 and AAPL Q1 FY2026, which aren't shown and don't reconcile (operating margin gap vs AAPL listed as 30.44pp; the table implies 34.21pp), and it ignores AAPL's different industry. B only asks which margin to use, when the user already said 'margins'. [sell-side] A covers all three with named quarters and says the misaligned quarters could shift the gaps. It repeats the margin-difference lines against periods it doesn't show (AMD Q4 FY2025, AAPL Q1 FY2026), and it never notes that AAPL is in a different industry. B asks which margin to use even though the question says 'margins', so it is a non-answer. [retail] A covers all three companies with sourced quarterly figures and a clear caveat that the quarters aren't aligned. Its pp-difference lines are labelled against AMD Q4 FY2025 and Apple Q1 FY2026, which aren't shown, and they don't match the table (operating gap to AAPL is listed as 30.44 pp; the table gives 34.21 pp). B only asks which margin I mean, which is a needless clarification since I said 'margins'. Neither notes that Apple is in a different industry.
- **cause-in-evidence**: A (candidate): weak_conclusion, unstated_gap; B (baseline): weak_conclusion, unstated_gap. Notes: [buy-side] Both fall into the 'cause unknown' trap: AMD's attributed ~$800M MI308 export-control charge is in evidence but is reported as not covered. Both also label a 12.58pp margin swing as '-12.58%'. B is slightly more useful because it shows the -$134M operating loss and $7.685B revenue behind the margin. [sell-side] Both say the cause is 'not covered', though AMD's filed MI308 export-control charge (~$800M) is in evidence, and both label a -12.58 point margin move as '%'. B at least shows the -$134M operating loss and $7,685M revenue, so it is marginally better. [retail] Both show the margin swing (10.84% to -1.74%) and then say the cause isn't covered, even though AMD's own export-control explanation (~$800M charges) is in evidence, so neither answers the 'why'. B is slightly better because it adds the -$134M operating loss on $7.685B revenue, which makes the size of the loss concrete. Both label a percentage-point change as '%'.

Scores digest: `e0929cfd6842ef4bc0fb81f1ff8d245898fbb41b5598e33221fc9fb64be7bb8c`.
