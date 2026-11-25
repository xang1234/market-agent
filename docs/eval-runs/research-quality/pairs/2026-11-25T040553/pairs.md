# Blinded answer pairs: 2026-11-25T040553

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

# NVDA vs. AMD

**Bottom line:** NVDA is far larger and much more profitable, and it is still growing faster in absolute dollars. AMD is growing quickly from a smaller base, with margins improving but still well below NVDA's. The data on file doesn't support a valuation comparison.

## Latest annual (as reported)

| | NVDA FY2026 (to Jan 2026) | NVDA FY2025 | AMD FY2025 (to Dec 2025) | AMD FY2024 |
|---|---|---|---|---|
| Revenue ($M) | 209,911 | 130,497 | 34,669 | 25,785 |
| Revenue growth | +60.9% | | +34.5% | |
| Gross margin | 70.8% | 75.0% | 49.9% | 49.3% |
| Operating margin | 60.2% | 62.4% | 9.8% | 1.6% |
| Net margin | 53.6% | 55.9% | 12.0% | 6.4% |

- NVDA added about $79.4B of revenue in FY2026, versus about $8.9B for AMD in FY2025.
- NVDA's margins slipped year over year but stayed very high. Q1 FY2026 gross margin dipped to 60.5%, and the data doesn't explain why.
- AMD's FY2025 net income ($4,174M) exceeded operating income ($3,392M). The data doesn't say what drove that gap.

## Latest quarter

| | NVDA Q4 FY2026 (to Jan 25, 2026) | AMD Q2 FY2026 (to Jun 27, 2026) |
|---|---|---|
| Revenue ($M) | 62,100 | 11,200 |
| YoY growth | +57.9% | +45.7% |
| QoQ growth | +8.9% | +4.7% |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |
| Net margin | 57.0% | 13.2% |

- AMD's YoY comparison is flattered. Its Q2 FY2025 results (operating loss of $134M) included about $800M of inventory and related charges from the U.S. export controls on the MI308. The filing doesn't say which line items took the charge.
- AMD's trailing four quarters (Q3 FY2025 to Q2 FY2026) come to $41.4B revenue, $5.85B operating income and $5.47B net income. NVDA's FY2026 net income is roughly 20x that.
- NVDA's Q4 FY2026 revenue was 89% Data Center ($55.2B of $62.1B). The data has no segment breakdown for AMD, so I can't compare mix.

## Share prices (split-adjusted closes)

| | 2025-12-01 | 2026-08-31 | Change |
|---|---|---|---|
| NVDA | 167.35 | 178.40 | +6.6% |
| AMD | 156.68 | 162.30 | +3.6% |

Both are modest gains over about nine months, excluding dividends.

## Caveats

- **Staggered reporting:** NVDA's latest filed quarter ended January 2026, about seven months before AMD's. NVDA's more recent quarters aren't on file, so the comparison favors NVDA's older data.
- **Quote mismatch:** The quoted previous closes (NVDA 176.10, AMD 164.90) don't match the 2026-08-28 bar closes (178.34 and 162.27). The quoted "last price" equals the 08-31 bar close for both. I wouldn't rely on the implied one-day moves of +1.3% for NVDA and -1.6% for AMD until this is reconciled.
- **Not on file:** Share counts, market cap, EPS, P/E and other multiples, balance sheet, cash flow, guidance, and AMD segment data. I can't say which stock is cheaper or give a view on valuation from this data.

### Answer B

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It is the far more profitable business on every margin shown, and its larger scale comes with a much richer margin structure, while the year-to-date share price gain is only modestly higher.

Of NVDA and AMD, NVDA's revenue was highest: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's gross margin was highest: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's operating margin was highest: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's net margin was highest: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

AMD's operating income was **$3.4B**[9], net income **$4.2B**[10], operating margin **9.78%**[11] and net margin **12.04%**[12] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD:** Its net income exceeding operating income means its bottom line is not a clean read of core operating profitability, and the evidence does not say why.

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). AMD has no 10-K on file, so no business or risk factor claims from one. NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [9] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [10] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [11] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [12] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

## 2. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

### Answer B

**Q:** Break down NVDA's revenue by segment.

**NVDA revenue by segment, Q4 FY2026 (quarter ended 2026-01-25), USD millions**

| Segment | Revenue | % of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

The segments sum to 62,100, which matches reported Q4 FY2026 revenue.

- **Concentration:** Data Center is almost 89% of revenue, and it alone is larger than the other four segments combined by a wide margin (55,200 vs. 6,900).
- **Limits of the data:** The segment breakdown on file covers only Q4 FY2026. I have no segment figures for earlier quarters or for the full fiscal year, so I can't show segment growth, mix shift over time, or segment margins. Only the consolidated income statement is available for those periods.

## 3. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

# NVDA analysis (data as of 2026-09-01)

## Bottom line
The fundamentals are very strong: FY2026 revenue was up about 61% and the business remains highly profitable. Two things stand out: margins were lower in FY2026 than FY2025, and sequential growth slowed in the latest quarter. The data on file cannot support a valuation view (no share count, EPS, balance sheet, cash flow, guidance or estimates).

## Growth and profitability (annual, USD M)

