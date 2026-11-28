# Blinded answer pairs: 2026-11-28T095038

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

## 1. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

**Short version:** On the filed numbers, NVDA is growing much faster and is far more profitable per dollar of revenue, while AAPL is larger in revenue and roughly equal in net income. Share prices have moved similarly since December. The data on file can't tell us which is cheaper, because there is no share count, EPS, market cap or estimates.

**Trailing four quarters (USD millions)**

| | AAPL (Q4 FY25–Q3 FY26, to 2026-06-27) | NVDA (FY2026, to 2026-01-25) |
|---|---|---|
| Revenue | 426,266 | 209,911 |
| Gross profit | 200,841 (47.1%) | 148,570 (70.8%) |
| Operating income | 137,227 (32.2%) | 126,388 (60.2%) |
| Net income | 115,766 (27.2%) | 112,507 (53.6%) |

AAPL has about twice NVDA's revenue but similar net income, because NVDA keeps about 54 cents of profit per revenue dollar versus about 27 cents for AAPL.

**Growth**
- **NVDA:** FY2026 revenue was up 60.9% (130,497 to 209,911) and net income up 54.4%. Q4 FY26 revenue of 62,100 was up 57.9% year on year, and net income of 35,400 was up 60.2%.
- **AAPL:** FY2025 revenue was up 6.4% (391,035 to 416,161) and net income up 19.5%. The latest quarter (Q3 FY26) had revenue of 97,100, up 3.3% year on year, and net income of 24,900, up 6.3%.

**Margins**
- NVDA's gross margin was 70.8% for FY2026, down from 75.0% in FY2025. It dipped to 60.5% in Q1 FY26 and recovered to 74.4% in Q4. The data doesn't explain the dip.
- AAPL's margins are steady: gross margin was 46.9% in FY2025 (46.2% in FY2024) and 47.1% in the latest quarter.

**Concentration**
NVDA's Q4 FY26 revenue was 88.9% Data Center (55,200 of 62,100). AAPL's segment revenue isn't on file, so I can't compare mix.

**Share price**

| | Last (2026-09-01) | Change since 2025-12-01 close |
|---|---|---|
| AAPL | 231.60 | +6.1% (from 218.38) |
| NVDA | 178.40 | +6.6% (from 167.35) |

Both stocks have risen in a steady, narrow range, so the market hasn't separated them over this window despite the very different growth.

**Caveats**
- **Staleness:** NVDA's latest filed quarter is Q4 FY26 (ended January 2026), about seven months old. AAPL's is June 2026. Any NVDA quarters since then aren't on file, so the growth comparison probably flatters NVDA's data on timeliness.
- **Fiscal calendars:** The two companies' fiscal years end at different times (AAPL in September, NVDA in January), so I used trailing four quarters where possible.
- **Quote inconsistency:** The quote's "previous close" figures (AAPL 229.80, NVDA 176.10) don't match the daily bars. The bars show 2026-08-28 closes of 231.53 and 178.34, and the last prices equal the 08-31 closes. I wouldn't rely on the quote's one-day change until that's reconciled.
- **Valuation:** I can't compute P/E, P/S or any other multiple from what's on file.

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

## 2. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

AMD's operating margin has moved from about 11% to about 14% over the last eight quarters, with one sharp dip in Q2 FY2025.

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

- **Early period (Q3 FY2024 to Q1 FY2025):** margins held in a 10.6% to 11.4% band.
- **Q2 FY2025 dip:** the operating loss of $134M was driven by the U.S. export controls on the MI308 data center GPU. AMD's filing says they led to roughly $800M of inventory and related charges. Gross profit fell to $3,059M, a gross margin of about 39.8%, against roughly 50% in the prior quarters. As an illustration, adding the $800M back to operating income gives about $666M, or roughly 8.7% of revenue. That is my arithmetic, and it assumes the full charge sits in operating income. It was still below the neighboring quarters, so the charge alone doesn't explain all of the dip.
- **Recovery and expansion (Q3 FY2025 onward):** margin jumped to 13.7% and has crept up each quarter since, to 14.4% in Q2 FY2026. Revenue rose from $9.2B to $11.2B over the same stretch, and gross margin has been steady at roughly 54% for the last three quarters. The recent gains are small, about 10 to 15 basis points per quarter, so the trend looks like gradual operating leverage rather than a step change.
- **Annual view:** operating margin was 1.6% in FY2024 ($401M on $25,785M) and 9.8% in FY2025 ($3,392M on $34,669M).

