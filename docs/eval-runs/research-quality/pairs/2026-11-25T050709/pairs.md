# Blinded answer pairs: 2026-11-25T050709

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

# NVDA vs AMD vs AAPL: revenue and margins

**Summary:** NVDA has by far the highest margins and fastest growth. AMD is growing quickly from a much smaller base, with gross margin near 54% but thin operating margins. AAPL is the largest by revenue, growing low single digits, with steady margins that are inching up.

**Data gap:** NVDA's latest filed quarter on file ends **2026-01-25**. Nothing for its fiscal quarters ending around April or July 2026 is in the data. AMD and AAPL run through **2026-06-27**. The NVDA comparison is therefore about five months staler than the other two.

## Latest trailing four quarters

| | NVDA (FY2026, to Jan-26) | AMD (Q3 FY25–Q2 FY26, to Jun-26) | AAPL (Q4 FY25–Q3 FY26, to Jun-26) |
|---|---|---|---|
| Revenue ($M) | 209,911 | 41,446 | 426,266 |
| Gross margin | 70.8% | 53.9% | 47.1% |
| Operating margin | 60.2% | 14.1% | 32.2% |
| Net margin | 53.6% | 13.2% | 27.2% |

## Latest quarter and growth

| | NVDA Q4 FY26 | AMD Q2 FY26 | AAPL Q3 FY26 |
|---|---|---|---|
| Revenue ($M) | 62,100 | 11,200 | 97,100 |
| Revenue vs. same quarter last year | +57.9% | +45.7%* | +3.3% |
| Gross margin | 74.4% | 54.0% | 47.1% |
| Operating margin | 64.9% | 14.4% | 30.7% |
| Net margin | 57.0% | 13.2% | 25.6% |
| Last full-year revenue growth | +60.9% (FY26) | +34.5% (FY25) | +6.4% (FY25) |

*AMD's year-ago quarter (Q2 FY25) was depressed, so +45.7% flatters the growth rate. Q1 FY26 growth of +43.9% is a cleaner read.

## Company notes

**NVDA**
- Margins recovered quarter by quarter through FY2026:
  - Gross margin: 60.5% → 72.4% → 73.4% → 74.4%.
  - Operating margin: 49.1% → 60.8% → 63.2% → 64.9%.
- Full-year FY2026 margins were still below FY2025 (gross 75.0%, operating 62.4%). That is because of the Q1 FY26 dip, when gross margin fell to 60.5% from 73.0% the prior quarter. **There is no filed explanation on file for that dip.**
- Data Center was $55.2B of the $62.1B in Q4 FY26, about 89% of revenue, so growth is highly concentrated in that segment.

**AMD**
- Margins have been flat to slightly up for four quarters:
  - Gross margin: 53.6% → 54.0% → 54.0% → 54.0%.
  - Operating margin: 13.7% → 14.1% → 14.2% → 14.4%.
- Q2 FY25 (gross margin 39.8%, operating loss of $134M) was hit by about $800M of inventory and related charges. The company's filing attributes these to U.S. export controls on its MI308 data center GPUs.
- Net income exceeded operating income in FY2025 ($4,174M vs. $3,392M) and in Q2 FY25. The data doesn't break out the non-operating or tax items behind that.
- Revenue has grown sequentially every quarter since Q1 FY25. Q2 FY26 was up 4.7% on Q1 FY26.

**AAPL**
- Growth is steady at about +3% year on year in each of the last three quarters.
- Margins are edging up. Q3 FY26 gross margin was 47.1% vs. 46.5% a year ago, and operating margin was 30.7% vs. 30.0%.
- Revenue is seasonal: the December quarter is much larger ($128.0B in Q1 FY26).
- Q4 FY24 net income ($14.7B, a 15.5% net margin) is an outlier against a normal operating margin of about 31%. **There is no explanation on file for it.**

## What the data doesn't cover

There is no share count, balance sheet or cash flow data on file. I can't compare valuation (P/E, EV/sales) or cash conversion. I also can't say whether NVDA's growth or margins held after January 2026.

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 4 requested results verified*

- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

*Engine answer: all 4 requested results verified*

- Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Among the two companies with figures, it converts far more of each revenue dollar into profit at every margin level, while the other is the larger business by its latest quarterly revenue.

By revenue, highest first: AAPL **$97.1B**[1], NVDA **$62.1B**[2]. No revenue is shown for AMD.

Of NVDA and AAPL, NVDA's gross margin was highest: NVDA **74.40%**[3], AAPL **47.06%**[4]. No gross margin is shown for AMD.

Of NVDA and AAPL, NVDA's operating margin was highest: NVDA **64.90%**[5], AAPL **30.69%**[6]. No operating margin is shown for AMD.

Of NVDA and AAPL, NVDA's net margin was highest: NVDA **57.00%**[7], AAPL **25.64%**[8]. No net margin is shown for AMD.

Periods: NVDA Q4 FY2026 (ended Jan 2026), AAPL Q3 FY2026 (ended Jun 2026). No figures are shown for AMD.

AMD: the figures were not computed, as the turn reached its limit of model calls. Reading stopped at the turn's limit of model calls, so part of the question may be unanswered.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [2] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [3] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [4] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [5] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [6] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%

## 2. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

*Engine answer: 7 of 11 requested results verified*

- NVIDIA Corporation, EPS (diluted), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
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

*Engine answer: all 7 requested results verified*

- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

_Analyst commentary:_ NVDA's revenue was **$62.1B**[1], gross profit **$46.2B**[2], operating income **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA's gross margin was **74.40%**[5], operating margin **64.90%**[6] and net margin **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

> **Analyst inference:** The shown data lacks cash flow, EPS and consensus, so it cannot confirm that these high margins convert to cash or beat expectations.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

### Answer B

**Q:** Analyze NVDA's latest quarter.

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Bottom line:** This was a strong quarter. Revenue grew 58% year on year to $62.1B, operating margin was about 65%, and margins widened from Q3. Almost all of it came from Data Center (89% of revenue). One important caveat: this quarter ended seven months ago, and nothing newer is on file.

## Headline numbers

| | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross profit | 46,200 | 41,849 | 28,723 | +10.4% | +60.8% |
| Operating income | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income | 35,400 | 31,910 | 22,091 | +10.9% | +60.2% |

USD millions.

## Margins

| | Q4 FY26 | Q3 FY26 | Q2 FY26 | Q1 FY26 | Q4 FY25 |
|---|---|---|---|---|---|
| Gross | 74.4% | 73.4% | 72.4% | 60.5% | 73.0% |
| Operating | 64.9% | 63.2% | 60.8% | 49.1% | 61.1% |
| Net | 57.0% | 56.0% | 56.5% | 42.6% | 56.2% |

- **Gross margin has recovered for three quarters in a row** since the Q1 FY26 dip to 60.5%. It is still below early FY25 levels (78.4% in Q1 FY25, 75.1% in Q2 FY25). The data on file does not explain the Q1 FY26 dip. The only filed explanation in the set covers AMD's export-control charges, and I won't attribute that to NVDA.
- **Operating leverage is clear.** Implied operating expenses (gross profit minus operating income) were about $5.9B. That is roughly flat versus Q3 (~$5.8B) and fell to 9.5% of revenue from 10.2%. Operating income grew faster than revenue both sequentially and year on year.

## Mix

| Segment | Revenue | Share |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

Only this quarter's segment split is on file, so I can't show segment growth rates. The concentration is the main point: the investment case is a Data Center case.

## Full-year context

FY2026 revenue was $209.9B, up 60.9% from $130.5B. Net income was $112.5B, up 54.4%. The four quarters add up exactly to the annual figures. Sequential revenue growth sped up in the second half (+22% in Q3, +9% in Q4) after a slow +6% in Q2.

## Stock

- The last price is $178.40, versus about $169.6 around the quarter-end date. That is roughly +5% since then, and +6.6% since Dec 1 ($167.35).
- **Valuation can't be computed.** There is no share count, so I have no market cap or P/E.
- **Data quality flags:**
  - The quote's "previous close" of $176.10 doesn't match the 8/28 bar close of $178.34.
  - The daily bars rise in an almost perfectly linear way, include holiday dates (12/25, 1/1), and show unusually low volumes.
  - I'd verify the price data before relying on it.

## Gaps to close before acting

- **No Q1 FY27 (Apr 2026) or Q2 FY27 (Jul 2026) results on file.** Both should have been reported by now, so this analysis is likely stale by two prints.
- **Also missing:** guidance, balance sheet and cash flow data, segment history, and any management commentary for NVDA.

## 3. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

# NVDA revenue by segment, Q4 FY2026 (quarter ended 2026-01-25)

| Segment | Revenue (USD M) | Share of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

The segments add up exactly to the reported quarterly revenue of $62,100M.

- **The business is almost entirely Data Center.** It brings in about $8.90 of every $10 of revenue. The four other segments together total $6,900M, about 11%.
- **Gaming is the only other segment of real size.** At about 7% of revenue, it is still less than one-twelfth of Data Center.
- **Pro Viz, Automotive and OEM & Other are each under 2%.** Individually they barely affect the consolidated numbers.

**Context from total revenue:**
- Q4 FY2026 revenue of $62,100M was up about 9% from Q3 FY2026 ($57,006M).
- It was up about 58% from Q4 FY2025 ($39,331M).
- Full-year FY2026 revenue was $209,911M, up about 61% from $130,497M in FY2025.

**Limits of the data:**
- **One quarter only.** The segment split covers Q4 FY2026 alone. I have no segment figures for earlier quarters, so I can't say which segments drove the growth above or how the mix has changed. Given its size, Data Center very likely accounts for most of it, but that is an inference, not something the data shows.
- **Nothing more recent.** No NVDA financials after the quarter ended 2026-01-25 are on file. Any quarters reported since then aren't reflected here.

### Answer B

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

## 4. peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Answer A

**Q:** Compare NVDA with AMD.

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

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It is the far more profitable business on every margin shown, and its scale is larger, though the share price returns this year are close.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

AMD's net income was **$4.2B**[9] and operating income **$3.4B**[10] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD:** Its net income exceeding operating income means below-the-line items lifted its bottom line, so net margin overstates operating profitability.

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [9] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [10] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B

### Answer B

**Q:** Compare NVDA with AMD.

# NVDA vs AMD: comparison from data on file (as of 2026-09-01)

**Bottom line:** NVDA is far larger and much more profitable. Its operating margin runs at roughly 4x AMD's. AMD is growing quickly too, but from a much lower margin base. I can't compare valuation because no share counts, balance sheet or cash-flow data are on file.

## 1. Scale and growth

| | NVDA | AMD |
|---|---|---|
| Latest fiscal year | FY2026 (ended 2026-01-25) | FY2025 (ended 2025-12-27) |
| Revenue | $209,911M | $34,669M |
| YoY revenue growth | +60.9% | +34.5% |
| Latest quarter on file | Q4 FY2026 (ended 2026-01-25) | Q2 FY2026 (ended 2026-06-27) |
| Latest-quarter revenue | $62,100M | $11,200M |
| YoY / QoQ | +57.9% / +8.9% | +45.7% / +4.7% |

NVDA's operating income in a single quarter ($40,300M) is about the same as AMD's trailing-four-quarter revenue ($41,446M).

**Timing gap:** NVDA's latest quarter on file ends in January 2026. AMD's runs to June 2026. NVDA's two quarters after Q4 FY2026 are not in the data, so the latest-quarter rows are not like-for-like in time.

## 2. Profitability

| Margin | NVDA FY2026 | NVDA Q4 FY26 | AMD FY2025 | AMD Q2 FY26 |
|---|---|---|---|---|
| Gross | 70.8% | 74.4% | 49.9% | 54.0% |
| Operating | 60.2% | 64.9% | 9.8% | 14.4% |
| Net | 53.6% | 57.0% | 12.0% | 13.2% |

Both companies are widening margins:
- **AMD:** operating margin has risen each quarter, from 13.7% in Q3 FY25 to 14.4% in Q2 FY26. Trailing-four-quarter operating margin is about 14.1%.
- **NVDA:** gross margin went from 60.5% in Q1 FY26 to 74.4% in Q4 FY26.

## 3. One-off disruptions