| | FY2025 | FY2026 | Change |
|---|---|---|---|
| Revenue | 130,497 | 209,911 | +60.9% |
| Gross profit | 97,859 | 148,570 | +51.8% |
| Operating income | 81,454 | 126,388 | +55.2% |
| Net income | 72,880 | 112,507 | +54.4% |
| Gross margin | 75.0% | 70.8% | -4.2 pts |
| Operating margin | 62.4% | 60.2% | -2.2 pts |
| Net margin | 55.9% | 53.6% | -2.3 pts |

Profit grew more slowly than revenue, so FY2026 margins were lower than FY2025's. The quarterly figures sum to the annual totals.

## Quarterly trajectory

| Quarter | Revenue | QoQ | Gross margin | Operating margin |
|---|---|---|---|---|
| Q4 FY25 | 39,331 | | 73.0% | 61.1% |
| Q1 FY26 | 44,062 | +12.0% | 60.5% | 49.1% |
| Q2 FY26 | 46,743 | +6.1% | 72.4% | 60.8% |
| Q3 FY26 | 57,006 | +22.0% | 73.4% | 63.2% |
| Q4 FY26 | 62,100 | +8.9% | 74.4% | 64.9% |

- **Q1 FY2026 margin dip:** Gross margin fell to 60.5% and operating margin to 49.1%, and that quarter drags down the FY2026 annual margins. The data on file does not say why. The only filed explanation covers AMD, not NVDA.
- **Margin recovery:** Margins rebuilt every quarter since, and Q4 gross margin (74.4%) is back above Q4 FY2025's (73.0%). Q4 operating margin (64.9%) is also above Q4 FY2025's (61.1%).
- **Year-over-year in Q4:** Revenue was up 57.9% and net income up 60.3% (35,400 vs 22,091).
- **Deceleration:** Q4 sequential growth of 8.9% is well below Q3's 22.0%. Whether that is lumpiness or a slowdown cannot be determined without guidance, which is not on file.

## Mix (Q4 FY2026 only)
Data Center was 55,200 of 62,100, or 88.9% of revenue. Gaming was 6.9%, OEM & Other 1.7%, Professional Visualization 1.4% and Automotive 1.0%. I only have one quarter of segment data, so I can't show how concentration has changed over time. The mix does show that results are driven almost entirely by Data Center.

## Price action
- The last price is 178.40, up 6.6% from the 2025-12-01 close of 167.35.
- The bars show a very smooth, steady uptrend with no pullbacks. The last close is the highest in the window, and the highest intraday print is 180.18 on 2026-08-31.
- Daily volume rose steadily from 1.01M to 2.96M shares over the period.
- I cannot say how the price reacted to earnings. The bars start 2025-12-01 and there are no report dates on file.

## Data issues to be aware of
- **Quote vs. bars:** The quote shows a previous close of 176.10, but the bars show 178.34 for 2026-08-28. The quote's +1.3% day-over-day move (176.10 to 178.40) is therefore not consistent with the bars, which show +0.03%. I would verify before relying on the daily change.
- **Holiday sessions:** The bars include sessions on dates such as 2025-12-25 and 2026-01-01. This suggests the series may not be a clean exchange record.

## What I can't tell you from this data
- Valuation: there is no share count, EPS or market cap, so no P/E or other multiples.
- Cash flow, balance sheet, capex or buybacks.
- Guidance, consensus estimates or the next earnings date.
- The Q1 FY2026 margin drivers, or any segment history beyond Q4 FY2026.
- Why the stock has moved the way it has.

**Q:** Compare it with AMD YTD.

# NVDA vs. AMD, year to date

## Share price (calendar YTD, 2025-12-31 close to latest 2026-08-31 close)

| | 2025-12-31 | Latest | YTD |
|---|---|---|---|
| NVDA | 168.60 | 178.40 | +5.8% |
| AMD | 157.32 | 162.30 | +3.2% |

NVDA has outperformed AMD by about 2.6 points. Both series are very smooth uptrends, and the returns exclude dividends. Since 2025-12-01 the figures are NVDA +6.6% and AMD +3.6%.

AMD's quote shows a previous close of 164.90, but its bars show 162.27 for 2026-08-28. The quote implies a -1.6% day and the bars imply +0.02%. NVDA has the same kind of mismatch, so verify daily moves before relying on them. The volume series is also identical across NVDA, AMD and AAPL, which suggests placeholder data. I would not read anything into volume.

## Fundamentals: a like-for-like YTD comparison isn't possible
NVDA's latest reported quarter is Q4 FY2026, which ended 2026-01-25. There is no NVDA quarter on file covering the months since then. AMD has reported through the quarter ended 2026-06-27. So I'm comparing the most recent reported periods, and they are not aligned in time.

| | NVDA (Q4 FY26) | AMD (Q2 FY26) |
|---|---|---|
| Revenue, USD M | 62,100 | 11,200 |
| YoY revenue growth | +57.9% | +45.7% |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |
| Net income, USD M | 35,400 | 1,480 |
| YoY net income growth | +60.3% | +69.7% |

Trailing four reported quarters:

