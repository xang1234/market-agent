# Research-quality eval: 2026-11-25T040734

Stack revision: `defab76cc1f2`, clean. Runner revision: `defab76cc1f2`. Question set: `2a1d31d1c787`. Dataset: `9714d6e9321f`.

Answered by: `anthropic/claude-sonnet-5-5` (14 turns).

Answer tokens: mean 28626 input / 1251 output per turn over 14 turns.

Assertions: not reported.

Model: `anthropic/claude-sonnet-5-5`. Data: frozen golden dataset. Score each question in `2026-11-25T040734.scores.json` (rubric below),
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

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Q: Analyze NVDA's latest quarter.

_Outcome: completed; time: 9.3s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28304 input / 1118 output tokens._

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Headline numbers (USD millions)**

| Metric | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross profit | 46,200 | 41,849 | 28,723 | +10.4% | +60.8% |
| Operating income | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income | 35,400 | 31,910 | 22,091 | +10.9% | +60.2% |

**Margins**

| | Q4 FY26 | Q3 FY26 | Q4 FY25 |
|---|---|---|---|
| Gross | 74.4% | 73.4% | 73.0% |
| Operating | 64.9% | 63.2% | 61.1% |
| Net | 57.0% | 56.0% | 56.2% |

**Takeaways**
- Growth is strong, with revenue up about 58% YoY, and operating income grew faster than revenue. Operating margin expanded roughly 380 bp YoY and 170 bp QoQ.
- Gross margin was the main driver, up about 100 bp QoQ to 74.4%. Operating expenses (gross profit minus operating income) were 5,900, or 9.5% of revenue, versus 5,839 (10.2%) in Q3, so opex was roughly flat in dollars and gave a little extra leverage.
- Data Center was 55,200, or about 88.9% of revenue. Gaming was 4,300 (6.9%), OEM & Other 1,050 (1.7%), Professional Visualization 900 (1.4%), and Automotive 650 (1.0%). Data Center is the whole story. The data gives no prior-quarter segment split, so I can't tell you segment growth.
- The year looks like a V-shape in margins. Q1 FY26 gross margin was 60.5% and operating margin 49.1%, well below the surrounding quarters, then recovered to 72.4% and 60.8% in Q2. The data doesn't say why, so I won't speculate.
- FY2026 totals: revenue 209,911 (+60.9% vs FY25), operating income 126,388 (+55.2%), net income 112,507 (+54.4%). Q4 is the largest quarter of the year at about 29.6% of annual revenue.

**Stock context (as of 2026-09-01)**
Last price is 178.40, up 1.3% from the 176.10 prior close. The stock has drifted up steadily from about 167 in early December 2025, roughly +6.6%, a modest move compared with the fundamentals. I can't give valuation multiples because share count, EPS, and cash flow/balance sheet data are not on file.

**Gaps**
- Q4 is now over seven months old. The data has no later quarter (Q1 FY2027 and Q2 FY2027 would normally have been reported by now), so this is not the most current picture of the business.
- No guidance, management commentary, or filed explanation for NVDA is on file, so I can't explain the drivers behind the margin or segment trends.
- No peer valuation comparison is possible from the data provided.


## margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Q: How have AMD's operating margins trended over the last eight quarters?

_Outcome: completed; time: 6.8s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28310 input / 822 output tokens._

AMD's operating margin (operating income ÷ revenue) over the eight quarters on file:

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

**Trend**
- **Late 2024 to Q1 FY2025:** margins were stable at roughly 11%.
- **Q2 FY2025 dip:** operating income turned negative (-1.7%). AMD's filing attributes this to the U.S. export controls on the Instinct MI308 data center GPU, which led to approximately $800 million in inventory and related charges. Adding that back would put operating income at roughly $666M, or about 8.7% of revenue. That is my own illustrative arithmetic, not a company-reported adjusted figure. It also assumes the full charge sat in operating income, which the filing doesn't state outright.
- **Recovery and expansion:** since Q3 FY2025 margin has risen every quarter, from 13.7% to 14.4%. That is about 3 points above the pre-dip level of roughly 11%.

