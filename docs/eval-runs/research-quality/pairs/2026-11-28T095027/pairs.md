# Blinded answer pairs: 2026-11-28T095027

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

## 1. peer-two (peer comparison)

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, net margin, and price return rankings): It is the larger and far more profitable business at every level shown, from gross to net margin, while its year-to-date share price gain is only modestly ahead of its peer's.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**[9], AMD **3.17%**[10] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income exceeding operating income means its net margin overstates the profitability of its core operations, so the operating margin is the cleaner gauge.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no analyst consensus captured in the 7 days to the cutoff is on file. AMD has no 10-K on file, so no business or risk factor claims from one. NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [9] **5.81%**: price series
- [10] **3.17%**: price series

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ NVDA is far stronger than AMD on scale and profitability in the latest fiscal years shown. The year-to-date share price gap is much narrower.

- **Scale:** NVDA's FY2026 revenue was **$209.9B**[1] against AMD's FY2025 **$34.7B**[2], about **6x**[3][4]. ~~The gap widens down the income statement.~~ (The gap widens from revenue to operating income, then narrows at net income.) Operating income was **$126.4B**[5] versus **$3.4B**[6], and net income was **$112.5B**[7] versus **$4.2B**[8].
- **Margins:** NVDA's gross margin was **70.78%**[9] versus **49.92%**[10] for AMD, a gap of about **21 points**[11][12]. Operating margin was **60.21%**[13] versus **9.78%**[14], about **50 points**[15][16]. Net margin was **53.60%**[17] versus **12.04%**[18], about **42 points**[19][20]. NVDA keeps most of each revenue dollar as operating profit, while AMD keeps under a tenth.
- **Share prices:** Year to date through Aug 31, 2026, NVDA returned **5.81%**[21] (last close **$178.40**[22]) and AMD returned **3.17%**[23] (last close **$162.30**[24]). The market has not separated the two by anything like the gap in their fundamentals.

**Counterpoint:** AMD's results look better below the operating line than at it. Net income of **$4.2B**[25] exceeds operating income of **$3.4B**[26], so its **12.04%**[27] net margin sits above its **9.78%**[28] operating margin. NVDA's net margin runs below its operating margin. AMD's bottom line therefore overstates its core operating profitability relative to NVDA's. The periods also differ: NVDA's year ended Jan 25, 2026 and AMD's ended Dec 27, 2025.

**Not available:** Operating cash flow, capex and free cash flow could not be computed for either company. No analyst consensus was on file for either in the week before the cutoff. Neither company has a 10-K on file, so there is no business or risk-factor detail, and the standout findings for both went unread. This comparison therefore rests on income-statement margins and price returns alone.

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. Standout findings for NVDA went unread, as the turn reached its limit of reads. Standout findings for AMD went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [4] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [5] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [6] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [7] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [8] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [9] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [10] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [11] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [12] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [13] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [14] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [15] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [16] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [17] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [18] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [19] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [20] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [21] **5.81%**: price series
- [22] **$178.40**: price series
- [23] **3.17%**: price series
- [24] **$162.30**: price series
- [25] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [26] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [27] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [28] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

## 2. missing-segments (missing data)

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

_Analyst commentary:_ AMD's segment mix can't be broken out from what I have. The only figure available is total revenue of **$34.7B**[1] for FY2025 (ended 2025-12-27) [F1], with no split across segments, so I can't say which business drove it or which lagged.

There is also no prior-period figure, so I can't give growth, and no peer comparison for context.

The main limit is that AMD has no 10-K on file, so no business or risk factor claims from one are available. The 10-K is where the segment disclosure would normally come from. Until it or an equivalent segment table is on file, the **$34.7B**[2] total is the only number I can stand behind. Any segment percentages would be guesses.

AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

## 3. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

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

_Analyst commentary:_ **Takeaway:** The most recent quarter in the packet, Q4 FY2026 (ended 2026-01-25), shows very high profitability. NVDA earned **$35.4B**[1] of net income on **$62.1B**[2] of revenue.