- **AMD Q2 FY2025** shows an operating loss of $134M and a 39.8% gross margin. AMD's 8-K attributes this to U.S. export controls on its MI308 data center GPUs, which led to "approximately $800 million in inventory and related charges."
  - This makes AMD's +45.7% YoY growth in Q2 FY26 look somewhat flattered.
  - It also depresses AMD's FY2025 operating margin.
- **NVDA Q1 FY2026** also shows a gross-margin dip, to 60.5% from 73.0% the quarter before. No filed explanation for it is on file, so I can't attribute a cause.

## 4. Mix and concentration

- **NVDA:** Data Center was $55,200M in Q4 FY26, about 89% of revenue. Gaming was $4,300M, and the remaining segments are small.
- **AMD:** no segment breakdown is on file, so I can't compare exposure.

## 5. Share price (daily bars)

| | 2025-12-01 close | 2026-08-31 close | Change |
|---|---|---|---|
| NVDA | 167.35 | 178.40 | +6.6% |
| AMD | 156.68 | 162.30 | +3.6% |

**Data-quality caveats on the price series:**
- Both series rise in near-constant daily increments, with volume stepping up exactly 10,000 shares a day.
- They include bars on 2025-12-25 and 2026-01-01, which are market holidays.
- The quotes' "previous close" figures don't match the prior bars:
  - NVDA: quote shows 176.10, but the 08-28 bar closed at 178.34.
  - AMD: quote shows 164.90, but the 08-28 bar closed at 162.27.

I would not draw conclusions about momentum or relative performance from this series without verifying it.

## Not covered by the data

- Valuation: market cap, P/E, EV
- Balance sheet, cash flow and capex
- Guidance
- NVDA results after January 2026
- AMD segment mix

These would be needed before turning this into a relative-value view.

## 5. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

**AMD's Q2 FY2025 operating loss came from a one-time charge of about $800 million tied to U.S. export controls, which pushed operating margin to -1.7%.** Without that charge, the quarter would have been modestly profitable.

**What the company said.** In its Q2 FY2025 earnings release (8-K, 2025-08-05), AMD stated:

> "...our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges."

**How it shows up in the numbers (USD millions)**

| Quarter | Revenue | Gross margin | Operating expenses* | Operating income | Operating margin |
|---|---|---|---|---|---|
| Q1 FY2025 | 7,438 | 50.2% | 2,929 | 806 | 10.8% |
| **Q2 FY2025** | **7,685** | **39.8%** | **3,193** | **-134** | **-1.7%** |
| Q3 FY2025 | 9,246 | 53.6% | 3,683 | 1,270 | 13.7% |

*Operating expenses here are gross profit minus operating income, which I derived; they are not reported line items.*

**What drove it**

1. **Gross margin fell about 10 points.** Revenue rose slightly from Q1, but gross profit fell from 3,735 to 3,059. The $800M charge is about 10.4% of Q2 revenue, which roughly matches the drop. That pattern fits the charge landing mainly in cost of sales. However, the filing excerpt does not say which line items absorbed it, so this is an inference.
2. **Illustrative add-back.** If the full $800M sat above operating income:
   - Gross margin would have been about 50.2%, flat with Q1.
   - Operating income would have been about $666M, an operating margin of about 8.7%.
3. **Operating expenses also rose.** They grew about $264M from Q1 (2,929 to 3,193). So even after the add-back, operating margin would still have been below Q1's 10.8%. The data on file does not explain that increase.

**It was a one-off.** Margins recovered right away: gross margin was 53.6% in Q3 FY2025, and operating margin rose to 13.7%, then about 14% in Q4 FY2025, Q1 FY2026 and Q2 FY2026.

**One oddity.** Net income was positive ($872M) in Q2 despite the operating loss. The data on file does not show the non-operating or tax items behind that gap, so I can't explain it from these figures.

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: 5 of 6 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- Advanced Micro Devices, Inc., EPS (diluted), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference:** Its operating loss came despite a positive gross profit, so costs below gross profit absorbed the gross profit; the data shown does not say why.

AMD's revenue was **$7.7B**[1] in Q2 FY2025 (ended Jun 2025).

AMD's gross profit was **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[3] and operating margin **-1.74%**[4] in Q2 FY2025 (ended Jun 2025).

AMD's net income was **$872.0M**[5] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Its positive net income alongside an operating loss means items outside operations lifted the bottom line, so net income does not reflect operating performance.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [4] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [5] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M

## 6. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

# AAPL vs. NVDA

**In short:** NVDA earns roughly the same net income as Apple on about half the revenue, and it is still growing near 60% a year. Apple grows in the low single digits at about half NVDA's margins. Two limits apply. NVDA's latest filed quarter ended 2026-01-25, about seven months stale, while AAPL's ended 2026-06-27. And there is no data on file to support a valuation comparison.

## Latest fiscal years

The fiscal years don't line up. NVDA's year ends in late January and AAPL's in late September.

| | AAPL FY2025 (to 2025-09-27) | NVDA FY2026 (to 2026-01-25) |
|---|---|---|
| Revenue | $416.2B | $209.9B |
| Revenue growth y/y | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net income | $112.0B | $112.5B |
| Net income growth y/y | +19.5% | +54.4% |

## Roughly overlapping quarters (Oct–Dec 2025)

| | AAPL Q1 FY26 (9/28–12/27) | NVDA Q4 FY26 (10/27–1/25) |
|---|---|---|
| Revenue | $128.0B (+3.0% y/y) | $62.1B (+57.9% y/y) |
| Operating income | $44.1B (34.5%) | $40.3B (64.9%) |
| Net income | $37.5B | $35.4B |

## Trajectory

- **AAPL** grew revenue steadily but slowly in each FY2026 quarter: +3.0%, +3.5% and +3.3% y/y.
  - The latest quarter (to 2026-06-27) had $97.1B revenue, a 47.1% gross margin and a 30.7% operating margin.
  - Net income in that quarter was $24.9B, up 6.3% y/y.
  - Trailing four-quarter revenue is about $426.3B and net income about $115.8B.