**Drivers:** Gross margin moves with it (Q3 FY2025 53.6%, Q2 FY2026 54.0%, versus about 50% in late 2024 and early 2025). Revenue growth has also spread fixed costs: revenue is up about 21% over the last four quarters, Q2 FY2025 to Q2 FY2026 (7,685 to 11,200) and operating income rose from a loss to $1.6B. The data on file doesn't break out operating expenses, so I can't say how much came from gross margin versus opex leverage.

**Caveat:** the improvement is gradual in recent quarters (about 0.1 to 0.3 points per quarter), so the trend is steady expansion, not an acceleration.


## what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Q: What changed in NVDA's gross margin in Q1 fiscal 2026?

_Outcome: completed; time: 4.4s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28315 input / 549 output tokens._

NVDA's gross margin fell sharply in Q1 FY2026, then recovered the next quarter.

**Gross margin by quarter (gross profit / revenue, computed from the filed figures):**
- Q4 FY2025: 28,723 / 39,331 = 73.0%
- Q1 FY2026: 26,668 / 44,062 = 60.5%
- Q2 FY2026: 33,853 / 46,743 = 72.4%

**What changed in Q1 FY2026:**
- Margin dropped about 12.5 percentage points from the prior quarter (73.0% to 60.5%).
- Revenue still grew, from 39,331 to 44,062 (+12.0% QoQ), while gross profit fell from 28,723 to 26,668 (about -7.2%).
- The decline flowed through to operating income, which fell from 24,034 to 21,638, and net income, which fell from 22,091 to 18,775. Operating margin went from 61.1% to 49.1%.
- Q2 FY2026 reversed most of it, with gross margin back to 72.4% and operating income at 28,440.

**What I can't tell you:** the data on file has no filed explanation for NVDA's Q1 FY2026 margin drop. There is no press release, MD&A, or segment breakdown for that quarter (the only segment table is for Q4 FY2026). I can't say whether it came from charges, product mix, pricing, or something else. The only filed explanation in the data concerns AMD, not NVDA, so I wouldn't read anything across from it. To get the cause, you'd need NVDA's Q1 FY2026 earnings release or 10-Q.


## cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Q: Why did AMD's operating margin turn negative in Q2 2025?

_Outcome: completed; time: 4.9s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28312 input / 618 output tokens._

AMD's operating margin turned negative in Q2 FY2025 (quarter ended 2025-06-28) because of charges tied to U.S. export controls on its MI308 data center GPU.

**What the filing says:** In its Q2 2025 earnings release (8-K Exhibit 99.1, published 2025-08-05), AMD stated that the U.S. Government's export control on the AMD Instinct MI308 products led to approximately $800 million in inventory and related charges for the quarter.

**What the numbers show:**
- Operating income was -$134M on revenue of $7,685M, a margin of about -1.7%.
- Gross profit was $3,059M, a gross margin of about 39.8%. In the prior quarter (Q1 FY2025) it was $3,735M on $7,438M, about 50.2%, and in the following quarter (Q3 FY2025) it was $4,953M on $9,246M, about 53.6%.
- Quarter on quarter, gross profit fell by about $676M even though revenue rose by about $247M.

**Putting it together:** If you add back the roughly $800M charge, operating income would have been about +$666M, a margin of about 8.7%. That is somewhat below Q1's ~$806M (10.8%). This is my own arithmetic, not a figure AMD reported. It also assumes the full charge sat in cost of sales, which the filing excerpt doesn't state explicitly, though the gross margin drop is consistent with that.

**What the data doesn't tell me:** The excerpt doesn't break down where the $800M was booked in the income statement, or how much of the remaining decline versus Q1 came from other factors such as lost MI308 revenue or product mix. I'd need the full filing for that.