| | NVDA (FY2026) | AMD (Q3 FY25 to Q2 FY26) |
|---|---|---|
| Revenue, USD M | 209,911 | 41,446 |
| Gross margin | 70.8% | 53.9% |
| Operating margin | 60.2% | 14.1% |
| Net income, USD M | 112,507 | 5,473 |
| Net margin | 53.6% | 13.2% |

## Takeaways
- **Scale and profitability:** NVDA's trailing revenue is about 5x AMD's, and its net income is about 20x. Its operating margin is more than four times AMD's.
- **Growth:** NVDA is growing faster on revenue (+57.9% vs +45.7% YoY in the latest quarter). AMD's +69.7% net income growth is flattered by a weak base.
- **AMD's base effect:** AMD's Q2 FY2025 results included approximately $800M of inventory and related charges tied to U.S. export controls on its MI308 data center GPU. That depressed Q2 FY2025 operating income to -134. This inflates AMD's YoY comparisons in Q2 FY2026 and in H1 (H1 2026 operating income of 3,130 vs 672 a year earlier). H1 revenue growth is cleaner at +44.8% (21,900 vs 15,123).
- **AMD's momentum:** AMD's margins have improved gradually, and its operating margin rose from 11.7% in Q4 FY25 to 14.4% in Q2 FY26. Sequential revenue growth is modest, at +4.7% in Q2.
- **Why NVDA's price outperformed:** The data on file does not explain it. NVDA's reported fundamentals are older than AMD's, so the price gap cannot be tied to results.

## Not covered by the data
Valuation multiples (no share counts or EPS for either), post-January NVDA results, guidance or estimates, and balance sheet or cash flow. I can't say which stock is cheaper or better positioned from this file.

**Q:** Explain the differences and show the evidence.

# Why NVDA and AMD differ, with the evidence

**Correction first:** my previous reply said AMD's operating margin rose from 11.7% in Q4 FY25 to 14.4%. The Q4 FY25 figure is wrong. It was 14.1% (1,450 / 10,300), so AMD's margin has been roughly flat at 14% for four quarters.

## 1. The profitability gap comes mostly from operating costs, not gross margin
Operating expenses here are implied as gross profit minus operating income, since the file has no R&D or SG&A breakdown.

| Latest quarter, USD M | NVDA (Q4 FY26) | AMD (Q2 FY26) | Gap |
|---|---|---|---|
| Revenue | 62,100 | 11,200 | 5.5x |
| Gross profit | 46,200 | 6,050 | |
| Implied operating expenses | 5,900 | 4,440 | 1.3x |
| Operating income | 40,300 | 1,610 | |
| Gross margin | 74.4% | 54.0% | 20.4 pts |
| Implied opex % of revenue | 9.5% | 39.6% | 30.1 pts |
| Operating margin | 64.9% | 14.4% | 50.5 pts |

- About 60% of the 50.5-point operating margin gap comes from the opex ratio and about 40% from gross margin.
- NVDA's opex is only about 1.3x AMD's on 5.5x the revenue. The numbers are consistent with NVDA spreading its cost base over a much larger revenue base.
- The file does not say why gross margins differ. NVDA's Q4 revenue was 88.9% Data Center, but there is no AMD segment data to compare against.

## 2. Growth: NVDA is faster year over year, but the periods don't line up

| Sequential revenue growth | Q3 FY25 | Q4 FY25 | Q1 FY26 | Q2 FY26 | Q3 FY26 | Q4 FY26 |
|---|---|---|---|---|---|---|
| NVDA (quarters ended Oct-24, Jan-25, Apr-25, Jul-25, Oct-25, Jan-26) | +16.8% | +12.1% | +12.0% | +6.1% | +22.0% | +8.9% |
| AMD (quarters ended Sep-25, Dec-25, Mar-26, Jun-26) | +20.3% | +11.4% | +3.9% | +4.7% | | |

The NVDA column headers use NVDA's fiscal labels, so they don't match AMD's quarter for quarter. The key points:
- On a year-over-year basis, NVDA's latest quarter is +57.9% and AMD's is +45.7%.
- AMD's sequential growth has slowed to +3.9% and +4.7% in its last two quarters.
- NVDA's last reported quarter (+8.9%) ended in January, and AMD's two slow quarters came after that. The file has nothing on NVDA for the same months, so I can't say whether NVDA slowed too.

## 3. The margin dips: one is explained, one is not
**AMD, Q2 FY2025.** The filing says export controls on the MI308 led to "approximately $800 million in inventory and related charges." AMD's figures show the hit:

| AMD | Q1 FY25 | Q2 FY25 | Q3 FY25 |
|---|---|---|---|
| Gross margin | 50.2% | 39.8% | 53.6% |
| Operating margin | 10.8% | -1.7% | 13.7% |

As an illustration only, adding $800M back to Q2 gross profit gives (3,059 + 800) / 7,685 = 50.2%, matching Q1. That assumes the whole charge sat in cost of revenue, which the filing doesn't state.

**NVDA, Q1 FY2026.** Gross margin was 73.0% in Q4 FY25, 60.5% in Q1 FY26 and 72.4% in Q2 FY26. Operating margin fell to 49.1% before recovering. That is a similar-looking dip, but no explanation is on file for NVDA. I won't attribute it to the same cause as AMD's.