- **Margins:** Gross profit was **$46.2B**[3], a **74.40%**[4] gross margin. Operating income was **$40.3B**[5], a **64.90%**[6] operating margin. Net income gave a **57.00%**[7] net margin.
- **Cost structure:** The gap between gross profit and operating income is $5.9B (46.2 − 40.3), about 9.5% of revenue. Operating costs absorbed little of the gross profit, so about 87% of it reached operating income (40.3 / 46.2).
- **Below operating income:** Net income was $4.9B lower than operating income (40.3 − 35.4). The packet does not break that gap down.

**Counterpoint:** The profit figures are not matched by cash or per-share figures. Diluted EPS, operating cash flow, capex and free cash flow for the latest fiscal quarter are unavailable, so I can't test whether the **57%**[8] net margin converts to cash. The packet also has no prior-period figures, so the quarter can't be compared with earlier ones for growth or margin trend. No GAAP to non-GAAP reconciliation or analyst consensus is on file, so the quarter can't be measured against expectations either. The packet flags no standout finding in NVDA's own history: some inputs for operating margin, stock-based compensation relative to free cash flow, and cash conversion are missing or not certified.

_4 figures could not be traced to the sources read._

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).

_Cited:_

- [1] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [2] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [3] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [5] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

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

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ NVDA's revenue was **$62.1B**[1] and gross profit **$46.2B**[2] in Q4 FY2026 (ended Jan 2026).

NVDA's operating income was **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA's gross margin was **74.40%**[5], operating margin **64.90%**[6] and net margin **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[9] in the Aug 31, 2026 session.

> **Unverified analyst view** (not backed by the figures shown): The counterpoint is that the quarter shown is not the most recent period before the cutoff and cash flow data is unavailable, so the stock's modest year-to-date gain cannot be tied to these earnings.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **5.81%**: price series
- [9] **$178.40**: price series

## 4. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 12 requested results verified*