The negative margin was a one-quarter event. Operating income was positive again in Q3 FY2025 ($1,270M) and has stayed positive since.


## peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Q: Compare NVDA with AMD.

_Outcome: completed; time: 13.6s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28301 input / 1958 output tokens._

**Bottom line:** NVDA is far larger and much more profitable. AMD is growing quickly from a much smaller base, with margins improving. The data on file can't support a valuation comparison.

**Scale and profitability (latest fiscal year)**

| | NVDA FY2026 (to Jan 2026) | AMD FY2025 (to Dec 2025) |
|---|---|---|
| Revenue | $209.9B | $34.7B |
| Revenue growth | +60.9% | +34.5% |
| Gross margin | 70.8% (FY25: 75.0%) | 49.9% (FY24: 49.4%) |
| Operating margin | 60.2% (FY25: 62.4%) | 9.8% (FY24: 1.6%) |
| Net income | $112.5B | $4.2B |
| Net margin | 53.6% | 12.0% |

**Latest quarter**
- **NVDA Q4 FY2026:** revenue was $62.1B, up 57.9% year on year. Gross margin was 74.4% and operating margin 64.9%. Data Center was $55.2B, about 89% of revenue.
- **AMD Q2 FY2026:** revenue was $11.2B, up 45.7% year on year. Gross margin was 54.0% and operating margin 14.4%.
- AMD's year-ago quarter (Q2 FY2025) was depressed by about $800M of inventory and related charges tied to US export controls on its MI308 GPU. That flatters the year-on-year comparison. AMD's operating income that quarter was -$134M.

**Trends worth noting**
- NVDA's margins are very high but have not expanded. Gross margin fell from 75.0% in FY2025 to 70.8% in FY2026, with a dip to 60.5% in Q1 FY2026 before recovering to 74.4% by Q4. The data on file doesn't explain the dip.
- AMD's revenue has risen every quarter since Q2 FY2025, from $7.7B to $11.2B. Operating income has risen each quarter, from -$134M to $1.6B.
- AMD's trailing four quarters (Q3 FY25 to Q2 FY26) show revenue of about $41.4B and net income of about $5.5B.

**Stock performance (price only, excluding dividends)**
- **NVDA:** closed at $178.40, up 1.3% on the day. It is up about 6.6% since 2025-12-01.
- **AMD:** closed at $162.30, down 1.6% on the day. It is up about 3.6% since 2025-12-01.
- Both stocks have drifted up steadily with rising volume over the period.

**Gaps**
- There are no share counts, balance sheet or cash flow data, so I can't give market cap, P/E, EV/sales or free cash flow comparisons.
- NVDA's latest filing on file is Q4 FY2026 (period ended 2026-01-25), while AMD's runs through June 2026. The two are not on the same footing, and NVDA's more recent quarters are not on file.
- There is no AMD segment breakdown, no guidance and no analyst estimates, so I can't compare how much of each company's growth is AI-driven.


## peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Q: Compare NVDA, AMD and AAPL on revenue and margins.

_Outcome: completed; time: 13.3s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28313 input / 2030 output tokens._

**Bottom line:** NVDA is far ahead on growth and margins. AAPL is the largest by revenue but is growing slowly. AMD is the smallest, with the lowest operating margin, but its margins are improving.

**Latest fiscal year (as reported; fiscal calendars differ)**

| | Revenue ($M) | YoY | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|
| NVDA FY2026 (to Jan-26) | 209,911 | +60.9% | 70.8% | 60.2% | 53.6% |
| AMD FY2025 (to Dec-25) | 34,669 | +34.4% | 49.9% | 9.8% | 12.0% |
| AAPL FY2025 (to Sep-25) | 416,161 | +6.4% | 46.9% | 32.0% | 26.9% |

Prior-year margins (gross / operating / net):
- NVDA FY2025: 75.0% / 62.4% / 55.9%
- AMD FY2024: 49.4% / 1.6% / 6.4%
- AAPL FY2024: 46.2% / 31.5% / 24.0%

