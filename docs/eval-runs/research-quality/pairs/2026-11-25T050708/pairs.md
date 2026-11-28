# Blinded answer pairs: 2026-11-25T050708

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

## 1. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Bottom line:** Revenue was $62.1B, up 8.9% QoQ and 57.9% YoY. Gross margin reached 74.4%, the best of the eight quarters on file. Profit grew faster than revenue because operating expenses were roughly flat. Data Center is 89% of revenue, so this quarter is essentially a Data Center story.

**Gap to flag first:** This is the latest NVDA quarter on file, but it ended more than seven months before today (2026-09-01). There is nothing on file for the April or July 2026 quarters. This analysis may therefore be one or two quarters stale.

## Headline figures (USD millions)

| | Q4 FY26 | Q3 FY26 | QoQ | Q4 FY25 | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | +8.9% | 39,331 | +57.9% |
| Gross profit | 46,200 | 41,849 | +10.4% | 28,723 | +60.8% |
| Operating income | 40,300 | 36,010 | +11.9% | 24,034 | +67.7% |
| Net income | 35,400 | 31,910 | +10.9% | 22,091 | +60.2% |
| Gross margin | 74.4% | 73.4% | +1.0 pt | 73.0% | +1.4 pt |
| Operating margin | 64.9% | 63.2% | +1.7 pt | 61.1% | +3.8 pt |
| Net margin | 57.0% | 56.0% | +1.0 pt | 56.2% | +0.8 pt |

## What stands out

1. **Operating leverage.** Implied operating expenses (gross profit minus operating income) were about $5.9B, versus $5.84B in Q3, so roughly flat. As a result, about 84% of the $5.1B sequential revenue increase reached operating income. Opex was 9.5% of revenue, down from 10.2%. On a YoY basis opex grew about 26%, well below revenue growth of 58%.

2. **Margins recovered through FY2026.** Quarterly gross margin went 60.5% → 72.4% → 73.4% → 74.4% across Q1 to Q4. The Q1 FY26 drop is not explained in any NVDA filing on file. The only filed explanation in the data, about MI308 export controls, belongs to AMD, and I would not assume it applies here. Ask the team before reading the Q1 dip as a one-off.

3. **Sequential growth slowed.** QoQ revenue growth was +12.0%, +6.1%, +22.0% and then +8.9%. Q4 added $5.1B, compared with $10.3B in Q3. That is still strong, but the step-up from Q3 did not repeat.

4. **Revenue concentration.** The Q4 segment split sums exactly to total revenue:

| Segment | Revenue ($M) | Share |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Pro Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

I only have segment data for this one quarter, so I cannot calculate segment growth rates.

5. **Below operating income.** Net income was 87.8% of operating income, versus 88.6% in Q3. Tax and other income are not broken out in the data, so I cannot explain the small slippage.

## Full year FY2026

The four quarters reconcile exactly to the annual figures.

- Revenue: $209.9B, up 60.9% from $130.5B.
- Operating income: $126.4B, up 55.2%.
- Net income: $112.5B, up 54.4%.
- Full-year margins came in below FY2025 (gross margin 70.8% vs 75.0%; operating margin 60.2% vs 62.4%). That is entirely because of the weak Q1. The exit rate in Q4 is above FY2025 levels.

## Stock context

- The stock closed at $178.40, up about 5.2% from $169.56 on 2026-01-23, the last session before quarter end.
- The 2026-09-01 quote lists a previous close of $176.10, but the 2026-08-31 bar shows a close of $178.40. These do not reconcile.
- The daily bars move almost linearly and include sessions on 2025-12-25 and 2026-01-01. I would treat the price series as unreliable for anything beyond a rough level.

## What I can't assess from the data

- **Valuation:** there is no share count, EPS, balance sheet or cash flow data, so I cannot compute P/E, EV or FCF.
- **Guidance and the reasons behind results:** there is no NVDA commentary or explanation on file.
- **Segment trends over time:** there is only one quarter of segment data.
- **The two most recent quarters:** neither is on file.

The Q4 FY26 figures are also rounded to the nearest $100M, while earlier quarters are reported to the $1M. It is worth confirming they come from the final 10-K rather than a preliminary source.

### Answer B

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

_Analyst commentary:_ > **Analyst inference:** Its latest quarter shows very high profitability, with margins at every level above the full-year level, though cash flow and per-share data are not available to confirm earnings quality.

NVDA's revenue was **$62.1B**[1], gross profit **$46.2B**[2], operating income **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B

## 2. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

_Analyst commentary:_ Of NVDA and AAPL, AAPL's revenue was highest: NVDA **$130.5B**[1], AAPL **$416.2B**[2].

> **Analyst inference on NVDA:** The fiscal years end at different dates, so the comparison covers different stretches of time and is not strictly like for like.

Periods: NVDA FY2025 (ended Jan 2025), AAPL FY2025 (ended Sep 2025).

_Cited:_

- [1] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [2] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

# NVDA vs. AAPL: Fiscal 2025 Revenue

**Apple's FY2025 revenue was about 3.2x NVIDIA's ($416.2B vs. $130.5B), but the two fiscal years cover different periods, so the comparison needs that caveat.**

| | NVDA FY2025 | AAPL FY2025 |
|---|---|---|
| Period | 2024-01-29 to 2025-01-26 | 2024-09-29 to 2025-09-27 |
| Revenue | $130,497M | $416,161M |
| Gross margin | 75.0% | 46.9% |
| Operating margin | 62.4% | 32.0% |
| Net income | $72,880M | $112,010M |

- **Size gap:** Apple's revenue was higher by about $285.7B.
- **Profit gap is much smaller:** NVIDIA's margins are higher. Its operating income was $81.5B against Apple's $133.1B, about 61% of Apple's, even though its revenue was only about 31% of Apple's.