*Revenue, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|
| NVIDIA Corporation | $62.1B (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $11.2B (Q2 FY2026 (ended 2026-06-27)) | 54.02% (Q2 FY2026 (ended 2026-06-27)) | 14.38% (Q2 FY2026 (ended 2026-06-27)) | 13.21% (Q2 FY2026 (ended 2026-06-27)) |
| Apple Inc. | $97.1B (Q3 FY2026 (ended 2026-06-27)) | 47.06% (Q3 FY2026 (ended 2026-06-27)) | 30.69% (Q3 FY2026 (ended 2026-06-27)) | 25.64% (Q3 FY2026 (ended 2026-06-27)) |

_Block sources: S1._

_Analyst commentary:_ **Takeaway:** NVDA has the highest margins of the three by a wide margin, AAPL has the largest revenue, and AMD is the smallest and has the lowest operating and net margins, though its gross margin is above AAPL's. The periods differ, so this is not a like-for-like quarter.

**Revenue:** AAPL reported **$97.1B**[1] for Q3 FY2026 (ended 2026-06-27). NVDA reported **$62.1B**[2] for Q4 FY2026 (ended 2026-01-25). AMD reported **$11.2B**[3] for Q2 FY2026 (ended 2026-06-27). AAPL's revenue is about **1.6x**[4][5] NVDA's and about **8.7x**[6][7] AMD's.

**Margins:**

| | Gross | Operating | Net |
|---|---|---|---|
| NVDA | **74.40%**[8] | **64.90%**[9] | **57.00%**[10] |
| AAPL | **47.06%**[11] | **30.69%**[12] | **25.64%**[13] |
| AMD | **54.02%**[14] | **14.38%**[15] | **13.21%**[16] |

- NVDA's operating margin is **34.2 points**[17][18] above AAPL's and **50.5 points**[19][20] above AMD's. Its net margin is **57.00%**[21], more than double AAPL's **25.64%**[22].
- AMD's gross margin (**54.02%**[23]) is **6.96 points**[24][25] above AAPL's (**47.06%**[26]). It gives that edge back below the gross line: its operating margin is **16.31 points**[27][28] lower than AAPL's.
- Gross-to-operating margin falls **9.5 points**[29][30] for NVDA, **16.37**[31][32] for AAPL and **39.64**[33][34] for AMD. That puts AMD's operating cost load well above the other two, relative to revenue.

**Counterpoint:** NVDA's figures are for a quarter that ended 2026-01-25, about five months before the AMD and AAPL quarters ended on 2026-06-27. Its lead may therefore not hold in a same-period comparison. Also, AMD's gross margin is above AAPL's, so AAPL's advantage is in operating and net margin, not in gross profitability.

_Cited:_

- [1] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [2] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [3] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [4] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [5] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [6] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [7] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [8] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [9] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [10] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [11] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [12] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [13] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [14] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [15] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [16] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%
- [17] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [18] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [19] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [20] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [21] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [22] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [23] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [24] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [25] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [26] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [27] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [28] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [29] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [30] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [31] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [32] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [33] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [34] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 12 requested results verified*

*Revenue, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|
| NVIDIA Corporation | $209.9B (FY2026 (ended 2026-01-25)) | 70.78% (FY2026 (ended 2026-01-25)) | 60.21% (FY2026 (ended 2026-01-25)) | 53.60% (FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $34.7B (FY2025 (ended 2025-12-27)) | 49.92% (FY2025 (ended 2025-12-27)) | 9.78% (FY2025 (ended 2025-12-27)) | 12.04% (FY2025 (ended 2025-12-27)) |
| Apple Inc. | $416.2B (FY2025 (ended 2025-09-27)) | 46.91% (FY2025 (ended 2025-09-27)) | 31.97% (FY2025 (ended 2025-09-27)) | 26.92% (FY2025 (ended 2025-09-27)) |

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is the strongest of the three at every margin level, while the revenue lead belongs to a different company, so scale and margin quality are not the same thing here.

By revenue, highest first: AAPL **$416.2B**[1], NVDA **$209.9B**[2], AMD **$34.7B**[3].

By gross margin, highest first: NVDA **70.78%**[4], AMD **49.92%**[5], AAPL **46.91%**[6].

By operating margin, highest first: NVDA **60.21%**[7], AAPL **31.97%**[8], AMD **9.78%**[9].

By net margin, highest first: NVDA **53.60%**[10], AAPL **26.92%**[11], AMD **12.04%**[12].

> **Analyst inference on AAPL** (from the gross margin, operating margin, and net margin rankings): Its gross margin is the lowest of the three, yet it converts more of revenue into operating profit than AMD does, which points to a lighter operating cost load relative to gross profit.

Periods: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025), AAPL FY2025 (ended Sep 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [4] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [5] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [6] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [7] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [8] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [9] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [10] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [11] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [12] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

## 5. cause-in-evidence (cause in evidence)

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

_Analyst commentary:_ > **Analyst inference:** Its operating loss in the quarter looks driven by operating costs absorbing the gross profit, but the data shown does not establish why.

AMD's revenue was **$7.7B**[1] in Q2 FY2025 (ended Jun 2025).

AMD's gross profit was **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[3] and operating margin **-1.74%**[4] in Q2 FY2025 (ended Jun 2025).

> **Unverified analyst view** (not backed by the figures shown): Positive net income alongside an operating loss means the bottom line did not reflect core operating performance, so the negative margin alone overstates weakness.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. Certified figures for AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [4] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: 5 of 6 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- Advanced Micro Devices, Inc., EPS (diluted), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

_Block sources: S1._

_Analyst commentary:_ **Takeaway:** The figures show where the squeeze sat, but not why it happened. Gross profit was too small to cover operating costs in the quarter, and the evidence gives no stated cause.

- **Margin:** AMD's Q2 FY2025 (ended 2025-06-28) operating income was **-$134.0M**[1] on revenue of **$7.7B**[2], an operating margin of **-1.74%**[3].
- **Gross profit:** It was **$3.1B**[4], a gross margin of roughly **40%**[5][6] (3.1/7.7), so the business was still profitable at the gross line.
- **Operating costs:** Gross profit of **$3.1B**[7] less an operating loss of **$134.0M**[8] implies operating expenses of about **$3.2B**[9][10], or roughly **42%**[11][12][13] of revenue. That exceeded gross profit by about 2 points of revenue, which is arithmetically why the margin went negative.

**Counterpoint:** The operating loss did not carry through to the bottom line. Net income was **$872.0M**[14], positive despite the **-$134.0M**[15] operating income. Items below operating income must have more than offset the loss, and the packet does not itemize them. The operating-margin dip therefore says little about overall earnings for the quarter.

**Notes:** No earnings release with a GAAP to non-GAAP reconciliation is on file. The figures were also not computed in full, and there is no 10-K. The specific drivers of the operating expense load therefore cannot be attributed here.

_1 figure could not be traced to the sources read._

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. Standout findings for AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [2] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [3] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [4] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [5] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [6] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [7] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [8] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [9] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [10] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [11] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [12] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [13] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [14] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- [15] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M

## 6. what-changed-gross-margin (what changed)

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

_Analyst commentary:_ NVDA's gross margin fell sharply in Q1 FY2026, to **60.52%**[1] [F1], ~~even as revenue and gross profit rose in dollar terms~~ (even as revenue rose in dollar terms (gross profit rose year over year but fell from Q4 FY2025)).

- **Sequential:** Margin was **73.03%**[2] in Q4 FY2025 [F4], so it dropped about 12.5 points. Revenue grew from **$39.3B**[3] [F6] to **$44.1B**[4] [F3], but gross profit fell from **$28.7B**[5] [F5] to **$26.7B**[6] [F2].
- **Year over year:** Q1 FY2025 margin was **78.35%**[7] [F7], so the decline is about 17.8 points. Revenue rose from **$26.0B**[8] [F9] to **$44.1B**[9] [F3], about **70%**[10][11]. Gross profit rose from **$20.4B**[12] [F8] to **$26.7B**[13] [F2], about **31%**[14][15], so profit grew well below revenue.

Takeaway: the quarter shows growth in dollars but weaker profitability per dollar of sales. Q1 FY2026 is the weakest of the three periods shown, and Q4 FY2025 sits between it and the year-ago peak.

Counterpoint: absolute gross profit of **$26.7B**[16] is still $6.3B above the year-ago level, so the business is earning more gross profit even with the compressed margin. The packet doesn't hold the reasons for the margin drop, and its notes say no GAAP to non-GAAP reconciliation was read and the 10-K claims went unread, so the figures here are GAAP-style ratios computed from reported gross profit and revenue.

_3 figures could not be traced to the sources read._

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [2] **73.03%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- [3] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B
- [4] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [5] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [6] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [7] **78.35%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- [8] **$26.0B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B
- [9] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [10] **$26.0B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B
- [11] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [12] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- [13] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [14] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- [15] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [16] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B

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

_Analyst commentary:_ NVDA's gross profit was **$26.7B**[1] and revenue **$44.1B**[2] in Q1 FY2026 (ended Apr 2025); NVDA's gross profit was **$28.7B**[3] and revenue **$39.3B**[4] in Q4 FY2025 (ended Jan 2025).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit is still well above the year-earlier quarter, so the business is earning more in dollars even with a thinner margin.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [3] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [4] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B

## 7. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

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

_Block sources: S1._

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, and operating margin rankings): Its profitability is clearly stronger on every margin shown, even though net income is about the same as the other company's, so each revenue dollar converts to more profit.

By revenue, highest first: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

AAPL's operating income was **$133.0B**[7] in FY2025 (ended Sep 2025); NVDA's operating income was **$126.4B**[8] in FY2026 (ended Jan 2026).

> **Analyst inference on AAPL** (from the revenue ranking): Its larger revenue base and higher operating income show greater scale, which cuts against reading the margin gap as a broader earnings advantage; the periods also end at different dates.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL has no 10-K on file, so no business or risk factor claims from one. NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [4] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [5] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [8] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

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

_Block sources: S1._

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ NVDA is much the more profitable business per dollar of revenue, but the two earn almost the same absolute profit, and their year-to-date share returns are close. NVDA's FY2026 net income was **$112.5B**[1] against AAPL's **$112.0B**[2] in FY2025.

- **Scale:** AAPL's revenue of **$416.2B**[3] is about **2x**[4][5] NVDA's **$209.9B**[6].
- **Margins:** NVDA leads on every layer.
  - Gross margin is **70.78%**[7] vs **46.91%**[8], a gap of about **23.9 points**[9][10].
  - Operating margin is **60.21%**[11] vs **31.97%**[12], a gap of about **28.2 points**[13][14].
  - Net margin is **53.60%**[15] vs **26.92%**[16], a gap of about **26.7 points**[17][18].
- **Absolute profit:** Operating income is **$126.4B**[19] at NVDA and **$133.0B**[20] at AAPL. Net income is near parity, so NVDA converts far less revenue into the same profit.
- **Share price:** Year to date through Aug 31, 2026, NVDA is up **5.81%**[21] (last close **$178.40**[22]) and AAPL is up **5.34%**[23] (last close **$231.60**[24]). The gap is about **0.5 points**[25][26], so the market has not separated them this year.

**Counterpoint:** AAPL's operating income is **$6.6B**[27][28] larger than NVDA's despite the margin gap, so its profit base is at least as large in dollars. The fiscal years also differ: AAPL's ended 2025-09-27 and NVDA's ended 2026-01-25. NVDA's figures therefore cover a later period, which flatters the comparison somewhat.

Operating cash flow, capex and free cash flow are unavailable for both companies. No analyst consensus is on file for either, so this comparison rests on income-statement margins and price returns alone.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file.

_Cited:_

- [1] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [2] **$112.0B**: engine result: Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B
- [3] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [4] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [5] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [6] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [7] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [8] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [9] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [10] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [11] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [12] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [13] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [14] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [15] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [16] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [17] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [18] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [19] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [20] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [21] **5.81%**: price series
- [22] **$178.40**: price series
- [23] **5.34%**: price series
- [24] **$231.60**: price series
- [25] **5.81%**: price series
- [26] **5.34%**: price series
- [27] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [28] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B

## 8. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

_Analyst commentary:_ NVDA's segment breakdown isn't available here. The only figure I hold is total revenue of **$209.9B**[1] for FY2026 (ended 2026-01-25) [F1], so I can't say how much each segment contributed or which one is strongest or weakest.

Segment detail would normally come from the company's 10-K, and NVDA has no 10-K on file, so there are no business or risk-factor claims to draw on.

Counterpoint: the **$209.9B**[2] total is a single period with no prior-year comparison and no peer figures. It shows scale but not mix. Any view on where growth is coming from or how concentrated revenue is would be speculation until segment data is added.

NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

### Answer B

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

## 9. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ AAPL's fiscal 2025 revenue was about **3.2x**[1][2] NVDA's: **$416.2B**[3] versus **$130.5B**[4], a gap of roughly $285.7B.

- **AAPL:** **$416.2B**[5] for FY2025, ended 2025-09-27 [F1].
- **NVDA:** **$130.5B**[6] for FY2025, ended 2025-01-26 [F2].
- **Relative size:** NVDA's revenue equals about **31%**[7][8] of AAPL's.

**Counterpoint:** the two "fiscal 2025" periods do not line up. NVDA's year ended in January 2025, about eight months before AAPL's ended in September 2025. The comparison therefore does not cover the same stretch of time. NVDA's following fiscal year would overlap AAPL's FY2025 more closely, and the gap could look different on that basis. The packet holds only revenue, so it says nothing about growth, margins, or what drove either figure.

_1 figure could not be traced to the sources read._

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [3] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [4] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [5] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [6] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [7] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [8] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): Its revenue is higher than its peer's, so it is the bigger business by sales.