**Most recent quarter**

| | Revenue ($M) | YoY | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|
| NVDA Q4 FY26 (Jan-26) | 62,100 | +57.9% | 74.4% | 64.9% | 57.0% |
| AMD Q2 FY26 (Jun-26) | 11,200 | +45.7% | 54.0% | 14.4% | 13.2% |
| AAPL Q3 FY26 (Jun-26) | 97,100 | +3.3% | 47.1% | 30.7% | 25.6% |

**Takeaways**
- **NVDA:** Revenue grew about 61% in FY2026, and Data Center was $55.2B of the $62.1B Q4 revenue. Gross margin fell from 75.0% to 70.8% for the year, though operating margin held above 60%. Gross margin was 60.5% in Q1 FY26 before recovering to 74.4% in Q4. The data on file doesn't explain that dip.
- **AMD:** Margins are structurally lower, but the trend is up. Operating margin went from 1.6% in FY2024 to 9.8% in FY2025 and 14.4% in the latest quarter. Q2 FY25 is distorted by roughly $800M of inventory and related charges tied to US export controls on the MI308 GPU. That quarter showed a 39.8% gross margin and an operating loss of $134M.
- **AAPL:** It is the most stable, with margins creeping up. Growth is mostly seasonal, with the December quarter at $128.0B against about $97–99B in the others. The latest quarter is up only 3.3% YoY.
- **Trailing four quarters, revenue:** NVDA $209.9B (the same as FY2026), AAPL $426.3B, AMD $41.4B.

**Not covered by the data:** consensus estimates, forward guidance, and valuation multiples. There are no share counts or balance sheet items on file, so I can't compute P/E or market cap.


## fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Q: Compare NVDA's and AAPL's fiscal 2025 revenue.

_Outcome: completed; time: 4.1s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28315 input / 462 output tokens._

**FY2025 revenue (as reported, USD millions)**

| | Period | Revenue |
|---|---|---|
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |

- AAPL's FY2025 revenue was about $285.7B higher than NVDA's, or roughly 3.2x as large (416,161 / 130,497 ≈ 3.19).
- The fiscal years don't line up. NVDA's FY2025 ended in January 2025, while AAPL's ended in late September 2025, so AAPL's year is shifted about eight months later. This matters because NVDA was growing quickly in that window. Its next fiscal year (FY2026, ended 2026-01-25) came in at 209,911, up about 61% from FY2025.
- Using the periods closest to AAPL's FY2025 (Q3 FY2025 through Q2 FY2026 for NVDA, ending 2025-07-27) would give a different picture. I haven't built that sum, but the quarterly data is on file if you want it.
- The comparison is on revenue only. Growth was also very different: AAPL's FY2025 revenue rose about 6.4% from FY2024's 391,035, while NVDA's FY2025 revenue is shown without a FY2024 comparison in the data on file.


## segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Q: Break down NVDA's revenue by segment.

_Outcome: completed; time: 2.8s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28304 input / 349 output tokens._

The data on file has a segment breakdown for only one period: Q4 FY2026 (2025-10-27 to 2026-01-25). Total revenue for the quarter was $62,100M.

| Segment | Revenue ($M) | % of Q4 revenue |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

The five segments sum to $62,100M, which matches reported quarterly revenue.

Data Center is nearly 89% of the quarter, and Gaming is the only other segment above 2%.

The data does not include segment figures for any other quarter or for the full fiscal years FY2025 and FY2026. I can't show how the mix has shifted over time or give segment growth rates. Those would need prior-period segment filings, which aren't on file.


## missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Q: Break down AMD's revenue by segment.

_Outcome: completed; time: 4.2s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28303 input / 537 output tokens._

The data on file does not include a segment breakdown for AMD. I only have AMD's consolidated income statement (revenue, gross profit, operating income, net income), so I can't split revenue into Data Center, Client, Gaming, Embedded, or any other segment. The only segment-level breakdown on file is for NVIDIA (Q4 FY2026), which doesn't help here.