- **NVDA** grew revenue every quarter, from $44.1B to $62.1B across FY2026.
  - Gross margin dipped to 60.5% in Q1 FY2026 and recovered to 74.4% by Q4. There is no filed explanation on file for that dip.
  - The business is concentrated: Data Center was $55.2B of Q4 revenue, about 89%.
- **NVDA gap:** quarters ending around April and July 2026 are not on file. If they have been reported, they are missing from what I have.

## Stock performance (2025-12-01 close to 2026-08-31 close)

- AAPL rose from $218.38 to $231.60, about +6.1%.
- NVDA rose from $167.35 to $178.40, about +6.6%.
- So the two were essentially in line, despite very different fundamental growth.

**Data-quality caveats on the price series:**
- The bars rise almost linearly, and volume increases by exactly 10,000 shares every day.
- They include sessions on 2025-12-25 and 2026-01-01.
- The quoted "previous close" figures don't match the bar history (AAPL $229.80 vs. a $231.53 bar close; NVDA $176.10 vs. $178.34).

I'd treat the price data as indicative only.

## What I can't tell you

There are no share counts, EPS, balance sheets or cash flows on file. That means I can't compute market cap, P/E, FCF yield, net cash or capital returns, so I can't say which stock is cheaper on earnings. There is also no AAPL segment breakdown on file to compare against NVDA's Data Center concentration.

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: all 7 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- Apple Inc., Gross profit, FY2025 (ended 2025-09-27): $195.2B
- Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B
- Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%

_Block sources: S1._

*Engine answer: all 7 requested results verified*

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is far stronger at every margin level, while the other company earns similar net income on a much larger revenue base, so the comparison is about margin quality versus scale.

By revenue, highest first: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[7] (FY2025, ended Sep 2025), NVDA **53.60%**[8] (FY2026, ended Jan 2026).

NVDA's net income was **$112.5B**[9] in FY2026 (ended Jan 2026); AAPL's net income was **$112.0B**[10] in FY2025 (ended Sep 2025).

> **Analyst inference on AAPL** (from the revenue ranking): The fiscal years ended at different dates, so the profit comparison is not strictly like for like, which tempers the margin conclusion.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL has no 10-K on file, so no business or risk factor claims from one. NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [4] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [5] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [8] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [9] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [10] **$112.0B**: engine result: Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B

## 7. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

# NVDA: analysis from data on file as of 2026-09-01

**Bottom line:** Through fiscal Q4 FY2026 (ended 2026-01-25), NVIDIA kept growing fast with very high margins, and Data Center made up almost all of revenue. The financials on file are about seven months old, though, and nothing is on file to value the stock. Treat this as a fundamentals review, not a price call.

## 1. Gaps in the data

- **The latest financials are stale.** The most recent quarter on file ended 2026-01-25. Quarters ending in roughly April and July 2026 would normally be reported by 2026-09-01, but none are on file. I can't tell you how the business has done since January.
- **No valuation inputs.** There is no share count, EPS, balance sheet or cash flow. I can't compute market cap, P/E, EV or FCF yield.
- **No NVIDIA filed explanations.** Margin moves below are described, not explained.
- **The price data has problems:**
  - The quote shows a previous close of 176.10, but the 2026-08-28 bar closes at 178.34. AMD and AAPL show the same kind of mismatch.
  - The bars include 2025-12-25 and 2026-01-01, which are market holidays.
  - Price climbs about $0.05–0.06 every session, and volume rises by exactly 10,000 shares a day.

  The price series looks smoothed or synthetic, so I would not draw trading conclusions from it.

## 2. Growth

| | FY2025 | FY2026 | YoY |
|---|---|---|---|
| Revenue | 130,497 | 209,911 | +60.9% |
| Operating income | 81,454 | 126,388 | +55.2% |
| Net income | 72,880 | 112,507 | +54.4% |

USD millions. The quarterly figures sum exactly to the annual totals.

Revenue grew every quarter in FY2026:

| Quarter | Revenue | QoQ growth |
|---|---|---|
| Q1 | 44,062 | +12.0% |
| Q2 | 46,743 | +6.1% |
| Q3 | 57,006 | +22.0% |
| Q4 | 62,100 | +8.9% |

Q4 FY2026 revenue was up 57.9% on Q4 FY2025.

## 3. Margins

| Quarter | Gross margin | Operating margin |
|---|---|---|
| Q1 FY25 | 78.4% | 64.9% |
| Q4 FY25 | 73.0% | 61.1% |
| **Q1 FY26** | **60.5%** | **49.1%** |
| Q2 FY26 | 72.4% | 60.8% |
| Q3 FY26 | 73.4% | 63.2% |
| Q4 FY26 | 74.4% | 64.9% |

- **The Q1 FY26 dip is the standout.** Gross margin fell about 12.5 points from the prior quarter, even though revenue still grew 12%.
  - Margins then recovered in each of the next three quarters.
  - By Q4 FY26, operating margin was back to Q1 FY25's level, but gross margin was still about 4 points lower.
  - There is no NVIDIA explanation on file for the dip. AMD's filing says US export controls on its MI308 GPU cost it about $800M in its quarter ended 2025-06-28. That period overlaps NVIDIA's dip, but I can't attribute NVIDIA's dip to the same cause from this data.
- **Full year:** gross margin fell from 75.0% to 70.8%, and operating margin from 62.4% to 60.2%. Earnings grew a bit more slowly than revenue.

## 4. Business mix (Q4 FY26)

- Data Center brought in $55.2B, or 88.9% of revenue.
- Gaming was $4.3B (6.9%).
- ProViz, Auto and OEM/Other together were about 4%.

The company is effectively a single-segment data-center story. Only one quarter of segment data is on file, so I can't show how the mix has changed.

## 5. Peer context

These periods don't line up exactly, so the comparison is approximate.

- AMD's latest quarter (ended 2026-06-27) had revenue of $11.2B, a 54.0% gross margin and a 14.4% operating margin.
- AMD's last four quarters add up to about $41.4B, roughly one-fifth of NVIDIA's FY2026 revenue.
- NVIDIA's operating margin is about four times AMD's.

## 6. Price (with the data caveats in section 1)

| | 2025-12-01 close | 2026-08-31 close | Change |
|---|---|---|---|
| NVDA | 167.35 | 178.40 | +6.6% |
| AAPL | | | +6.1% |
| AMD | | | +3.6% |