**The fiscal years barely overlap.** NVIDIA's FY2025 is mostly calendar 2024. Apple's FY2025 runs from October 2024 to September 2025, so they share only about four months. That matters because NVIDIA was growing fast. Its four quarters ending 2025-07-27 (Q3 FY25 to Q2 FY26) add up to **$165,218M**, which lines up more closely with Apple's FY2025. On that basis Apple is about **2.5x** NVIDIA, not 3.2x.

**Growth:**
- **Apple:** FY2025 revenue rose **+6.4%** from FY2024 ($391,035M).
- **NVIDIA:** I don't have its FY2024 annual figure on file, so I can't calculate FY2025 growth. Its next year, FY2026, came in at $209,911M, up **+60.9%** from FY2025.

## 3. missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** Break down AMD's revenue by segment.

I can't break AMD's revenue down by segment from what we have on file. The AMD data contains only consolidated totals (revenue, gross profit, operating income, net income). There's no segment split, so I can't say how much comes from data center, client, gaming, embedded, or any other line. The only segment table on file is for NVIDIA (Q4 FY2026).

**Consolidated AMD revenue (USD millions)**

| Quarter | Revenue | YoY | Gross margin | Operating margin |
|---|---|---|---|---|
| Q3 FY2024 | 6,819 | n/a | 50.1% | 10.6% |
| Q4 FY2024 | 7,658 | n/a | 51.0% | 11.4% |
| Q1 FY2025 | 7,438 | n/a | 50.2% | 10.8% |
| Q2 FY2025 | 7,685 | n/a | 39.8% | -1.7% |
| Q3 FY2025 | 9,246 | +35.6% | 53.6% | 13.7% |
| Q4 FY2025 | 10,300 | +34.5% | 54.0% | 14.1% |
| Q1 FY2026 | 10,700 | +43.9% | 54.0% | 14.2% |
| Q2 FY2026 | 11,200 | +45.7% | 54.0% | 14.4% |

- **Full year:** FY2025 revenue was 34,669, up 34.5% from 25,785 in FY2024.
- **First half of FY2026:** revenue was 21,900, and growth has accelerated into the mid-40s percent.
- **Margins:** gross margin has held at about 54% for three straight quarters.

**The only segment-level clue on file**

AMD's Q2 FY2025 8-K says U.S. export controls on its Instinct MI308 data center GPUs led to about $800M of inventory and related charges. That charge explains the margin dip that quarter.

- It shows AMD has a data center GPU business that was material enough to move results.
- It doesn't tell us that business's revenue or its share of the total.
- If all $800M sat in cost of sales, gross margin would have been about 50% that quarter. The filing doesn't specify where the charge was booked, so treat that as approximate.

To answer your question properly, we'd need AMD's segment disclosures from its 10-Q/10-K or earnings releases. Those aren't in the data I have.

### Answer B

**Q:** Break down AMD's revenue by segment.

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

_Block sources: S1._

AMD has no 10-K on file, so no business or risk factor claims from one.

## 4. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

**AMD's Q2 FY2025 operating loss came mainly from about $800 million in charges tied to U.S. export controls on its Instinct MI308 data center GPUs. Higher operating expenses made up the rest of the drop.**

**What the numbers show**

| | Q1 FY2025 | Q2 FY2025 | Q3 FY2025 |
|---|---|---|---|
| Revenue | 7,438 | 7,685 | 9,246 |
| Gross profit | 3,735 | 3,059 | 4,953 |
| Gross margin | 50.2% | 39.8% | 53.6% |
| Operating income | 806 | -134 | 1,270 |
| Operating margin | 10.8% | -1.7% | 13.7% |

USD millions. Margins are my calculations from the reported figures.

Revenue rose about 3% quarter over quarter. Gross profit still fell by $676M, so the problem was costs, not demand.

**The company's explanation**

AMD's Q2 earnings release (8-K, 2025-08-05) says results were "impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products," which "led to approximately $800 million in inventory and related charges."

**How much the charge explains (my estimate)**

- If the full ~$800M is added back to gross profit, Q2 gross margin would be about 50%, in line with Q1.
- On that basis, operating income would be about $666M, a margin of roughly 8.7%.
- That is positive but still below Q1's 10.8%. The rest of the gap is operating expenses (gross profit minus operating income): about $3,193M in Q2 versus $2,929M in Q1, up roughly $264M.

One caveat: the release doesn't say which line items the "inventory and related charges" were booked to. I've assumed they sit in cost of sales, which fits the size of the gross margin drop. That assumption is mine, not the filing's.

**The rebound**

Q3 FY2025 gross margin recovered to 53.6% and operating margin to 13.7%. Margins kept improving through Q2 FY2026, which reached 54.0% gross and 14.4% operating. That points to a one-quarter event rather than a lasting margin reset.

**Not explained by the data**

Q2 net income was positive at $872M despite the operating loss. The data on file doesn't show the below-the-line items (tax, interest, other income) that account for this, so I can't break it down.

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

_Analyst commentary:_ > **Analyst inference:** Its operating loss came despite positive gross profit, so costs below gross profit absorbed all of it, but the data shown does not say why.

AMD's revenue was **$7.7B**[1] in Q2 FY2025 (ended Jun 2025).

AMD's gross profit was **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[3] and operating margin **-1.74%**[4] in Q2 FY2025 (ended Jun 2025).

AMD's net income was **$872.0M**[5] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Positive net income alongside an operating loss means items outside operations lifted the bottom line, so the operating loss does not by itself show weak profitability.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [4] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [5] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M

## 5. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

_Block sources: S1._

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2024: gap (blocked_by_dependency): A required input or calculation is unavailable.

_Analyst commentary:_ AMD's operating margin was **9.78%**[1] in FY2025 (ended Dec 2025).

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

# AMD operating margins: last eight quarters

**AMD's operating margin rose from about 11% to about 14% over the eight quarters.** The exception is Q2 FY2025, which was negative because of an export-control charge. Since then the margin has improved modestly in each of four straight quarters.