What I can give you on AMD's total revenue (USD millions):

| Period | Revenue |
|---|---|
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 | 11,200 |
| FY2024 | 25,785 |
| FY2025 | 34,669 |

Revenue has grown for five straight quarters, from 7,685 in Q2 FY2025 to 11,200 in Q2 FY2026. FY2025 revenue was up about 34% over FY2024.

One filed explanation touches on products, though not on segment revenue. AMD said its Q2 FY2025 results were hit by U.S. export controls on the Instinct MI308 data center GPU, which led to about $800 million in inventory and related charges. That is consistent with the dip in Q2 FY2025 gross profit (3,059) and the operating loss (-134), but the filing as provided doesn't tell us how much data center revenue contributed.

For the segment split, you'd need AMD's 10-K/10-Q segment note or earnings release, which isn't in the data I have. I can build out anything else from the consolidated figures, such as margin trends.


## missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Q: What is AMD's free cash flow?

_Outcome: completed; time: 4.3s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28301 input / 464 output tokens._

I can't give you AMD's free cash flow from the data on file. Free cash flow needs operating cash flow and capital expenditures, and the file has neither. It has only income statement lines (revenue, gross profit, operating income, net income), price and volume bars, and one filed explanation. There is no cash flow statement or balance sheet for AMD.

I haven't estimated it from net income or operating income. Those figures leave out working capital, depreciation and amortization, stock-based compensation, and capex, so any number I derived would be a guess.

What the file does show about AMD's earnings power:
- **FY2025:** revenue $34,669M, operating income $3,392M, net income $4,174M.
- **Latest quarter (Q2 FY2026, ended 2026-06-27):** revenue $11,200M, operating income $1,610M, net income $1,480M.
- **Q2 FY2025 distortion:** operating income was -$134M. AMD attributed about $800M of inventory and related charges to U.S. export controls on the MI308 data center GPU. That quarter would depress any trailing earnings-based measure.

To get FCF, we'd need AMD's cash flow statement, specifically operating cash flow and purchases of property and equipment, from its 10-K/10-Q filings. If you can pull those, I can calculate FCF and a yield against the $162.30 last price. I'd also need the share count, which isn't on file either.


## follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Q: Analyze NVDA.

_Outcome: completed; time: 9.6s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28298 input / 1263 output tokens._

# NVDA snapshot (as of 2026-09-01)

**Bottom line:** The filed numbers show very strong growth and expanding profitability. The data does not include valuation inputs (shares outstanding, EPS, consensus, guidance), so I can't say whether the stock is cheap or expensive.

## Fundamentals

**Annual**
| | FY2025 | FY2026 | Change |
|---|---|---|---|
| Revenue | $130.5B | $209.9B | +60.9% |
| Gross margin | 75.0% | 70.8% | -4.2 pts |
| Operating margin | 62.4% | 60.2% | -2.2 pts |
| Net margin | 55.9% | 53.6% | -2.3 pts |
| Operating income | $81.5B | $126.4B | +55.2% |
| Net income | $72.9B | $112.5B | +54.4% |

Profit grew a bit slower than revenue, so margins compressed year over year.

**Quarterly trajectory (FY2026)**
| | Revenue | Gross margin | Op margin |
|---|---|---|---|
| Q1 | 44.1B | 60.5% | 49.1% |
| Q2 | 46.7B | 72.4% | 60.8% |
| Q3 | 57.0B | 73.4% | 63.2% |
| Q4 | 62.1B | 74.4% | 64.9% |

- Q1 FY2026 was a clear margin trough (gross margin 60.5%, down from 73.0% in Q4 FY2025). The data doesn't say why, so I won't speculate.
- Margins have recovered each quarter since, with Q4 gross margin at 74.4%, close to FY2025 levels.
- Revenue grew 58% in Q4 FY2026 versus Q4 FY2025 (62.1B vs 39.3B), and 8.9% sequentially from Q3.
- Sequential growth was lumpy: +6% in Q2, +22% in Q3, +9% in Q4.