The data on file doesn't explain the margin gains after Q2 FY2025, such as mix, opex discipline or other drivers. It also doesn't show whether any one-time items affected the recent quarters, so I can't say how sustainable the ~14% level is.

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

## 3. missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** Break down AMD's revenue by segment.

I can't give you an AMD segment breakdown, because the data on file has no segment revenue for AMD. The only segment table is NVIDIA's, for Q4 FY2026. For AMD I have consolidated income statement lines only, so I can't split revenue into Data Center, Client, Gaming, Embedded or anything else.

**What I do have for AMD (USD millions):**

| Period | Revenue |
|---|---|
| FY2024 | 25,785 |
| FY2025 | 34,669 |
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 | 11,200 |

The most recent quarter, Q2 FY2026 (ended 2026-06-27), had revenue of 11,200, gross profit of 6,050 and operating income of 1,610.

**The only segment-related information on file** is AMD's Q2 FY2025 8-K explanation. It says U.S. export controls on the AMD Instinct MI308 data center GPU led to about $800 million in inventory and related charges that quarter. That tells you the charge hit data center GPU products, but it gives no revenue figure for any segment.

To get an actual breakdown, you'd need AMD's segment disclosures from its 10-Q or 10-K, which aren't in what I have. I can also run other analysis on the consolidated figures, such as margin trends or growth rates.

### Answer B

**Q:** Break down AMD's revenue by segment.

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

_Block sources: S1._

AMD has no 10-K on file, so no business or risk factor claims from one.

## 4. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

The data on file doesn't include AMD's free cash flow. There is no cash flow statement, so I have no operating cash flow or capital expenditures, and nothing on working capital, stock-based compensation, or D&A that would let me build a reliable estimate. I won't back into a number from the income statement.

What I do have for AMD is the income statement:

| Period | Revenue ($M) | Operating income ($M) | Net income ($M) |
|---|---|---|---|
| FY2024 | 25,785 | 401 | 1,641 |
| FY2025 | 34,669 | 3,392 | 4,174 |
| Q1 FY2026 | 10,700 | 1,520 | 1,400 |
| Q2 FY2026 | 11,200 | 1,610 | 1,480 |

- **Earnings trend:** Revenue and operating income are rising. Operating margin was about 9.8% in FY2025 and about 14.4% in Q2 FY2026.
- **Q2 FY2025 charge:** AMD's filing says export controls on the MI308 GPU led to roughly $800M of inventory and related charges. That weighed on that quarter's operating income, which was -$134M. It is an earnings item, and I can't say how it affected cash flow.

To get FCF, I'd need the cash flow statement (operating cash flow less capex) from AMD's 10-K or 10-Q filings. If you can pull those in, I can work through FCF, FCF margin, and conversion from net income.

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

## 5. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

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

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

# Revenue and margins: NVDA vs AMD vs AAPL

The three companies have different fiscal calendars, so I used the trailing four reported quarters for each. That is NVDA through Jan 2026, AMD through Jun 2026 and AAPL through Jun 2026.

## Trailing four quarters (USD millions)

| | Revenue | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|
| NVDA (Q1-Q4 FY26) | 209,911 | 70.8% | 60.2% | 53.6% |
| AMD (Q3 FY25-Q2 FY26) | 41,446 | 53.9% | 14.1% | 13.2% |
| AAPL (Q4 FY25-Q3 FY26) | 426,266 | 47.1% | 32.2% | 27.2% |

## Latest quarter