| Quarter | Period end | Revenue ($M) | Operating income ($M) | Operating margin | Gross margin |
|---|---|---|---|---|---|
| Q3 FY2024 | 2024-09-28 | 6,819 | 724 | 10.6% | 50.1% |
| Q4 FY2024 | 2024-12-28 | 7,658 | 871 | 11.4% | 51.0% |
| Q1 FY2025 | 2025-03-29 | 7,438 | 806 | 10.8% | 50.2% |
| Q2 FY2025 | 2025-06-28 | 7,685 | -134 | -1.7% | 39.8% |
| Q3 FY2025 | 2025-09-27 | 9,246 | 1,270 | 13.7% | 53.6% |
| Q4 FY2025 | 2025-12-27 | 10,300 | 1,450 | 14.1% | 54.0% |
| Q1 FY2026 | 2026-03-28 | 10,700 | 1,520 | 14.2% | 54.0% |
| Q2 FY2026 | 2026-06-27 | 11,200 | 1,610 | 14.4% | 54.0% |

## What stands out

**1. Q2 FY2025 is distorted by a one-off charge.**
- AMD's Q2 FY2025 earnings release attributes about $800M of "inventory and related charges" to U.S. export controls on its Instinct MI308 data center GPUs.
- Adding the $800M back gives roughly $666M of operating income, or about 8.7% margin. That is still below the surrounding quarters, so treat this as approximate.
- The release doesn't say which line the charge sits in. If it was all in cost of sales, gross margin would have been about 50.2%, consistent with the prior three quarters. That is plausible but I can't confirm it from the data.

**2. Stepping up and then plateauing.**
- Margin moved from the ~11% range (Q3 FY2024 to Q1 FY2025) to the ~14% range from Q3 FY2025 onward.
- Since that step-up, gains have been small: 13.7% → 14.1% → 14.2% → 14.4%.

**3. The improvement came entirely from gross margin, not operating leverage.**
- Gross margin rose from about 50% to about 54%, roughly +3.9 points between Q3 FY2024 and Q2 FY2026.
- Operating expenses (gross profit minus operating income) grew from $2,695M to $4,440M. That is about 39.5% of revenue then and 39.6% now.
- So opex has grown in line with revenue, which rose about 64% over the period.
- Incremental operating margin on the added revenue was only about 20%.
- Gross margin has been flat at roughly 54% for three quarters. Unless opex growth slows, the recent margin trend looks more like a plateau than an ongoing expansion.

**4. Annual context.**
- FY2024 operating margin was just 1.6% ($401M on $25,785M). With Q3 and Q4 contributing $1,595M combined, the first half of FY2024 implies about -$1.19B of operating income.
- FY2025 operating margin was 9.8%, despite the Q2 charge.
- The data doesn't explain the weak first half of FY2024.

## What the data doesn't cover
- No segment breakdown for AMD, so I can't say which businesses are driving the gross margin mix.
- No opex split (R&D versus SG&A), so I can't tell what is absorbing the spending growth.
- No guidance on forward margins.

## 6. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 4 requested results verified*

- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

*Engine answer: all 4 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA:** On the periods shown, it earns much higher margins at every level than its mega-cap peer, though the periods differ and AMD is missing, so the comparison is incomplete.

NVDA's revenue was **$62.1B**[1].

AAPL's revenue was **$416.2B**[2].

Periods: NVDA Q4 FY2026 (ended Jan 2026), AAPL FY2025 (ended Sep 2025). No figures are shown for AMD.

AMD: the figures were not computed, as the turn reached its limit of model calls. Reading stopped at the turn's limit of model calls, so part of the question may be unanswered.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

# NVDA vs AMD vs AAPL: revenue and margins

**Bottom line:** NVDA has the highest margins and the fastest growth. AMD is growing fast and its margins have improved, but they are a fraction of NVDA's. AAPL is the largest by revenue, with steady, mid-tier margins and low single-digit growth.

### Trailing four reported quarters

| | NVDA | AMD | AAPL |
|---|---|---|---|
| Latest quarter ended | 2026-01-25 | 2026-06-27 | 2026-06-27 |
| Revenue ($M) | 209,911 | 41,446 | 426,266 |
| Gross margin | 70.8% | 53.9% | 47.1% |
| Operating margin | 60.2% | 14.1% | 32.2% |
| Net margin | 53.6% | 13.2% | 27.2% |

**Timing caveat:** NVDA's latest filed quarter ends about five months before AMD's and AAPL's. NVDA's quarters ending around April and July 2026 are not on file, so this is not a like-for-like calendar comparison.

### Latest quarter, year over year

| | Revenue ($M) | YoY growth | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|
| NVDA Q4 FY26 | 62,100 | +57.9% | 74.4% | 64.9% | 57.0% |
| AMD Q2 FY26 | 11,200 | +45.7% | 54.0% | 14.4% | 13.2% |
| AAPL Q3 FY26 | 97,100 | +3.3% | 47.1% | 30.7% | 25.6% |

### NVDA
- **Revenue:** FY2026 revenue grew 60.9% to $209.9B. Every quarter rose sequentially, from $44.1B in Q1 to $62.1B in Q4.
- **Concentration:** Data Center was $55.2B, about 89% of Q4 revenue.
- **Margins vs prior year:** FY2026 margins were slightly below FY2025 (gross 75.0%, operating 62.4%). That gap is mostly due to Q1 FY2026, when gross margin fell to 60.5% and operating margin to 49.1%.
- **Recovery:** Margins recovered to 74.4% gross in Q4.
- **Gap in the data:** No filed explanation for the Q1 dip is on file.

