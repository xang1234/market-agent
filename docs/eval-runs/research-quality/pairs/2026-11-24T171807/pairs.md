# Blinded answer pairs: 2026-11-24T171807

Each question has two answers, A and B, from two runs of the same questions on the same frozen data. Which run
wrote which is in a key you don't see. Score every applicable cell of both answers 0, 1 or 2 in `pairs.scores.json`,
add the failure labels that apply, then run `node --experimental-strip-types scripts/research-quality-pairs.ts reveal
<this folder>`. Each cited figure carries a number; the list after the answer says what it points at.

## Rubric (0 / 1 / 2)

- **correct_companies**: Does the answer cover exactly the companies asked about? 0 = Wrong or missing company; 1 = Right companies, one only partly covered; 2 = Every company asked about, and only those.
- **comparable_periods**: Are the periods named and comparable (or the mismatch stated)? 0 = Periods unnamed or silently mismatched; 1 = Periods named, mismatch not called out; 2 = Periods named; any fiscal-calendar mismatch stated.
- **figures_match_sources**: Does every figure match a displayed value and its source? 0 = A figure differs from its source; 1 = Figures right but some lack a link to source; 2 = Every figure matches and links to its source.
- **conclusions_justified**: Do the conclusions follow from the figures shown? 0 = Conclusion contradicts or ignores the data; 1 = Plausible but thinly supported; 2 = Each conclusion traced to shown figures.
- **counterarguments**: Does it note what cuts the other way or what could change the view? 0 = One-sided; 1 = A caveat, but generic; 2 = A specific counterpoint grounded in the data.
- **no_invented_numbers**: Is missing data stated honestly, with no invented numbers? 0 = A number not in the data, or one misrepresented (e.g. net income passed off as free cash flow); 1 = No invented numbers, but a data gap left unstated or glossed over; 2 = Gaps stated plainly; every number is from the data.
- **decision_useful**: Could a portfolio manager act on this, and does it say what would change the answer? 0 = Figures only; the reader must work out why they matter; 1 = Says why it matters, but generically (e.g. "worth watching"); 2 = Names the figure, threshold or event in the data that would change a view of the stock.

Failure labels: `wrong_subject`, `wrong_period`, `unsupported_figure`, `invented_figure`, `weak_conclusion`, `missing_counterpoint`, `unstated_gap`, `operational_failure`. An answer that wasn't given is labelled
`operational_failure` at the reveal.

## 1. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 12 requested results verified*

*Revenue, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|
| NVIDIA Corporation | $215.9B (FY2026 (ended 2026-01-25)) | 71.07% (FY2026 (ended 2026-01-25)) | 60.38% (FY2026 (ended 2026-01-25)) | 55.60% (FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $34.7B (FY2025 (ended 2025-12-27)) | 49.92% (FY2025 (ended 2025-12-27)) | 9.78% (FY2025 (ended 2025-12-27)) | 12.04% (FY2025 (ended 2025-12-27)) |
| Apple Inc. | $416.2B (FY2025 (ended 2025-09-27)) | 46.91% (FY2025 (ended 2025-09-27)) | 31.97% (FY2025 (ended 2025-09-27)) | 26.92% (FY2025 (ended 2025-09-27)) |

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its margins are the strongest of the three at every level, while its revenue sits between the other two, so its profitability looks structurally richer than its scale alone suggests.

By revenue, highest first: AAPL **$416.2B**[1], NVDA **$215.9B**[2], AMD **$34.7B**[3].

By gross margin, highest first: NVDA **71.07%**[4], AMD **49.92%**[5], AAPL **46.91%**[6].

By operating margin, highest first: NVDA **60.38%**[7], AAPL **31.97%**[8], AMD **9.78%**[9].

By net margin, highest first: NVDA **55.60%**[10], AAPL **26.92%**[11], AMD **12.04%**[12].

Periods: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025), AAPL FY2025 (ended Sep 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [3] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [4] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [5] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [6] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [7] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [8] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [9] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [10] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [11] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [12] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 4 requested results verified*

- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

*Engine answer: all 4 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its revenue and every margin level shown are higher than AMD's, so on the data shown it is the stronger earner, though the periods differ and AAPL is missing.

By revenue, highest first: NVDA **$62.1B**[1], AMD **$11.2B**[2]. No revenue is shown for AAPL.

By gross margin, highest first: NVDA **74.40%**[3], AMD **54.02%**[4]. No gross margin is shown for AAPL.

By operating margin, highest first: NVDA **64.90%**[5], AMD **14.38%**[6]. No operating margin is shown for AAPL.

By net margin, highest first: NVDA **57.00%**[7], AMD **13.21%**[8]. No net margin is shown for AAPL.

Periods: NVDA Q4 FY2026 (ended Jan 2026), AMD Q2 FY2026 (ended Jun 2026). No figures are shown for AAPL.

AAPL: the figures were not computed, as the turn reached its limit of model calls. Reading stopped at the turn's limit of model calls, so part of the question may be unanswered.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [3] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [4] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [5] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [6] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%

## 2. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: 5 of 6 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- Advanced Micro Devices, Inc., EPS (diluted), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference:** Its operating loss came despite a positive gross profit, so the loss sits below the gross line, but the data shown does not say what drove it.

AMD's revenue was **$7.7B**[1] and gross profit **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[3] and operating margin **-1.74%**[4] in Q2 FY2025 (ended Jun 2025).

AMD's net income was **$872.0M**[5] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Positive net income alongside an operating loss means earnings below the operating line offset it, so the operating margin alone understates bottom-line results.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [4] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [5] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: all 5 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2025 (ended 2025-06-28): 39.80%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference:** Its operating loss in the quarter reflects a gross profit that was not enough to cover operating costs, but the data shown does not say what drove the shortfall.

AMD's revenue was **$7.7B**[1] and gross profit **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's gross margin was **39.80%**[3] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[4] and operating margin **-1.74%**[5] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** The single quarter shown has no prior period for comparison, so it cannot be told whether the negative margin is a break from trend or a one-off.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **39.80%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2025 (ended 2025-06-28): 39.80%
- [4] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [5] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

## 3. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

*Engine answer: 10 of 11 requested results verified*

- NVIDIA Corporation, EPS (diluted), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*Engine answer: 7 of 11 requested results verified*

- NVIDIA Corporation, EPS (diluted), Q4 FY2026: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Operating cash flow, Q4 FY2026: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Capital expenditures (PP&E cash payments), Q4 FY2026: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), Q4 FY2026: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference:** Its latest quarter shows very high profitability, with margins above the full-year level and strong cash generation over the year.

