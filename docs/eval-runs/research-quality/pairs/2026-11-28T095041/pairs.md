# Blinded answer pairs: 2026-11-28T095041

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

## 1. missing-segments (missing data)

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

The data on file doesn't include a segment breakdown for AMD. It only has consolidated figures. The only segment table on file is NVIDIA's Q4 FY2026, so I can't split AMD's revenue into Data Center, Client, Gaming, Embedded or any other segments without making up numbers.

**AMD consolidated revenue (USD millions)**

| Period | Revenue |
|---|---|
| FY2024 | 25,785 |
| FY2025 | 34,669 |
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 (ended 2026-06-27) | 11,200 |

The only segment-related information is qualitative. In its Q2 FY2025 8-K (published 2025-08-05), AMD said U.S. export controls on its Instinct MI308 data center GPU led to about $800 million in inventory and related charges. That affected gross profit that quarter (3,059 on 7,685 of revenue) and produced an operating loss of -134. The filing excerpt doesn't say how much revenue came from the data center business.

For a real segment split, we'd need AMD's segment disclosures from its 10-Q or 10-K filings, which aren't in what I have. I can also build a consolidated margin or growth analysis for AMD from the figures above.

## 2. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

This is the latest quarter on file. Nothing later is in the data, so it is about seven months old as of 2026-09-01. Any quarters reported since then are not covered here.

## Headline numbers (USD M)

| | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross profit | 46,200 | 41,849 | 28,723 | +10.4% | +60.8% |
| Operating income | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income | 35,400 | 31,910 | 22,091 | +10.9% | +60.2% |

## Margins

| | Q4 FY26 | Q3 FY26 | Q4 FY25 |
|---|---|---|---|
| Gross margin | 74.4% | 73.4% | 73.0% |
| Operating margin | 64.9% | 63.2% | 61.1% |
| Net margin | 57.0% | 56.0% | 56.2% |

Operating income grew faster than revenue, both sequentially and year over year. Gross margin expanded by about 1 point sequentially and about 1.4 points year over year, and operating margin by about 1.7 points sequentially and 3.8 points year over year. Operating expenses (gross profit minus operating income) were 5.9B, up from 5.8B in Q3, so they did not grow in line with revenue.

## Segment mix

| Segment | Revenue (USD M) | Share |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

The segments sum to the 62,100 total. The business is overwhelmingly Data Center. The data on file has segment revenue for this quarter only, so I can't say which segments drove the growth.

## Context from the quarterly trend

- **Sequential growth slowed from Q3.** Quarter-on-quarter revenue growth ran +12.0%, +6.1%, +22.0% and +8.9% through FY26. Q4's +8.9% is well below Q3's +22.0%, though the year-over-year rate is still strong.
- **Full-year FY26:** revenue was 209,911 (+60.9% vs FY25) and net income 112,507 (+54.4%). Q4 was about 30% of the year's revenue. Full-year gross margin was 70.8% vs 75.0% in FY25, held down by Q1 FY26 (60.5%). Margins recovered to 74.4% by Q4.
- I can't explain the Q1 FY26 gross margin dip from the data. No filed explanation for NVDA is on file.

## Stock

NVDA closed at 178.40 on the latest bar (2026-08-31). That is up about 5% from the 169.62 close on 2026-01-26, just after quarter-end, and up about 6.6% from 167.35 on 2025-12-01. One data quirk: the quote lists a previous close of 176.10, which doesn't match the daily bars (178.34 on 08-28), so I'd treat that figure cautiously.

## What the data doesn't cover

- Quarters after Q4 FY2026, and any guidance or management commentary
- Balance sheet, cash flow, share count or EPS, so I can't compute valuation multiples or a market cap
- Consensus estimates, so I can't say whether the quarter beat or missed
- Reasons for the margin changes or segment drivers

On the numbers alone, Q4 FY2026 was a strong quarter with expanding margins and heavy Data Center concentration. Whether the stock's current level reflects this, or what has happened since, would need data not on file.

### Answer B

**Q:** Analyze NVDA's latest quarter.

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

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Unverified analyst view** (not backed by the figures shown): The latest reported quarter shows very high profitability, with margins at each level of the income statement indicating strong pricing power and operating leverage.

NVDA's revenue was **$62.1B**[1] in Q4 FY2026 (ended Jan 2026).

NVDA's operating margin was **64.90%**[2] in Q4 FY2026 (ended Jan 2026).

NVDA's net margin was **57.00%**[3] in Q4 FY2026 (ended Jan 2026).

> **Analyst inference:** The data shown has no cash flow, capital spending or per-share earnings figures for the quarter, so the profit strength is not confirmed by cash generation.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [3] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

## 3. margin-trend-loss-quarter (margin trend)

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

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads. Standout findings for AMD went unread, as the turn reached its limit of reads.

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

**AMD's operating margin (operating income ÷ revenue), last eight quarters**