| | Revenue | Gross margin | Operating margin | YoY revenue growth |
|---|---|---|---|---|
| NVDA Q4 FY26 | 62,100 | 74.4% | 64.9% | +57.9% |
| AMD Q2 FY26 | 11,200 | 54.0% | 14.4% | +45.7% |
| AAPL Q3 FY26 | 97,100 | 47.1% | 30.7% | +3.3% |

## Last full fiscal year growth
- NVDA FY26 revenue grew 60.9% (130,497 to 209,911).
- AMD FY25 revenue grew 34.5% (25,785 to 34,669).
- AAPL FY25 revenue grew 6.4% (391,035 to 416,161).

## Takeaways
- **Scale:** AAPL has the largest revenue base, about 2x NVDA's and about 10x AMD's. NVDA's latest quarter (62.1bn) is already well below AAPL's seasonally strong Dec quarter (128.0bn) but is growing far faster.
- **Growth:** NVDA and AMD are growing at very different speeds from AAPL. AMD's latest-quarter growth (+45.7%) is close to NVDA's (+57.9%), while AAPL is near flat.
- **Margins:** NVDA is well ahead on every line, and its Q4 FY26 gross margin (74.4%) is the highest in the set. AAPL sits in the middle, with gross margin lowest of the three but operating margin well above AMD's. AMD's operating margin is only about 14%.
- **Trend:**
  - NVDA's FY26 gross margin (70.8%) and operating margin (60.2%) are below FY25 (75.0% and 62.4%). Gross margin dipped to 60.5% in Q1 FY26 and has recovered each quarter since. The data on file doesn't explain the dip.
  - AMD's margins have improved steadily, with operating margin rising from 9.8% in FY25 to 14.4% in the latest quarter. Q2 FY25 was depressed by about $800 million of inventory and related charges tied to US export controls on its MI308 GPU, according to AMD's filing. That quarter's gross margin was 39.8% and it posted an operating loss.
  - AAPL's margins are stable, with a seasonal lift in the Dec quarter.
- **Caveats:** This is reported, unadjusted data. I haven't compared valuation, cash flow, balance sheets or guidance, because none of it is on file for these names.

## 6. segment-drill-down (segment drill-down)

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

The segments sum to the reported Q4 FY2026 revenue of $62,100M.

- **Data Center dominates.** At $55.2B it is almost nine-tenths of revenue. All other segments combined are $6.9B, or about 11%.
- **Gaming is the only other meaningful segment.** It is about $4.3B, and Professional Visualization, Automotive and OEM & Other are each under $1.1B.

**Data limits:** The file has a segment split only for Q4 FY2026. There is no segment data for earlier quarters or for the full FY2026 or FY2025 years. I therefore can't show how the mix has shifted over time or the segment growth rates. Segment-level profitability isn't on file either. Only consolidated gross profit and operating income are available.

## 7. peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Answer A

**Q:** Compare NVDA with AMD.

# NVDA vs. AMD

**Bottom line:** On the data on file, NVDA is much larger, faster-growing and far more profitable. AMD is improving quickly off a low base, but its margins are a fraction of NVDA's. The data can't support a valuation comparison.

## Fundamentals

| | NVDA (FY2026, ended Jan-2026) | AMD (FY2025, ended Dec-2025) | AMD (last 4 qtrs to Jun-2026) |
|---|---|---|---|
| Revenue | $209.9B | $34.7B | $41.4B |
| Revenue growth y/y | +60.9% | +34.5% | n/a |
| Gross margin | 70.8% (FY25: 75.0%) | 49.9% (FY24: 49.4%) | n/a |
| Operating margin | 60.2% (FY25: 62.4%) | 9.8% (FY24: 1.6%) | 14.1% |
| Net margin | 53.6% (FY25: 55.8%) | 12.0% | 13.2% |
| Net income | $112.5B | $4.2B | $5.5B |

## Latest quarter