Of NVDA and AAPL, AAPL's revenue was highest: NVDA **$130.5B**[1], AAPL **$416.2B**[2].

> **Analyst inference on NVDA:** The two fiscal years end in different months, so the revenue comparison covers different calendar windows and is not like-for-like.

Periods: NVDA FY2025 (ended Jan 2025), AAPL FY2025 (ended Sep 2025).

_Cited:_

- [1] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [2] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

## 10. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference:** It is extremely profitable at the operating and net levels, but cash generation cannot be confirmed from the data shown, and the year-to-date share price gain has been modest.

NVDA's revenue was **$209.9B**[1] in FY2026 (ended Jan 2026).

NVDA's gross profit was **$148.6B**[2], operating income **$126.4B**[3] and net income **$112.5B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[5], operating margin **60.21%**[6] and net margin **53.60%**[7] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[9] in the Aug 31, 2026 session.

> **Analyst inference:** Operating cash flow, capex and free cash flow are unavailable, so the strong reported profit cannot be checked against cash, which cuts against the takeaway.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the price return ranking): Its year-to-date share price gain is higher than the peer's, so the market has rewarded it somewhat more so far this year.

By price return, highest first: NVDA **5.81%**[10], AMD **3.17%**[11] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[12] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[13] in the Aug 31, 2026 session.