| Quarter | Revenue ($M) | Operating income ($M) | Operating margin |
|---|---|---|---|
| Q3 FY2024 | 6,819 | 724 | 10.6% |
| Q4 FY2024 | 7,658 | 871 | 11.4% |
| Q1 FY2025 | 7,438 | 806 | 10.8% |
| Q2 FY2025 | 7,685 | -134 | -1.7% |
| Q3 FY2025 | 9,246 | 1,270 | 13.7% |
| Q4 FY2025 | 10,300 | 1,450 | 14.1% |
| Q1 FY2026 | 10,700 | 1,520 | 14.2% |
| Q2 FY2026 | 11,200 | 1,610 | 14.4% |

**Takeaways**
- **Before the dip:** margins were stable at roughly 11% through the first three quarters.
- **The Q2 FY2025 dip:** the operating loss of $134M traces to the U.S. export controls on the MI308 data center GPU. AMD's filing says they led to about $800M of inventory and related charges. Adding that back to operating income (my own rough calculation, and it assumes the full charge sits in operating income) would imply a margin of about 8.7%. That is still below the surrounding quarters, so the charge doesn't fully explain the weak margin.
- **Since the dip:** margin has risen every quarter, from 13.7% to 14.4%. That is roughly 3 points above the pre-dip level, and operating income has grown faster than revenue in each of the last four quarters.
- **Gross margin:** it moved the same way, from about 50% in Q3 FY2024 to about 54% in Q2 FY2026 (6,050 ÷ 11,200). Gross profit was the main driver of the operating margin gain.

The data on file doesn't break out operating expenses or the drivers of the post-Q2 FY2025 improvement, so I can't say how much came from mix, pricing or cost control.

## 4. follow-up-memory (conversation)

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

_Analyst commentary:_ > **Analyst inference:** Its latest fiscal year shows very high profitability at every level, though cash flow could not be verified and the year-to-date share price gain has been modest.

NVDA's revenue was **$209.9B**[1] in FY2026 (ended Jan 2026).

NVDA's gross profit was **$148.6B**[2] and operating income **$126.4B**[3] in FY2026 (ended Jan 2026).

NVDA's net income was **$112.5B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[5], operating margin **60.21%**[6] and net margin **53.60%**[7] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close.

> **Unverified analyst view** (not backed by the figures shown): Operating cash flow, capital spending and free cash flow are unavailable, so the earnings cannot be checked against cash generation, which cuts against the takeaway.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[9], AMD **3.17%**[10] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[11] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[12] in the Aug 31, 2026 session.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is still positive, and this price-only comparison shows nothing on fundamentals or valuation that would say the gap will persist.

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability sits far above its peer's at every level of the income statement, and its stock has also returned more year to date.

Of NVDA and AMD, NVDA's revenue was highest: NVDA **$209.9B**[13] (FY2026, ended Jan 2026), AMD **$34.7B**[14] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's gross margin was highest: NVDA **70.78%**[15] (FY2026, ended Jan 2026), AMD **49.92%**[16] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's operating margin was highest: NVDA **60.21%**[17] (FY2026, ended Jan 2026), AMD **9.78%**[18] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's net margin was highest: NVDA **53.60%**[19] (FY2026, ended Jan 2026), AMD **12.04%**[20] (FY2025, ended Dec 2025).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income being above operating income means its bottom-line margin overstates how profitable its core operations are, which weakens the margin comparison's read on operations.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$148.6B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- [3] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [4] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [5] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **5.81%**: price series
- [9] **5.81%**: price series
- [10] **3.17%**: price series
- [11] **$178.40**: price series
- [12] **$162.30**: price series
- [13] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [14] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [15] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [16] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [17] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [18] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [19] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [20] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

### Answer B

**Q:** Analyze NVDA.

# NVDA: analysis from the data on file (as of 2026-09-01)

## Bottom line
The fundamentals on file show very strong growth and margins that recovered after a dip. The latest reported quarter is Q4 FY2026 (ended 2026-01-25). Nothing on file covers the roughly seven months since, so I can't say whether the trend has held. I also can't assess valuation, because there is no share count, EPS or consensus data.

## Growth
| Quarter | Revenue ($M) | YoY | QoQ |
|---|---|---|---|
| Q1 FY26 | 44,062 | +69.2% | n/a (prior quarter 39,331 is Q4 FY25: +12.0%) |
| Q2 FY26 | 46,743 | +55.6% | +6.1% |
| Q3 FY26 | 57,006 | +62.5% | +22.0% |
| Q4 FY26 | 62,100 | +57.9% | +8.9% |

- FY2026 revenue was $209.9B, up 60.9% from $130.5B in FY2025.
- Operating income grew 55.2% to $126.4B, and net income grew 54.4% to $112.5B.
- Profit grew slightly slower than revenue for the year, mainly because of the Q1 FY26 margin dip below.