- **NVDA, Q4 FY2026:** revenue was $62.1B (+57.9% y/y, +8.9% q/q). Gross margin was 74.4%, operating margin 64.9% and net income $35.4B.
- **AMD, Q2 FY2026:** revenue was $11.2B (+45.7% y/y, +4.7% q/q). Gross margin was 54.0%, operating margin 14.4% and net income $1.48B.
- **NVDA concentration:** Data Center was $55.2B of the $62.1B, or about 89% of revenue. The data doesn't give AMD's segment split.

## Trends and caveats

- **NVDA margins:** Full-year margins slipped in FY2026, but the quarterly trend recovered. Gross margin was 60.5% in Q1 FY2026 and 74.4% by Q4. The data doesn't say why Q1 dipped.
- **AMD margins:** Gross margin has risen from about 49% to 54% in recent quarters, and operating margin has been climbing steadily.
- **AMD's Q2 FY2025 base:** That quarter had an operating loss of $134M. AMD's filing attributes about $800M of inventory and related charges to the U.S. export control on its MI308 GPUs. This flatters AMD's y/y growth for Q2 FY2026 and the FY2025 comparisons, so look at the sequential trend too.
- **Different periods:** The latest NVDA quarter on file ended January 2026, while AMD's ended June 2026. NVDA's more recent quarters aren't in the data, so the comparison favors AMD in recency.

## Price action

Both stocks rose steadily from 2025-12-01 to 2026-08-31 (closes, excluding dividends).

| | 2025-12-01 close | 2026-08-31 close | Change |
|---|---|---|---|
| NVDA | $167.35 | $178.40 | +6.6% |
| AMD | $156.68 | $162.30 | +3.6% |

The quote block shows previous closes of $176.10 for NVDA and $164.90 for AMD. Its "last price" equals the 2026-08-31 bar close, but the previous close doesn't match the prior bar. I'd treat the one-day moves implied by the quotes with caution.

## What the data doesn't cover

- **Valuation:** There are no share counts, market caps, EPS, balance sheet or cash flow data, so I can't compute P/E, EV/sales or free cash flow yield.
- **Guidance and estimates:** None on file.
- **AMD segments and NVDA's post-January results:** Not on file.
- **Product, competitive or export-control exposure for NVDA:** Only AMD's MI308 disclosure is on file.

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

## 8. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Data caveat:** Q4 FY2026 is the latest quarter on file, but it ended more than seven months before 2026-09-01. Any later quarters have not been loaded, so this may not be the most recent report.

## Results

| USD m | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
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

- Growth was accompanied by margin expansion. Operating income grew faster than revenue both sequentially and year over year, so operating expenses grew more slowly than gross profit.
- Operating margin of 64.9% is about 380 bps above the year-ago quarter.

## Mix
- Data Center was $55,200m, or 88.9% of revenue.
- The rest was Gaming at $4,300m (6.9%), OEM & Other at $1,050m (1.7%), Professional Visualization at $900m (1.4%) and Automotive at $650m (1.0%).
- Segment figures sum to the $62,100m total.
- Only Q4 segment data is on file, so I can't say which segments drove the sequential or year-over-year growth.

## Fiscal-year context
- FY2026 revenue was $209,911m, up 60.9% from $130,497m. Net income was $112,507m, up 54.4% from $72,880m.
- Q4 was about 30% of full-year revenue, and revenue rose every quarter of the year.
- Q1 FY26 was an outlier on profitability, with gross margin of 60.5% and operating margin of 49.1%, against 74.4% and 64.9% in Q4. Nothing on file explains the Q1 dip.
- The full-year margins (gross 70.8%, operating 60.2%) sit below Q4's exit rate.

## Stock
- The last price is $178.40, up 1.3% from the $176.10 previous close.
- From 2025-12-01 ($167.35) to the 2026-08-31 bar ($178.40), the stock is up about 6.6%, with steady gains and rising volume.
- The quote and the bars don't reconcile: the 2026-08-31 close equals the "last price" of $178.40, yet the previous close is shown as $176.10, while that bar's own prior close was $178.34. I'd verify the quote before relying on the day's move.
- The earnings date isn't on file, so I can't measure the stock's reaction to this report.