NVDA's revenue was **$62.1B**[1], gross profit **$46.2B**[2], operating income **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B

### Answer B

**Q:** Analyze NVDA's latest quarter.

*Engine answer: 7 of 11 requested results verified*

- NVIDIA Corporation, EPS (diluted), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

*Engine answer: 13 of 17 requested results verified*

*NVIDIA Corporation, Operating cash flow*: FY2026 (ended 2026-01-25) $102.7B; FY2022 (ended 2022-01-30) $9.1B; FY2023 (ended 2023-01-29) $5.6B; FY2024 (ended 2024-01-28) $28.1B; FY2025 (ended 2025-01-26) $64.1B

*NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles)*: FY2026 (ended 2026-01-25) $6.0B; fiscal year 4 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; fiscal year 3 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; FY2024 (ended 2024-01-28) $1.1B; FY2025 (ended 2025-01-26) $3.2B

- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year), FY2026 (ended 2026-01-25): gap (incompatible_definition): This free cash flow is computed from a narrower filed concept (continuing-operations operating cash flow or productive-asset capex), so stock-based compensation is not divided by it.
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year) ranked across periods, fiscal year 4 before latest to FY2026 (ended 2026-01-25): gap (missing_input): Fewer than two periods have an eligible value.
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference:** Its latest quarter shows very high profitability at each margin level, though full-year cash conversion is the weakest point and the quarter's own cash flow and EPS are unavailable.

NVDA's revenue was **$62.1B**[1] and gross profit **$46.2B**[2] in Q4 FY2026 (ended Jan 2026).

NVDA's operating income was **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA's gross margin was **74.40%**[5], operating margin **64.90%**[6] and net margin **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

NVDA's operating margin was **60.38%**[8] in FY2026 (ended Jan 2026); NVDA's operating margin was **64.90%**[9] in Q4 FY2026 (ended Jan 2026).

NVDA's cash conversion: operating cash flow / net income including noncontrolling interest (reported period) was **0.86x**[10] in FY2026 (ended Jan 2026). For NVDA, **FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked**[11].

> **Analyst inference:** Cash generation grew strongly in absolute terms, but earnings turned into cash at their weakest rate of the years ranked, which cuts against the strong-profitability takeaway.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads. Certified figures for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [9] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [10] **0.86x**: engine result: NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- [11] **FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked

## 4. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B

_Block sources: S1._

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B

_Block sources: S1._

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B

_Block sources: S1._

_Analyst commentary:_ NVDA's gross margin was **60.52%**[1] in Q1 FY2026 (ended Apr 2025); NVDA's gross margin was **73.03%**[2] in Q4 FY2025 (ended Jan 2025).

NVDA's gross profit was **$26.7B**[3] and revenue **$44.1B**[4] in Q1 FY2026 (ended Apr 2025); NVDA's gross profit was **$28.7B**[5] and revenue **$39.3B**[6] in Q4 FY2025 (ended Jan 2025).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit dollars were still higher than in the year-earlier quarter, so the margin decline did not erode absolute profit over that span.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [2] **73.03%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- [3] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [4] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [5] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [6] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B

_Block sources: S1._

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B

_Block sources: S1._

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B

_Block sources: S1._

_Analyst commentary:_ NVDA's gross margin was **60.52%**[1], gross profit **$26.7B**[2] and revenue **$44.1B**[3] in Q1 FY2026 (ended Apr 2025).

NVDA's gross margin was **78.35%**[4], gross profit **$20.4B**[5] and revenue **$26.0B**[6] in Q1 FY2025 (ended Apr 2024).

The figures do not show why NVDA's gross profit changed.

> **Analyst inference:** Gross profit dollars are still well above the year-earlier quarter, so absolute profit growth partly offsets the lower margin.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [2] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [3] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [4] **78.35%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- [5] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- [6] **$26.0B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B

## 5. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 3 requested results verified*

- Advanced Micro Devices, Inc., Operating income, Q2 FY2026 (ended 2026-06-27): $1.6B
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B

_Block sources: S1._

*Engine answer: all 3 requested results verified*

- Advanced Micro Devices, Inc., Operating income, Q1 FY2026 (ended 2026-03-28): $1.5B
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2026 (ended 2026-03-28): 14.21%
- Advanced Micro Devices, Inc., Revenue, Q1 FY2026 (ended 2026-03-28): $10.7B

_Block sources: S1._

_Analyst commentary:_ AMD's operating margin rose from **14.21%**[1] in Q1 FY2026 (ended Mar 2026) to **14.38%**[2] in Q2 FY2026 (ended Jun 2026).

AMD's revenue rose from **$10.7B**[3] in Q1 FY2026 (ended Mar 2026) to **$11.2B**[4] in Q2 FY2026 (ended Jun 2026).