NVDA's range over the period was 165.68–180.18. The stock has risen far less than reported earnings, but without a share count I can't say whether the valuation has de-rated.

## What I'd need to go further

1. Q1 and Q2 FY2027 results. These matter most: do growth and the margin recovery continue?
2. Shares outstanding or EPS, for valuation.
3. Balance sheet and cash flow.
4. Management commentary on the Q1 FY26 gross-margin dip.
5. A verified price feed.

**Q:** Compare it with AMD YTD.

# NVDA vs AMD, year to date (through 2026-08-31)

**Bottom line:** NVDA is ahead YTD, up 5.8% against AMD's 3.2%. On fundamentals, though, only AMD has 2026 results on file. AMD's first half shows strong growth on an easy base. For NVDA I can't say anything about 2026 operating performance.

## 1. Share price YTD

Base is the 2025-12-31 close.

| | 2025-12-31 close | 2026-08-31 close | YTD change | YTD range (low–high) |
|---|---|---|---|---|
| NVDA | 168.60 | 178.40 | **+5.8%** | 166.97 – 180.18 |
| AMD | 157.32 | 162.30 | **+3.2%** | 155.77 – 163.92 |

- **NVDA leads by about 2.6 percentage points.** Prices exclude dividends.
- **Both made new highs on the final day**, and neither shows any pullback along the way.

**The same data caveats apply, and they're worse when you compare the two:**
- Both series climb by tiny fixed steps every session, with no down days.
- The two stocks have **identical volume figures** on every day, rising by exactly 10,000 shares a session.
- Both include bars for the 2026-01-01 holiday.
- The quotes' previous-close figures don't match the bars:
  - NVDA's quote says 176.10; the 2026-08-28 bar closed at 178.34.
  - AMD's quote says 164.90; the bar closed at 162.27.
  - Taken at face value, the quotes would mean NVDA rose about 1.3% on the day and AMD fell about 1.6%. I can't confirm either move.

I'd treat the YTD return gap as indicative only until it's checked against a verified price feed.

## 2. Fundamentals reported for 2026

**AMD: first half of 2026 vs first half of 2025** (two quarters ended 2026-06-27, USD millions)

| | H1 2025 | H1 2026 | Change |
|---|---|---|---|
| Revenue | 15,123 | 21,900 | +44.8% |
| Gross margin | 44.9% | 54.0% | +9.1 pts |
| Operating income | 672 | 3,130 | ~4.7x |
| Net income | 1,581 | 2,880 | +82.2% |

- Revenue grew 43.9% year on year in Q1 and 45.7% in Q2.
- The prior-year base is depressed. AMD's filing says US export controls on its MI308 GPU caused about $800M of inventory and related charges in Q2 FY2025. That flatters the margin and profit comparisons; the revenue comparison is cleaner.

**NVDA:** nothing on file covers 2026 beyond the quarter ended 2026-01-25.
- Its Q1 and Q2 FY2027 quarters, which cover roughly February to July 2026, are missing.
- The most recent read is Q4 FY2026: revenue up 57.9% year on year, operating margin 64.9%.

## 3. How to read it

- **On growth:** NVDA's last reported growth rate (about 58%) is still above AMD's latest (about 46%). But that's a January quarter compared with a June quarter, so it isn't a like-for-like comparison.
- **On profitability:** NVDA's operating margin is several times AMD's. AMD's Q2 FY2026 operating margin was 14.4%.
- **On price:** NVDA has done slightly better, but neither stock has moved much against the earnings growth on file. Without share counts I can't tell whether either has de-rated or which is cheaper.

## To make this a real comparison I'd need

1. NVDA's Q1 and Q2 FY2027 results.
2. Share counts or EPS for both companies.
3. A verified price feed.

**Q:** Explain the differences and show the evidence.

# NVDA vs AMD: the differences and the evidence

**Bottom line:** Five differences are clearly supported by the numbers: scale, growth rate, gross margin, cost intensity, and how current each company's data is. Only one difference has a filed explanation on file: AMD's 2025 margin dip, caused by export controls. Nothing on file explains why NVDA's stock has outperformed YTD, and the price data itself looks unreliable.

All figures are in USD millions unless marked as a price or a percentage. Ratios are my calculations from the reported figures.

---

## 1. Share price: NVDA +5.8% vs AMD +3.2% YTD. Cause unknown.

**Evidence:**

| | 2025-12-31 close | 2026-08-31 close | Change |
|---|---|---|---|
| NVDA | 168.60 | 178.40 | +9.80 (+5.81%) |
| AMD | 157.32 | 162.30 | +4.98 (+3.17%) |

- **The gap comes from a steady drift, not from events.** NVDA closes rise about $0.05–0.06 every session (for example, 178.29 → 178.34 → 178.40 over the last three days). AMD closes rise about $0.03 a session (162.24 → 162.27 → 162.30). Neither stock has a single down day, gap or jump that I can tie to an earnings release or news.
- **The volume figures are identical across all three tickers.**

  | Date | NVDA | AMD | AAPL |
  |---|---|---|---|
  | 2026-01-02 | 1,250,000 | 1,250,000 | 1,250,000 |
  | 2026-08-31 | 2,960,000 | 2,960,000 | 2,960,000 |

  Real trading data would not look like this.
- **The quotes' previous-close figures don't match the bars.** NVDA's quote says 176.10 against a bar close of 178.34; AMD's says 164.90 against 162.27.

**Conclusion:** I can measure the gap, but nothing on file explains it, and the price series looks synthetic or smoothed. I would not build a relative-performance thesis on it.

---

## 2. Scale: NVDA is about 5.5 times AMD's revenue and about 24 times its profit

| Latest quarter | Revenue | Operating income | Net income |
|---|---|---|---|
| NVDA Q4 FY26 (ended 2026-01-25) | 62,100 | 40,300 | 35,400 |
| AMD Q2 FY26 (ended 2026-06-27) | 11,200 | 1,610 | 1,480 |
| NVDA ÷ AMD | 5.5x | 25.0x | 23.9x |