## Mix
Data Center was $55.2B of $62.1B in Q4 FY2026, about 89% of revenue. Gaming was $4.3B (6.9%), OEM & Other $1.05B, Professional Visualization $0.9B, and Automotive $0.65B. The business is heavily concentrated in one segment. The data only has the segment split for Q4, so I can't show how mix has shifted over time.

## Price action
- Last price $178.40 (previous close $176.10, +1.3% on the day).
- The stock rose from $167.35 on 2025-12-01 to $178.40, about +6.6% over the roughly nine months of bars on file.
- The move has been a steady, low-volatility climb. Daily volume rose gradually from about 1.0M to 2.96M shares.
- Note that the stock gained only about 6.6% while FY2026 earnings grew over 50%. Without share count or EPS, I can't compute a P/E or say what that implies.

## What the data doesn't cover
- Market cap, share count, EPS, P/E or other multiples
- Balance sheet and cash flow
- Management guidance, Q1 FY2027 and later results (the latest filed quarter ends 2026-01-25, so the most recent results are about seven months old)
- Reasons for the Q1 FY2026 margin drop
- Competitive or customer-concentration detail

## Takeaways
1. Growth is exceptional and accelerating in absolute dollars; Q4 was a record.
2. Margins are recovering toward prior levels but remain below FY2025.
3. Data Center concentration (~89%) is the key exposure.
4. Valuation can't be judged from this file. I'd want share count, forward estimates, and any newer quarterly results before forming a view on the stock.


### Q: Compare it with AMD YTD.

_Outcome: completed; time: 14.0s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 29575 input / 1895 output tokens._

# NVDA vs AMD, year to date (through 2026-09-01)

## Price performance
YTD uses the 2025-12-31 close as the base. The bars exclude dividends.

| | 2025-12-31 close | Last price | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | **+5.8%** |
| AMD | $157.32 | $162.30 | **+3.2%** |

NVDA is ahead by about 2.6 points. Both stocks drifted up steadily with very little volatility, and neither shows a sharp move in the bars. The gap is small relative to the gap in operating results below.

**Correction to my earlier note:** I called NVDA's last price +1.3% on the day, based on the quoted previous close of $176.10. The 2026-08-31 bar closes at $178.40, which is the same as the quoted last price, so the quoted "previous close" doesn't reconcile with the bars. The same mismatch shows up for AMD (previous close $164.90 vs. a bar close of $162.30). I'd treat the one-day moves as unreliable.

## Fundamentals
Fiscal calendars differ. NVDA's latest filed quarter ended 2026-01-25. AMD's ended 2026-06-27, so AMD's data is about five months fresher.

| | NVDA FY2026 | AMD FY2025 |
|---|---|---|
| Revenue | $209.9B | $34.7B |
| Revenue growth | +60.9% | +34.5% |
| Gross margin | 70.8% | 49.9% |
| Operating margin | 60.2% | 9.8% |
| Net margin | 53.6% | 12.0% |

**Latest quarter**
| | NVDA Q4 FY2026 | AMD Q2 FY2026 |
|---|---|---|
| Revenue | $62.1B | $11.2B |
| YoY growth | +58% | +45.7% (vs. $7.7B) |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |

- NVDA is growing faster and is far more profitable at every margin line. Its operating income is roughly 40x AMD's in the latest quarters ($40.3B vs. $1.6B).
- AMD's growth has been steady, with sequential revenue gains each quarter since Q2 FY2025 and operating margin improving from -1.7% to 14.4%. Part of that improvement is an easy comparison: Q2 FY2025 included about $800M of inventory and related charges tied to U.S. export controls on the MI308, per AMD's filing.
- NVDA's operating margin is still below its FY2025 level (62.4%), while AMD's is rising from a low base.