AMD's operating income rose from **$1.5B**[5] in Q1 FY2026 (ended Mar 2026) to **$1.6B**[6] in Q2 FY2026 (ended Jun 2026).

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: a year in its window has no value; cash conversion (operating cash flow / net income): a year in its window has no value). Certified figures for AMD went unread, as the turn reached its limit of reads.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **14.21%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2026 (ended 2026-03-28): 14.21%
- [2] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [3] **$10.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q1 FY2026 (ended 2026-03-28): $10.7B
- [4] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [5] **$1.5B**: engine result: Advanced Micro Devices, Inc., Operating income, Q1 FY2026 (ended 2026-03-28): $1.5B
- [6] **$1.6B**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2026 (ended 2026-06-27): $1.6B

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

_Block sources: S1._

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads.

## 6. missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** Break down AMD's revenue by segment.

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

_Block sources: S1._

AMD has no 10-K on file, so no business or risk factor claims from one.

### Answer B

**Q:** Break down AMD's revenue by segment.

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

_Block sources: S1._

AMD has no 10-K on file, so no business or risk factor claims from one.

## 7. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: 17 of 20 requested results verified*

*Operating cash flow, Capital expenditures (productive-asset cash payments, may include intangibles), Free cash flow (OCF less productive-asset capex), Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Operating cash flow | Capital expenditures (productive-asset cash payments, may include intangibles) | Free cash flow (OCF less productive-asset capex) | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|---|---|---|---|---|---|
| Apple Inc. | gap (missing_input): No eligible input was public before the knowledge cutoff. (latest fiscal year) | gap (missing_input): No eligible input was public before the knowledge cutoff. (latest fiscal year) | gap (blocked_by_dependency): A required input or calculation is unavailable. (latest fiscal year) | $416.2B (FY2025 (ended 2025-09-27)) | $195.2B (FY2025 (ended 2025-09-27)) | $133.0B (FY2025 (ended 2025-09-27)) | $112.0B (FY2025 (ended 2025-09-27)) | 46.91% (FY2025 (ended 2025-09-27)) | 31.97% (FY2025 (ended 2025-09-27)) | 26.92% (FY2025 (ended 2025-09-27)) |
| NVIDIA Corporation | $102.7B (FY2026 (ended 2026-01-25)) | $6.0B (FY2026 (ended 2026-01-25)) | $96.7B (FY2026 (ended 2026-01-25)) | $215.9B (FY2026 (ended 2026-01-25)) | $153.5B (FY2026 (ended 2026-01-25)) | $130.4B (FY2026 (ended 2026-01-25)) | $120.1B (FY2026 (ended 2026-01-25)) | 71.07% (FY2026 (ended 2026-01-25)) | 60.38% (FY2026 (ended 2026-01-25)) | 55.60% (FY2026 (ended 2026-01-25)) |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ By gross margin, highest first: NVDA **71.07%**[1] (FY2026, ended Jan 2026), AAPL **46.91%**[2] (FY2025, ended Sep 2025).

By operating margin, highest first: NVDA **60.38%**[3] (FY2026, ended Jan 2026), AAPL **31.97%**[4] (FY2025, ended Sep 2025).

By net margin, highest first: NVDA **55.60%**[5] (FY2026, ended Jan 2026), AAPL **26.92%**[6] (FY2025, ended Sep 2025).

By revenue, highest first: AAPL **$416.2B**[7] (FY2025, ended Sep 2025), NVDA **$215.9B**[8] (FY2026, ended Jan 2026).

NVDA's operating cash flow was **$102.7B**[9], capital expenditures (productive-asset cash payments, may include intangibles) **$6.0B**[10] and free cash flow (OCF less productive-asset capex) **$96.7B**[11] in FY2026 (ended Jan 2026).

AAPL's operating income was **$133.0B**[12] and net income **$112.0B**[13] in FY2025 (ended Sep 2025); NVDA's operating income was **$130.4B**[14] and net income **$120.1B**[15] in FY2026 (ended Jan 2026).

By price return, highest first: NVDA **5.81%**[16], AAPL **5.34%**[17] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

AAPL's last close was **$231.60**[18] in the Aug 31, 2026 session; NVDA's last close was **$178.40**[19] in the Aug 31, 2026 session.

_Block sources: S2._

AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file.

_Cited:_

- [1] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [2] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [3] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [4] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [5] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [6] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [7] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [8] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [9] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [10] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [11] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [12] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [13] **$112.0B**: engine result: Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B
- [14] **$130.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- [15] **$120.1B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- [16] **5.81%**: price series
- [17] **5.34%**: price series
- [18] **$231.60**: price series
- [19] **$178.40**: price series

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: 17 of 20 requested results verified*