> **Unverified analyst view on AMD** (not backed by the figures shown): Its smaller gain is still positive, and price return alone says nothing about earnings or valuation, so the lead may not reflect better fundamentals.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

*Engine answer: all 7 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

_Block sources: S1._

*Engine answer: all 7 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- Advanced Micro Devices, Inc., Gross profit, FY2025 (ended 2025-12-27): $17.3B
- Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It converts far more of each revenue dollar into profit at every level than its peer, and its year-to-date share price gain is also higher.

By revenue, highest first: NVDA **$209.9B**[14] (FY2026, ended Jan 2026), AMD **$34.7B**[15] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[16] (FY2026, ended Jan 2026), AMD **49.92%**[17] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[18] (FY2026, ended Jan 2026), AMD **9.78%**[19] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[20] (FY2026, ended Jan 2026), AMD **12.04%**[21] (FY2025, ended Dec 2025).

NVDA's operating income was **$126.4B**[22] and net income **$112.5B**[23] in FY2026 (ended Jan 2026); AMD's operating income was **$3.4B**[24] and net income **$4.2B**[25] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD** (from the operating margin and net margin rankings): Its net margin is above its operating margin, so its bottom line looks better than its core operations alone, which tempers the profitability gap.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$148.6B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- [3] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [4] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [5] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **5.81%**: price series
- [9] **$178.40**: price series
- [10] **5.81%**: price series
- [11] **3.17%**: price series
- [12] **$178.40**: price series
- [13] **$162.30**: price series
- [14] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [15] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [16] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [17] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [18] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [19] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [20] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [21] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [22] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [23] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [24] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [25] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B