### AMD
- **Revenue:** FY2025 revenue grew 34.5% to $34.7B. Growth then accelerated, and quarterly revenue went from $7.7B in Q2 FY25 to $11.2B in Q2 FY26.
- **Q2 FY2025 charge:** The year-ago quarter was hit by about $800M of inventory and related charges from U.S. export controls on MI308 GPUs, per AMD's 8-K. Gross margin that quarter was 39.8% and operating income was –$134M. This flatters the YoY margin comparison.
- **Margin trend:** On a cleaner sequential basis, gross margin has held at roughly 54% for four quarters. Operating margin crept up from 13.7% to 14.4%.
- **Oddity:** Net income exceeded operating income in FY2024, FY2025 and Q2 FY25. The data on file doesn't show why.

### AAPL
- **Revenue:** FY2025 revenue grew 6.4% to $416.2B. The first three quarters of FY2026 grew only about 3–3.5% YoY.
- **Margins:** Margins are drifting up slowly.
  - Gross margin went from 46.2% in FY24 to 46.9% in FY25, and was 47.1% in the latest quarter.
  - Net margin went from 24.0% in FY24 to 26.9% in FY25.
- **Oddity:** Net income in Q4 FY2024 was unusually low at 15.5% of revenue. The cause isn't in the data on file.

### Not covered by the data
- Segment detail exists only for NVDA, and only for Q4 FY26.
- There is no guidance, cash flow or balance sheet data.
- There are no share counts, so I can't compare valuation.

## 7. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

# NVDA: analysis from data on file as of 2026-09-01

**Summary:** NVDA grew revenue 61% in FY2026 to $209.9B. Margins recovered fully from a sharp one-quarter dip in Q1 FY2026, and Data Center is now about 89% of sales. Two big gaps limit any call. The latest results on file end 2026-01-25, about seven months stale. There is also no share count or balance sheet, so I cannot assess valuation.

## 1. Growth

| | FY2025 | FY2026 | YoY |
|---|---|---|---|
| Revenue | $130.5B | $209.9B | +60.9% |
| Operating income | $81.5B | $126.4B | +55.2% |
| Net income | $72.9B | $112.5B | +54.4% |

The four FY2026 quarters sum exactly to the annual figures.

Quarterly growth stayed strong through the year:

| Quarter | Revenue | YoY | QoQ |
|---|---|---|---|
| Q1 FY26 | $44.1B | +69.2% | +12.0% |
| Q2 FY26 | $46.7B | +55.6% | +6.1% |
| Q3 FY26 | $57.0B | +62.5% | +22.0% |
| Q4 FY26 | $62.1B | +57.9% | +8.9% |

Year-over-year growth is holding in the high-50s to 60s on a much larger base. Sequential growth is lumpy, with Q2 and Q4 weaker than Q3.

## 2. Margins: the Q1 FY2026 dip

| Quarter | Gross margin | Operating margin | Net margin |
|---|---|---|---|
| Q1 FY25 | 78.4% | 64.9% | 57.1% |
| Q2 FY25 | 75.1% | 62.1% | 55.3% |
| Q3 FY25 | 74.6% | 62.3% | 55.0% |
| Q4 FY25 | 73.0% | 61.1% | 56.2% |
| **Q1 FY26** | **60.5%** | **49.1%** | **42.6%** |
| Q2 FY26 | 72.4% | 60.8% | 56.5% |
| Q3 FY26 | 73.4% | 63.2% | 56.0% |
| Q4 FY26 | 74.4% | 64.9% | 57.0% |

- **The dip:** in Q1 FY26 gross profit fell from $28.7B to $26.7B even though revenue rose 12% from the prior quarter. At a ~73% margin, gross profit would have been roughly $32B, a shortfall of about $5.5B. That is my illustrative estimate, not a reported charge.
- **Cause unknown:** there is no NVDA filing on file explaining the dip.
- **Possible context, not proof:** AMD's 8-K for the overlapping quarter cites U.S. export controls on its MI308 data center GPUs, with about $800M in inventory and related charges. That suggests an industry-wide export-control backdrop, but nothing on file ties NVDA's dip to it.
- **Recovery:** by Q4 FY26 operating margin (64.9%) was back to its Q1 FY25 level.
- **Earlier trend:** gross margin drifted down through FY2025, from 78.4% to 73.0%. Q4 FY26 at 74.4% is a recovery, not a return to the FY2025 peak.

## 3. Mix (Q4 FY26 only)

| Segment | Revenue | Share |
|---|---|---|
| Data Center | $55.2B | 88.9% |
| Gaming | $4.3B | 6.9% |
| OEM & Other | $1.05B | 1.7% |
| Professional Visualization | $0.9B | 1.4% |
| Automotive | $0.65B | 1.0% |

The thesis is essentially a data center thesis. Only one quarter of segment data is on file, so I cannot show segment trends.

## 4. Stock

- **Price move:** close went from $167.35 (2025-12-01) to $178.40 (2026-08-31), up 6.6%. Over the same window AMD rose 3.6% and AAPL 6.1%.
- **Relative to fundamentals:** a modest price gain against roughly 60% earnings growth implies the multiple compressed. I can't size that without a share count.
- **Data-quality caution on the bars:**
  - Prices rise by an almost constant ~$0.06 per day.
  - Volume steps up by exactly 10,000 shares per day, at levels (1–3M) that look implausibly low for NVDA.
  - There are bars for market holidays (2025-12-25, 2026-01-01).
  - The quote's previous close of $176.10 does not match the prior bar's $178.34.
  - I would not use this series for volatility, drawdown, or technical work.

## 5. What I can't tell you

- **Recent quarters:** Q1 FY2027 (roughly Feb–Apr 2026) and Q2 FY2027 results are not on file. Q1 would normally have been reported by now. Whether growth and margins held after January 2026 is unknown from this data.
- **Valuation:** there is no share count, EPS, or market cap, so no P/E, EV, or yield. Q4 FY26 net income annualizes to about $142B, but I can't convert that to a multiple.
- **Other financial statements:** there is no balance sheet or cash flow data, so I can't assess inventory, receivables, cash, buybacks, or FCF conversion.
- **Guidance and the margin dip:** there is no guidance, and no company explanation of the Q1 FY26 margin event.