*Operating cash flow, Capital expenditures (productive-asset cash payments, may include intangibles), Free cash flow (OCF less productive-asset capex), Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Operating cash flow | Capital expenditures (productive-asset cash payments, may include intangibles) | Free cash flow (OCF less productive-asset capex) | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|---|---|---|---|---|---|
| Apple Inc. | gap (missing_input): No eligible input was public before the knowledge cutoff. (latest fiscal year) | gap (missing_input): No eligible input was public before the knowledge cutoff. (latest fiscal year) | gap (blocked_by_dependency): A required input or calculation is unavailable. (latest fiscal year) | $416.2B (FY2025 (ended 2025-09-27)) | $195.2B (FY2025 (ended 2025-09-27)) | $133.0B (FY2025 (ended 2025-09-27)) | $112.0B (FY2025 (ended 2025-09-27)) | 46.91% (FY2025 (ended 2025-09-27)) | 31.97% (FY2025 (ended 2025-09-27)) | 26.92% (FY2025 (ended 2025-09-27)) |
| NVIDIA Corporation | $102.7B (FY2026 (ended 2026-01-25)) | $6.0B (FY2026 (ended 2026-01-25)) | $96.7B (FY2026 (ended 2026-01-25)) | $215.9B (FY2026 (ended 2026-01-25)) | $153.5B (FY2026 (ended 2026-01-25)) | $130.4B (FY2026 (ended 2026-01-25)) | $120.1B (FY2026 (ended 2026-01-25)) | 71.07% (FY2026 (ended 2026-01-25)) | 60.38% (FY2026 (ended 2026-01-25)) | 55.60% (FY2026 (ended 2026-01-25)) |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the gross margin, operating margin, and net margin rankings): Its profitability is far stronger on every margin shown, and it converts that into cash, while the other company's profit base is large but earned on thinner margins.

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[1] (FY2025, ended Sep 2025), NVDA **71.07%**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[3] (FY2025, ended Sep 2025), NVDA **60.38%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[5] (FY2025, ended Sep 2025), NVDA **55.60%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[7] (FY2025, ended Sep 2025), NVDA **$215.9B**[8] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's price return was highest: AAPL **5.34%**[9], NVDA **5.81%**[10] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

> **Analyst inference on AAPL** (from the revenue and price return rankings): Its larger revenue base and similar share-price performance this year cut against the idea that the other company's margin lead makes it the clear winner; the periods also differ by fiscal year.

_Block sources: S2._

AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file.

_Cited:_

- [1] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [2] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [3] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [4] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [5] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [6] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [7] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [8] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [9] **5.34%**: price series
- [10] **5.81%**: price series

## 8. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on AAPL** (from the revenue ranking): Its revenue base is larger than the other company's, so it is the bigger business by sales on these figures.

> **Analyst inference on NVDA:** The two fiscal years end at different times, so the comparison is not over identical twelve-month windows, which tempers the ranking.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): It is the bigger business by sales, as its revenue is higher than its peer's.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on NVDA:** Its fiscal year ended at a different point in the calendar than its peer's, so the two figures cover different calendar windows and the comparison is not like-for-like.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

## 9. history-analysis (analysis against history)

**Expect:** FY2026 against FY2017-FY2025: record revenue and operating income, operating margin 60.4% second only to FY2025's 62.4%, and cash conversion 0.86x, the lowest of the ten years (FY2025 0.88x, the high was FY2020 at 1.70x). A good answer uses the ten-year history, names the cash-conversion low as what cuts against the growth story, and does not invent a cause. Comparing only with FY2025 misses the question.

### Answer A

**Q:** How does NVIDIA's latest fiscal year compare with its own history?

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*Engine answer: 13 of 17 requested results verified*

*NVIDIA Corporation, Operating cash flow*: FY2026 (ended 2026-01-25) $102.7B; FY2022 (ended 2022-01-30) $9.1B; FY2023 (ended 2023-01-29) $5.6B; FY2024 (ended 2024-01-28) $28.1B; FY2025 (ended 2025-01-26) $64.1B

*NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles)*: FY2026 (ended 2026-01-25) $6.0B; fiscal year 4 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; fiscal year 3 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; FY2024 (ended 2024-01-28) $1.1B; FY2025 (ended 2025-01-26) $3.2B

- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year), FY2026 (ended 2026-01-25): gap (incompatible_definition): This free cash flow is computed from a narrower filed concept (continuing-operations operating cash flow or productive-asset capex), so stock-based compensation is not divided by it.
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year) ranked across periods, fiscal year 4 before latest to FY2026 (ended 2026-01-25): gap (missing_input): Fewer than two periods have an eligible value.
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference:** Its latest year is exceptional in scale and profitability, with cash flow growing sharply, though cash conversion was its weakest of the years ranked.

NVIDIA Corporation's revenue was **$215.9B**[1], gross profit **$153.5B**[2], operating income **$130.4B**[3] and net income **$120.1B**[4] in FY2026 (ended Jan 2026).

NVIDIA Corporation's gross margin was **71.07%**[5], operating margin **60.38%**[6] and net margin **55.60%**[7] in FY2026 (ended Jan 2026).

NVIDIA Corporation's capital expenditures (productive-asset cash payments, may include intangibles) was **$1.1B**[8] in FY2024 (ended Jan 2024); NVIDIA Corporation's capital expenditures (productive-asset cash payments, may include intangibles) was **$3.2B**[9] in FY2025 (ended Jan 2025); NVIDIA Corporation's capital expenditures (productive-asset cash payments, may include intangibles) was **$6.0B**[10] and free cash flow (OCF less productive-asset capex) **$96.7B**[11] in FY2026 (ended Jan 2026).

For NVIDIA Corporation, **FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked**[12]. For NVIDIA Corporation, **FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked**[13].

NVIDIA Corporation's cash conversion: operating cash flow / net income including noncontrolling interest (reported period) was **0.86x**[14] in FY2026 (ended Jan 2026). For NVIDIA Corporation, **FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked**[15].

> **Analyst inference:** Its operating margin sits below the peak set in another year, and its cash conversion is the weakest of the years ranked, so this year is not best on every measure.

_Cited:_

- [1] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [2] **$153.5B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- [3] **$130.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- [4] **$120.1B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- [5] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [6] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [7] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [8] **$1.1B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2024 (ended 2024-01-28): $1.1B
- [9] **$3.2B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2025 (ended 2025-01-26): $3.2B
- [10] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [11] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [12] **FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- [13] **FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked
- [14] **0.86x**: engine result: NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- [15] **FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked

### Answer B

**Q:** How does NVIDIA's latest fiscal year compare with its own history?

*Engine answer: 10 of 11 requested results verified*