## Margins
| Quarter | Gross margin | Operating margin |
|---|---|---|
| Q4 FY25 | 73.0% | 61.1% |
| Q1 FY26 | 60.5% | 49.1% |
| Q2 FY26 | 72.4% | 60.8% |
| Q3 FY26 | 73.4% | 63.2% |
| Q4 FY26 | 74.4% | 64.9% |

- Full-year gross margin fell from 75.0% to 70.8%, operating margin from 62.4% to 60.2%, and net margin from 55.8% to 53.6%.
- Q1 FY26 gross margin of 60.5% was the outlier. The data on file has no explanation for it, and the only filed explanation in the data concerns AMD, so I won't attribute a cause.
- Margins have improved for three straight quarters. Q4 FY26 gross and operating margins were the best in the FY26 set, and Q4's 64.9% operating margin was above any FY25 quarter shown.
- Q4 FY26 net margin was 57.0%.

## Mix
Data Center was $55.2B of Q4 FY26's $62.1B revenue, or 88.9%. Gaming was 6.9% ($4.3B), OEM & Other 1.7%, Professional Visualization 1.4% and Automotive 1.0%. Only Q4 segment data is on file, so I can't show how the mix has shifted. The concentration in Data Center is the main thing to monitor.

## Price action
- The last price is $178.40. Over the bars on file (2025-12-01 to 2026-08-31), the stock is up 6.6% from $167.35, a much slower pace than the 60%+ revenue growth.
- The advance has been almost perfectly steady, with each close slightly above the last. The range is $165.68 to $180.18, and the stock is near the top of it.
- Daily volume has risen steadily from 1.01M to 2.96M shares.
- Data inconsistency: the quote section lists a previous close of $176.10, but the 2026-08-28 bar closes at $178.34. Last price matches the 8/31 bar. By the quote, the day's move is +1.3%. By the bars, it's +0.03%. I'd treat the quote's previous close with caution.

## What the data can't answer
- **Valuation:** there is no share count, EPS, market cap, balance sheet or cash flow, so no P/E, EV/sales or FCF yield.
- **Recent results:** there are no quarters after Q4 FY26, and no guidance or consensus estimates.
- **Margin drivers:** there is no explanation for the Q1 FY26 gross margin drop.
- **Segment trends and competition:** there is no segment history, and no customer or competitive data.

If you can share the more recent quarters, shares outstanding or consensus numbers, I can put together a fuller view, including valuation.

**Q:** Compare it with AMD YTD.

# NVDA vs AMD, year to date (through 2026-09-01)

## Price performance
I'm using calendar YTD, measured from the 2025-12-31 close to the latest close of 2026-08-31. Prices exclude dividends.

| | 2025-12-31 close | Latest ($) | YTD |
|---|---|---|---|
| NVDA | 168.60 | 178.40 | +5.8% |
| AMD | 157.32 | 162.30 | +3.2% |

NVDA is ahead by about 2.6 percentage points. Both moves are small next to the revenue growth below, and both stocks rose in a very steady, near-linear way, so neither shows meaningful volatility on file. Measured from 2025-12-01 instead, the gap is similar: NVDA +6.6%, AMD +3.6%.

AMD's quote section also conflicts with its bars. The quote shows a previous close of $164.90, but the 2026-08-28 bar closes at $162.27. The last price of $162.30 matches the 8/31 bar, so I used that.

## Fundamentals
The fiscal calendars are offset, so I've lined up NVDA FY2026 (Jan 2025 to Jan 2026) against AMD FY2025 (Dec 2024 to Dec 2025), which are roughly the same twelve months.

| | NVDA FY26 | AMD FY25 |
|---|---|---|
| Revenue | $209.9B | $34.7B |
| Revenue growth | +60.9% | +34.5% |
| Gross margin | 70.8% | 49.9% |
| Operating margin | 60.2% | 9.8% |
| Net margin | 53.6% | 12.0% |

NVDA's revenue is about six times AMD's. It also grew faster and earns far higher margins at every level.

## Most recent quarters
AMD has reported more recently: Q2 FY26 ended 2026-06-27, versus NVDA's Q4 FY26 ended 2026-01-25.

| | NVDA Q4 FY26 | AMD Q2 FY26 |
|---|---|---|
| Revenue | $62.1B | $11.2B |
| Revenue YoY | +57.9% | +45.7% |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |

AMD's year-ago comparison is flattered. Its Q2 FY25 included approximately $800M in inventory and related charges tied to the U.S. export control on its MI308 data center GPU, per its 8-K. That quarter's gross margin was 39.8% and operating income was -$134M. If the full charge sat in gross profit, the adjusted gross margin would be roughly 50%, so AMD's gross margin improvement to 54.0% is smaller than the headline comparison suggests. AMD's Q1 FY26 revenue growth, off a cleaner base, was +43.9%.

NVDA's latest data is about five months older than AMD's. Its two most recent quarters aren't on file, so the comparison isn't like-for-like in time.