### Answer B

**Q:** Analyze NVDA.

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ NVDA's FY2026 (ended 2026-01-25) shows exceptional profitability: revenue of **$209.9B**[1] converted into **$112.5B**[2] of net income. The shares have gained only modestly this year, up **5.81%**[3] from the Dec 31, 2025 close to **$178.40**[4] on Aug 31, 2026.

- **Margins:** Gross profit was **$148.6B**[5], a **70.78%**[6] gross margin. Operating income was **$126.4B**[7], a **60.21%**[8] operating margin. Net income was **$112.5B**[9], a **53.60%**[10] net margin.
- **Cost structure (computed):** Cost of revenue was about $61.3B (**$209.9B**[11] less **$148.6B**[12]). Operating expenses were about $22.2B (**$148.6B**[13] less **$126.4B**[14]), so most gross profit reached operating income.
- **Operating to net:** Net income was $13.9B below operating income, a 6.61-point margin step-down.
- **Share price:** Revenue and profit scale look strong, while the **5.81%**[15] year-to-date return is comparatively muted.

**Counterpoint:** The earnings strength is not confirmed by cash flow. Operating cash flow, capex and free cash flow for the latest fiscal year could not be obtained, so I can't test whether the **$112.5B**[16] of net income turned into cash. Margins also come from a single fiscal year, so I can't say whether they are rising or falling.

**Not available:** analyst consensus, an earnings-release GAAP to non-GAAP reconciliation, industry peers, and 10-K business or risk-factor content.