- NVIDIA Corporation, EPS (diluted), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2024 (ended 2024-01-28): $28.1B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2024 (ended 2024-01-28): $1.1B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2024 (ended 2024-01-28): $27.0B
- NVIDIA Corporation, Revenue, FY2024 (ended 2024-01-28): $60.9B
- NVIDIA Corporation, Gross profit, FY2024 (ended 2024-01-28): $44.3B
- NVIDIA Corporation, Operating income, FY2024 (ended 2024-01-28): $33.0B
- NVIDIA Corporation, Net income, FY2024 (ended 2024-01-28): $29.8B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2024 (ended 2024-01-28): 72.72%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2024 (ended 2024-01-28): 54.12%
- NVIDIA Corporation, Net margin (net income / revenue), FY2024 (ended 2024-01-28): 48.85%

_Block sources: S1._

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2025 (ended 2025-01-26): $64.1B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2025 (ended 2025-01-26): $3.2B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2025 (ended 2025-01-26): $60.9B
- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- NVIDIA Corporation, Gross profit, FY2025 (ended 2025-01-26): $97.9B
- NVIDIA Corporation, Operating income, FY2025 (ended 2025-01-26): $81.5B
- NVIDIA Corporation, Net income, FY2025 (ended 2025-01-26): $72.9B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2025 (ended 2025-01-26): 74.99%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2025 (ended 2025-01-26): 62.42%
- NVIDIA Corporation, Net margin (net income / revenue), FY2025 (ended 2025-01-26): 55.85%

_Block sources: S1._

*Engine answer: 8 of 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2023 (ended 2023-01-29): $5.6B
- NVIDIA Corporation, Capital expenditures (PP&E cash payments), FY2023: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Free cash flow (OCF less PP&E cash capex), FY2023: gap (blocked_by_dependency): A required input or calculation is unavailable.
- NVIDIA Corporation, Revenue, FY2023 (ended 2023-01-29): $27.0B
- NVIDIA Corporation, Gross profit, FY2023 (ended 2023-01-29): $15.4B
- NVIDIA Corporation, Operating income, FY2023 (ended 2023-01-29): $4.2B
- NVIDIA Corporation, Net income, FY2023 (ended 2023-01-29): $4.4B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2023 (ended 2023-01-29): 56.93%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2023 (ended 2023-01-29): 15.66%
- NVIDIA Corporation, Net margin (net income / revenue), FY2023 (ended 2023-01-29): 16.19%

_Block sources: S1._

_Analyst commentary:_ NVIDIA Corporation's revenue rose in every period from FY2023 (ended Jan 2023) (**$27.0B**[1]) to FY2026 (ended Jan 2026) (**$215.9B**[2]).

NVIDIA Corporation's operating income rose in every period from FY2023 (ended Jan 2023) (**$4.2B**[3]) to FY2026 (ended Jan 2026) (**$130.4B**[4]).

NVIDIA Corporation's operating margin rose from **15.66%**[5] in FY2023 (ended Jan 2023) to a high of **62.42%**[6] in FY2025 (ended Jan 2025), then pulled back to **60.38%**[7] in FY2026 (ended Jan 2026), still above where it started.

NVIDIA Corporation's gross margin rose from **56.93%**[8] in FY2023 (ended Jan 2023) to a high of **74.99%**[9] in FY2025 (ended Jan 2025), then pulled back to **71.07%**[10] in FY2026 (ended Jan 2026), still above where it started.

NVIDIA Corporation's net margin was **55.60%**[11] in FY2026 (ended Jan 2026); NVIDIA Corporation's net margin was **55.85%**[12] in FY2025 (ended Jan 2025); NVIDIA Corporation's net margin was **48.85%**[13] in FY2024 (ended Jan 2024).

NVIDIA Corporation's operating cash flow rose in every period from FY2023 (ended Jan 2023) (**$5.6B**[14]) to FY2026 (ended Jan 2026) (**$102.7B**[15]).

NVIDIA Corporation's free cash flow (OCF less productive-asset capex) was **$96.7B**[16] and capital expenditures (productive-asset cash payments, may include intangibles) **$6.0B**[17] in FY2026 (ended Jan 2026); NVIDIA Corporation's free cash flow (OCF less productive-asset capex) was **$60.9B**[18] and capital expenditures (productive-asset cash payments, may include intangibles) **$3.2B**[19] in FY2025 (ended Jan 2025).

NVIDIA Corporation's net income was **$120.1B**[20] in FY2026 (ended Jan 2026); NVIDIA Corporation's net income was **$72.9B**[21] in FY2025 (ended Jan 2025); NVIDIA Corporation's net income was **$29.8B**[22] in FY2024 (ended Jan 2024).

The figures do not show why NVIDIA Corporation's gross margin and NVIDIA Corporation's operating margin changed.

_Cited:_

- [1] **$27.0B**: engine result: NVIDIA Corporation, Revenue, FY2023 (ended 2023-01-29): $27.0B
- [2] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [3] **$4.2B**: engine result: NVIDIA Corporation, Operating income, FY2023 (ended 2023-01-29): $4.2B
- [4] **$130.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- [5] **15.66%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2023 (ended 2023-01-29): 15.66%
- [6] **62.42%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2025 (ended 2025-01-26): 62.42%
- [7] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [8] **56.93%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2023 (ended 2023-01-29): 56.93%
- [9] **74.99%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2025 (ended 2025-01-26): 74.99%
- [10] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [11] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [12] **55.85%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2025 (ended 2025-01-26): 55.85%
- [13] **48.85%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2024 (ended 2024-01-28): 48.85%
- [14] **$5.6B**: engine result: NVIDIA Corporation, Operating cash flow, FY2023 (ended 2023-01-29): $5.6B
- [15] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [16] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [17] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [18] **$60.9B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2025 (ended 2025-01-26): $60.9B
- [19] **$3.2B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2025 (ended 2025-01-26): $3.2B
- [20] **$120.1B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- [21] **$72.9B**: engine result: NVIDIA Corporation, Net income, FY2025 (ended 2025-01-26): $72.9B
- [22] **$29.8B**: engine result: NVIDIA Corporation, Net income, FY2024 (ended 2024-01-28): $29.8B