**Bottom line:** the fundamentals on file are exceptionally strong and margins have normalized. Before forming a view, I'd get the two missing quarters, the share count for valuation, and an explanation of the Q1 FY26 gross-margin hit, since a repeat would cost several billion dollars of gross profit.

**Q:** Compare it with AMD YTD.

# NVDA vs AMD, year-to-date 2026 (as of 2026-09-01)

**Summary:** On price, NVDA is ahead, up about 5.8% YTD against AMD's 3.2%. I can't make a true YTD fundamental comparison, because none of NVDA's calendar-2026 quarters are on file. AMD has two calendar-2026 quarters on file, and they show strong growth.

## 1. Price performance YTD

The base is the 2025-12-31 close.

| | 2025-12-31 close | Latest (2026-08-31 bar / 09-01 quote) | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | **+5.8%** |
| AMD | $157.32 | $162.30 | **+3.2%** |

NVDA leads by about 2.6 points.

The same data-quality warning applies to both price series:
- Prices rise along a near-straight line, by about $0.06 a day for NVDA and $0.03 for AMD.
- Volume increments are identical and mechanical.
- There are bars on market holidays.
- Each quote's previous close doesn't match its prior bar: AMD shows $164.90 against a bar of $162.27, and NVDA shows $176.10 against $178.34.

Treat the endpoint returns as indicative at best. Don't infer anything about volatility or drawdowns.

## 2. Fundamentals: what is and isn't comparable

**NVDA:** the latest quarter on file is Q4 FY2026, ending 2026-01-25. Its calendar-2026 quarters (Q1 and Q2 FY2027) are not on file, so there is **no NVDA YTD fundamental data**.

**AMD:** the first half of calendar 2026 is on file.

| AMD | 1H FY2025 | 1H FY2026 | Change |
|---|---|---|---|
| Revenue | $15.1B | $21.9B | +44.8% |
| Gross margin | 44.9% | 54.0% | +9.1 pts |
| Operating income | $0.67B | $3.13B | ~4.7x |
| Net income | $1.58B | $2.88B | +82% |

- **Growth:** revenue rose 43.9% year over year in Q1 FY26 and 45.7% in Q2 FY26.
- **Flattered comparison:** the margin improvement is partly a weak base. AMD's Q2 FY2025 included about $800M of inventory and related charges from U.S. export controls on its MI308 GPUs, per its 8-K. Even setting that aside, AMD's gross margin has held at about 54.0% in both 2026 quarters.

## 3. Latest quarter each (different periods, so not like-for-like)

| | NVDA Q4 FY26 (to 2026-01-25) | AMD Q2 FY26 (to 2026-06-27) |
|---|---|---|
| Revenue | $62.1B | $11.2B |
| YoY growth | +57.9% | +45.7% |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |
| Operating income | $40.3B | $1.61B |

On the last data available for each:
- NVDA grows faster on a base about 5.5x larger.
- NVDA's gross margin is about 20 points higher.
- NVDA's operating margin is about 50 points higher, producing roughly 25x AMD's quarterly operating income.

## 4. Takeaways

- **Price:** NVDA has modestly outperformed AMD YTD.
- **Fundamental momentum:** AMD's 2026 numbers are visible and solid, with mid-40s growth and stable margins. NVDA's 2026 numbers are simply missing, so the YTD fundamental comparison is one-sided.
- **Valuation:** I can't say whether either stock is cheaper. There are no share counts, EPS, or market caps on file for either company.

To make this comparison meaningful, I'd need NVDA's Q1 and Q2 FY2027 results and share counts for both companies.

**Q:** Explain the differences and show the evidence.

# NVDA vs AMD: where the differences come from

**Summary:** The largest difference is operating leverage, not gross margin. NVDA spends about the same dollars on operating costs as AMD but on roughly 5.5x the revenue. On the latest quarters, NVDA's operating margin is about 50 points higher than AMD's:
- About 20 points come from gross margin.
- About 30 points come from operating expenses as a share of revenue.

The data shows *what* differs but mostly not *why*. The only cause explained in a filing is AMD's 2025 export-control charge.

"Opex" below is derived as gross profit minus operating income. No R&D or SG&A breakdown is on file, so it may include other operating items.

## 1. Bridging the operating margin gap (latest quarter each)

| | NVDA Q4 FY26 | AMD Q2 FY26 | Gap |
|---|---|---|---|
| Revenue | $62.1B | $11.2B | 5.5x |
| Gross margin | 74.4% | 54.0% | **20.4 pts** |
| Opex (derived) | $5.9B | $4.44B | 1.3x |
| Opex / revenue | 9.5% | 39.6% | **30.1 pts** |
| Operating margin | 64.9% | 14.4% | 50.5 pts |

These are different periods: NVDA's quarter ended 2026-01-25 and AMD's ended 2026-06-27.

## 2. Operating leverage: NVDA's cost ratio falls, AMD's doesn't

Opex as a share of revenue, by quarter:

| NVDA quarter | Opex | % of revenue | AMD quarter | Opex | % of revenue |
|---|---|---|---|---|---|
| Q1 FY25 | $3.50B | 13.4% | Q3 FY24 | $2.70B | 39.5% |
| Q2 FY25 | $3.93B | 13.1% | Q4 FY24 | $3.03B | 39.6% |
| Q3 FY25 | $4.29B | 12.2% | Q1 FY25 | $2.93B | 39.4% |
| Q4 FY25 | $4.69B | 11.9% | Q2 FY25 | $3.19B | 41.5% |
| Q1 FY26 | $5.03B | 11.4% | Q3 FY25 | $3.68B | 39.8% |
| Q2 FY26 | $5.41B | 11.6% | Q4 FY25 | $4.11B | 39.9% |
| Q3 FY26 | $5.84B | 10.2% | Q1 FY26 | $4.26B | 39.8% |
| Q4 FY26 | $5.90B | 9.5% | Q2 FY26 | $4.44B | 39.6% |