- **Full year:** NVDA's FY2026 revenue was 209,911. AMD's was 34,669 for FY2025 and about 41,446 for its last four quarters.
- **Caveat:** the quarters compared are five months apart (see section 6).

---

## 3. Growth: NVDA grows faster; AMD is speeding up

**Year-on-year revenue growth by quarter:**

| NVDA quarter | YoY | AMD quarter | YoY |
|---|---|---|---|
| Q1 FY26 (to Apr-25) | +69.2% | Q3 FY25 (to Sep-25) | +35.6% |
| Q2 FY26 (to Jul-25) | +55.6% | Q4 FY25 (to Dec-25) | +34.5% |
| Q3 FY26 (to Oct-25) | +62.5% | Q1 FY26 (to Mar-26) | +43.9% |
| Q4 FY26 (to Jan-26) | +57.9% | Q2 FY26 (to Jun-26) | +45.7% |

- **NVDA:** growth has stayed between 55% and 70% each quarter with no clear trend.
- **AMD:** growth moved up from about 35% to about 45%. Part of that is easier comparisons: its Q2 FY25 base quarter was hit by export controls.
- **No explanation of the drivers is on file for either company.**

---

## 4. Margins: a structural gap of about 20 points in gross margin and about 50 points in operating margin

**Gross margin:**

| | Oldest quarters on file | Dip quarter | Latest 3 quarters |
|---|---|---|---|
| NVDA | 78.4% (Q1 FY25) → 73.0% (Q4 FY25) | **60.5%** (Q1 FY26) | 72.4%, 73.4%, 74.4% |
| AMD | 50.1%, 51.0%, 50.2% (Q3 FY24–Q1 FY25) | **39.8%** (Q2 FY25) | 53.6%, 54.0%, 54.0% (Q3 FY25–Q1 FY26); also 54.0% in Q2 FY26 |

**The real gap is below gross profit: AMD spends far more relative to revenue.**

Here "operating costs" means gross profit minus operating income.

| Latest quarter | Operating costs | As % of revenue | Operating margin |
|---|---|---|---|
| NVDA Q4 FY26 | 46,200 − 40,300 = 5,900 | 9.5% | 64.9% |
| AMD Q2 FY26 | 6,050 − 1,610 = 4,440 | 39.6% | 14.4% |

- **Evidence of operating leverage:** NVDA spends only about a third more than AMD in absolute dollars on these costs, but on 5.5 times the revenue.
- **What's missing:** no breakdown into R&D, SG&A or other items is on file, so I can't say which line drives it.

---

## 5. The 2025 margin dips: AMD's is explained, NVDA's is not

Both companies had a sharp one-quarter margin drop in overlapping periods.

| | Quarter | Gross margin | Change from prior quarter | Filed explanation |
|---|---|---|---|---|
| AMD | Q2 FY25 (2025-03-30 to 06-28) | 39.8% | −10.4 pts | **Yes:** "approximately $800 million in inventory and related charges" from US export controls on MI308 GPUs (8-K, 2025-08-05) |
| NVDA | Q1 FY26 (2025-01-27 to 04-27) | 60.5% | −12.5 pts | **None on file** |

- **Testing AMD's explanation:** suppose the whole $800M sat in cost of sales. The filing doesn't say which line it hit, so this is my assumption. Gross profit would then be 3,859 and gross margin about 50.2%, which is exactly in line with AMD's previous three quarters. AMD also swung to an operating loss of −134 that quarter, which fits a one-off charge.
- **NVDA:** the timing overlaps with AMD's, and the pattern looks similar: a sharp drop, then a full recovery within one to three quarters. But I can't attribute NVDA's dip to export controls without an NVIDIA filing saying so.

---

## 6. Other differences worth knowing

- **Net income vs operating income.**
  - AMD's net income is often above its operating income: FY2024 net 1,641 vs operating 401; FY2025 4,174 vs 3,392; Q2 FY25 872 vs −134. That points to sizeable non-operating gains or tax benefits.
  - NVDA's net income consistently runs at about 87–92% of operating income.
  - Nothing on file explains AMD's pattern, so AMD's reported earnings quality is harder to judge from this data.
- **Revenue concentration.**
  - NVDA: Data Center was 55,200 of 62,100 in Q4 FY26, or 88.9%.
  - AMD: no segment data on file, so I can't compare exposure.
- **How current the data is.** NVDA's fiscal year ends in late January and AMD's in late December. NVDA's latest quarter ended 2026-01-25; AMD's ended 2026-06-27. AMD's numbers are therefore five months more current. NVDA's quarters ending around April and July 2026 are missing even though they should have been reported by now. That makes any 2026 fundamental comparison one-sided.

---

## Summary

| Difference | Supported by the numbers? | Cause on file? |
|---|---|---|
| NVDA's YTD outperformance (+2.6 pts) | Yes, but the price data is suspect | No |
| Scale (about 5.5x revenue) | Yes | n/a |
| NVDA growing faster; AMD speeding up | Yes | No |
| Gross and operating margin gap | Yes | No cost breakdown on file |
| AMD's Q2 FY25 margin dip | Yes | **Yes:** about $800M export-control charge |
| NVDA's Q1 FY26 margin dip | Yes | No |
| AMD net income above operating income | Yes | No |

To turn this from description into explanation, I'd need:
1. NVDA's Q1 and Q2 FY2027 results.
2. Cost breakdowns for both companies.
3. AMD segment data.
4. Share counts.
5. A verified price feed.

### Answer B

**Q:** Analyze NVDA.

*Engine answer: 7 of 11 requested results verified*

- NVIDIA Corporation, EPS (diluted), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
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

_Analyst commentary:_ NVDA's operating income was **$126.4B**[1] and net income **$112.5B**[2] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[3], operating margin **60.21%**[4] and net margin **53.60%**[5] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[6] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[7] in the Aug 31, 2026 session.

> **Analyst inference:** Its profitability is very high, with most of each revenue dollar converting to operating income, while the share price gain this year has been modest by comparison.

> **Analyst inference:** The counterpoint is that the profitability evidence covers a single fiscal year, so it shows no trend in margins or growth, and its cash flow and per-share earnings are unavailable to test the earnings quality.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[8], AMD **3.17%**[9] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[10] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[11] in the Aug 31, 2026 session.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is a price-only result, and price return alone says nothing about fundamentals or valuation, so it does not show which company is the better business.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