## 4. The price gap (NVDA +5.8% vs AMD +3.2% YTD) can't be explained from this data
- **Association only:** NVDA has the higher growth and margins, but the file offers no link between those and the price gap.
- **No event reactions:** Both price series rise by about 0.02–0.04% per day, with no visible jumps around earnings. Report dates aren't on file either. I didn't find any earnings reaction in the bars.
- **Data quality:** I flagged earlier that the quote-versus-bars mismatches and the identical volume series across tickers suggest the price data may not be a clean record. I would not draw causal conclusions from it.
- **Size of the gap:** The 2.6-point price gap is small next to the fundamental gaps above.

## What the data does not explain
- Why AMD's gross margin is about 20 points lower than NVDA's.
- What is inside either company's operating expenses.
- Whether NVDA's growth has changed since January 2026.
- Why NVDA's price has outperformed.

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

_Analyst commentary:_ > **Analyst inference:** It converts revenue into profit at very high rates, with most of each revenue dollar reaching operating and net income, while the share price has moved up modestly this year.

NVDA's revenue was **$209.9B**[1] and gross profit **$148.6B**[2] in FY2026 (ended Jan 2026).

NVDA's operating income was **$126.4B**[3] and net income **$112.5B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[5], operating margin **60.21%**[6] and net margin **53.60%**[7] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[9] in the Aug 31, 2026 session.

> **Analyst inference:** Only a single fiscal year of results is shown, so the trend in growth and margins cannot be judged, and cash flow and per-share earnings are unavailable to test how well profit converts to cash.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ By price return, highest first: NVDA **5.81%**[10], AMD **3.17%**[11] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[12] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[13] in the Aug 31, 2026 session.

> **Analyst inference on NVDA** (from the price return ranking): It has outperformed on price this year to date, though both stocks have posted only modest gains.

> **Analyst inference on AMD** (from the price return ranking): Its lower return is a price-only comparison, so it says nothing about fundamentals or valuation, which the data shown does not cover.

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is far stronger at every margin level, and its year-to-date price return is also higher, so the market has rewarded it somewhat more.

Of NVDA and AMD, NVDA's revenue was highest: NVDA **$209.9B**[14] (FY2026, ended Jan 2026), AMD **$34.7B**[15] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's gross margin was highest: NVDA **70.78%**[16] (FY2026, ended Jan 2026), AMD **49.92%**[17] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's operating margin was highest: NVDA **60.21%**[18] (FY2026, ended Jan 2026), AMD **9.78%**[19] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's net margin was highest: NVDA **53.60%**[20] (FY2026, ended Jan 2026), AMD **12.04%**[21] (FY2025, ended Dec 2025).

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. AMD has no 10-K on file, so no business or risk factor claims from one.

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

## 4. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

**Short version:** NVDA is far ahead on growth and margins. AAPL is the largest by revenue but is growing slowly. AMD is growing quickly from a much smaller base, with margins in between on gross profit and the lowest on operating profit.

**Fiscal calendars differ, so periods don't line up.** NVDA's latest quarter ended 2026-01-25. AMD's and AAPL's ended 2026-06-27. NVDA's figures are about five months older than the other two.

**Latest fiscal year (USD millions)**

| | Period | Revenue | YoY | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|---|
| NVDA | FY2026 (to Jan-26) | 209,911 | +60.9% | 70.8% | 60.2% | 53.6% |
| AMD | FY2025 (to Dec-25) | 34,669 | +34.5% | 49.9% | 9.8% | 12.0% |
| AAPL | FY2025 (to Sep-25) | 416,161 | +6.4% | 46.9% | 32.0% | 26.9% |

Prior-year margins (gross / operating / net):
- NVDA FY2025: 75.0% / 62.4% / 55.9%
- AMD FY2024: 49.4% / 1.6% / 6.4%
- AAPL FY2024: 46.2% / 31.5% / 24.0%

**Latest reported quarter (USD millions)**

| | Quarter | Revenue | YoY | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|---|
| NVDA | Q4 FY2026 | 62,100 | +57.9% | 74.4% | 64.9% | 57.0% |
| AMD | Q2 FY2026 | 11,200 | +45.7% | 54.0% | 14.4% | 13.2% |
| AAPL | Q3 FY2026 | 97,100 | +3.3% | 47.1% | 30.7% | 25.6% |

**Last four reported quarters**
- NVDA: revenue 209,911 (the same as FY2026).
- AMD: revenue 41,446, gross margin 53.9%, operating margin 14.1%.
- AAPL: revenue 426,266, gross margin 47.1%, operating margin 32.2%.

**Observations**
- **NVDA:**
  - Revenue nearly doubled over the last four quarters, from 44.1bn in Q1 FY2026 to 62.1bn in Q4. Data Center was 55.2bn of the 62.1bn in Q4 FY2026, about 89%.
  - Gross margin dipped to about 60.5% in Q1 FY2026 (26,668 on 44,062) before recovering to 74.4%. The data doesn't say why.
  - Full-year margins are still slightly below FY2025's.
- **AMD:**
  - Margins are improving. Gross margin rose from 49.9% in FY2025 to 54.0% in the latest quarter, and operating margin from 9.8% to 14.4%.
  - Q2 FY2025 was distorted by an export-control hit. AMD's filing cites about $800M of inventory and related charges tied to MI308 restrictions. That quarter showed a 39.8% gross margin and an operating loss of 134. Adding the $800M back to gross profit gives roughly 50%, though the filing doesn't say exactly where the charge sat in the income statement.
  - Part of AMD's year-over-year growth in that quarter therefore comes off a depressed base.