## Not covered by the data
- Valuation: there is no share count, EPS or consensus, so I can't compute P/E or compare against expectations.
- Guidance, management commentary, cash flow, balance sheet and the reasons behind the margin gains.
- Any results after Q4 FY2026.

**Bottom line:** Q4 FY2026 was a strong quarter, with revenue up 58% year over year, a nearly 90% Data Center mix and record-high margins in the data on file. Whether the stock prices that in, or what has happened since, can't be judged from this data.

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

## 9. follow-up-memory (conversation)

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

# NVDA analysis (data through 2026-09-01)

**Bottom line:** The fundamentals on file are very strong. FY2026 revenue grew 61% and Q4 FY2026 was the best quarter yet. I can't say whether the stock is cheap or expensive, because the file has no share count, EPS, balance sheet, cash flow, guidance or estimates.

## Growth
- **FY2026 revenue was $209.9B, up 60.9%** from $130.5B in FY2025. Operating income rose 55.2% to $126.4B, and net income rose 54.4% to $112.5B.
- **Revenue rose every quarter** over the eight quarters shown, from $26.0B to $62.1B.
- **Q4 FY2026 revenue was $62.1B**, up 8.9% on Q3 and 57.9% on Q4 FY2025.
- **Concentration:** Data Center was $55.2B of the $62.1B in Q4, or 88.9%. Gaming was 6.9%, OEM & Other 1.7%, Professional Visualization 1.4% and Automotive 1.0%. The growth story is essentially a Data Center story.

## Margins

| | FY2025 | FY2026 | Q4 FY2026 |
|---|---|---|---|
| Gross margin | 75.0% | 70.8% | 74.4% |
| Operating margin | 62.4% | 60.2% | 64.9% |
| Net margin | 55.8% | 53.6% | 57.0% |

- Full-year margins slipped about 2 to 4 points, almost entirely because of **Q1 FY2026**. Gross margin that quarter was 60.5%, against 73.0% in Q4 FY2025, and operating income fell to $21.6B from $24.0B even as revenue grew.
- Gross margin then recovered each quarter: 72.4%, 73.4% and 74.4%. Q4 FY2026 operating margin of 64.9% is the highest in the series.
- **The file doesn't explain the Q1 FY2026 dip.** The only filed explanation on file is AMD's, about its own export-control charge, and I wouldn't read it across to NVDA.

## Price action
- The last price is **$178.40**, up 1.3% from the $176.10 previous close.
- Since the first bar on 2025-12-01 ($167.35), the stock is up 6.6%. Since the 2026-01-26 close ($169.62), shortly after fiscal year-end, it is up 5.2%.
- The climb is steady, with small daily ranges and no sharp drawdowns. The window low was $165.68 and the high was $180.18, set on 2026-08-31, so the stock is near the top of its range.
- Daily volume rose steadily from about 1.0M to 2.96M shares.
- **Data inconsistency:** The quote's "last price" of $178.40 equals the 2026-08-31 bar close, but the quoted previous close ($176.10) doesn't match the prior bar's close ($178.34). I'd treat the 1.3% daily move with caution.

## Versus the other two names on file
Fiscal calendars differ, so this is rough. Over the same window the price moves were NVDA +6.6%, AAPL +6.1% and AMD +3.6%. NVDA's Q4 FY2026 operating margin of 64.9% compares with about 30.7% for AAPL (Q3 FY2026) and 14.4% for AMD (Q2 FY2026).

## What the data doesn't cover
- **Stale financials:** The latest quarter on file is Q4 FY2026 (ended 2026-01-25). Nothing is on file for the quarters since, though the price runs to September.
- **No valuation:** There is no share count, market cap, EPS, P/E or free cash flow, so I can't say whether the price already reflects this growth.
- **No outlook:** There is no guidance, consensus or commentary on demand, competition or export restrictions.
- **No balance sheet or cash flow:** I can't assess capital returns, working capital or the cash behind the earnings.