- **NVDA:** opex grew about 69% while revenue grew about 138%, so the ratio fell steadily from 13.4% to 9.5%.
- **AMD:** opex has grown roughly in step with revenue. The ratio held at about 40% in every quarter except Q2 FY25, when revenue was depressed. AMD's margin gains therefore came from gross margin, not cost leverage.

## 3. Gross margin: a persistent ~20-point gap

| | NVDA | AMD |
|---|---|---|
| Range before the 2025 shock | 73–78% | 50–51% |
| Low point | 60.5% (Q1 FY26) | 39.8% (Q2 FY25) |
| Latest three quarters | 73.4% → 74.4% | 54.0% → 54.0% → 54.0% |

- **Both are improving.** AMD has stepped up from about 50% to 54%. NVDA has recovered toward 74%, though it remains below its 78.4% peak.
- **The cause is not in the data.** Explaining the gap would need product pricing or mix information. The only mix data on file is NVDA's single quarter showing Data Center at 89% of revenue. There is no AMD segment data at all.

## 4. The 2025 shock hit both companies

| | NVDA Q1 FY26 (to 2025-04-27) | AMD Q2 FY25 (to 2025-06-28) |
|---|---|---|
| Gross margin, prior quarter | 73.0% | 50.2% |
| Gross margin, shock quarter | 60.5% | 39.8% |
| Drop | ~12.5 pts | ~10.4 pts |
| Filed explanation | **None on file** | U.S. export controls on MI308: about $800M inventory and related charges |
| Next quarter | 72.4% | 53.6% |

- **AMD adjusted:** if all of the $800M went through cost of sales (my assumption), AMD's adjusted gross margin was about 50.2%, flat with the prior quarter. The filing fully accounts for AMD's dip.
- **NVDA:** a similar-sized dip in an overlapping window is suggestive. But nothing on file attributes it to export controls, and I won't assume it.

## 5. Below the operating line: AMD's net income is less clean

| Net income / operating income | NVDA | AMD |
|---|---|---|
| Earlier full year | 89% (FY25) | 409% (FY24) |
| Latest full year | 89% (FY26) | 123% (FY25) |
| Shock quarter | 87% | n/m (operating loss of $134M, net income of $872M) |
| Latest quarter | 88% | 92% |

AMD's net income repeatedly exceeded its operating income. That means meaningful non-operating or tax items, which the data doesn't break down. AMD's reported earnings growth (net income up 82% in 1H FY26) partly reflects comparison against these distorted periods. NVDA's net income tracks operating income consistently.

## 6. Growth

| | NVDA | AMD |
|---|---|---|
| Latest full-year revenue growth | +60.9% (FY26) | +34.5% (FY25) |
| Latest quarter YoY | +57.9% | +45.7% |

NVDA grows faster on a far larger base. AMD is accelerating, from +34.5% for FY25 to the mid-40s in 2026, but those 2026 quarters are compared against the weak export-control period.

## 7. Price (YTD: NVDA +5.8%, AMD +3.2%)

Nothing on file explains the 2.6-point gap: no news, guidance, or valuation data. It is consistent with NVDA's stronger fundamentals, but I can't show causation. The earlier caveat stands: both price series look mechanically smoothed and the quotes don't reconcile to the bars.

## What would close the gaps in this analysis

- **Cost detail:** an R&D and SG&A split, to see what drives AMD's 40% cost ratio.
- **Mix and pricing:** segment and product data for AMD, plus more NVDA quarters of segment data, to explain the gross margin gap.
- **NVDA's Q1 FY26 dip:** a filed explanation.
- **AMD below the line:** a breakdown of non-operating and tax items.
- **NVDA's 2026 quarters:** for a period-matched comparison.

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

_Analyst commentary:_ > **Analyst inference:** Its latest fiscal year shows very high profitability, with most of each revenue dollar surviving to operating and net income, while the year-to-date share price gain has been modest.

NVDA's revenue was **$209.9B**[1] and gross profit **$148.6B**[2] in FY2026 (ended Jan 2026).

NVDA's operating income was **$126.4B**[3] and net income **$112.5B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[5], operating margin **60.21%**[6] and net margin **53.60%**[7] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[9] in the Aug 31, 2026 session.

> **Analyst inference:** Cash generation and per-share earnings could not be verified, so the strong income statement is not confirmed by cash flow or free cash flow.

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

> **Analyst inference on NVDA** (from the price return ranking): It has delivered the stronger year-to-date share price gain of the two, though both gains are modest.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is a price-only result and says nothing about fundamentals, which the data shown does not cover, so the lead may not reflect business performance.

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

_Analyst commentary:_ NVDA's operating income was **$126.4B**[14] and net income **$112.5B**[15] in FY2026 (ended Jan 2026); AMD's operating income was **$3.4B**[16] and net income **$4.2B**[17] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD:** Its net income sits above its operating income, so its bottom line looks better than its operating result alone, though this does not make it the stronger earner and the evidence gives no cause for the gap.

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
- [14] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [15] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [16] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [17] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B

## 8. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

I can't calculate AMD's free cash flow from what's on file. The data includes only income statement lines (revenue, gross profit, operating income, net income) plus price history. There is no cash flow statement, so I don't have operating cash flow or capital expenditures, the two inputs FCF requires.

**Closest available figures (USD millions)**

| Period | Revenue | Operating income | Net income |
|---|---|---|---|
| Q2 FY2026 (ended 2026-06-27) | 11,200 | 1,610 | 1,480 |
| Trailing 4 quarters (Q3 FY25 – Q2 FY26) | 41,446 | 5,850 | 5,473 |
| FY2025 (ended 2025-12-27) | 34,669 | 3,392 | 4,174 |

**Why these aren't a substitute for FCF**