## What I can't say
- **Valuation:** there is no share count, EPS or market cap for either company, so I can't compare multiples or say whether NVDA's outperformance is justified.
- **Cause of the price gap:** nothing on file explains why NVDA outperformed.
- **Forward view:** there is no guidance or consensus for either company.

**Q:** Explain the differences and show the evidence.

# Why NVDA and AMD differ, and the evidence

The main differences are in growth, gross margin and operating expense leverage. The price gap is much smaller than those fundamental gaps, and the data on file can't explain why. Below, each difference comes with its supporting numbers, and I say where the evidence stops.

## 1. Price: NVDA +5.8% vs AMD +3.2% YTD

| Checkpoint close | NVDA | AMD |
|---|---|---|
| 2025-12-31 | 168.60 | 157.32 |
| 2026-03-31 | 172.22 | 159.16 |
| 2026-06-30 | 175.91 | 161.03 |
| 2026-08-31 | 178.40 | 162.30 |

| Period return | NVDA | AMD |
|---|---|---|
| Dec 31 to Mar 31 | +2.1% | +1.2% |
| Mar 31 to Jun 30 | +2.1% | +1.2% |
| Jun 30 to Aug 31 | +1.4% | +0.8% |
| YTD | +5.8% | +3.2% |

- The gap built evenly across all three periods. NVDA gained roughly 1.7x AMD's return each time. Both slowed in the latest two months.
- The 2.6-point gap is small next to the fundamental gaps below. If the fundamentals drove the price, I'd expect a wider spread, but the data on file can't say why it isn't wider.
- I can't test whether either stock reacted to earnings. The bars show no jumps (both paths are nearly straight lines), and report dates aren't on file for NVDA. The AMD 8-K is dated 2025-08-05, before the bars begin.
- Volume is identical for NVDA and AMD on every date (1.01M rising to 2.96M), so it carries no relative information. I'd ignore it.

## 2. Growth: NVDA faster, AMD accelerating

| | NVDA | AMD |
|---|---|---|
| Latest full year | FY26 +60.9% | FY25 +34.5% |
| Quarterly YoY, latest four | +69.2%, +55.6%, +62.5%, +57.9% | +35.6%, +34.5%, +43.9%, +45.7% |

- The year-level growth gap is about 26 points (60.9% vs 34.5%).
- AMD's quarterly growth stepped up in the two most recent quarters, from the mid-30s to the mid-40s. NVDA's has stayed in a 56–69% band without a clear trend.
- The latest-quarter gap is about 12 points (57.9% vs 45.7%), but these quarters end five months apart, so that is not a clean comparison.

## 3. Profitability: the largest difference

| FY (NVDA FY26 / AMD FY25) | NVDA | AMD | Gap |
|---|---|---|---|
| Gross margin | 70.8% | 49.9% | 20.9 pts |
| Operating expenses / revenue* | 10.6% | 40.1% | 29.6 pts |
| Operating margin | 60.2% | 9.8% | 50.4 pts |

*Derived as gross profit minus operating income. The data doesn't break out R&D or SG&A.

- About 41% of the operating margin gap comes from gross margin and about 59% from expense intensity.
- Revenue is 6.1x AMD's, but NVDA's derived operating expenses are only 1.6x AMD's ($22.2B vs $13.9B). That is the core of the margin gap.
- Both companies show operating leverage, but NVDA's is stronger:

| | Opex growth | Revenue growth | Opex/revenue, prior → latest |
|---|---|---|---|
| NVDA FY26 | +35.2% | +60.9% | 12.6% → 10.6% |
| AMD FY25 | +12.9% | +34.5% | 47.8% → 40.1% |

- AMD's latest quarter (Q2 FY26) shows the same pattern: gross margin 54.0%, derived opex 39.6% of revenue, operating margin 14.4%. NVDA's Q4 FY26 was 74.4%, 9.5% and 64.9%.

## 4. Adjustments that change the comparison

- **AMD's charge.** AMD's Q2 FY25 included approximately $800M of inventory and related charges from the MI308 export control (per its 8-K). That quarter's gross margin was 39.8% and operating income was -$134M. Assuming the full charge sat in gross profit, AMD's FY25 would look like this:

| AMD FY25 | Reported | Ex-charge |
|---|---|---|
| Gross margin | 49.9% | ~52.2% |
| Operating margin | 9.8% | ~12.1% |

  The gaps narrow to about 18.6 points on gross margin and 48.1 on operating margin. They remain very large. AMD's improvement is real: its operating margin rose from about 8.7% in Q2 FY25 (ex-charge) to 14.4% in Q2 FY26.

- **NVDA's Q1 FY26 dip.** Gross margin fell to 60.5%, versus 73.0% the prior quarter and 72.4% the next. That pulled NVDA's full-year gross margin from 75.0% to 70.8%. The data has no explanation for it. The filed explanation covers AMD only, so I won't apply it to NVDA.