To form a view on valuation or the margin trajectory, I'd want the share count, the latest quarterly filings, and an explanation of the Q1 FY2026 gross-margin drop.

**Q:** Compare it with AMD YTD.

# NVDA vs AMD, year to date (through 2026-09-01)

## Price performance
I used the 2025-12-31 close as the starting point, and the 178.40 and 162.30 quotes as the end point. These are price returns only, since the bars exclude dividends.

| | 2025-12-31 close | Last price | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | **+5.8%** |
| AMD | $157.32 | $162.30 | **+3.2%** |

NVDA is ahead by about 2.6 points. Both paths are smooth and one-directional, with no meaningful drawdowns in the bars. Both closed 2026-08-31 at or near their window highs (NVDA $180.18 intraday, AMD $163.92).

The quotes' previous closes ($176.10 for NVDA, $164.90 for AMD) don't match the prior bars' closes ($178.34 and $162.27). I'd ignore the implied one-day moves of +1.3% and -1.6%.

## Fundamentals behind the moves
Fiscal calendars differ. NVDA's FY2026 ended January 2026 and is roughly calendar 2025. AMD's FY2025 ended December 2025.

| | NVDA | AMD |
|---|---|---|
| Latest full-year revenue growth | +60.9% (FY2026) | +34.5% (FY2025) |
| Latest full-year operating margin | 60.2% | 9.8% |
| Latest quarter on file | Q4 FY2026 (ended Jan 2026) | Q2 FY2026 (ended Jun 2026) |
| Latest quarter revenue | $62.1B | $11.2B |
| Latest quarter gross / operating margin | 74.4% / 64.9% | 54.0% / 14.4% |

- **NVDA** is growing faster and is far more profitable, but its financials stop at January 2026. Nothing is on file for the roughly seven months of its YTD price move since then.
- **AMD** has two 2026 quarters on file. Revenue rose from $10.3B in Q4 FY2025 to $10.7B and then $11.2B, about +4% sequentially each quarter. First-half 2026 revenue of $21.9B is up 44.8% on the first half of 2025 ($15.1B). Operating income improved each quarter, from $1.45B to $1.52B to $1.61B.
- AMD's year-ago comparisons are distorted. Its Q2 FY2025 operating loss of $134M included about $800M of inventory and related charges tied to U.S. export controls on its MI308 data center GPU, per its 8-K. That flatters year-over-year improvement in the Q2 comparison.

## What I can and can't conclude
- NVDA has outperformed AMD YTD, and its reported growth and margins are stronger. The price gap is small relative to the fundamental gap, but I can't say whether that means AMD is cheap or NVDA is rich.
- There is no valuation data on file for either company: no share counts, EPS, multiples, estimates or guidance.
- The file doesn't show what drove either stock's moves. The two financial histories only end at different dates.

**Q:** Explain the differences and show the evidence.

# Why NVDA and AMD differ, with the evidence

The data supports clear differences in profitability, scale and data recency. It does not tell us why the stocks moved as they did, and I flag where it stops.

## 1. NVDA turns revenue into far more profit

| Latest quarter | NVDA (Q4 FY26) | AMD (Q2 FY26) |
|---|---|---|
| Revenue | $62,100M | $11,200M |
| Gross profit | $46,200M (74.4%) | $6,050M (54.0%) |
| Operating income | $40,300M (64.9%) | $1,610M (14.4%) |
| Net income | $35,400M (57.0%) | $1,480M (13.2%) |

- NVDA's revenue is 5.5x AMD's ($62,100M vs $11,200M), but its operating income is 25x AMD's ($40,300M vs $1,610M).
- The gap is a margin gap, and it is persistent. On full-year numbers, NVDA FY2026 had a 60.2% operating margin, against 9.8% for AMD FY2025 ($3,392M on $34,669M).
- AMD's gross margin has been flat at about 54% for four quarters (53.6%, 54.0%, 54.0%, 54.0%). Its operating margin has crept up (13.7%, 14.1%, 14.2%, 14.4%).
- NVDA's gross margin has recovered each quarter since Q1 FY26 (60.5%, 72.4%, 73.4%, 74.4%), and its operating margin rose from 60.8% to 63.2% to 64.9% over the last three.