## 10. standout-annual (standout in own history)

**Expect:** FY2026 (ended 2026-01-25): revenue $215.9B, up about 65%; operating margin 60.4%, a little below FY2025's 62.4%. What stands out against NVDA's own ten fiscal years on file (FY2017-FY2026): cash conversion (operating cash flow / net income) was 0.86x ($102.7B / $120.1B), the lowest of the ten. A good answer names it as the lowest of those years and says the data does not show why. Traps: a ten-year claim about another measure the data does not rank, a stated cause, or a free cash flow presented as PP&E capex (NVDA files capex as productive-asset payments, FY2024-FY2026 only).

### Answer A

**Q:** What stands out in NVIDIA's latest annual results?

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*Engine answer: 13 of 17 requested results verified*

*NVIDIA Corporation, Operating cash flow*: FY2026 (ended 2026-01-25) $102.7B; FY2022 (ended 2022-01-30) $9.1B; FY2023 (ended 2023-01-29) $5.6B; FY2024 (ended 2024-01-28) $28.1B; FY2025 (ended 2025-01-26) $64.1B

*NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles)*: FY2026 (ended 2026-01-25) $6.0B; fiscal year 4 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; fiscal year 3 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; FY2024 (ended 2024-01-28) $1.1B; FY2025 (ended 2025-01-26) $3.2B

- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year), FY2026 (ended 2026-01-25): gap (incompatible_definition): This free cash flow is computed from a narrower filed concept (continuing-operations operating cash flow or productive-asset capex), so stock-based compensation is not divided by it.
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year) ranked across periods, fiscal year 4 before latest to FY2026 (ended 2026-01-25): gap (missing_input): Fewer than two periods have an eligible value.
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference:** Its latest year pairs very large revenue and profit with strong free cash flow, but cash conversion was its weakest of the years ranked, so earnings outran cash generation.

NVIDIA Corporation's revenue was **$215.9B**[1], gross profit **$153.5B**[2], operating income **$130.4B**[3] and net income **$120.1B**[4] in FY2026 (ended Jan 2026).

NVIDIA Corporation's gross margin was **71.07%**[5], operating margin **60.38%**[6] and net margin **55.60%**[7] in FY2026 (ended Jan 2026).

NVIDIA Corporation's operating cash flow was **$102.7B**[8], capital expenditures (productive-asset cash payments, may include intangibles) **$6.0B**[9] and free cash flow (OCF less productive-asset capex) **$96.7B**[10] in FY2026 (ended Jan 2026).

NVIDIA Corporation's cash conversion: operating cash flow / net income including noncontrolling interest (reported period) was **0.86x**[11] in FY2026 (ended Jan 2026). For NVIDIA Corporation, **FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked**[12].

For NVIDIA Corporation, **FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked**[13]. For NVIDIA Corporation, **FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked**[14].

> **Analyst inference:** Its operating margin was highest in an earlier year than the latest, so the latest year is not its peak for operating profitability.

_Cited:_

- [1] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [2] **$153.5B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- [3] **$130.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- [4] **$120.1B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- [5] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [6] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [7] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [8] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [9] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [10] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [11] **0.86x**: engine result: NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- [12] **FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked
- [13] **FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- [14] **FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked

### Answer B

**Q:** What stands out in NVIDIA's latest annual results?

*Engine answer: 10 of 14 requested results verified*