*Engine answer: all 14 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | $209.9B (FY2026 (ended 2026-01-25)) | $148.6B (FY2026 (ended 2026-01-25)) | $126.4B (FY2026 (ended 2026-01-25)) | $112.5B (FY2026 (ended 2026-01-25)) | 70.78% (FY2026 (ended 2026-01-25)) | 60.21% (FY2026 (ended 2026-01-25)) | 53.60% (FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $34.7B (FY2025 (ended 2025-12-27)) | $17.3B (FY2025 (ended 2025-12-27)) | $3.4B (FY2025 (ended 2025-12-27)) | $4.2B (FY2025 (ended 2025-12-27)) | 49.92% (FY2025 (ended 2025-12-27)) | 9.78% (FY2025 (ended 2025-12-27)) | 12.04% (FY2025 (ended 2025-12-27)) |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, net margin, and price return rankings): Its fundamentals are far stronger, with higher scale and margins at every level, and its year-to-date share price return is also higher.

By revenue, highest first: NVDA **$209.9B**[12] (FY2026, ended Jan 2026), AMD **$34.7B**[13] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[14] (FY2026, ended Jan 2026), AMD **49.92%**[15] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[16] (FY2026, ended Jan 2026), AMD **9.78%**[17] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[18] (FY2026, ended Jan 2026), AMD **12.04%**[19] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**[20], AMD **3.17%**[21] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

AMD's revenue was **$34.7B**[22], operating income **$3.4B**[23] and net income **$4.2B**[24] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD:** Its net income is higher than its operating income, so its bottom-line margin overstates how profitable its core operations are.

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [2] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [5] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [6] **5.81%**: price series
- [7] **$178.40**: price series
- [8] **5.81%**: price series
- [9] **3.17%**: price series
- [10] **$178.40**: price series
- [11] **$162.30**: price series
- [12] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [13] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [14] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [15] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [16] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [17] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [18] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [19] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [20] **5.81%**: price series
- [21] **3.17%**: price series
- [22] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [23] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [24] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B

## 8. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

I can't give you AMD's free cash flow from what's on file. We only have income statement lines (revenue, gross profit, operating income, net income), daily prices, and one 8-K excerpt. There is no operating cash flow and no capex for AMD (or NVDA or AAPL), so free cash flow can't be calculated or estimated responsibly.

The closest earnings figures we do have (USD millions) are below. Neither is a substitute for FCF, since working capital, capex and non-cash items aren't visible.

| Period | Operating income | Net income |
|---|---|---|
| Q2 FY2026 (ended 2026-06-27) | 1,610 | 1,480 |
| Trailing 4 quarters (Q3 FY25–Q2 FY26) | 5,850 | 5,473 |
| FY2025 (ended 2025-12-27) | 3,392 | 4,174 |

Two things to keep in mind when reading these:
- **Q2 FY2025** had an operating loss of -134. AMD's 8-K attributes this to about $800M of inventory and related charges tied to US export controls on its MI308 GPUs. Inventory charges like that don't necessarily move cash in the same period, so earnings and cash flow could diverge there.
- **FY2025 net income (4,174) is higher than operating income (3,392).** The data doesn't explain the gap, but it means net income isn't a clean proxy for operating cash generation either.

If you want an FCF figure, we'd need AMD's cash flow statement from the 10-Q/10-K: cash from operations less purchases of property and equipment.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

## 9. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

# NVDA gross margin in Q1 FY2026

**Gross margin fell sharply in Q1 FY2026 and recovered the next quarter.** The margin was **60.5%**, down from **73.0%** in Q4 FY2025, a drop of about 12.5 points. Gross profit fell in dollars even though revenue grew.

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | 78.4% |
| Q2 FY2025 | 30,040 | 22,574 | 75.1% |
| Q3 FY2025 | 35,082 | 26,156 | 74.6% |
| Q4 FY2025 | 39,331 | 28,723 | 73.0% |
| **Q1 FY2026** | **44,062** | **26,668** | **60.5%** |
| Q2 FY2026 | 46,743 | 33,853 | 72.4% |
| Q3 FY2026 | 57,006 | 41,849 | 73.4% |
| Q4 FY2026 | 62,100 | 46,200 | 74.4% |

**Key points**
- **Revenue rose but gross profit fell.** Revenue grew about 12% quarter over quarter (39,331 → 44,062). Gross profit fell about 7% (28,723 → 26,668).
- **Rough size of the shortfall.** At the prior quarter's 73.0% margin, Q1 FY2026 gross profit would have been about $32.2B. That implies a gap of roughly **$5.5B**. This is my calculation, not a reported charge.
- **The hit carried through the P&L.**
  - Operating income fell from $24.0B to $21.6B.
  - Net income fell from $22.1B to $18.8B.
- **The margin recovered quickly.** It returned to 72.4% in Q2 FY2026 and reached 74.4% by Q4 FY2026. That pattern looks like a one-quarter event, not a reset in structural margin.
- **The longer trend was already drifting down before Q1.** Margin slid from 78.4% to 73.0% across FY2025. The Q1 FY2026 drop came on top of that drift.

**Why it happened: not covered by the data.** I have no NVDA filing or management commentary explaining the Q1 FY2026 margin. The only filed explanation on file is AMD's. AMD attributes roughly $800M of inventory and related charges in its quarter ended June 2025 to U.S. export controls on its MI308 data center GPUs. That points to a possible industry-wide factor in that period. But it is AMD's disclosure, and I can't use it to explain NVDA's number. Confirming the driver would need NVDA's own Q1 FY2026 filing.

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

_Analyst commentary:_ > **Analyst inference:** Its gross margin dropped sharply in the latest quarter versus both the prior quarter and the year-earlier quarter, even as revenue and gross profit dollars grew year over year.

NVDA's gross margin was **60.52%**[1], gross profit **$26.7B**[2] and revenue **$44.1B**[3] in Q1 FY2026 (ended Apr 2025).