## What this does and doesn't say
- Both stocks rose modestly YTD despite strong earnings growth, so neither move is explained by the filings alone.
- The file has no shares outstanding, EPS, multiples, or estimates for either company, so I can't say which is better valued or whether NVDA's lead in fundamentals is already priced in.
- NVDA's results are stale (nothing after January 2026), so any NVDA vs. AMD comparison on recent trends is lopsided in data freshness.


### Q: Explain the differences and show the evidence.

_Outcome: completed; time: 24.9s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 31487 input / 3592 output tokens._

# Why NVDA and AMD differ, with the evidence

Everything below is arithmetic on the filed figures. The data supports how large the differences are and where they sit in the income statement. It mostly does not say why they exist, and I flag where I'm stopping.

## 1. Price: NVDA +5.8% vs AMD +3.2% YTD

| | 2025-12-31 close | Last price | Change | YTD |
|---|---|---|---|---|
| NVDA | 168.60 | 178.40 | +9.80 | 9.80 / 168.60 = **+5.8%** |
| AMD | 157.32 | 162.30 | +4.98 | 4.98 / 157.32 = **+3.2%** |

- The 2.6-point gap is small, and both series are near-straight climbs with tiny daily moves.
- **No cause is on file.** There are no estimates, news, or multiples, so I can't tie the gap to fundamentals.
- Most of the reported results predate this window. NVDA's last quarter ended 2026-01-25, so the YTD price move can't be tied to the earnings in the file.
- **Data quality flag:** daily volume is identical for NVDA, AMD, and AAPL on every session (1.01M rising 10k a day to 2.96M). That looks synthetic or placeholder, so I would not read anything into volume.

## 2. Growth: NVDA faster, and from a much larger base

| | NVDA | AMD |
|---|---|---|
| Latest full year | FY2026 $209,911M vs $130,497M = **+60.9%** | FY2025 $34,669M vs $25,785M = **+34.5%** |
| Latest quarter YoY | Q4 FY26 62,100 vs 39,331 = **+57.9%** | Q2 FY26 11,200 vs 7,685 = **+45.7%** |
| Dollars added (year) | +$79.4B | +$8.9B |

NVDA's annual revenue is about 6x AMD's. The segment split for Q4 FY2026 shows Data Center at $55.2B of $62.1B (89%). There is no segment data for AMD, so I can't compare mix.

## 3. Profitability: the large gap

**Annual margins**

| | NVDA FY2026 | AMD FY2025 | Gap |
|---|---|---|---|
| Gross margin | 148,570 / 209,911 = 70.8% | 17,307 / 34,669 = 49.9% | 20.9 pts |
| Gross profit − operating income ("opex") as % of revenue | 22,182 / 209,911 = 10.6% | 13,915 / 34,669 = 40.1% | 29.6 pts |
| Operating margin | 126,388 / 209,911 = 60.2% | 3,392 / 34,669 = 9.8% | 50.4 pts |

The 50.4-point operating margin gap splits into about 21 points from gross margin and about 30 points from operating expenses. NVDA spends about $22.2B on opex against AMD's $13.9B, only 1.6x as much on 6x the revenue. The filings on hand don't break opex into R&D, SG&A, or other lines, so I can't say what is in it.

**Latest quarter, same pattern**
- NVDA Q4 FY26: gross margin 74.4%, opex 5,900 / 62,100 = 9.5%, operating margin 64.9%.
- AMD Q2 FY26: gross margin 54.0%, opex 4,440 / 11,200 = 39.6%, operating margin 14.4%.

**Net margin oddity:** AMD's FY2025 net income ($4,174M) exceeds its operating income ($3,392M). NVDA's is lower than operating income, as you'd expect after tax. Something below the operating line helped AMD, but the data doesn't say what.

## 4. Trajectories: different shapes

**NVDA gross margin by quarter:** Q4 FY25 73.0% → Q1 FY26 60.5% → 72.4% → 73.4% → 74.4%. There was one trough, then a steady recovery. No reason is on file.

