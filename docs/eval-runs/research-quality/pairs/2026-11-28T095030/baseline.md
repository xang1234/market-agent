# Research-quality eval: 2026-11-28T093231

Stack revision: `b0ee9f28c009`, clean. Runner revision: `b0ee9f28c009`. Question set: `2a1d31d1c787`. Dataset: `9714d6e9321f`.

Answered by: `anthropic/claude-sonnet-5-5` (10 turns), no model (4 turns).

Answer tokens: not reported.

Assertions: 75 accepted, 4 rejected (binding 1, comparative 2, kind 1) over 14 answered turns; 0 missing, 0 malformed, 0 with no figures; 10 rendered.

Model: `anthropic/claude-sonnet-5-5 (fallbacks: opencode-go/qwen3.8-max, opencode-go/kimi-k2.7-code)`. Data: frozen golden dataset. Score each question in `2026-11-28T093231.scores.json` (rubric below),
then run `node --experimental-strip-types scripts/research-quality-eval.ts summary`.
Bold figures are cited (linked to a fact); open the thread link for charts and sources.

## Rubric (0 / 1 / 2)

- **correct_companies**: Does the answer cover exactly the companies asked about? 0 = Wrong or missing company; 1 = Right companies, one only partly covered; 2 = Every company asked about, and only those.
- **comparable_periods**: Are the periods named and comparable (or the mismatch stated)? 0 = Periods unnamed or silently mismatched; 1 = Periods named, mismatch not called out; 2 = Periods named; any fiscal-calendar mismatch stated.
- **figures_match_sources**: Does every figure match a displayed value and its source? 0 = A figure differs from its source; 1 = Figures right but some lack a link to source; 2 = Every figure matches and links to its source.
- **conclusions_justified**: Do the conclusions follow from the figures shown? 0 = Conclusion contradicts or ignores the data; 1 = Plausible but thinly supported; 2 = Each conclusion traced to shown figures.
- **counterarguments**: Does it note what cuts the other way or what could change the view? 0 = One-sided; 1 = A caveat, but generic; 2 = A specific counterpoint grounded in the data.
- **no_invented_numbers**: Is missing data stated honestly, with no invented numbers? 0 = A number not in the data, or one misrepresented (e.g. net income passed off as free cash flow); 1 = No invented numbers, but a data gap left unstated or glossed over; 2 = Gaps stated plainly; every number is from the data.
- **decision_useful**: Could a portfolio manager act on this, and does it say what would change the answer? 0 = Figures only; the reader must work out why they matter; 1 = Says why it matters, but generically (e.g. "worth watching"); 2 = Names the figure, threshold or event in the data that would change a view of the stock.

## single-latest-quarter (single company)

Thread: http://127.0.0.1:6573/chat/8090abc7-20fc-458f-bae0-dacffba99413
Trace: .dev/traces/8090abc7-20fc-458f-bae0-dacffba99413/e6b32acd-c4be-437c-b954-0ca3442ee340.86e44d97-3871-4dab-9274-2e58d2342bbe.json

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Q: Analyze NVDA's latest quarter.

_Outcome: completed; time: 14.9s; answered by: `anthropic/claude-sonnet-5-5`; checks: 10 accepted, 0 rejected._

_Assertions (rendered): 10 accepted, 0 rejected:_

- ✓ analyst_inference []: The latest reported quarter shows very high profitability, with margins at each level of the income statement indicating strong pricing power and operating leverage.
- ✓ observation [F5] (text not shown): Revenue for Q4 FY2026 (ended 2026-01-25) was $62.1B.
- ✓ observation [F6, F7] (text not shown): Gross profit was $46.2B and operating income was $40.3B in Q4 FY2026.
- ✓ observation [F8] (text not shown): Net income was $35.4B in Q4 FY2026.
- ✓ observation [F9] (text not shown): Gross margin was 74.40% in Q4 FY2026.
- ✓ observation [F10] (text not shown): Operating margin was 64.90% in Q4 FY2026.
- ✓ observation [F11] (text not shown): Net margin was 57.00% in Q4 FY2026.
- ✓ observation [F12] (text not shown): The stock returned 5.81% year to date through the Aug 31, 2026 close.
- ✓ observation [F13] (text not shown): The last close, on Aug 31, 2026, was $178.40.
- ✓ analyst_inference []: The data shown has no cash flow, capital spending or per-share earnings figures for the quarter, so the profit strength is not confirmed by cash generation.