- **Time offset.** The annual comparison uses roughly aligned twelve months. The latest-quarter comparison does not, since AMD reports about five months more recently.

- **Below operating income.** AMD's FY25 net income ($4,174M) exceeded its operating income ($3,392M), while NVDA's was below ($112,507M vs $126,388M). The data doesn't explain the items in between, so I can't comment on earnings quality below that line.

## 5. What the evidence does and doesn't establish

**Established:**
- NVDA is much larger, faster-growing and more profitable.
- Its margin advantage comes more from expense leverage than from gross margin.
- AMD is improving on both growth and margins.
- NVDA has modestly outperformed AMD YTD.

**Not established:**
- Why the price gap is only 2.6 points. That would need valuation data (EPS, shares, multiples), consensus expectations or news, none of which is on file.
- Any forward view, since there is no guidance on file.
- Whether NVDA's strong margins have held since January 2026, because its latest quarter on file is Q4 FY26.

## 5. ticker-page-compare (explicit subject)

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is far stronger on every margin shown, and net income is nearly the same on a much smaller revenue base, so it converts sales to profit more efficiently.

By revenue, highest first: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[7] (FY2025, ended Sep 2025), NVDA **53.60%**[8] (FY2026, ended Jan 2026).

> **Unverified analyst view on AAPL** (not backed by the figures shown): Its profit is similar in dollars despite lower margins, so its earnings look less dependent on a single high-margin revenue stream, though the data shown does not confirm that.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file.

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [4] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [5] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [8] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

**Bottom line:** NVDA is growing far faster and earns much higher margins. Both stocks are up by a similar amount since December. The data on file has no valuation inputs, so I can't say which is cheaper.

**Latest fiscal year (USD millions)**

| | AAPL FY2025 (to Sep 2025) | NVDA FY2026 (to Jan 2026) |
|---|---|---|
| Revenue | 416,161 | 209,911 |
| Revenue growth | +6.4% | +60.8% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net income | 112,010 | 112,507 |
| Net margin | 26.9% | 53.6% |

- Net income is almost identical, but NVDA earns it on about half of AAPL's revenue.
- NVDA's margins slipped from FY2025, when gross margin was 75.0% and operating margin 62.4%. Q1 FY2026 was the weak quarter, with gross margin of 60.5%, and margins recovered in the following quarters.

**Latest quarter**

| | AAPL Q3 FY2026 (to Jun 2026) | NVDA Q4 FY2026 (to Jan 2026) |
|---|---|---|
| Revenue | 97,100 | 62,100 |
| Year-over-year growth | +3.3% | +57.9% |
| Gross margin | 47.1% | 74.4% |
| Operating margin | 30.7% | 64.9% |
| Net income | 24,900 | 35,400 |

- On trailing four quarters, AAPL has revenue of about 426.3bn and net income of about 115.8bn. NVDA's trailing figures are its FY2026 numbers above.
- NVDA revenue is still accelerating, up 8.9% sequentially in Q4. AAPL's quarters follow its usual holiday-quarter pattern (Q1 FY2026 at 128.0bn, then 98.7bn and 97.1bn).
- NVDA's Q4 is concentrated: Data Center was 55,200 of 62,100, or 89% of revenue. The data has no segment breakdown for AAPL.

**Stock prices (split-adjusted, excluding dividends)**
- From 2025-12-01 to 2026-08-31, AAPL rose from 218.38 to 231.60 (+6.1%) and NVDA from 167.35 to 178.40 (+6.6%).
- Despite the large fundamental gap, the two stocks have moved about the same.
- Both series climb steadily with no large daily moves.

**Caveats**
- The periods don't line up. NVDA's latest quarter on file ended January 2026, about seven months before AAPL's. Any NVDA quarters reported since then are not in the data.
- There is no share count, EPS, market cap, balance sheet or cash flow for either company. I can't compute P/E, EV/sales or return on capital.
- The quote's "previous close" doesn't match the prior bar for either stock. For AAPL it is 229.80 against a 231.60 last bar, and for NVDA 176.10 against 178.40. I'd treat the one-day changes in the quote (AAPL +0.8%, NVDA +1.3%) with caution and rely on the daily bars for trend.

I can also add AMD to this comparison if that would help.

## 6. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

AMD's Q2 FY2025 operating margin turned negative mainly because of roughly $800 million in inventory and related charges tied to U.S. export controls on its MI308 data center GPU.

**The numbers (Q2 FY2025, quarter ended 2025-06-28)**
- Revenue was $7,685M, up from $7,438M in Q1.
- Gross profit fell to $3,059M from $3,735M in Q1, even though revenue rose. Gross margin dropped to about 39.8% from about 50.2%.
- Operating income was -$134M, a margin of about -1.7%, versus +$806M (about 10.8%) in Q1.

**The filed explanation**
AMD's Q2 2025 earnings release (8-K, Exhibit 99.1, published 2025-08-05) says the results "were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products." It says the restrictions "led to approximately $800 million in inventory and related charges."