NVDA's gross profit rose from **$20.4B**[4] in Q1 FY2025 (ended Apr 2024) to a high of **$28.7B**[5] in Q4 FY2025 (ended Jan 2025), then pulled back to **$26.7B**[6] in Q1 FY2026 (ended Apr 2025), still above where it started.

The figures do not show why NVDA's gross margin changed.

> **Analyst inference** (from NVDA's gross profit trend): Growth in revenue did not carry through to gross profit last quarter, so the margin decline outweighed the sales growth sequentially.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file.

_Cited:_

- [1] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [2] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [3] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [4] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- [5] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [6] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B

## 10. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

_Block sources: S1._

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads.

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

# AMD operating margins: the last eight quarters

AMD's operating margin moved up from about 11% to about 14% over the last eight quarters. Q2 FY2025 broke the pattern with a one-off charge. Since Q3 FY2025, margins have held near 14% and crept up only slightly.

| Quarter | Revenue ($M) | Operating income ($M) | Operating margin | Gross margin |
|---|---|---|---|---|
| Q3 FY2024 | 6,819 | 724 | 10.6% | 50.1% |
| Q4 FY2024 | 7,658 | 871 | 11.4% | 51.0% |
| Q1 FY2025 | 7,438 | 806 | 10.8% | 50.2% |
| Q2 FY2025 | 7,685 | -134 | -1.7% | 39.8% |
| Q3 FY2025 | 9,246 | 1,270 | 13.7% | 53.6% |
| Q4 FY2025 | 10,300 | 1,450 | 14.1% | 54.0% |
| Q1 FY2026 | 10,700 | 1,520 | 14.2% | 54.0% |
| Q2 FY2026 | 11,200 | 1,610 | 14.4% | 54.0% |

**Q2 FY2025.** AMD's earnings release says US export controls on its MI308 data center GPUs led to about $800M of inventory and related charges that quarter. Adding back roughly $800M is my own rough adjustment, and it assumes the full charge sat above the operating line, which the filing doesn't break out. On that basis:
- Operating income would have been about $666M, a margin of about 8.7%.
- Gross margin would have been about 50.2%, in line with the prior three quarters.

So underlying profitability that quarter was a bit soft, not negative.

**What drove the step-up.** Operating expenses, taken as gross profit minus operating income, have run at about 39.5–40% of revenue in every quarter except Q2 FY2025. That includes the most recent quarter, at 39.6%. The roughly 3-point gain in operating margin therefore mirrors the move in gross margin, from about 50–51% to about 54%. It is not opex leverage: AMD has grown spending roughly in line with revenue, which rose from $6.8B to $11.2B a quarter.

**Recent trajectory.** Gross margin has been flat at about 54% for three straight quarters. Operating margin has edged up only about 0.7 points across the last four quarters, from 13.7% to 14.4%. Further expansion would need either another gross margin gain or opex growing more slowly than revenue. Neither shows up in the reported figures yet.

**Limits of the data.** I have no segment breakdown, guidance, or opex line items (R&D, SG&A, amortization) for AMD. That means I can't say which products drove the gross margin improvement or how much of opex is non-cash amortization.

## 11. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): Its revenue base is larger than its peer's, so it is the bigger business by sales.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on NVDA:** The two fiscal years end at different points in the calendar, so the comparison does not cover the same window and the gap is not like-for-like.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

## NVDA vs. AAPL: fiscal 2025 revenue

| | NVDA FY2025 | AAPL FY2025 |
|---|---|---|
| Period | 2024-01-29 to 2025-01-26 | 2024-09-29 to 2025-09-27 |
| Revenue | $130,497M | $416,161M |
| Prior fiscal year | Not on file | $391,035M (FY2024) |
| YoY growth | Can't compute from the data | +6.4% |

Apple's FY2025 revenue was about **3.2x** NVIDIA's, a gap of roughly **$285.7B**.

**The labels don't line up.** NVIDIA's "FY2025" ended in January 2025. Apple's ended in September 2025. The two periods overlap by only about four months, so this is not a same-period comparison.

**A closer-aligned comparison** uses NVIDIA's four quarters from 2024-10-28 to 2025-10-26. That is Q4 FY2025 through Q3 FY2026, offset from Apple's year by about a month. Those quarters sum to **$187,142M**. On that basis Apple is about 2.2x NVIDIA, not 3.2x. The gap narrows because NVIDIA revenue rose every quarter in that window, from $39.3B to $57.0B.

**On growth:**
- **NVIDIA** has no FY2024 annual figure on file, so I can't give FY2025 YoY growth. Its FY2026 revenue ($209,911M) was up about 61% on FY2025.
- **Apple** grew a more modest 6.4% in FY2025.

## 12. missing-segments (missing data)

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

**I can't break AMD's revenue down by segment from what we have.** Our AMD data covers only consolidated totals (revenue, gross profit, operating income, net income) and price history. The only segment table on file is for NVIDIA (Q4 FY2026), not AMD. For AMD's segment split, we'd need the segment disclosures from its 10-Q/10-K or earnings release, which aren't in our data.

**Consolidated revenue (USD millions)**

| Quarter | Revenue | YoY | Gross margin |
|---|---|---|---|
| Q3 FY2024 | 6,819 | – | 50.1% |
| Q4 FY2024 | 7,658 | – | 51.0% |
| Q1 FY2025 | 7,438 | – | 50.2% |
| Q2 FY2025 | 7,685 | – | 39.8% |
| Q3 FY2025 | 9,246 | +35.6% | 53.6% |
| Q4 FY2025 | 10,300 | +34.5% | 54.0% |
| Q1 FY2026 | 10,700 | +43.9% | 54.0% |
| Q2 FY2026 (to 2026-06-27) | 11,200 | +45.7% | 54.0% |

Full-year revenue grew from 25,785 (FY2024) to 34,669 (FY2025), up 34.5%.

**The only product-level detail on file:** AMD's Q2 FY2025 release says U.S. export controls on its Instinct MI308 data center GPUs led to about $800M of inventory and related charges. That explains the dip in gross margin to 39.8% and the operating loss of –134 that quarter. This shows the data center GPU business was material, but it doesn't tell us how large data center revenue is or how fast it's growing.

If you can get the segment tables from AMD's filings, I can work through mix, growth by segment, and margin contribution.