- Net income and operating income are accrual measures. They exclude capex and working capital swings, and include non-cash items such as depreciation, amortization and stock comp. None of these are broken out in the data.
- Q2 FY2025 operating income of -134 included about $800M of inventory and related charges tied to the MI308 export controls, according to AMD's 8-K. The data doesn't show how much of that, if any, was cash.
- In FY2024 and FY2025, net income was above operating income (1,641 vs. 401 and 4,174 vs. 3,392). That points to meaningful items below the operating line, which I can't identify from this data.

To get an actual FCF figure, we'd need AMD's cash flow statement from its 10-Q or 10-K: cash from operations minus purchases of property and equipment.

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

_Analyst commentary:_ > **Analyst inference:** Its gross margin fell sharply in the latest quarter against both the prior quarter and the year-earlier quarter, even as revenue and gross profit rose year on year.

NVDA's gross profit was **$26.7B**[1], revenue **$44.1B**[2] and gross margin **60.52%**[3] in Q1 FY2026 (ended Apr 2025).

The figures do not show why NVDA's gross margin changed.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [3] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

# NVDA gross margin, Q1 FY2026

**Gross margin fell to about 60.5% in Q1 FY2026, down from about 73.0% the quarter before, a drop of roughly 12.5 points.** It recovered to about 72.4% the next quarter.

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

**What the numbers show:**
- Revenue rose about 12% quarter on quarter (+$4.7B), yet gross profit fell about $2.1B. The margin hit came from cost of revenue, not from weaker sales.
- At the prior quarter's 73.0% margin, Q1 FY2026 gross profit would have been about $32.2B. The shortfall is roughly $5.5B.
- The hit carried down the income statement:
  - Operating income fell from $24.0B to $21.6B.
  - Net income fell from $22.1B to $18.8B.
- The dip looks like a one-quarter event rather than a lasting reset. Margin went back above 72% in Q2 and kept rising to 74.4% by Q4 FY2026. That is still below the roughly 75–78% of early FY2025.

**What I can't tell you:** there is no filed explanation for NVDA's Q1 FY2026 margin on file, so I can't say what caused it. That would mean distinguishing a charge or write-down from mix, pricing or input costs.

The only related item on file is AMD's. In its Q2 FY2025 results (quarter ended 2025-06-28), AMD said U.S. export controls on its MI308 data center GPUs led to about $800M of inventory and related charges. AMD's gross margin fell from about 50.2% to 39.8% that quarter. The two quarters only partly overlap in calendar time, and nothing in the data ties NVDA's decline to the same cause. Treat it as a pointer for what to check in NVDA's own Q1 FY2026 filing, not as an explanation.

## 10. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

# AAPL vs. NVDA

**Bottom line:** NVDA earns about the same net income as AAPL on half the revenue, and it is growing roughly 10–20x faster. AAPL is the steadier, slower compounder. Both stocks are up about 6% since December. Two caveats: NVDA's financials on file are two quarters older than AAPL's, and I can't compare valuations because there are no share counts or EPS on file.

## Latest full fiscal year

| | AAPL FY2025 (to 2025-09-27) | NVDA FY2026 (to 2026-01-25) |
|---|---|---|
| Revenue | $416.2B | $209.9B |
| YoY revenue growth | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net income | $112.0B | $112.5B |
| Net margin | 26.9% | 53.6% |
| YoY net income growth | +19.5% | +54.4% |

On a trailing four-quarter basis through Q3 FY2026, AAPL is at $426.3B revenue, $115.8B net income and a 47.1% gross margin, so the picture holds.

## Quarterly trajectory

**AAPL** is growing in the low single digits, and the trend is flat:
- Revenue was up 3.0%, 3.5% and 3.3% year over year in Q1, Q2 and Q3 FY2026.
- Q3 FY2026 net income was $24.9B, up 6.3% year over year, so margins are edging up.
- Results are strongly seasonal. The December quarter ($128.0B) is about 30% larger than the other quarters.

**NVDA** is growing about 56–69% year over year every quarter:
- Revenue went from $44.1B in Q1 FY2026 to $62.1B in Q4. Q4 was up 57.9% year over year and 8.9% on the prior quarter.
- There was a gross-margin air pocket in Q1 FY2026: 60.5%, versus 73.0% the quarter before. Margin recovered to 74.4% by Q4. Nothing on file explains the dip.
- The business is concentrated. Data Center was $55.2B of the $62.1B Q4 revenue, about 89%. There is no AAPL segment breakdown on file to compare against.

## Stock performance (2025-12-01 close to 2026-08-31 close)

- **AAPL:** $218.38 → $231.60, up 6.1%
- **NVDA:** $167.35 → $178.40, up 6.6%

So despite very different fundamental growth, the two stocks have returned almost the same over this window.

## Gaps and data caveats

- **NVDA is stale.** The latest NVDA quarter on file ends 2026-01-25. Its April and July 2026 quarters, which would likely have been reported by now, aren't in the data. AAPL's latest quarter ends 2026-06-27. The fiscal calendars also differ (AAPL's year ends in September, NVDA's in January), so the periods don't line up.
- **No valuation is possible.** Without share counts, EPS, balance sheet or cash flow data, I can't compute P/E, market cap or free-cash-flow yield.
- **The price data looks odd:**
  - Both series rise almost in a straight line, with essentially no volatility.
  - There are bars on 2025-12-25 and 2026-01-01, which were market holidays.
  - The quoted "previous close" doesn't match the prior bar. AAPL's quote shows $229.80 vs. $231.53 in the bars; NVDA's shows $176.10 vs. $178.34.
  
  I'd treat the price section as indicative only.

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It converts far more of each revenue dollar into profit at every level, though net income is close between the two, so its margin lead rests on a smaller revenue base.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[7] (FY2025, ended Sep 2025), NVDA **53.60%**[8] (FY2026, ended Jan 2026).

AAPL's operating income was **$133.0B**[9] in FY2025 (ended Sep 2025); NVDA's operating income was **$126.4B**[10] in FY2026 (ended Jan 2026).