**How much the charge explains**
- Gross profit fell about $676M quarter over quarter while revenue grew, so the gross margin drop accounts for most of the swing.
- Operating expenses, which I back into as gross profit minus operating income, rose from about $2,929M in Q1 to about $3,193M in Q2. That is an increase of about $264M and a secondary factor.
- As a rough illustration, adding back $800M would put gross profit near $3,859M (about 50.2% of revenue) and operating income near +$666M (about 8.7%). This assumes the full charge sits in cost of sales, which the data on file doesn't confirm.

**What the data doesn't cover**
- It doesn't break out where the charges were booked, or the operating expense line items.
- It doesn't explain the roughly $264M rise in operating expenses.
- It doesn't say whether any MI308 revenue was lost, beyond the filing's reference to the restrictions.

The hit looks one-time: operating income was back to +$1,270M in Q3 FY2025 and has risen each quarter since, to $1,610M in Q2 FY2026.

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

_Analyst commentary:_ > **Unverified analyst view** (not backed by the figures shown): Its operating margin turned negative because gross profit was not enough to cover operating costs in the quarter, but the evidence does not show which cost or charge drove it.

AMD's operating income was **-$134.0M**[1] and operating margin **-1.74%**[2] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Its positive net income despite an operating loss shows the bottom line was supported by items below operating income, so the operating loss alone understates quarterly earnings.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. Standout findings for AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [2] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

## 7. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

I can't give you AMD's free cash flow because the data on file has no cash flow statement. There is no operating cash flow, capital expenditure, or any other cash flow line for AMD. I'd rather not estimate it from net income, since the gap between earnings and cash can be large (working capital, inventory, capex, and stock-based compensation all sit in between).

What the file does have for AMD is income statement data. These figures are summed from the last four reported quarters (Q3 FY2025 through Q2 FY2026, ended 2026-06-27):

| Metric | Trailing four quarters (USD M) |
|---|---|
| Revenue | 41,446 |
| Gross profit | 22,343 |
| Operating income | 5,850 |
| Net income | 5,473 |

The most recent quarter, Q2 FY2026, had revenue of 11,200, operating income of 1,610, and net income of 1,480.

To get to FCF, I'd need AMD's cash flow statement (operating cash flow and capex) or a filed FCF figure. If you can pull those from the 10-K or 10-Q, I can work through the calculation and the FCF margin with you.

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

## 8. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

### Answer B

**Q:** Break down NVDA's revenue by segment.

# NVDA revenue by segment, Q4 FY2026 (2025-10-27 to 2026-01-25)

| Segment | Revenue (USD M) | % of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

The segments sum to 62,100, which matches reported Q4 FY2026 revenue.

- **Data Center dominates.** It is almost 89% of revenue, and the other four segments combined are only 6,900 (about 11%).
- **Gaming is a distant second.** At 4,300, it is under 8% of Data Center's size.

**Data gap:** The file has segment data only for Q4 FY2026. There is no segment breakdown for earlier quarters or for the FY2025 and FY2026 annual periods. I can't show segment growth, mix shift over time, or full-year segment totals. For total company revenue, the file shows Q4 FY2026 at 62,100 versus 39,331 in Q4 FY2025 (about +58% year over year), but I can't say how much of that came from each segment.

## 9. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

**NVDA's gross margin dropped sharply in Q1 FY2026 (quarter ended 2025-04-27), to about 60.5% from about 73.0% in the prior quarter.**

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | 78.3% |
| Q4 FY2025 | 39,331 | 28,723 | 73.0% |
| **Q1 FY2026** | **44,062** | **26,668** | **60.5%** |
| Q2 FY2026 | 46,743 | 33,853 | 72.4% |

- **Sequential change:** Revenue rose about 12% from Q4 FY2025 (+$4.7B), but gross profit fell about 7% (-$2.1B). That is a decline of roughly 12.5 percentage points in margin.
- **Operating income:** It fell from $24.0B to $21.6B, so operating margin went from about 61.1% to about 49.1%.
- **Recovery:** Gross margin rebounded to about 72.4% in Q2 FY2026 and has risen further since (about 73.4% in Q3 and 74.4% in Q4). The Q1 dip looks like a one-quarter event rather than a trend.

**The cause isn't in the data.** The filings on file give no explanation for NVDA's Q1 FY2026 margin drop, such as charges, mix, or pricing. The only filed explanation is AMD's, which attributes about $800M of charges in its own Q2 FY2025 to export controls on the MI308. That is about AMD and shouldn't be read across to NVDA. To pin down the driver, we'd need NVDA's earnings release or 10-Q for that quarter.

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

_Analyst commentary:_ > **Analyst inference:** Its gross margin fell sharply in the latest quarter, even as revenue and gross profit dollars grew from a year earlier, so growth came with much lower profitability per dollar of sales.