- NVIDIA Corporation, Cash and equivalents (excluding restricted cash), end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Total assets, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Total liabilities, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Stockholders' equity, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2025 (ended 2025-01-26): $64.1B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2025 (ended 2025-01-26): $3.2B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2025 (ended 2025-01-26): $60.9B
- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- NVIDIA Corporation, Gross profit, FY2025 (ended 2025-01-26): $97.9B
- NVIDIA Corporation, Operating income, FY2025 (ended 2025-01-26): $81.5B
- NVIDIA Corporation, Net income, FY2025 (ended 2025-01-26): $72.9B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2025 (ended 2025-01-26): 74.99%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2025 (ended 2025-01-26): 62.42%
- NVIDIA Corporation, Net margin (net income / revenue), FY2025 (ended 2025-01-26): 55.85%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (from NVIDIA Corporation's revenue, operating cash flow, free cash flow (OCF less productive-asset capex), and gross margin trends): Its standout feature is a very large step up in scale and cash generation, with profit growing alongside revenue even as gross and operating margins slipped.

NVIDIA Corporation's revenue rose from **$130.5B**[1] in FY2025 (ended Jan 2025) to **$215.9B**[2] in FY2026 (ended Jan 2026).

NVIDIA Corporation's operating cash flow rose from **$64.1B**[3] in FY2025 (ended Jan 2025) to **$102.7B**[4] in FY2026 (ended Jan 2026).

NVIDIA Corporation's free cash flow (OCF less productive-asset capex) rose from **$60.9B**[5] in FY2025 (ended Jan 2025) to **$96.7B**[6] in FY2026 (ended Jan 2026).

NVIDIA Corporation's gross margin fell from **74.99%**[7] in FY2025 (ended Jan 2025) to **71.07%**[8] in FY2026 (ended Jan 2026).

NVIDIA Corporation's operating margin fell from **62.42%**[9] in FY2025 (ended Jan 2025) to **60.38%**[10] in FY2026 (ended Jan 2026).

NVIDIA Corporation's net margin fell from **55.85%**[11] in FY2025 (ended Jan 2025) to **55.60%**[12] in FY2026 (ended Jan 2026).

NVIDIA Corporation's capital expenditures (productive-asset cash payments, may include intangibles) rose from **$3.2B**[13] in FY2025 (ended Jan 2025) to **$6.0B**[14] in FY2026 (ended Jan 2026).

The figures do not show why NVIDIA Corporation's gross margin and NVIDIA Corporation's operating margin changed.

> **Analyst inference** (from NVIDIA Corporation's gross margin, operating margin, net margin, and capital expenditures (productive-asset cash payments, may include intangibles) trends): Profitability is still exceptionally high, but the lower margins and higher capital spending show the growth is not coming with improving unit economics.

NVIDIA Corporation: no earnings release read for its GAAP to non-GAAP reconciliation is on file.

_Cited:_

- [1] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [2] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [3] **$64.1B**: engine result: NVIDIA Corporation, Operating cash flow, FY2025 (ended 2025-01-26): $64.1B
- [4] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [5] **$60.9B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2025 (ended 2025-01-26): $60.9B
- [6] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [7] **74.99%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2025 (ended 2025-01-26): 74.99%
- [8] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [9] **62.42%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2025 (ended 2025-01-26): 62.42%
- [10] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [11] **55.85%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2025 (ended 2025-01-26): 55.85%
- [12] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [13] **$3.2B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2025 (ended 2025-01-26): $3.2B
- [14] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B

## 11. missing-cash-flow (missing data)

**Expect:** AMD's cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

## 12. peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Answer A

**Q:** Compare NVDA with AMD.

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

_Block sources: S1._

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ By revenue, highest first: NVDA **$215.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **71.07%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.38%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **55.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

NVDA's operating cash flow was **$102.7B**[9], capital expenditures (productive-asset cash payments, may include intangibles) **$6.0B**[10] and free cash flow (OCF less productive-asset capex) **$96.7B**[11] in FY2026 (ended Jan 2026).

AMD's operating income was **$3.4B**[12] and net income **$4.2B**[13] in FY2025 (ended Dec 2025).

By price return, highest first: NVDA **5.81%**[14], AMD **3.17%**[15] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[16] in the Aug 31, 2026 session; AMD's last close was **$162.30**[17] in the Aug 31, 2026 session.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [9] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [10] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [11] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [12] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [13] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [14] **5.81%**: price series
- [15] **3.17%**: price series
- [16] **$178.40**: price series
- [17] **$162.30**: price series

### Answer B

**Q:** Compare NVDA with AMD.

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

_Block sources: S1._

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It is far larger and more profitable than its rival at every level of the income statement, and it also turned more of its sales into earnings, though the year-to-date share price gain is only modestly higher.

By revenue, highest first: NVDA **$215.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **71.07%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.38%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **55.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

## 13. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

### Answer B

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

## 14. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*Engine answer: 13 of 17 requested results verified*

*NVIDIA Corporation, Operating cash flow*: FY2026 (ended 2026-01-25) $102.7B; FY2022 (ended 2022-01-30) $9.1B; FY2023 (ended 2023-01-29) $5.6B; FY2024 (ended 2024-01-28) $28.1B; FY2025 (ended 2025-01-26) $64.1B

*NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles)*: FY2026 (ended 2026-01-25) $6.0B; fiscal year 4 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; fiscal year 3 before latest gap (missing_input): No eligible input was public before the knowledge cutoff.; FY2024 (ended 2024-01-28) $1.1B; FY2025 (ended 2025-01-26) $3.2B

- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year), FY2026 (ended 2026-01-25): gap (incompatible_definition): This free cash flow is computed from a narrower filed concept (continuing-operations operating cash flow or productive-asset capex), so stock-based compensation is not divided by it.
- NVIDIA Corporation, Stock-based compensation / free cash flow (fiscal year) ranked across periods, fiscal year 4 before latest to FY2026 (ended 2026-01-25): gap (missing_input): Fewer than two periods have an eligible value.
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period), FY2026 (ended 2026-01-25): 0.86x
- NVIDIA Corporation, Cash conversion: operating cash flow / net income including noncontrolling interest (reported period) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2026 (ended 2026-01-25) has the lowest cash conversion: operating cash flow / net income including noncontrolling interest (reported period) of the 10 fiscal years ranked

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference:** It is an exceptionally profitable, cash-generative business, though its cash conversion is the weakest in the years ranked.

NVDA's revenue was **$215.9B**[1], gross profit **$153.5B**[2], operating income **$130.4B**[3] and net income **$120.1B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **71.07%**[5], operating margin **60.38%**[6] and net margin **55.60%**[7] in FY2026 (ended Jan 2026).

NVDA's operating cash flow fell from **$9.1B**[8] in FY2022 (ended Jan 2022) to a low of **$5.6B**[9] in FY2023 (ended Jan 2023), then rebounded to **$102.7B**[10] in FY2026 (ended Jan 2026), its highest of the periods compared, above where it started.

NVDA's free cash flow (OCF less productive-asset capex) was **$96.7B**[11], operating cash flow **$102.7B**[12] and capital expenditures (productive-asset cash payments, may include intangibles) **$6.0B**[13] in FY2026 (ended Jan 2026).

For NVDA, **FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked**[14]. For NVDA, **FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked**[15].

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). Non-GAAP reconciliations for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

Some of the analysis was left out, as the turn reached its limit of model calls.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the price return ranking): Its share price gain is larger than its peer's, though both are modest, so the market has rewarded it somewhat more over this window.

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[16], AMD **3.17%**[17] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[18] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[19] in the Aug 31, 2026 session.