**What the file can't say:** why the margins differ. NVDA's segment table shows Data Center at 88.9% of revenue ($55,200M of $62,100M). There is no segment, product-mix or pricing data for AMD, and nothing that attributes the margin gap to a cause.

## 2. NVDA grew faster annually, but AMD's recent sequential growth is competitive

| | NVDA | AMD |
|---|---|---|
| Latest full-year revenue growth | +60.9% ($130,497M to $209,911M) | +34.5% ($25,785M to $34,669M) |
| Latest quarter, year over year | +57.9% (Q4 FY26) | +45.7% (Q2 FY26) |

Roughly calendar-aligned sequential growth shows a more mixed picture:

| Period | NVDA | AMD |
|---|---|---|
| Jul to Oct 2025 (NVDA Q3 FY26, AMD Q3 FY25) | +22.0% | +20.3% |
| Oct 2025 to Jan 2026 (NVDA Q4 FY26, AMD Q4 FY25) | +8.9% | +11.4% |

AMD's two later quarters grew +3.9% and +4.7% sequentially, so its growth has slowed. For NVDA, we simply have no quarters after January 2026.

AMD's year-ago base is also distorted. Q2 FY25 included about $800M of inventory and related charges from U.S. export controls on its MI308 GPU, per its 8-K. The filing doesn't say whether that touched revenue.

## 3. The stock moves

| | 2025-12-31 close | Last | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | +5.8% |
| AMD | $157.32 | $162.30 | +3.2% |

- The 2.6-point gap is small next to the fundamental gap above.
- Both series rise almost every session by a tiny, near-constant amount. For example, NVDA's closes on 2026-02-25 and 02-26 are $170.86 and $170.92. The bars show no visible jump I can tie to a result or filing.
- The report dates aren't on file, so I can't tie any price move to an earnings release.

## 4. The data's limits

- **Different recency:** AMD's financials run through June 2026 and NVDA's stop at January 2026. Much of the YTD price window has no fundamentals for NVDA, so the comparison favors AMD in information.
- **Identical volumes:** NVDA, AMD and AAPL show the same volume on every date (for example, 1,010,000 on 2025-12-01 and 2,960,000 on 2026-08-31). That looks like a data artifact, so I wouldn't draw conclusions from volume.
- **Quote mismatch:** Both quotes' previous closes ($176.10 for NVDA, $164.90 for AMD) disagree with the prior bars ($178.34 and $162.27).
- **No valuation inputs:** There is no share count, EPS or multiples for either company. I can't tell whether NVDA's stronger fundamentals are already priced in, or whether AMD's smaller gain reflects its slower growth.

**Summary:** NVDA has the stronger financial profile on scale, margins and annual growth, and it has the better YTD price return. The data doesn't establish that the first caused the second.

## 10. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

**AAPL's fiscal 2025 revenue was about 3.2x NVDA's.**

| | Fiscal period | Revenue (USD M) |
|---|---|---|
| NVDA | FY2025 (2024-01-29 to 2025-01-26) | 130,497 |
| AAPL | FY2025 (2024-09-29 to 2025-09-27) | 416,161 |

- AAPL's revenue was higher by $285,664M. NVDA's was about 31% of AAPL's.
- **The fiscal years don't line up.** NVDA's FY2025 ended in January 2025, while AAPL's ended in late September 2025, so AAPL's window sits roughly eight months later. This is the labeled comparison you asked for, but it is not calendar-aligned.
- **A closer-in-time comparison:** NVDA's FY2026 (ended 2026-01-25) revenue was $209,911M, up about 61% from FY2025. That is still roughly half of AAPL's FY2025 figure. The data on file has no AAPL FY2026 annual figure yet, since its fiscal year ends in September.
- **Growth rates:** AAPL's FY2025 revenue grew about 6.4% from FY2024 ($391,035M). NVDA's FY2024 revenue isn't on file, so I can't give its FY2025 growth.

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