NVDA's gross profit was **$26.7B**[1], revenue **$44.1B**[2] and gross margin **60.52%**[3] in Q1 FY2026 (ended Apr 2025).

NVDA's gross profit was **$28.7B**[4], revenue **$39.3B**[5] and gross margin **73.03%**[6] in Q4 FY2025 (ended Jan 2025).

NVDA's gross profit was **$20.4B**[7], revenue **$26.0B**[8] and gross margin **78.35%**[9] in Q1 FY2025 (ended Apr 2024).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit dollars still rose against the year-earlier quarter, which cuts against reading the margin drop as a loss of earning power, though they slipped from the prior quarter.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [3] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [4] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [5] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B
- [6] **73.03%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- [7] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- [8] **$26.0B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B
- [9] **78.35%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%

## 10. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): Its revenue is higher than its peer's, so it is the larger business by sales.

Of NVDA and AAPL, AAPL's revenue was highest: NVDA **$130.5B**[1], AAPL **$416.2B**[2].

> **Analyst inference on NVDA:** Its fiscal year ended earlier than its peer's, so the two figures do not cover the same calendar window.

Periods: NVDA FY2025 (ended Jan 2025), AAPL FY2025 (ended Sep 2025).

_Cited:_

- [1] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [2] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

**Fiscal 2025 revenue (USD millions, as reported)**

| Company | Fiscal period | Revenue |
|---|---|---|
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |

Apple's FY2025 revenue was about $285.7B higher than NVIDIA's, roughly 3.2x as large. NVIDIA's figure is about 31% of Apple's.

**Fiscal calendars don't line up.** NVIDIA's FY2025 ended in January 2025, about eight months before Apple's ended in September 2025. NVIDIA's FY2026 (2025-01-27 to 2026-01-25) overlaps Apple's FY2025 much more closely. On that basis:

- NVDA FY2026 revenue was 209,911, so Apple's 416,161 is about 2.0x NVIDIA's.
- NVIDIA's revenue grew about 61% from FY2025 to FY2026 (130,497 to 209,911).
- Apple's revenue grew about 6% from FY2024 to FY2025 (391,035 to 416,161).

The gap is narrowing quickly, but Apple's annual revenue is still roughly double NVIDIA's on the most comparable periods in the data. Apple's FY2026 isn't complete in the data (three quarters filed), so I haven't compared the two on a full FY2026 basis.

## 11. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

**Bottom line:** NVIDIA has by far the highest margins and fastest growth. Apple is the largest and most stable. AMD is the smallest, with the lowest margins, though they are improving.

**Fiscal years are not aligned.** NVDA's latest year ended Jan 2026, AAPL's ended Sep 2025 and AMD's ended Dec 2025. NVDA's latest quarter on file is Q4 FY2026 (ended Jan 2026), about five months older than AMD's and AAPL's June 2026 quarters. NVDA's results for the following two quarters are not in the data.

**Latest fiscal year (USD millions)**

| | Revenue | Y/Y | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|
| NVDA FY2026 | 209,911 | +60.9% | 70.8% | 60.2% | 53.6% |
| AMD FY2025 | 34,669 | +34.4% | 49.9% | 9.8% | 12.0% |
| AAPL FY2025 | 416,161 | +6.4% | 46.9% | 32.0% | 26.9% |

Prior-year margins (gross / operating / net):
- NVDA FY2025: 75.0% / 62.4% / 55.9%
- AMD FY2024: 49.4% / 1.6% / 6.4%
- AAPL FY2024: 46.2% / 31.5% / 24.0%

**Latest quarter**

| | Quarter | Revenue | Y/Y | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|---|
| NVDA | Q4 FY26 (Jan 2026) | 62,100 | +57.9% | 74.4% | 64.9% | 57.0% |
| AMD | Q2 FY26 (Jun 2026) | 11,200 | +45.7% | 54.0% | 14.4% | 13.2% |
| AAPL | Q3 FY26 (Jun 2026) | 97,100 | +3.3% | 47.1% | 30.7% | 25.6% |

**Observations**
- **NVDA:**
  - Annual revenue grew about 61%, but gross margin fell from 75.0% to 70.8% and operating margin from 62.4% to 60.2%.
  - Q1 FY2026 was the trough, with a 60.5% gross margin. It recovered to 74.4% by Q4. The data does not say why it dipped.
  - Data Center was 55,200 of the 62,100 Q4 revenue, about 89%.
- **AMD:**
  - Operating margin rose from 1.6% to 9.8% in FY2025 and to 14.4% in the latest quarter, with gross margin up to 54.0%.
  - Q2 FY2025 is distorted. AMD attributed about $800M of inventory and related charges to U.S. export controls on its MI308 data center GPU, and the quarter showed an operating loss of $134M. That flatters the year-over-year margin comparison.
  - Revenue over the last four quarters is about 41.4B.