**AMD by quarter:**

| | Q2 FY25 | Q3 FY25 | Q4 FY25 | Q1 FY26 | Q2 FY26 |
|---|---|---|---|---|---|
| Gross margin | 39.8% | 53.6% | 54.0% | 54.0% | 54.0% |
| Operating margin | -1.7% | 13.7% | 14.1% | 14.2% | 14.4% |

This corrects my earlier wording that AMD's margin was "improving from -1.7% to 14.4%". The improvement happened in one step in Q3 FY25, and margins have been essentially flat for four quarters.

**The one explanation on file:** AMD's Q2 FY2025 filing attributes about $800M of inventory and related charges to U.S. export controls on its MI308 data center GPU. As a rough check, if the full charge sat in cost of sales (my assumption, since the filing only says "inventory and related charges"), Q2 FY25 gross margin would be about (3,059 + 800) / 7,685 = 50.2% and operating margin about (−134 + 800) / 7,685 = 8.7%. That means the trough was largely charge-driven, and the Q3 FY25 jump overstates underlying improvement. It does not close the gap with NVDA's margins.

## 5. What would be needed to go further
- Opex line items (R&D, SG&A) to explain the 30-point opex gap.
- Segment data for AMD, and NVDA segments for periods other than Q4.
- Shares outstanding, EPS, and estimates, to link fundamentals to the price gap.
- NVDA results after January 2026, so the comparison isn't lopsided in data freshness.


## ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Q: Compare with NVDA. (opened from the AAPL page)

_Outcome: completed; time: 13.1s; answered by: `anthropic/claude-sonnet-5-5`; checks: unknown; 28320 input / 1861 output tokens._

**Short version:** On the filed numbers, NVDA is growing about ten times faster than AAPL, at roughly double the operating margin. The data can't tell us which stock is cheaper, because there are no share counts, EPS or valuation inputs on file.

**Scale and profitability (annual, as reported, USD millions)**

| | AAPL FY2025 (to Sep 2025) | NVDA FY2026 (to Jan 2026) |
|---|---|---|
| Revenue | 416,161 | 209,911 |
| Revenue growth y/y | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net income | 112,010 | 112,507 |
| Net margin | 26.9% | 53.6% |

NVDA earned about the same net income as AAPL on roughly half the revenue. NVDA's gross margin also slipped from 75.0% in FY2025 to 70.8% in FY2026. Within FY2026, Q1 was the low point at 60.5%. The data doesn't explain why.

**Latest quarter**
- **NVDA Q4 FY2026 (to Jan 2026):** revenue was 62,100, up 57.9% y/y, with an operating margin of 64.9%. Data Center was 55,200, or about 89% of revenue.
- **AAPL Q3 FY2026 (to Jun 2026):** revenue was 97,100, up 3.3% y/y, with an operating margin of 30.7%.
- AAPL's last four quarters sum to revenue of 426,266 and net income of 115,766.

**Cadence:** AAPL's revenue is seasonal, peaking in the December quarter at 124,300 in FY2025 and 128,000 in FY2026. NVDA's has climbed almost every quarter.

**Stock price (split-adjusted, excluding dividends)**
- **1 Sep 2026 move:** NVDA closed at 178.40 versus 176.10 the prior day (+1.3%). AAPL closed at 231.60 versus 229.80 (+0.8%).
- **Since 1 Dec 2025:** NVDA is up 6.6% (167.35 to 178.40) and AAPL is up 6.1% (218.38 to 231.60). Both rose in a steady, narrow range.

**Gaps in the data**
- No valuation comparison is possible (no market cap, P/E, or price/sales).
- No balance sheet or cash flow is on file for either company.
- No segment breakdown is on file for AAPL.
- NVDA's latest filed period ends in January 2026, about five months before AAPL's. NVDA has no filed results for the quarters since then.
- Nothing on file explains the drivers of NVDA's growth beyond the Data Center share of revenue.