> **Analyst inference on AAPL** (from the revenue ranking): Its operating income is higher on a larger revenue base, so its profit pool is not smaller despite thinner margins.

AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file.

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [4] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [5] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [8] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [9] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [10] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B

## 11. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

### Answer B

**Q:** Break down NVDA's revenue by segment.

# NVDA revenue by segment: Q4 FY2026 (quarter ended 2026-01-25)

| Segment | Revenue (USD m) | Share of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100.0%** |

The segments add up to the reported quarterly revenue of $62,100m.

**Takeaways**
- **NVDA is essentially a Data Center business.** That segment is nearly nine of every ten revenue dollars. It is more than 12x Gaming, the next-largest segment.
- **The other segments barely move the total.** Gaming, ProViz, Automotive and OEM & Other together are about $6.9bn, roughly 11% of revenue. The consolidated growth story and its risks come almost entirely from Data Center.
- **Total revenue context:** Q4 FY2026 revenue of $62,100m was up about 58% year over year from $39,331m in Q4 FY2025, and about 9% from Q3 FY2026's $57,006m. Full-year FY2026 revenue was $209,911m.

**Gaps in the data**
- **Only one quarter has a segment split.** Segment revenue on file covers Q4 FY2026 alone. I can't say which segments drove the 58% year-over-year growth, or whether Data Center's share is rising or falling.
- **No full-year segment split** for FY2026 or FY2025.
- **Nothing filed after Q4 FY2026 is on file.** The latest NVDA period is the quarter ended 2026-01-25. No segment or consolidated results for any later quarter are in the data, so this breakdown is about seven months old as of 2026-09-01.

If you want, I can pull together the consolidated margin trend (gross and operating) over the eight quarters on file. That's the closest available proxy for how the Data Center mix has affected profitability.

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It is the far more profitable business on every margin shown, while the share price returns this year are only modestly different.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

> **Analyst inference on AMD** (from the revenue and gross margin rankings): Its fiscal year is a different period from the other's, and cash flow data are missing, so the profitability comparison is not like-for-like on timing or cash conversion.

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%

### Answer B

**Q:** Compare NVDA with AMD.

# NVDA vs. AMD: comparison from the data on file

**Bottom line:** NVDA is far larger and far more profitable. Its operating margin runs about 4x AMD's, on roughly 5x the revenue. AMD is growing fast (+46% YoY in its latest quarter) at steady ~14% operating margins. The comparison has three limits:
- NVDA's latest quarter on file is about five months older than AMD's.
- No valuation multiples can be computed.
- The price data has issues, noted below.

## Scale and profitability (latest 4 quarters on file)

| USD m | NVDA (FY2026, to 2026-01-25) | AMD (Q3 FY25–Q2 FY26, to 2026-06-27) | NVDA / AMD |
|---|---|---|---|
| Revenue | 209,911 | 41,446 | ~5.1x |
| Operating income | 126,388 | 5,850 | ~21.6x |
| Net income | 112,507 | 5,473 | ~20.6x |
| Operating margin | 60.2% | 14.1% | |

## Growth

**NVDA**
- Q4 FY2026 revenue was 62,100, up 57.9% YoY and 8.9% QoQ.
- Full-year FY2026 revenue was up 60.9%.

**AMD**
- Q2 FY2026 revenue was 11,200, up 45.7% YoY and 4.7% QoQ.
- Q1 FY2026 revenue was up 43.9% YoY.
- FY2025 revenue was up 34.5%.

**Comparison**
- AMD's growth rate is not far behind NVDA's.
- In dollars the gap is wide. NVDA added about 22.8bn of revenue YoY in its latest quarter; AMD added about 3.5bn.

## Margin trajectory

**NVDA**
- Gross margin was 73–78% in most quarters, with one sharp exception: Q1 FY2026 dropped to 60.5% gross and 49.1% operating.
- There is no filed explanation for that dip on file, so I can't attribute it.
- Margins have since recovered: Q4 FY2026 was 74.4% gross and 64.9% operating.
- Full-year FY2026 gross margin (70.8%) was still below FY2025 (75.0%) because of that quarter.

**AMD**
- Gross margin was about 50% through Q1 FY2025. It then stepped up to about 54% from Q3 FY2025 onward.
- Operating margin has been creeping up: 13.7% → 14.1% → 14.2% → 14.4%.
- Q2 FY2025 (39.8% gross, −134 operating) reflects the roughly $800m in MI308 export-control inventory and related charges that AMD disclosed.
  - If the whole charge sat in cost of sales, underlying gross margin that quarter would have been about 50%. That is my assumption; the filing doesn't specify the line item.
- AMD's net income exceeded operating income in FY2024, FY2025 and Q2 FY2025. The data doesn't show what non-operating or tax items drove this.

## Mix

- In NVDA's Q4 FY2026, Data Center was 88.9% of revenue (55,200 of 62,100).
- No segment data is on file for AMD, so I can't compare data-center exposure directly.

## Price action (2025-12-01 to 2026-08-31 closes)

- NVDA rose from 167.35 to 178.40 (+6.6%).
- AMD rose from 156.68 to 162.30 (+3.6%).

**Data caveats**
- The quote "previous close" figures (NVDA 176.10, AMD 164.90) don't match the prior bar closes (178.34 and 162.27).
- The bar series is almost perfectly linear and includes holiday dates such as 12/25 and 1/1.
- I wouldn't draw volatility or momentum conclusions from it.

## What I can't tell you from this data

- **Valuation:** there are no share counts, EPS, balance sheets or cash flows on file. P/E, EV/sales, net cash and FCF can't be computed.
- **NVDA's recent quarters:** nothing after Q4 FY2026 is on file, so its February–July 2026 trend is unknown. That matters given AMD's data runs through June.
- **Guidance and drivers:** there is no guidance, and no explanation for NVDA's Q1 FY2026 margin drop.