- **AAPL:**
  - Margins are steady, with operating margin around 30–32%.
  - Revenue is seasonal: Q1 (Dec quarter) was 124.3B in FY2025 and 128.0B in FY2026, against about 95–102B in other quarters.
  - Its revenue over the last four quarters is about 426B, roughly double NVDA's FY2026 revenue.

The data on file covers only income statement lines and prices. It has no cash flow, balance sheet, share counts or guidance, so I can't comment on returns on capital, valuation multiples or forward expectations.

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is the strongest of the three at every margin level, and its scale is large, so it converts revenue into profit most effectively.

By revenue, highest first: AAPL **$416.2B**[1], NVDA **$209.9B**[2], AMD **$34.7B**[3].

By gross margin, highest first: NVDA **70.78%**[4], AMD **49.92%**[5], AAPL **46.91%**[6].

By operating margin, highest first: NVDA **60.21%**[7], AAPL **31.97%**[8], AMD **9.78%**[9].

By net margin, highest first: NVDA **53.60%**[10], AAPL **26.92%**[11], AMD **12.04%**[12].

> **Unverified analyst view on AAPL** (not backed by the figures shown): Its gross margin is the lowest of the three, yet it has the largest revenue and the second-highest operating margin, so its profit rests on scale and cost control rather than product margin.

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

## 12. peer-two (peer comparison)

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

_Analyst commentary:_ > **Unverified analyst view on NVDA** (not backed by the figures shown): Its operating profile is far stronger, with higher revenue and margins at every level, though its share price has risen only modestly more than its rival's this year.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**[9], AMD **3.17%**[10] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[11] in the Aug 31, 2026 session; AMD's last close was **$162.30**[12] in the Aug 31, 2026 session.

AMD's operating income was **$3.4B**[13] and net income **$4.2B**[14] in FY2025 (ended Dec 2025).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income sitting above operating income means its bottom line is not a clean read of core operating profitability.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

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
- [11] **$178.40**: price series
- [12] **$162.30**: price series
- [13] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [14] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B

### Answer B

**Q:** Compare NVDA with AMD.

# NVDA vs AMD

**Bottom line:** On the data on file, NVDA is the much larger and far more profitable business. AMD is growing quickly from a lower-margin base, with margins improving. I can't say which is cheaper, because the file has no share counts, market caps, EPS or estimates.

## Latest fiscal year

| | NVDA FY2026 (to Jan 2026) | AMD FY2025 (to Dec 2025) |
|---|---|---|
| Revenue | $209.9B | $34.7B |
| Revenue growth | +60.9% | +34.5% |
| Gross margin | 70.8% (FY25: 75.0%) | 49.9% (FY24: 49.3%) |
| Operating margin | 60.2% (FY25: 62.4%) | 9.8% (FY24: 1.6%) |
| Net margin | 53.6% | 12.0% |
| Net income | $112.5B | $4.2B |

## Most recent quarter on file

| | NVDA Q4 FY2026 (Oct 2025 to Jan 2026) | AMD Q2 FY2026 (Mar to Jun 2026) |
|---|---|---|
| Revenue | $62.1B (+57.9% YoY) | $11.2B (+45.7% YoY) |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |
| Net income | $35.4B | $1.5B |

- **NVDA:** Data Center was $55.2B of the $62.1B quarter, about 89% of revenue. Gaming was $4.3B. This is a concentrated mix.
- **AMD:** Revenue has risen every quarter since Q2 FY2025, from $7.7B to $11.2B. Operating margin has moved from -1.7% to 14.4% over the same span.
- **AMD's Q2 FY2025 comparison is distorted.** Its filing cites about $800M of inventory and related charges from U.S. export controls on the MI308 data center GPU. That explains much of the quarter's 39.8% gross margin and operating loss. Part of AMD's margin improvement is therefore a recovery from that charge, not purely underlying gains.
- **NVDA's margin dip:** Gross margin fell to 60.5% in Q1 FY2026 before recovering to 74.4%. The data on file doesn't explain the dip, so I won't speculate on the cause.

## Share prices

- **Since 2025-12-01 (daily closes):** NVDA is up 6.6% (167.35 to 178.40) and AMD is up 3.6% (156.68 to 162.30). Both rose in a very steady line, with no sharp drawdowns in the bars.
- **Quote caveat:** The quote file shows previous closes of 176.10 for NVDA and 164.90 for AMD. These don't match the 2026-08-28 daily closes (178.34 and 162.27). I wouldn't rely on the quoted one-day moves until that's reconciled.

## Gaps

- **NVDA data is older.** Its latest quarter ended January 2026, so two quarters are missing compared with AMD's June 2026 quarter. The comparison isn't period-aligned, and NVDA's current run-rate may differ.
- **Not covered:** valuation multiples, balance sheet, cash flow, guidance, consensus estimates, and AMD's segment mix.
- **Unexplained items:** AMD's net income exceeded operating income in FY2025 ($4.2B vs $3.4B). The data doesn't say why.