*Engine answer: 7 of 11 requested results verified*

- NVIDIA Corporation, Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, EPS (diluted), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Analyst commentary:_ > **Unverified analyst view** (not backed by the figures shown): The latest reported quarter shows very high profitability, with margins at each level of the income statement indicating strong pricing power and operating leverage.

NVDA's revenue was **$62.1B** in Q4 FY2026 (ended Jan 2026).

NVDA's operating margin was **64.90%** in Q4 FY2026 (ended Jan 2026).

NVDA's net margin was **57.00%** in Q4 FY2026 (ended Jan 2026).

> **Analyst inference:** The data shown has no cash flow, capital spending or per-share earnings figures for the quarter, so the profit strength is not confirmed by cash generation.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).


## margin-trend-loss-quarter (margin trend)

Thread: http://127.0.0.1:6573/chat/f67530b1-ed7c-454f-8182-e676193138ac
Trace: .dev/traces/f67530b1-ed7c-454f-8182-e676193138ac/5ba1a822-ae67-4109-8a3f-a9c628ea3920.4dbc1e67-dccd-4e41-a6be-d58de8c38548.json

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Q: How have AMD's operating margins trended over the last eight quarters?

_Outcome: completed; time: 15.9s; answered by: none (no model wrote it); checks: 0 accepted, 0 rejected._

_Assertions (fallback): 0 accepted, 0 rejected:_


*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads. Standout findings for AMD went unread, as the turn reached its limit of reads.


## what-changed-gross-margin (what changed)

Thread: http://127.0.0.1:6573/chat/c9dae3b5-9ff5-494f-93dd-683526824b11
Trace: .dev/traces/c9dae3b5-9ff5-494f-93dd-683526824b11/f41c9a65-efbc-4cf6-a289-d06ebfe6ef19.64a8579a-5b71-4841-8245-2e4dccac7936.json

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Q: What changed in NVDA's gross margin in Q1 fiscal 2026?

_Outcome: completed; time: 21.1s; answered by: `anthropic/claude-sonnet-5-5`; checks: 6 accepted, 2 rejected (comparative 2)._

_Assertions (rendered): 6 accepted, 2 rejected:_

- ✓ analyst_inference []: Its gross margin fell sharply in the latest quarter, even as revenue and gross profit dollars grew from a year earlier, so growth came with much lower profitability per dollar of sales.
- ✓ observation [F2, F3, F1] (text not shown): Q1 FY2026 gross profit was $26.7B on revenue of $44.1B, a 60.52% gross margin.
- ✓ observation [F5, F6, F4] (text not shown): The prior quarter had gross profit of $28.7B on revenue of $39.3B, a 73.03% margin, so gross profit dollars were lower in Q1 FY2026 despite higher revenue.
- ✓ observation [F8, F9, F7] (text not shown): The year-earlier quarter had gross profit of $20.4B on revenue of $26.0B, a 78.35% margin.
- ✓ unknown_cause [F1, F4, F7] (text not shown): The evidence gives no cause for the margin decline in Q1 FY2026.
- ✓ analyst_inference []: Gross profit dollars still rose against the year-earlier quarter, which cuts against reading the margin drop as a loss of earning power, though they slipped from the prior quarter.
- ✗ [comparative] comparison: a period is missing between Q1 FY2025 (ended 2024-04-28) and Q4 FY2025 (ended 2025-01-26), so every-period movement is not shown: Gross margin fell across the three periods shown, from the year-earlier quarter to the prior quarter to Q1 FY2026.
- ✗ [comparative] comparison: a period is missing between Q1 FY2025 (ended 2024-04-28) and Q4 FY2025 (ended 2025-01-26), so every-period movement is not shown: Revenue was higher in Q1 FY2026 than in the prior quarter and the year-earlier quarter.

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B

_Analyst commentary:_ > **Analyst inference:** Its gross margin fell sharply in the latest quarter, even as revenue and gross profit dollars grew from a year earlier, so growth came with much lower profitability per dollar of sales.

NVDA's gross profit was **$26.7B**, revenue **$44.1B** and gross margin **60.52%** in Q1 FY2026 (ended Apr 2025).

NVDA's gross profit was **$28.7B**, revenue **$39.3B** and gross margin **73.03%** in Q4 FY2025 (ended Jan 2025).