> **Analyst inference on NVDA** (from the price return ranking): Its lead is only a price-return comparison over one window and says nothing about fundamentals, so it is weak evidence of better business performance.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

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

_Block sources: S1._

*Engine answer: all 10 requested results verified*

- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, and operating margin rankings): It converts far more of its sales into profit than the peer and has the stronger year-to-date share price return, so the evidence favours it on both fundamentals and recent performance.

By revenue, highest first: NVDA **$215.9B**[20] (FY2026, ended Jan 2026), AMD **$34.7B**[21] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **71.07%**[22] (FY2026, ended Jan 2026), AMD **49.92%**[23] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.38%**[24] (FY2026, ended Jan 2026), AMD **9.78%**[25] (FY2025, ended Dec 2025).

_Cited:_

- [1] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [2] **$153.5B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- [3] **$130.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- [4] **$120.1B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- [5] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [6] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [7] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [8] **$9.1B**: engine result: NVIDIA Corporation, Operating cash flow, FY2022 (ended 2022-01-30): $9.1B
- [9] **$5.6B**: engine result: NVIDIA Corporation, Operating cash flow, FY2023 (ended 2023-01-29): $5.6B
- [10] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [11] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [12] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [13] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [14] **FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2025 (ended 2025-01-26) has the highest operating margin (operating income / revenue) of the 10 fiscal years ranked
- [15] **FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue) ranked across periods, FY2017 (ended 2017-01-29) to FY2026 (ended 2026-01-25): FY2023 (ended 2023-01-29) has the lowest operating margin (operating income / revenue) of the 10 fiscal years ranked
- [16] **5.81%**: price series
- [17] **3.17%**: price series
- [18] **$178.40**: price series
- [19] **$162.30**: price series
- [20] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [21] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [22] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [23] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [24] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [25] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

### Answer B

**Q:** Analyze NVDA.

*Engine answer: 10 of 14 requested results verified*

- NVIDIA Corporation, Cash and equivalents (excluding restricted cash), end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Total assets, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Total liabilities, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Stockholders' equity, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference:** It shows exceptional profitability and cash generation in the latest fiscal year, with free cash flow far exceeding what its small capital spending requires, while the shares have gained modestly this year.

NVDA's revenue was **$215.9B**[1] and gross profit **$153.5B**[2] in FY2026 (ended Jan 2026).

NVDA's operating income was **$130.4B**[3] and net income **$120.1B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **71.07%**[5], operating margin **60.38%**[6] and net margin **55.60%**[7] in FY2026 (ended Jan 2026).

NVDA's operating cash flow was **$102.7B**[8], capital expenditures (productive-asset cash payments, may include intangibles) **$6.0B**[9] and free cash flow (OCF less productive-asset capex) **$96.7B**[10] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[11] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[12] in the Aug 31, 2026 session.

> **Analyst inference:** Counterpoint: only one fiscal year is shown, so the data cannot say whether these very high margins and cash flows are holding, improving or fading.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[13], AMD **3.17%**[14] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[15] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[16] in the Aug 31, 2026 session.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is still positive, and price return alone says nothing about the drivers or the fundamentals behind either stock.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

*Engine answer: all 14 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | $215.9B (FY2026 (ended 2026-01-25)) | $153.5B (FY2026 (ended 2026-01-25)) | $130.4B (FY2026 (ended 2026-01-25)) | $120.1B (FY2026 (ended 2026-01-25)) | 71.07% (FY2026 (ended 2026-01-25)) | 60.38% (FY2026 (ended 2026-01-25)) | 55.60% (FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $34.7B (FY2025 (ended 2025-12-27)) | $17.3B (FY2025 (ended 2025-12-27)) | $3.4B (FY2025 (ended 2025-12-27)) | $4.2B (FY2025 (ended 2025-12-27)) | 49.92% (FY2025 (ended 2025-12-27)) | 9.78% (FY2025 (ended 2025-12-27)) | 12.04% (FY2025 (ended 2025-12-27)) |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, net margin, and price return rankings): Its fundamentals are far stronger on scale and profitability, and its year-to-date share price return is also higher.

By revenue, highest first: NVDA **$215.9B**[17] (FY2026, ended Jan 2026), AMD **$34.7B**[18] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **71.07%**[19] (FY2026, ended Jan 2026), AMD **49.92%**[20] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.38%**[21] (FY2026, ended Jan 2026), AMD **9.78%**[22] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **55.60%**[23] (FY2026, ended Jan 2026), AMD **12.04%**[24] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**[25], AMD **3.17%**[26] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [2] **$153.5B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $153.5B
- [3] **$130.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $130.4B
- [4] **$120.1B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $120.1B
- [5] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [6] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [7] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [8] **$102.7B**: engine result: NVIDIA Corporation, Operating cash flow, FY2026 (ended 2026-01-25): $102.7B
- [9] **$6.0B**: engine result: NVIDIA Corporation, Capital expenditures (productive-asset cash payments, may include intangibles), FY2026 (ended 2026-01-25): $6.0B
- [10] **$96.7B**: engine result: NVIDIA Corporation, Free cash flow (OCF less productive-asset capex), FY2026 (ended 2026-01-25): $96.7B
- [11] **5.81%**: price series
- [12] **$178.40**: price series
- [13] **5.81%**: price series
- [14] **3.17%**: price series
- [15] **$178.40**: price series
- [16] **$162.30**: price series
- [17] **$215.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $215.9B
- [18] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [19] **71.07%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 71.07%
- [20] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [21] **60.38%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.38%
- [22] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [23] **55.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 55.60%
- [24] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [25] **5.81%**: price series
- [26] **3.17%**: price series