_4 figures could not be traced to the sources read._

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ **NVDA has led AMD year to date, but only narrowly.** From the Dec 31, 2025 close to the Aug 31, 2026 close, NVDA returned **5.81%**[17] [F1] and AMD returned **3.17%**[18] [F3]. That puts NVDA 2.64 percentage points ahead.

- **NVDA:** the last close on Aug 31, 2026 was **$178.40**[19] [F2].
- **AMD:** the last close on Aug 31, 2026 was **$162.30**[20] [F4].
- **Reading the closes:** the dollar prices say nothing about relative value or performance. Only the percentage returns are comparable.

**Counterpoint:** both gains are in the single digits, so a 2.64-point gap is a thin basis for calling NVDA the stronger stock. The packet holds only price returns for one window, with no fundamentals, valuation or estimates for either company. It shows what the shares did, not why, and the ranking could change with a small move in either price.

_2 figures could not be traced to the sources read._

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

*Engine answer: all 7 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

_Block sources: S1._

*Engine answer: all 7 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- Advanced Micro Devices, Inc., Gross profit, FY2025 (ended 2025-12-27): $17.3B
- Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ **Takeaway:** NVDA is far ahead of AMD on scale and profitability, but the year-to-date share-price gap is narrow: NVDA is up **5.81%**[21] against AMD's **3.17%**[22], a 2.64-point difference.

**Fundamentals (latest fiscal years)**
- **Scale:** NVDA revenue was **$209.9B**[23] for FY2026 (ended 2026-01-25). AMD's was **$34.7B**[24] for FY2025 (ended 2025-12-27). That makes NVDA about **6.0x**[25][26] larger.
- **Gross margin:** NVDA **70.78%**[27] vs AMD **49.92%**[28], a gap of about **20.9 points**[29][30].
- **Operating margin:** NVDA **60.21%**[31] (**$126.4B**[32] operating income) vs AMD **9.78%**[33] (**$3.4B**[34]), a gap of about **50.4 points**[35][36]. This is the widest gap.
- **Net margin:** NVDA **53.60%**[37] (**$112.5B**[38] net income) vs AMD **12.04%**[39] (**$4.2B**[40]), a gap of about **41.6 points**[41][42].

**Market performance (Dec 31, 2025 close to Aug 31, 2026 close)**
- NVDA returned **5.81%**[43] and closed at **$178.40**[44].
- AMD returned **3.17%**[45] and closed at **$162.30**[46].

**Counterpoint:** The market has not rewarded NVDA's margin advantage much this year, as the return gap is only 2.64 points. AMD's profile also has an oddity. Its net income (**$4.2B**[47]) is above its operating income (**$3.4B**[48]), so its net margin (**12.04%**[49]) exceeds its operating margin (**9.78%**[50]). The packet gives no reason for this, so AMD's earnings quality needs checking before leaning on the comparison. NVDA's fiscal year also ends about a month later than AMD's, so the periods are not perfectly aligned.

**Not on file:** AMD has no analyst consensus captured in the 7 days to the cutoff, and no 10-K, so there are no business or risk-factor claims for it.

_2 figures could not be traced to the sources read._

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [3] **5.81%**: price series
- [4] **$178.40**: price series
- [5] **$148.6B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- [6] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [7] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [8] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [9] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [10] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [11] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [12] **$148.6B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- [13] **$148.6B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- [14] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [15] **5.81%**: price series
- [16] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [17] **5.81%**: price series
- [18] **3.17%**: price series
- [19] **$178.40**: price series
- [20] **$162.30**: price series
- [21] **5.81%**: price series
- [22] **3.17%**: price series
- [23] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [24] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [25] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [26] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [27] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [28] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [29] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [30] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [31] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [32] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [33] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [34] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [35] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [36] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [37] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [38] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [39] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [40] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [41] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [42] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [43] **5.81%**: price series
- [44] **$178.40**: price series
- [45] **3.17%**: price series
- [46] **$162.30**: price series
- [47] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [48] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [49] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [50] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

## 11. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

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