NVDA's gross profit was **$20.4B**, revenue **$26.0B** and gross margin **78.35%** in Q1 FY2025 (ended Apr 2024).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit dollars still rose against the year-earlier quarter, which cuts against reading the margin drop as a loss of earning power, though they slipped from the prior quarter.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.


## cause-in-evidence (cause in evidence)

Thread: http://127.0.0.1:6573/chat/167f48b1-a466-4155-9456-6775d0e49a41
Trace: .dev/traces/167f48b1-a466-4155-9456-6775d0e49a41/ea50247b-6606-403d-a0f8-c48283f13db0.e36c3927-bb04-45a4-9485-75a715b1112c.json

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Q: Why did AMD's operating margin turn negative in Q2 2025?

_Outcome: completed; time: 20.0s; answered by: `anthropic/claude-sonnet-5-5`; checks: 6 accepted, 1 rejected (kind 1)._

_Assertions (rendered): 6 accepted, 1 rejected:_

- ✓ analyst_inference []: Its operating margin turned negative because gross profit was not enough to cover operating costs in the quarter, but the evidence does not show which cost or charge drove it.
- ✓ observation [F1] (text not shown): AMD's Q2 FY2025 revenue was $7.7B.
- ✓ observation [F2] (text not shown): AMD's Q2 FY2025 gross profit was $3.1B.
- ✓ observation [F3, F6] (text not shown): AMD's Q2 FY2025 operating income was -$134.0M, giving an operating margin of -1.74%.
- ✓ analyst_inference []: Its positive net income despite an operating loss shows the bottom line was supported by items below operating income, so the operating loss alone understates quarterly earnings.
- ✓ observation [F4] (text not shown): AMD's Q2 FY2025 net income was $872.0M, positive despite the operating loss.
- ✗ [kind] an unknown cause cites a change: one company's metric, two periods, two values: The evidence gives no cause for operating income falling below zero in Q2 FY2025.

*Engine answer: 5 of 6 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- Advanced Micro Devices, Inc., EPS (diluted), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

_Analyst commentary:_ > **Unverified analyst view** (not backed by the figures shown): Its operating margin turned negative because gross profit was not enough to cover operating costs in the quarter, but the evidence does not show which cost or charge drove it.

AMD's operating income was **-$134.0M** and operating margin **-1.74%** in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Its positive net income despite an operating loss shows the bottom line was supported by items below operating income, so the operating loss alone understates quarterly earnings.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. Standout findings for AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one.


## peer-two (peer comparison)

Thread: http://127.0.0.1:6573/chat/b903dbf1-6cf1-4959-9a46-552a42dd9016
Trace: .dev/traces/b903dbf1-6cf1-4959-9a46-552a42dd9016/09ecdf50-b9d3-496b-ba05-8b501d226d0e.e547c135-fe3a-42f0-82c9-854341ac69a5.json

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Q: Compare NVDA with AMD.

_Outcome: completed; time: 18.4s; answered by: `anthropic/claude-sonnet-5-5`; checks: 9 accepted, 0 rejected._

_Assertions (rendered): 9 accepted, 0 rejected:_

- ✓ analyst_inference []: Its operating profile is far stronger, with higher revenue and margins at every level, though its share price has risen only modestly more than its rival's this year.
- ✓ comparison [F4, F14] (text not shown): Revenue is higher at NVDA than at AMD for the latest fiscal years shown.
- ✓ comparison [F8, F18] (text not shown): Gross margin is higher at NVDA than at AMD.
- ✓ comparison [F9, F19] (text not shown): Operating margin is higher at NVDA than at AMD.
- ✓ comparison [F10, F20] (text not shown): Net margin is higher at NVDA than at AMD.
- ✓ comparison [F21, F23] (text not shown): Year-to-date price return is higher for NVDA than for AMD.
- ✓ observation [F22, F24] (text not shown): NVDA last closed at $178.40 and AMD at $162.30 on Aug 31, 2026.
- ✓ observation [F16, F17] (text not shown): AMD's net income of $4.2B exceeds its operating income of $3.4B.
- ✓ analyst_inference []: Its net income sitting above operating income means its bottom line is not a clean read of core operating profitability.

*Engine answer: 7 of 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