## 11. cause-in-evidence (cause in evidence)

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

**Short answer:** AMD's own filing attributes it to the U.S. government's export controls on the Instinct MI308 data center GPU. The restrictions led to about $800 million in inventory and related charges in the quarter (8-K Exhibit 99.1, published 2025-08-05).

**What the numbers show**

| Quarter | Revenue ($M) | Gross margin | Operating income ($M) | Operating margin |
|---|---|---|---|---|
| Q1 FY2025 | 7,438 | 50.2% | 806 | 10.8% |
| Q2 FY2025 | 7,685 | 39.8% | -134 | -1.7% |
| Q3 FY2025 | 9,246 | 53.6% | 1,270 | 13.7% |

- Revenue rose slightly from Q1 to Q2, so this was not a sales collapse. The damage came from gross profit, which fell from $3,735M to $3,059M, a drop of about $676M on higher revenue.
- Gross margin dropped about 10 points in Q2 and then recovered in Q3. That pattern fits a one-time charge rather than a lasting change in profitability.
- Implied operating expenses (gross profit minus operating income) were about $3,193M in Q2, versus $2,929M in Q1 and $3,683M in Q3. Q2 opex was not unusually high relative to the trend, so the swing to a loss came mostly from gross profit.

**Rough sizing (my estimate, not from the filing):** If the full ~$800M had hit cost of sales, adding it back would give gross profit of about $3,859M (roughly 50% margin) and operating income of about $666M (roughly 8.7% margin), in line with Q1. The filing says "inventory and related charges" but does not say which income statement line they were booked to, so treat this as illustrative.

**What the data doesn't cover:** It doesn't break out the charge by line item, give the precise accounting (write-down versus purchase commitments, for example), or explain the Q2 opex movement.

## 12. what-changed-gross-margin (what changed)

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

_Analyst commentary:_ NVDA's gross profit was **$26.7B**[1] and revenue **$44.1B**[2] in Q1 FY2026 (ended Apr 2025); NVDA's gross profit was **$28.7B**[3] and revenue **$39.3B**[4] in Q4 FY2025 (ended Jan 2025).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit is still well above the year-earlier quarter, so the business is earning more in dollars even with a thinner margin.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [3] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [4] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

**NVDA's gross margin fell sharply in Q1 FY2026 (quarter ended 2025-04-27) and then recovered the next quarter.**

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | ~78.4% |
| Q4 FY2025 | 39,331 | 28,723 | ~73.0% |
| **Q1 FY2026** | **44,062** | **26,668** | **~60.5%** |
| Q2 FY2026 | 46,743 | 33,853 | ~72.4% |
| Q3 FY2026 | 57,006 | 41,849 | ~73.4% |
| Q4 FY2026 | 62,100 | 46,200 | ~74.4% |

- **Sequential change:** Gross margin dropped about 12.5 points, from ~73.0% in Q4 FY2025 to ~60.5%. Revenue rose about 12% ($4.7B), but gross profit fell about $2.1B.
- **Implied cost of revenue:** Revenue minus gross profit rose from about $10.6B to $17.4B, up about 64%.
- **Operating margin:** Operating income fell from $24,034M to $21,638M, so operating margin went from ~61.1% to ~49.1%. Net income also fell, from $22,091M to $18,775M.
- **Recovery:** Margin was back to ~72.4% in Q2 FY2026 and has risen each quarter since, to ~74.4% in Q4 FY2026.

**Cause:** The data on file doesn't explain why NVDA's margin fell. It has no NVDA filing commentary, cost breakdown or segment data for Q1 FY2026. The only explanation on file is AMD's, about export-control inventory charges in its own Q2 FY2025. It would be speculation to link that to NVDA. To pin down the cause, we'd need NVDA's Q1 FY2026 earnings release or 10-Q.