- **AAPL:**
  - Margins are stable and slightly rising: gross margin was 46.2% in FY2024, 46.9% in FY2025 and 47.1% in the latest quarter.
  - Revenue is seasonal, peaking at 128.0bn in the December quarter. Compare it year over year rather than sequentially.
  - Revenue is about 2x NVDA's and about 10x AMD's on a trailing basis, but growth is in the low single digits.

**Not covered by the data:** segment breakdowns for AMD and AAPL, drivers of NVDA's Q1 FY2026 margin dip, balance sheet and cash flow, and any guidance or consensus. I've also kept this to revenue and margins and haven't done any valuation work.

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 4 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%

_Block sources: S1._

*Engine answer: all 4 requested results verified*

- Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue, gross margin, operating margin, and net margin rankings): Its much larger revenue base and higher operating and net margins show stronger profit conversion, while the other company's gross margin is higher.

By revenue, highest first: AAPL **$97.1B**[1], AMD **$11.2B**[2]. No revenue is shown for NVDA.

By gross margin, highest first: AMD **54.02%**[3], AAPL **47.06%**[4]. No gross margin is shown for NVDA.

By operating margin, highest first: AAPL **30.69%**[5], AMD **14.38%**[6]. No operating margin is shown for NVDA.

By net margin, highest first: AAPL **25.64%**[7], AMD **13.21%**[8]. No net margin is shown for NVDA.

> **Analyst inference on AMD** (from the gross margin, operating margin, and net margin rankings): Its lead on gross margin does not carry through to operating or net margin, which suggests heavier costs below the gross line, though the data shown does not say which.

Periods: AMD Q2 FY2026 (ended Jun 2026), AAPL Q3 FY2026 (ended Jun 2026). No figures are shown for NVDA.

NVDA: the figures were not computed, as the turn reached its limit of model calls. Reading stopped at the turn's limit of model calls, so part of the question may be unanswered.

_Cited:_

- [1] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [2] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [3] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [4] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [5] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [6] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [7] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [8] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%

## 5. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): It operates at a larger revenue scale than its peer, on the revenue comparison.

By revenue, highest first: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on AAPL** (from the revenue ranking): The two fiscal years end on different dates, so the comparison does not cover the same stretch of time.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

**Fiscal 2025 revenue (USD millions)**

| | Period | Revenue |
|---|---|---|
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |

- AAPL's FY2025 revenue was about $285.7B higher than NVDA's, roughly 3.2x. NVDA's was about 31% of AAPL's.
- **Timing caveat:** the fiscal years are offset by about eight months. NVDA's FY2025 ended in January 2025 and AAPL's ended in September 2025, so this is not a same-calendar-period comparison.
- **Closer in time:** NVDA's FY2026 (2025-01-27 to 2026-01-25) revenue was 209,911. That is about 50% of AAPL's FY2025 figure, and 61% above NVDA's FY2025.
- **Profitability:** operating margin on FY2025 figures was about 62% for NVDA (81,454 / 130,497) and about 32% for AAPL (133,050 / 416,161). AAPL's operating income was still higher in absolute terms.
- **Growth:** AAPL's FY2025 revenue grew about 6.4% from FY2024 (391,035). The data on file has no NVDA FY2024 annual figure, so I can't give NVDA's FY2025 growth.

## 6. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

### Answer B

**Q:** What is AMD's free cash flow?

The data on file doesn't include AMD's free cash flow, and I can't derive it. Free cash flow needs operating cash flow and capital expenditures, and the file has no cash flow statement, no balance sheet, and no capex or working-capital detail for AMD. It only has the income statement (revenue, gross profit, operating income, net income) and price data.

I'd rather not use net income or operating income as a stand-in. Cash conversion depends on items that aren't on file here, such as working capital, capex, and stock-based compensation.

What the file does show for AMD:

- **FY2025 (year ended 2025-12-27):** revenue $34,669M, operating income $3,392M, net income $4,174M. Net income is above operating income, so there were non-operating or tax items that the file doesn't break out.
- **Most recent quarter (Q2 FY2026, ended 2026-06-27):** revenue $11,200M, operating income $1,610M, net income $1,480M.
- **Q2 FY2025:** operating income was -$134M. AMD's filing attributes about $800M of inventory and related charges to U.S. export controls on the MI308 data center GPU. Because the charge was taken in a single quarter, it may also distort cash flow comparisons, but the file doesn't show its cash impact.

To get free cash flow, you'd need AMD's cash flow statements (operating cash flow less capex) from its 10-K or 10-Q filings. If you can share those, I can build the trailing-twelve-month figure and an FCF margin against the revenue above.

## 7. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

_Block sources: S1._

*Engine answer: all 5 requested results verified*

- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2025 (ended 2025-06-28): 39.80%
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B

_Block sources: S1._

*Engine answer: all 4 requested results verified*

- Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q1 FY2025 (ended 2025-03-29): 50.22%
- Advanced Micro Devices, Inc., Operating income, Q1 FY2025 (ended 2025-03-29): $806.0M
- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2025 (ended 2025-03-29): 10.84%
- Advanced Micro Devices, Inc., Revenue, Q1 FY2025 (ended 2025-03-29): $7.4B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (from AMD's operating margin and gross margin trends): Its swing to an operating loss came with a sharp drop in gross margin while revenue held up, so the squeeze looks to have come from the cost of sales rather than from weak demand, though the data does not show what drove it.

AMD's operating margin fell from **10.84%**[1] in Q1 FY2025 (ended Mar 2025) to **-1.74%**[2] in Q2 FY2025 (ended Jun 2025).

AMD's gross margin fell from **50.22%**[3] in Q1 FY2025 (ended Mar 2025) to **39.80%**[4] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **$806.0M**[5] in Q1 FY2025 (ended Mar 2025); AMD's operating income was **-$134.0M**[6] in Q2 FY2025 (ended Jun 2025).

AMD's revenue rose from **$7.4B**[7] in Q1 FY2025 (ended Mar 2025) to **$7.7B**[8] in Q2 FY2025 (ended Jun 2025).

The figures do not show why AMD's gross margin changed.

AMD's net income was **$872.0M**[9] and operating income **-$134.0M**[10] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Positive net income alongside an operating loss means the bottom line was supported by items below operating income, so the operating loss alone overstates weakness in total earnings.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for AMD went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **10.84%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2025 (ended 2025-03-29): 10.84%
- [2] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [3] **50.22%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q1 FY2025 (ended 2025-03-29): 50.22%
- [4] **39.80%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2025 (ended 2025-06-28): 39.80%
- [5] **$806.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q1 FY2025 (ended 2025-03-29): $806.0M
- [6] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [7] **$7.4B**: engine result: Advanced Micro Devices, Inc., Revenue, Q1 FY2025 (ended 2025-03-29): $7.4B
- [8] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [9] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- [10] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

AMD's filing attributes it to the US export controls on its MI308 data center GPU. The company says the restrictions led to about $800 million in inventory and related charges in the quarter (Q2 FY2025, ended 2025-06-28).

**What the numbers show**
- Revenue was $7,685M, and operating income was -$134M, an operating margin of about -1.7%. The prior quarter's margin was about 10.8% ($806M on $7,438M).
- Gross profit fell to $3,059M even though revenue rose. Gross margin dropped from about 50.2% in Q1 to about 39.8%, which is where the charge shows up.
- Gross profit minus operating income implies operating expenses of about $3,193M, up from about $2,929M in Q1. That is a rise of roughly $264M, which the data does not explain.

**Rough sizing (my arithmetic, not from the filing)**
If the full $800M sat in gross profit, which the filing doesn't specify, excluding it would give gross profit of about $3,859M and operating income of about +$666M. That is a margin of about 8.7%. So the charge more than accounts for the swing to a loss, but underlying margin was still a bit below Q1's, partly because of the higher operating expenses.

**Recovery**
Operating income returned to +$1,270M in Q3 FY2025, a margin of about 13.7%, on revenue of $9,246M.

**What the data doesn't cover**
- Which income statement line the charge was booked in.
- Why net income was still positive at $872M despite the operating loss. The data has no below-the-line items.
- The cause of the operating expense increase.

## 8. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

AMD's operating margin was flat to slightly up through mid-2025, collapsed in Q2 FY2025, then recovered and has risen steadily since.

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

- **Q3 FY2024 to Q1 FY2025:** Margins held in a 10.6% to 11.4% range.
- **Q2 FY2025:** Operating income turned negative, and gross profit fell to about 39.8% of revenue, versus roughly 50% in the prior quarters. AMD attributes this to U.S. export controls on its MI308 data center GPU, which led to about $800M of inventory and related charges. Adding that back is my own arithmetic, not a company-reported adjusted figure. It gives operating income of about $666M, or an 8.7% margin, still below the surrounding quarters.
- **Q3 FY2025 onward:** Margin stepped up to 13.7% and has risen each quarter to 14.4% in Q2 FY2026. Revenue grew from $9.2B to $11.2B over the same stretch, and gross margin has held around 54%. So the margin gain comes from the higher gross margin and from operating costs growing more slowly than revenue.

Over the full eight quarters, margin is up about 3.8 points, from 10.6% to 14.4%. The recent gains are small, about 0.1 to 0.2 points per quarter. The data on file doesn't break out operating expenses, so I can't say how much of the improvement is mix versus cost discipline.

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

_Block sources: S1._

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads.

## 9. single-latest-quarter (single company)

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

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference:** Its latest quarter shown was extremely profitable, with high gross margin and most of each revenue dollar reaching operating income, though the picture is incomplete without cash flow and per-share data.

NVDA's revenue was **$62.1B**[1] and gross profit **$46.2B**[2] in Q4 FY2026 (ended Jan 2026).

NVDA's operating income was **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA's gross margin was **74.40%**[5], operating margin **64.90%**[6] and net margin **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA has no 10-K on file, so no business or risk factor claims from one.

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

**Data gap:** Q4 FY2026 is the latest quarter on file. Anything NVDA has reported since (the quarters ending around April and July 2026) is not in my data, so this is not a view on current trading. The file also has no guidance, consensus, cash flow, balance sheet or share count, so I can't comment on those or on valuation multiples.

## Headline numbers (USD millions)

| | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross profit | 46,200 | 41,849 | 28,723 | +10.4% | +60.8% |
| Operating income | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income | 35,400 | 31,910 | 22,091 | +10.9% | +60.2% |

## Margins
| | Q4 FY26 | Q3 FY26 | Q4 FY25 |
|---|---|---|---|
| Gross | 74.4% | 73.4% | 73.0% |
| Operating | 64.9% | 63.2% | 61.1% |
| Net | 57.0% | 56.0% | 56.2% |

- Operating income grew faster than revenue both sequentially and year over year, so there was operating leverage on top of a higher gross margin.
- Operating margin was about 380 bps above a year ago. Gross margin was up about 140 bps, so most of the gain came from the gross line and the rest from opex leverage.

## Mix
Data Center was $55.2B, or 88.9% of revenue. Gaming was $4.3B (6.9%), OEM & Other $1.05B (1.7%), Professional Visualization $0.9B (1.4%) and Automotive $0.65B (1.0%). The company is overwhelmingly a data center story. I have no prior-period segment data on file, so I can't say which segments drove growth.

## Fiscal-year context
- FY2026 revenue was $209.9B, up 60.9% from $130.5B. Net income was $112.5B, up 54% from $72.9B.
- FY2026 gross margin was 70.8% versus 75.0% in FY2025, and operating margin was 60.2% versus 62.4%.
- The full-year dip comes from Q1 FY26, when gross margin fell to 60.5%. It then rebuilt each quarter: 72.4%, 73.4%, 74.4%. The data doesn't say why Q1 was weak. Q4 is back near FY25 levels.
- Revenue rose every quarter of FY26, from $44.1B to $62.1B.

## Stock
The last price is $178.40, versus $167.35 at the 2025-12-01 close (+6.6%). That is a modest move against the fundamentals above, with net income up about 60% year over year. The price drifts steadily upward in the bars with no visible earnings-day jump. Without a share count or EPS I can't convert that into a valuation.

One data quirk: the quote's previous close ($176.10) doesn't match the prior bar's close ($178.34 on 2026-08-28), so I wouldn't rely on the quoted +1.3% day move.

## Bottom line
Q4 FY2026 was a strong quarter. Revenue grew 58% year over year, margins were at or near the best in the series, and Data Center was nearly 90% of sales. To judge whether the stock still has room, I'd need the more recent quarters, guidance and share count, none of which are on file.

## 10. missing-segments (missing data)

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

I can't break down AMD's revenue by segment, because the data on file has no segment figures for AMD. Only NVIDIA has a segment table (Q4 FY2026). For AMD there is only consolidated revenue.

**AMD consolidated revenue (USD millions)**

| Period | Revenue |
|---|---|
| Q3 FY2024 | 6,819 |
| Q4 FY2024 | 7,658 |
| Q1 FY2025 | 7,438 |
| Q2 FY2025 | 7,685 |
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 | 11,200 |
| FY2024 | 25,785 |
| FY2025 | 34,669 |

The only segment-related detail is in AMD's Q2 FY2025 filing. It says the U.S. export control on the AMD Instinct MI308 data center GPU led to about $800 million in inventory and related charges. That confirms AMD has data center GPU products, but it gives no revenue by segment or product line.

To get the split, you would need AMD's segment disclosures from its 10-Q/10-K filings, which aren't in the data I have. I can also compare consolidated margins or growth against NVIDIA if that helps.

## 11. what-changed-gross-margin (what changed)

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

_Analyst commentary:_ > **Analyst inference:** Its gross margin fell sharply in the latest quarter against both the prior quarter and the year-earlier quarter, even as revenue and gross profit dollars grew from a year earlier.

NVDA's gross profit was **$26.7B**[1], revenue **$44.1B**[2] and gross margin **60.52%**[3] in Q1 FY2026 (ended Apr 2025).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit dollars fell from the prior quarter despite higher revenue, so the margin compression was not offset by volume in that sequential comparison.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [3] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

NVDA's gross margin dropped sharply in Q1 FY2026 (quarter ended 2025-04-27), then mostly recovered the next quarter.

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | 78.4% |
| Q4 FY2025 | 39,331 | 28,723 | 73.0% |
| **Q1 FY2026** | **44,062** | **26,668** | **60.5%** |
| Q2 FY2026 | 46,743 | 33,853 | 72.4% |

- **Sequential:** Margin fell about 12.5 points from Q4 FY2025. Revenue rose about $4.7B (+12%), but gross profit fell about $2.1B. Implied cost of revenue (revenue minus gross profit) jumped from about $10.6B to $17.4B, up roughly 64%.
- **Year over year:** Margin was down about 17.8 points from Q1 FY2025.
- **Operating income:** It fell from $24.0B to $21.6B, and operating margin went from about 61% to 49%. Implied operating expenses (gross profit minus operating income) rose only about $0.3B, from $4.7B to $5.0B. So the decline in operating income came almost entirely from gross margin.
- **Recovery:** Q2 FY2026 margin rebounded to 72.4%, and it reached about 73.4% in Q3 (41,849 / 57,006) and 74.4% in Q4 (46,200 / 62,100). Margin is still below the 78.4% of Q1 FY2025.

**What the data doesn't tell us:** I can't say why costs spiked. The data has no filed explanation, cost breakdown or segment detail for NVDA for that quarter. The only filed explanation on file is AMD's, which cites export-control-related inventory charges, and I wouldn't carry that over to NVDA without NVDA's own disclosure. The data points to a cost-of-revenue event rather than an operating expense issue, but the cause needs to come from NVDA's filings or call commentary.

## 12. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

**Bottom line:** NVDA is growing much faster and earns far higher margins, but its data on file ends a quarter-plus earlier than AAPL's. The data has no share counts, so I can't compare valuation.

**Annual (fiscal years don't line up)**

| | AAPL FY2025 (to Sep 2025) | NVDA FY2026 (to Jan 2026) |
|---|---|---|
| Revenue | $416.2B | $209.9B |
| Revenue growth | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% (FY25: 75.0%) |
| Operating margin | 32.0% | 60.2% (FY25: 62.4%) |
| Net margin | 26.9% | 53.6% (FY25: 55.8%) |
| Net income | $112.0B | $112.5B |

NVDA earned about the same net income as AAPL on roughly half the revenue. NVDA's margins slipped year over year, though. Its Q1 FY2026 gross margin was only 60.5% before recovering to 74.4% in Q4.

**Most recent quarter on file**
- **AAPL Q3 FY2026 (to Jun 2026):** revenue $97.1B (+3.3% vs. the year-ago quarter), gross margin 47.1%, operating margin 30.7%. Trailing four quarters revenue is $426.3B, up 4.3% on the prior four.
- **NVDA Q4 FY2026 (to Jan 2026):** revenue $62.1B (+57.9% year over year), gross margin 74.4%, operating margin 64.9%. Data Center was $55.2B, about 89% of revenue.

**Gaps in the data**
- NVDA's latest reported quarter ended January 2026. Nothing is on file for the quarters ending April or July 2026, so the comparison isn't period-matched. AAPL has results through June 2026.
- There is no AAPL segment breakdown, so I can't compare business mix beyond NVDA's Data Center concentration.
- There are no share counts, market caps, EPS or estimates, so I can't give P/E or other valuation comparisons.

**Price (split-adjusted, excludes dividends)**
- From 2025-12-01 to 2026-08-31, AAPL went from $218.38 to $231.60 (+6.1%). NVDA went from $167.35 to $178.40 (+6.6%). The returns are nearly identical, even though NVDA's fundamentals are far stronger. That points to the market already pricing in the growth gap, but I can't test that without valuation data.
- The quoted "previous close" (AAPL $229.80, NVDA $176.10) doesn't match the 2026-08-28 closes in the daily bars ($231.53 and $178.34). I wouldn't rely on the one-day moves implied by the quote until that's reconciled.

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: 14 of 20 requested results verified*

*Operating cash flow, Capital expenditures (PP&E cash payments), Free cash flow (OCF less PP&E cash capex), Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Operating cash flow, latest fiscal year | Capital expenditures (PP&E cash payments), latest fiscal year | Free cash flow (OCF less PP&E cash capex), latest fiscal year | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|---|---|---|---|---|---|
| Apple Inc. | gap (missing_input): No eligible input was public before the knowledge cutoff. | gap (missing_input): No eligible input was public before the knowledge cutoff. | gap (blocked_by_dependency): A required input or calculation is unavailable. | $416.2B (FY2025 (ended 2025-09-27)) | $195.2B (FY2025 (ended 2025-09-27)) | $133.0B (FY2025 (ended 2025-09-27)) | $112.0B (FY2025 (ended 2025-09-27)) | 46.91% (FY2025 (ended 2025-09-27)) | 31.97% (FY2025 (ended 2025-09-27)) | 26.92% (FY2025 (ended 2025-09-27)) |
| NVIDIA Corporation | gap (missing_input): No eligible input was public before the knowledge cutoff. | gap (missing_input): No eligible input was public before the knowledge cutoff. | gap (blocked_by_dependency): A required input or calculation is unavailable. | $209.9B (FY2026 (ended 2026-01-25)) | $148.6B (FY2026 (ended 2026-01-25)) | $126.4B (FY2026 (ended 2026-01-25)) | $112.5B (FY2026 (ended 2026-01-25)) | 70.78% (FY2026 (ended 2026-01-25)) | 60.21% (FY2026 (ended 2026-01-25)) | 53.60% (FY2026 (ended 2026-01-25)) |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It converts revenue into profit at a much higher rate at every level shown, while both stocks have returned similar amounts this year.

By revenue, highest first: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[7] (FY2025, ended Sep 2025), NVDA **53.60%**[8] (FY2026, ended Jan 2026).

AAPL's net income was **$112.0B**[9] in FY2025 (ended Sep 2025); NVDA's net income was **$112.5B**[10] in FY2026 (ended Jan 2026).

> **Analyst inference on AAPL** (from the revenue ranking): Its larger revenue base yields about the same net income despite far lower margins, which cuts against reading the margin gap as a profit gap.

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
- [9] **$112.0B**: engine result: Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B
- [10] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