*Engine answer: 7 of 10 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.
- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- Advanced Micro Devices, Inc., Gross profit, FY2025 (ended 2025-12-27): $17.3B
- Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Analyst commentary:_ > **Unverified analyst view on NVDA** (not backed by the figures shown): Its operating profile is far stronger, with higher revenue and margins at every level, though its share price has risen only modestly more than its rival's this year.

By revenue, highest first: NVDA **$209.9B** (FY2026, ended Jan 2026), AMD **$34.7B** (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%** (FY2026, ended Jan 2026), AMD **49.92%** (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%** (FY2026, ended Jan 2026), AMD **9.78%** (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%** (FY2026, ended Jan 2026), AMD **12.04%** (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**, AMD **3.17%** (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40** in the Aug 31, 2026 session; AMD's last close was **$162.30** in the Aug 31, 2026 session.

AMD's operating income was **$3.4B** and net income **$4.2B** in FY2025 (ended Dec 2025).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income sitting above operating income means its bottom line is not a clean read of core operating profitability.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.


## peer-three (peer comparison)

Thread: http://127.0.0.1:6573/chat/6bf170ff-3168-4ca3-acf0-f3acde7ca7f4
Trace: .dev/traces/6bf170ff-3168-4ca3-acf0-f3acde7ca7f4/e4706548-d8c5-4245-8aa4-b6d9ef270aaa.1e45f43c-fb51-46ca-9da2-f5883f5ad627.json

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Q: Compare NVDA, AMD and AAPL on revenue and margins.

_Outcome: completed; time: 24.5s; answered by: `anthropic/claude-sonnet-5-5`; checks: 7 accepted, 0 rejected._

_Assertions (rendered): 7 accepted, 0 rejected:_

- ✓ analyst_inference []: Its profitability is the strongest of the three at every margin level, and its scale is large, so it converts revenue into profit most effectively.
- ✓ comparison [F9, F1, F5] (text not shown): Revenue is highest at AAPL, then NVDA, then AMD.
- ✓ comparison [F2, F6, F10] (text not shown): Gross margin is highest at NVDA, then AMD, then AAPL.
- ✓ comparison [F3, F11, F7] (text not shown): Operating margin is highest at NVDA, then AAPL, then AMD.
- ✓ comparison [F4, F12, F8] (text not shown): Net margin is highest at NVDA, then AAPL, then AMD.
- ✓ observation [F3, F4, F7, F8, F11, F12] (text not shown): AMD's net margin is higher than its operating margin, while AAPL's and NVDA's net margins are lower than their operating margins.
- ✓ analyst_inference []: Its gross margin is the lowest of the three, yet it has the largest revenue and the second-highest operating margin, so its profit rests on scale and cost control rather than product margin.

*Engine answer: all 12 requested results verified*

*Revenue, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|
| NVIDIA Corporation | $209.9B (FY2026 (ended 2026-01-25)) | 70.78% (FY2026 (ended 2026-01-25)) | 60.21% (FY2026 (ended 2026-01-25)) | 53.60% (FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $34.7B (FY2025 (ended 2025-12-27)) | 49.92% (FY2025 (ended 2025-12-27)) | 9.78% (FY2025 (ended 2025-12-27)) | 12.04% (FY2025 (ended 2025-12-27)) |
| Apple Inc. | $416.2B (FY2025 (ended 2025-09-27)) | 46.91% (FY2025 (ended 2025-09-27)) | 31.97% (FY2025 (ended 2025-09-27)) | 26.92% (FY2025 (ended 2025-09-27)) |

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is the strongest of the three at every margin level, and its scale is large, so it converts revenue into profit most effectively.

By revenue, highest first: AAPL **$416.2B**, NVDA **$209.9B**, AMD **$34.7B**.

By gross margin, highest first: NVDA **70.78%**, AMD **49.92%**, AAPL **46.91%**.

By operating margin, highest first: NVDA **60.21%**, AAPL **31.97%**, AMD **9.78%**.

By net margin, highest first: NVDA **53.60%**, AAPL **26.92%**, AMD **12.04%**.

> **Unverified analyst view on AAPL** (not backed by the figures shown): Its gross margin is the lowest of the three, yet it has the largest revenue and the second-highest operating margin, so its profit rests on scale and cost control rather than product margin.

Periods: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025), AAPL FY2025 (ended Sep 2025).


## fiscal-year-trap (trap: mismatched fiscal years)

Thread: http://127.0.0.1:6573/chat/716bb9fa-3963-4be1-9237-98ba75b7c7e3
Trace: .dev/traces/716bb9fa-3963-4be1-9237-98ba75b7c7e3/b80eea9b-eac0-4ca6-9bc3-9ec18fec6044.d0c65f06-abf3-48dc-b885-24edd60dabbd.json

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Q: Compare NVDA's and AAPL's fiscal 2025 revenue.

_Outcome: completed; time: 15.6s; answered by: `anthropic/claude-sonnet-5-5`; checks: 5 accepted, 0 rejected._

_Assertions (rendered): 5 accepted, 0 rejected:_

- ✓ analyst_inference []: Its revenue is higher than its peer's, so it is the larger business by sales.
- ✓ observation [F1] (text not shown): NVDA's fiscal 2025 revenue, for the year ended 2025-01-26, was $130.5B.
- ✓ observation [F2] (text not shown): AAPL's fiscal 2025 revenue, for the year ended 2025-09-27, was $416.2B.
- ✓ comparison [F1, F2] (text not shown): Fiscal 2025 revenue is higher at AAPL than at NVDA.
- ✓ analyst_inference []: Its fiscal year ended earlier than its peer's, so the two figures do not cover the same calendar window.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): Its revenue is higher than its peer's, so it is the larger business by sales.

Of NVDA and AAPL, AAPL's revenue was highest: NVDA **$130.5B**, AAPL **$416.2B**.

> **Analyst inference on NVDA:** Its fiscal year ended earlier than its peer's, so the two figures do not cover the same calendar window.

Periods: NVDA FY2025 (ended Jan 2025), AAPL FY2025 (ended Sep 2025).


## segment-drill-down (segment drill-down)

Thread: http://127.0.0.1:6573/chat/6f7b4f2b-9453-4619-9912-d4416f04936c
Trace: .dev/traces/6f7b4f2b-9453-4619-9912-d4416f04936c/861c9b8c-991a-42de-b75a-6cdd406b41d4.c0f78aa6-2d77-4398-b9da-3a2040492e7f.json

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Q: Break down NVDA's revenue by segment.

_Outcome: completed; time: 6.0s; answered by: none (no model wrote it); checks: 0 accepted, 0 rejected._

_Assertions (fallback): 0 accepted, 0 rejected:_


*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

NVDA has no 10-K on file, so no business or risk factor claims from one.


## missing-segments (missing data)

Thread: http://127.0.0.1:6573/chat/caa882e8-9dea-489b-a252-70037a7120a6
Trace: .dev/traces/caa882e8-9dea-489b-a252-70037a7120a6/745d3b2b-7623-4858-9406-d49e3c0d5efa.00d51c46-6a9a-428a-8ac8-a471d3f6d379.json

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Q: Break down AMD's revenue by segment.

_Outcome: completed; time: 5.5s; answered by: none (no model wrote it); checks: 0 accepted, 0 rejected._

_Assertions (fallback): 0 accepted, 0 rejected:_


*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

AMD has no 10-K on file, so no business or risk factor claims from one.


## missing-cash-flow (missing data)

Thread: http://127.0.0.1:6573/chat/0638d643-e58f-4b11-bca4-2a4db16da42a
Trace: .dev/traces/0638d643-e58f-4b11-bca4-2a4db16da42a/fc5e8a22-5c08-4d79-9c25-5f70e17d1f49.3c19a0bc-8147-460d-a48c-a8721c71708b.json

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Q: What is AMD's free cash flow?

_Outcome: completed; time: 6.1s; answered by: none (no model wrote it); checks: 0 accepted, 0 rejected._

_Assertions (fallback): 0 accepted, 0 rejected:_


*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.


## follow-up-memory (conversation)

Thread: http://127.0.0.1:6573/chat/76278916-faba-4241-904f-37d9bd3bf10c
Trace: .dev/traces/76278916-faba-4241-904f-37d9bd3bf10c/b1d9798e-b18c-4b09-82f3-8fc0d9ed8ff7.66575c49-fdf6-42e0-9a91-3cffe771ed28.json
Trace: .dev/traces/76278916-faba-4241-904f-37d9bd3bf10c/357ef354-b498-454e-a52a-29805067e286.9e3d8c6a-bc25-49ad-affe-592ba08c76fd.json
Trace: .dev/traces/76278916-faba-4241-904f-37d9bd3bf10c/a006c4e9-9790-4d15-8e78-c7b74054a1b0.7a477356-0a4d-4a34-824b-3a964c754ed6.json

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Q: Analyze NVDA.

_Outcome: completed; time: 13.4s; answered by: `anthropic/claude-sonnet-5-5`; checks: 8 accepted, 0 rejected._

_Assertions (rendered): 8 accepted, 0 rejected:_

- ✓ analyst_inference []: Its latest fiscal year shows very high profitability at every level, though cash flow could not be verified and the year-to-date share price gain has been modest.
- ✓ observation [F4] (text not shown): NVDA revenue was $209.9B in FY2026 (ended 2026-01-25).
- ✓ observation [F5, F6] (text not shown): Gross profit was $148.6B and operating income was $126.4B for FY2026.
- ✓ observation [F7] (text not shown): Net income was $112.5B in FY2026.
- ✓ observation [F8, F9, F10] (text not shown): FY2026 margins were 70.78% gross, 60.21% operating and 53.60% net.
- ✓ observation [F11] (text not shown): The stock returned 5.81% from the Dec 31, 2025 close to the Aug 31, 2026 close.
- ✓ observation [F12] (text not shown): The last close, on Aug 31, 2026, was $178.40.
- ✓ analyst_inference []: Operating cash flow, capital spending and free cash flow are unavailable, so the earnings cannot be checked against cash generation, which cuts against the takeaway.

*Engine answer: 7 of 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Analyst commentary:_ > **Analyst inference:** Its latest fiscal year shows very high profitability at every level, though cash flow could not be verified and the year-to-date share price gain has been modest.

NVDA's revenue was **$209.9B** in FY2026 (ended Jan 2026).

NVDA's gross profit was **$148.6B** and operating income **$126.4B** in FY2026 (ended Jan 2026).

NVDA's net income was **$112.5B** in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**, operating margin **60.21%** and net margin **53.60%** in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%** in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close.

> **Unverified analyst view** (not backed by the figures shown): Operating cash flow, capital spending and free cash flow are unavailable, so the earnings cannot be checked against cash generation, which cuts against the takeaway.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.


### Q: Compare it with AMD YTD.

_Outcome: completed; time: 13.0s; answered by: `anthropic/claude-sonnet-5-5`; checks: 6 accepted, 1 rejected (binding 1)._

_Assertions (rendered): 6 accepted, 1 rejected:_

- ✓ observation [F1] (text not shown): NVDA's price return year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close, was 5.81%.
- ✓ observation [F3] (text not shown): AMD's price return over the same year-to-date period was 3.17%.
- ✓ comparison [F1, F3] (text not shown): Year-to-date price return is higher for NVDA than for AMD.
- ✓ observation [F2] (text not shown): NVDA last closed at $178.40 on Aug 31, 2026.
- ✓ observation [F4] (text not shown): AMD last closed at $162.30 on Aug 31, 2026.
- ✓ analyst_inference []: Its smaller gain is still positive, and this price-only comparison shows nothing on fundamentals or valuation that would say the gap will persist.
- ✗ [binding] an inference's subject is a company its evidence covers: Its year-to-date price gain is ahead of the other stock's, though both are modest, so the market has rewarded it slightly more this year.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Analyst commentary:_ Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**, AMD **3.17%** (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40** in the Aug 31, 2026 session.

AMD's last close was **$162.30** in the Aug 31, 2026 session.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is still positive, and this price-only comparison shows nothing on fundamentals or valuation that would say the gap will persist.


### Q: Explain the differences and show the evidence.

_Outcome: completed; time: 12.8s; answered by: `anthropic/claude-sonnet-5-5`; checks: 9 accepted, 0 rejected._

_Assertions (rendered): 9 accepted, 0 rejected:_

- ✓ analyst_inference []: Its profitability sits far above its peer's at every level of the income statement, and its stock has also returned more year to date.
- ✓ comparison [F1, F8] (text not shown): Revenue is higher at NVDA than at AMD in the latest fiscal year shown.
- ✓ comparison [F5, F12] (text not shown): Gross margin is higher at NVDA than at AMD.
- ✓ comparison [F6, F13] (text not shown): Operating margin is higher at NVDA than at AMD.
- ✓ comparison [F7, F14] (text not shown): Net margin is higher at NVDA than at AMD.
- ✓ comparison [F15, F17] (text not shown): Year-to-date price return is higher for NVDA than for AMD.
- ✓ observation [F10, F11] (text not shown): AMD's net income exceeded its operating income in FY2025.
- ✓ observation [F16, F18] (text not shown): Last closes on Aug 31, 2026 were $178.40 for NVDA and $162.30 for AMD.
- ✓ analyst_inference []: Its net income being above operating income means its bottom-line margin overstates how profitable its core operations are, which weakens the margin comparison's read on operations.

*Engine answer: all 7 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

*Engine answer: all 7 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- Advanced Micro Devices, Inc., Gross profit, FY2025 (ended 2025-12-27): $17.3B
- Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability sits far above its peer's at every level of the income statement, and its stock has also returned more year to date.

Of NVDA and AMD, NVDA's revenue was highest: NVDA **$209.9B** (FY2026, ended Jan 2026), AMD **$34.7B** (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's gross margin was highest: NVDA **70.78%** (FY2026, ended Jan 2026), AMD **49.92%** (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's operating margin was highest: NVDA **60.21%** (FY2026, ended Jan 2026), AMD **9.78%** (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's net margin was highest: NVDA **53.60%** (FY2026, ended Jan 2026), AMD **12.04%** (FY2025, ended Dec 2025).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income being above operating income means its bottom-line margin overstates how profitable its core operations are, which weakens the margin comparison's read on operations.


## ticker-page-compare (explicit subject)

Thread: http://127.0.0.1:6573/chat/794ca65b-cf23-4aaa-99c4-d36ae09ed87c
Trace: .dev/traces/794ca65b-cf23-4aaa-99c4-d36ae09ed87c/cbce4572-67a3-4914-bc8e-f266f460c70f.fc5926e4-c9fb-4c01-90f5-3de6e96dbab9.json

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Q: Compare with NVDA. (opened from the AAPL page)

_Outcome: completed; time: 15.5s; answered by: `anthropic/claude-sonnet-5-5`; checks: 9 accepted, 0 rejected._

_Assertions (rendered): 9 accepted, 0 rejected:_

- ✓ analyst_inference []: Its profitability is far stronger on every margin shown, and net income is nearly the same on a much smaller revenue base, so it converts sales to profit more efficiently.
- ✓ comparison [F4, F14] (text not shown): Revenue is higher at NVDA than at AAPL, in each company's latest fiscal year shown.
- ✓ comparison [F8, F18] (text not shown): Gross margin is higher at NVDA than at AAPL.
- ✓ comparison [F9, F19] (text not shown): Operating margin is higher at NVDA than at AAPL.
- ✓ comparison [F10, F20] (text not shown): Net margin is higher at NVDA than at AAPL.
- ✓ observation [F7, F17] (text not shown): Net income was $112.5B at NVDA and $112.0B at AAPL.
- ✓ comparison [F21, F23] (text not shown): Year-to-date price return is slightly higher for NVDA than for AAPL.
- ✓ observation [F22, F24] (text not shown): Last closes on Aug 31, 2026 were $231.60 for AAPL and $178.40 for NVDA.
- ✓ analyst_inference []: Its profit is similar in dollars despite lower margins, so its earnings look less dependent on a single high-margin revenue stream, though the data shown does not confirm that.

*Engine answer: 7 of 10 requested results verified*

- Apple Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Apple Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Apple Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.
- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- Apple Inc., Gross profit, FY2025 (ended 2025-09-27): $195.2B
- Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B
- Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%

*Engine answer: 7 of 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is far stronger on every margin shown, and net income is nearly the same on a much smaller revenue base, so it converts sales to profit more efficiently.

By revenue, highest first: AAPL **$416.2B** (FY2025, ended Sep 2025), NVDA **$209.9B** (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%** (FY2025, ended Sep 2025), NVDA **70.78%** (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%** (FY2025, ended Sep 2025), NVDA **60.21%** (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%** (FY2025, ended Sep 2025), NVDA **53.60%** (FY2026, ended Jan 2026).

> **Unverified analyst view on AAPL** (not backed by the figures shown): Its profit is similar in dollars despite lower margins, so its earnings look less dependent on a single high-margin revenue stream, though the data shown does not confirm that.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file.