_Analyst commentary:_ I can't give a free cash flow figure for AMD from the evidence available. Free cash flow here is operating cash flow less PP&E cash capex, and neither input is available for the periods I was asked to cover.

- **Latest fiscal year:** operating cash flow and capex were not public before the knowledge cutoff, so free cash flow cannot be calculated.
- **Latest fiscal quarter:** the same two inputs are missing, so no quarterly free cash flow can be calculated either.

Because no figure exists for any period, there is nothing to compare across periods or against other companies, and I can't offer a counterpoint grounded in the data. Any number I gave would be a guess rather than something supported by the evidence.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

## 12. margin-trend-loss-quarter (margin trend)

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

_Analyst commentary:_ > **Analyst inference** (from AMD's operating margin ranking and AMD's operating income trend): Operating margin looks to be edging up across the two quarters shown, but the evidence covers only two of the eight quarters asked about, so the full trend cannot be stated.

AMD's operating margin, highest first: Q2 FY2026 (ended Jun 2026) **14.38%**[1], Q1 FY2026 (ended Mar 2026) **14.21%**[2].

AMD's operating income rose from **$1.5B**[3] in Q1 FY2026 (ended Mar 2026) to **$1.6B**[4] in Q2 FY2026 (ended Jun 2026).

AMD's revenue rose from **$10.7B**[5] in Q1 FY2026 (ended Mar 2026) to **$11.2B**[6] in Q2 FY2026 (ended Jun 2026).

> **Analyst inference** (from AMD's operating margin ranking and AMD's operating income and revenue trends): The margin gain between the two quarters is small and rests on just two data points, so it does not establish a sustained expansion.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). Certified figures for AMD went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [2] **14.21%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2026 (ended 2026-03-28): 14.21%
- [3] **$1.5B**: engine result: Advanced Micro Devices, Inc., Operating income, Q1 FY2026 (ended 2026-03-28): $1.5B
- [4] **$1.6B**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2026 (ended 2026-06-27): $1.6B
- [5] **$10.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q1 FY2026 (ended 2026-03-28): $10.7B
- [6] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B

### Answer B

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

_Analyst commentary:_ AMD's operating margin is only visible for the two most recent quarters, and it is edging up: **14.21%**[1] in Q1 FY2026 to **14.38%**[2] in Q2 FY2026, a gain of about 0.17 percentage points. The packet does not hold the other six quarters, so I can't call an eight-quarter trend.

- **Q1 FY2026 (ended 2026-03-28):** operating income of **$1.5B**[3] on revenue of **$10.7B**[4], giving a **14.21%**[5] margin.
- **Q2 FY2026 (ended 2026-06-27):** operating income of **$1.6B**[6] on revenue of **$11.2B**[7], giving a **14.38%**[8] margin.

Revenue rose from **$10.7B**[9] to **$11.2B**[10], about $0.5B, and operating income rose roughly $0.1B on the rounded figures. Profit grew slightly faster than sales, which is why the margin ticked up. Because the dollar figures are rounded, the margin change is better read from the stated percentages than from the dollar amounts.

Counterpoint: a 0.17-point improvement across a single quarter is small and could easily be noise. With no earlier quarters and no GAAP to non-GAAP reconciliation on file, I can't tell whether this is the start of a recovery, a plateau, or a dip within a longer decline. The packet also notes that at least one year in AMD's operating margin history has no value, and that some certified figures went unread.

_4 figures could not be traced to the sources read._

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). Certified figures for AMD went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **14.21%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2026 (ended 2026-03-28): 14.21%
- [2] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [3] **$1.5B**: engine result: Advanced Micro Devices, Inc., Operating income, Q1 FY2026 (ended 2026-03-28): $1.5B
- [4] **$10.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q1 FY2026 (ended 2026-03-28): $10.7B
- [5] **14.21%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2026 (ended 2026-03-28): 14.21%
- [6] **$1.6B**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2026 (ended 2026-06-27): $1.6B
- [7] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [8] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [9] **$10.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q1 FY2026 (ended 2026-03-28): $10.7B
- [10] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
