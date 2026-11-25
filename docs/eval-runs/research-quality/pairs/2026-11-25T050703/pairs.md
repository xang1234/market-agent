# Blinded answer pairs: 2026-11-25T050703

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

**Bottom line:** NVDA has the highest margins and the fastest growth. AAPL is the largest by revenue but grows slowest. AMD sits in between on growth, with thin operating margins that are improving.

**Fiscal-year figures (each company's own fiscal year)**

| | NVDA FY2026 | AMD FY2025 | AAPL FY2025 |
|---|---|---|---|
| Revenue ($M) | 209,911 | 34,669 | 416,161 |
| Revenue growth vs. prior FY | +60.9% | +34.5% | +6.4% |
| Gross margin | 70.8% | 49.9% | 46.9% |
| Operating margin | 60.2% | 9.8% | 32.0% |
| Net margin | 53.6% | 12.0% | 26.9% |

**Latest reported quarter in the file**

| | NVDA Q4 FY2026 | AMD Q2 FY2026 | AAPL Q3 FY2026 |
|---|---|---|---|
| Revenue ($M) | 62,100 | 11,200 | 97,100 |
| YoY revenue growth | +57.9% | +45.8% | +3.3% |
| Gross margin | 74.4% | 54.0% | 47.1% |
| Operating margin | 64.9% | 14.4% | 30.7% |
| Net margin | 57.0% | 13.2% | 25.6% |

**Observations**

- **NVDA** has the highest margins in the group and is still growing very fast. Its gross margin was 60.5% in Q1 FY2026 and rose to 74.4% by Q4. The file does not explain the Q1 dip, so I can't say why it happened.
- **AMD** has improved sharply. Operating margin went from 1.6% in FY2024 to 9.8% in FY2025, and it was 14.4% in Q2 FY2026. Its Q2 FY2025 gross margin was 39.8%, depressed by the MI308 export-control charge of about $800M that AMD disclosed. Excluding that charge, that quarter's gross margin would have been roughly 50%, so the year-over-year comparison flatters the current quarter.
- **AAPL** has the largest revenue base and the most stable margins. Gross margin stayed between about 46% and 47% across the years and quarters shown. Growth has slowed to about 3% in the latest quarter.

**Data gaps**

- The fiscal years don't line up. NVDA's fiscal year ends in late January, while AMD's and AAPL's end in late December and late September. Each company is compared on its own latest periods.
- The file has no segment detail for AMD or AAPL, so I can't break their revenue down by product line.
- The file has no guidance, consensus estimates, or peer-valuation data, so this comparison doesn't say anything about valuation.

### Answer B

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

## 2. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

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

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

AMD's operating margin turned negative in Q2 2025 mainly because of U.S. export restrictions on its Instinct MI308 data center GPU. In its Q2 FY2025 earnings release (8-K, published 2025-08-05), AMD said these restrictions led to about **$800 million in inventory and related charges** for the quarter.

The numbers on file are consistent with that:

- **Q2 FY2025 operating income:** -$134M on revenue of $7,685M, an operating margin of about -1.7%.
- **Q1 FY2025 operating income:** $806M on revenue of $7,438M, about 10.8%.
- **Gross margin:** about 39.8% in Q2 (gross profit $3,059M), down from about 50.2% in Q1 and about 53.6% in Q3 FY2025.

The $800M charge is larger than the swing in operating income, which is about $940M from Q1 to Q2. Revenue was roughly flat, so the charge accounts for most of the decline. Adding the $800M back to Q2 operating income gives roughly $666M, about 8.7% of revenue. That is my arithmetic, not a figure AMD reported, and it assumes the charge is the only significant driver.

The data on file doesn't say which income statement line the charge was booked to. The gross margin drop suggests it was at least partly in cost of sales, but I can't confirm that from these sources. The file also has no operating expense breakdown, so I can't rule out other contributors.

## 3. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

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

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

**Short answer:** NVDA is far more profitable and growing much faster, while AAPL is larger and steadier. The file has no valuation data, so I can't say which is cheaper.

**Fundamentals (USD millions, as filed)**

| Metric | AAPL (FY2025, ended 2025-09-27) | NVDA (FY2026, ended 2026-01-25) |
|---|---|---|
| Revenue | 416,161 | 209,911 |
| Revenue growth vs prior FY | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net margin | 26.9% | 53.6% |
| Net income growth vs prior FY | +19.5% | +54.4% |

**Latest filed quarter**

| Metric | AAPL Q3 FY2026 (ended 2026-06-27) | NVDA Q4 FY2026 (ended 2026-01-25) |
|---|---|---|
| Revenue, y/y | 97,100, +3.3% | 62,100, +57.9% |
| Operating income, y/y | 29,800, +5.7% | 40,300, +67.7% |
| Operating margin | 30.7% | 64.9% |

- NVDA's revenue mix in Q4 FY2026 was about 89% Data Center (55,200). Gaming was about 7% (4,300). The other segments were small. The file has no segment breakdown for AAPL.

**Price action (daily bars, 2025-12-01 to 2026-08-31)**
- NVDA closed at 167.35 on the first bar and 178.40 on the last, about +6.6%.
- AAPL closed at 218.38 and 231.60, about +6.1%.
- Both drifted higher with small daily ranges and steadily rising volume. Neither shows a large single-day move in this window.

**Gaps and data issues to be aware of**
- **No valuation data.** The file has no market cap, share count, P/E, EV/EBITDA, or dividends, so I can't compare what each stock costs.
- **No balance sheet, cash flow, or guidance** for either company.
- **Timing mismatch.** NVDA's latest quarter on file ends 2026-01-25, about seven months before AAPL's latest quarter (ending 2026-06-27). Any NVDA quarters after January 2026 are missing, so the NVDA comparison is roughly seven months staler than the AAPL one.
- **Quote vs. bars don't reconcile.** The quote's previous close is 176.10 for NVDA and 229.80 for AAPL. The bar series closes on 2026-08-28 are 178.34 and 231.53. The stated day change (+1.3% NVDA, +0.7% AAPL) therefore doesn't match the bars. I'd verify the quote before using the day move.
- **AAPL FY2026 isn't filed yet.** Its three reported quarters show revenue of 128,000, 98,700, and 97,100 for FY2026 to date.

## 4. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

## NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Bottom line:** Q4 FY2026 was a strong quarter. Revenue reached $62.1B, up 57.9% year over year and 8.9% sequentially. Operating income grew faster than revenue, so margins expanded. Data Center made up 89% of revenue. The file doesn't include guidance, cash flow, or balance-sheet data, so this view covers the income statement and the share price only.

### Income statement (USD millions)

| Metric | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross profit | 46,200 | 41,849 | 28,723 | +10.4% | +60.9% |
| Operating income | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income | 35,400 | 31,910 | 22,091 | +10.9% | +60.3% |
| Gross margin | 74.4% | 73.4% | 73.0% | +1.0pp | +1.4pp |
| Operating margin | 64.9% | 63.2% | 61.1% | +1.7pp | +3.8pp |
| Net margin | 57.0% | 56.0% | 56.2% | +1.0pp | +0.8pp |

- **Operating leverage:** Sequentially, revenue rose $5.1B and operating income rose $4.3B, an incremental operating margin of about 84%. Costs grew much more slowly than sales.
- **Net margin:** Net income grew more slowly than operating income quarter over quarter, so below-the-line items or taxes absorbed more of the gain. The file doesn't break this down.
- **Share of the year:** Q4 was 29.6% of FY2026 revenue ($209.9B). The four quarters sum to the reported annual totals, so the quarterly data is internally consistent.

### Segment mix (Q4 FY26, USD millions)

| Segment | Revenue | Share of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

The segments sum to $62,100M, which ties to reported revenue. Data Center is the main driver. The file has no prior-year or prior-quarter segment figures, so I can't say which segments grew or shrank.

### Share price

- The stock closed at $169.62 on 2026-01-23, the last session before... more precisely, on 2026-01-26 (the session after quarter end). Since then it has risen steadily to $178.40 on 2026-08-31, about +5.2%.
- The daily bars show no visible jump around the Q4 report, so the market reaction can't be read cleanly from this data.
- The price is up about 6.6% from $167.35 on 2025-12-01, and the daily moves are small and steady throughout the file.
- **Data inconsistency:** The quote block lists a previous close of $176.10, but the daily bars show $178.34 on 2026-08-28. I'd check the feed before relying on the day-over-day figure.

### What the file doesn't cover

- Guidance or forward estimates
- Valuation (no share count or market cap, so no P/E or EV multiples)
- Cash flow, balance sheet, R&D and SG&A expense, or tax rate
- Segment comparisons over time
- Management commentary on the quarter

If you want a valuation view or a read on the forward outlook, I'd need those inputs added to the file.

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

## 5. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

NVDA's Q4 FY2026 revenue (2025-10-27 to 2026-01-25) was $62,100M, and the five segments sum to that total.

| Segment | Revenue ($M) | % of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

Data Center is almost nine-tenths of the quarter's revenue. Gaming is a distant second, and the other three segments together are about 4%.

The file has segment data for Q4 FY2026 only. It has no segment figures for other quarters or for FY2025 or FY2026 as a whole, so I can't show how the mix has shifted over time.

### Answer B

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

## 6. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

The data on file doesn't include AMD's free cash flow. It has no cash flow statement, so there's no operating cash flow or capital expenditure figure to calculate it from.

The file has AMD's income statement items (revenue, gross profit, operating income, net income) for quarterly and annual periods through Q2 FY2026, plus daily price bars and one filed explanation of a roughly $800 million export-control inventory charge in Q2 FY2025. Net income is not a substitute for free cash flow, so I haven't used it as one.

To answer this, we'd need AMD's cash flow statements from the 10-Qs and 10-Ks, specifically net cash from operating activities and purchases of property and equipment. Free cash flow is operating cash flow minus capex.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

## 7. missing-segments (missing data)

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

The data on file doesn't include AMD's revenue by segment. AMD's filings here give only consolidated figures: total revenue, gross profit, operating income, and net income, quarterly and annually. Segment data would have to come from AMD's 10-K or 10-Q filings, which aren't in this file.

What the file does show for total revenue:

- **FY2024:** $25,785M
- **FY2025:** $34,669M (up about 34% year over year)
- **Latest quarter (Q2 FY2026, ended 2026-06-27):** $11,200M, up from $10,700M in Q1 FY2026 and $7,685M in Q2 FY2025.

The one filed explanation concerns Q2 FY2025. AMD said U.S. export controls on its Instinct MI308 data center GPU led to about $800M in inventory and related charges that quarter. That explains a specific charge, but it isn't a segment revenue figure, and the filing doesn't say how much revenue the restriction removed.

If you need the segment split, I can work from AMD's 10-Q or 10-K for the relevant periods if you send them over.

## 8. fiscal-year-trap (trap: mismatched fiscal years)

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

**AAPL's fiscal 2025 revenue was about 3.2x NVDA's.**

| Company | Fiscal 2025 period | Revenue (USD millions) |
|---|---|---|
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |

- **Gap:** about $285.7 billion in AAPL's favor.
- **Ratio:** 416,161 / 130,497 ≈ 3.19x.

The two fiscal years don't cover the same months. NVDA's FY2025 ended in January 2025, about eight months before AAPL's FY2025 ended in September 2025. The comparison is therefore between each company's most recent completed fiscal year as of that period, not between the same calendar window. For NVDA's later year, FY2026 (ended 2026-01-25), revenue was 209,911 million, which is still well below AAPL's FY2025 figure.

## 9. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

AMD's operating margin has been roughly flat-to-up over the last eight quarters, with one sharp dip in Q2 FY2025.

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

- **Q3 FY2024 to Q1 FY2025:** Margins held around 10.6–11.4%.
- **Q2 FY2025:** Margin turned negative at -1.7%. AMD's filing for that quarter attributes about $800 million of inventory and related charges to U.S. export controls on its MI308 data center GPU. The filing does not say explicitly that all of this ran through operating income. If it did, the quarter's margin would have been roughly 8.7% before the charge (about $666M ÷ $7,685M), which would be in line with the surrounding quarters. Gross margin also fell that quarter to about 39.8% (3,059 ÷ 7,685), versus about 45% in the quarters on either side.
- **Q3 FY2025 onward:** Margin stepped up to 13.7% and then edged higher to 14.4% by Q2 FY2026. The gain is gradual, not a single jump, and it came alongside revenue growth from $9.2B to $11.2B per quarter.

The data on file does not explain the drivers of the Q3 FY2025 step-up in margin, so I can't attribute it beyond the revenue growth shown above.

### Answer B

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

## 10. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

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

### Answer B

**Q:** Analyze NVDA.

# NVDA: Analysis as of 2026-09-01

**Bottom line:** Through the last reported quarter (Q4 FY2026, ended 2026-01-25), NVIDIA's fundamentals were strong. Revenue grew about 61% for the year, and margins expanded through the year except for a dip in Q1. The stock has drifted steadily higher, up about 6.6% since December 2025. The file cannot support a valuation call, and it has no filings newer than Q4 FY2026, so I can't tell whether the trend has continued.

## Growth

| Quarter | Revenue ($M) | YoY growth | Gross margin | Operating margin | Net income ($M) |
|---|---|---|---|---|---|
| Q1 FY26 | 44,062 | +69.2% | 60.5% | 49.1% | 18,775 |
| Q2 FY26 | 46,743 | +55.6% | 72.4% | 60.8% | 26,422 |
| Q3 FY26 | 57,006 | +62.5% | 73.4% | 63.2% | 31,910 |
| Q4 FY26 | 62,100 | +57.9% | 74.4% | 64.9% | 35,400 |

- **FY2026 vs FY2025:** Revenue rose from $130.5B to $209.9B (+60.9%). Net income rose from $72.9B to $112.5B (+54.4%).
- **Sequential momentum slowed in Q4:** Revenue grew 8.9% quarter over quarter, after 21.9% in Q3. Net income grew 10.9% in Q4.
- **Earnings quality looks clean:** Net income is about 88% of operating income in Q4. The quarterly figures sum exactly to the reported annual totals.

## Margins

- Gross margin rose from 60.5% in Q1 FY26 to 74.4% in Q4, and operating margin rose from 49.1% to 64.9%.
- Q1 FY26 is an outlier. Gross margin fell from 73.0% in Q4 FY25 to 60.5%, then recovered within two quarters. The file doesn't say why, so I can't attribute the dip.

## Segment mix (Q4 FY26)

| Segment | Revenue ($M) | Share |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

Data Center is nearly 90% of revenue, so the company's results depend heavily on that one segment. The file has segment data for Q4 FY26 only, so I can't show how the mix has shifted over time.

## Stock price

- **Path:** The close rose from $167.35 (2025-12-01) to $178.40 (2026-08-31), a gain of 6.6%. Over the last two months, it moved from $175.96 (2026-07-01) to $178.40, up 1.4%.
- **Behavior:** The move is very smooth. Closes typically change by only a few cents per session, and daily ranges are narrow. This is a slow grind higher, not a volatile trade.
- **Quote discrepancy:** The quote block lists a previous close of $176.10, but the daily bars show the 2026-08-28 close as $178.34. The last bar is 2026-08-31, not 2026-09-01. I used the bars.

## What the file can't support

- **Valuation:** There is no share count, market cap, EPS, or enterprise value, so I can't compute P/E, EV/sales, or any other multiple.
- **Recent results:** The latest filed quarter is Q4 FY2026. Results for the quarters after it are not in the file, so I can't say whether the Q4 deceleration has continued.
- **Forward view:** There is no guidance, consensus estimate, or management commentary.
- **Balance sheet and cash flow:** The file has no balance sheet, cash flow statement, or capital return data, so I can't assess liquidity, free cash flow, or buybacks.
- **Filed explanations:** The only filed explanation in the file is AMD's, which doesn't apply to NVDA.

## Suggested next steps

Pull the subsequent 10-Q filings and current consensus to check whether the Q4 slowdown continued. Add the share count and balance sheet so you can compute valuation multiples. Then decide whether a stock that has risen steadily with slowing sequential growth is priced for that deceleration.

**Q:** Compare it with AMD YTD.

# NVDA vs. AMD: Year-to-Date Comparison

**Bottom line:** NVDA has gained more than AMD year to date, and its margins are far higher. AMD's most recent filing is more current, though, so the two companies aren't being compared on the same reporting period.

## Stock performance (2026 YTD)

Returns are measured from the 2025-12-31 close to the 2026-08-31 close, the last bar in the file.

| | 2025-12-31 close | 2026-08-31 close | YTD return |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | **+5.8%** |
| AMD | $157.32 | $162.30 | **+3.2%** |

Using the 2026-01-02 close as the base instead gives +5.7% for NVDA and +3.1% for AMD, so the ranking doesn't change. Both paths are similarly smooth, with steady small gains and no sharp swings. Neither is more volatile than the other in the bars.

## Fundamentals

| | NVDA (latest: Q4 FY26, ended 2026-01-25) | AMD (latest: Q2 FY26, ended 2026-06-27) |
|---|---|---|
| Latest quarter revenue | $62.1B | $11.2B |
| YoY revenue growth, latest quarter | +57.9% | +45.7% |
| Sequential revenue growth, latest quarter | +8.9% | +4.7% |
| Gross margin, latest quarter | 74.4% | 54.0% |
| Operating margin, latest quarter | 64.9% | 14.4% |
| Net margin, latest quarter | 57.0% | 13.2% |
| Latest full fiscal year revenue | $209.9B (FY26) | $34.7B (FY25) |
| Latest full fiscal year revenue growth | +60.9% | +34.5% |

**Key takeaways:**

- **Margins:** NVDA earns about 65 cents of operating profit per revenue dollar against AMD's roughly 14 cents. That is the widest difference in the data.
- **Scale:** NVDA's latest quarter was about 5.5 times AMD's latest quarter.
- **Growth:** NVDA's full-year growth was higher, and its latest-quarter growth was also higher. AMD's growth rate has been stable at about 44–46% year over year across its last two quarters, and its sequential growth slowed to +4.7% in Q2 FY26.
- **Base effect:** AMD's Q2 FY26 comparison is flattered by a weak prior-year quarter. AMD's Q2 FY25 filing says that quarter included "approximately $800 million in inventory and related charges" tied to U.S. export controls on its MI308 products. Q2 FY25 operating income was -$134M, so the +45.7% YoY growth figure partly reflects that low base.

## Timing mismatch

AMD's file runs through Q2 FY26 (ended June 2026). NVDA's file ends at Q4 FY26 (ended January 2026), so NVDA's two most recent quarters are missing. The fundamental comparison therefore covers different periods, and NVDA's more recent trend is unknown from this file.

## What the file can't support

- **Relative valuation:** There are no share counts, market caps, or EPS figures for either company, so I can't compare P/E or any other multiple.
- **Forward expectations:** There is no guidance or consensus for either company.
- **Balance sheet and cash flow:** These are missing for both companies.

## Data notes

- AMD's quote block shows a previous close of $164.90, but the bars show $162.27 for 2026-08-28. This matches the NVDA discrepancy I flagged earlier. I used the bars.

## Summary for the PM

NVDA has outperformed AMD year to date, +5.8% versus +3.2%. Its fundamentals are much stronger: far higher margins and roughly five times the revenue. AMD's growth rate is steady and its reporting is more current. The file cannot tell you whether NVDA's price already reflects its margin advantage, because it has no valuation data for either company.

**Q:** Explain the differences and show the evidence.

# NVDA vs. AMD: The Differences and the Evidence

The main differences are scale and profitability. Stock performance is a smaller difference. Each point below cites the figures in the file.

## 1. Scale

| Metric | NVDA | AMD | Ratio |
|---|---|---|---|
| Latest quarter revenue | $62,100M (Q4 FY26) | $11,200M (Q2 FY26) | 5.5x |
| Latest quarter net income | $35,400M | $1,480M | 23.9x |
| Latest full fiscal year revenue | $209,911M (FY26) | $34,669M (FY25) | 6.1x |

The full-year comparison uses different fiscal years, so it is approximate. The quarterly ratios are the cleaner comparison, though the quarters end at different times.

## 2. Profitability

| Latest quarter | NVDA | AMD |
|---|---|---|
| Gross profit / revenue | 46,200 / 62,100 = **74.4%** | 6,050 / 11,200 = **54.0%** |
| Operating income / revenue | 40,300 / 62,100 = **64.9%** | 1,610 / 11,200 = **14.4%** |
| Net income / revenue | 35,400 / 62,100 = **57.0%** | 1,480 / 11,200 = **13.2%** |

The gap is consistent across the whole data set. NVDA's gross margin was above 72% in every quarter from Q2 FY26 onward. AMD's gross margin was between 50% and 54% in every quarter except Q2 FY25, which was 39.8%.

The file does not explain the cause of the margin gap. It has no cost breakdown, product mix data for AMD, or management commentary.

## 3. Growth

| | NVDA YoY revenue growth | AMD YoY revenue growth |
|---|---|---|
| Q1 | +69.2% (Q1 FY26) | +43.9% (Q1 FY26) |
| Q2 | +55.6% (Q2 FY26) | +45.7% (Q2 FY26) |
| Q3 | +62.5% (Q3 FY26) | +35.6% (Q3 FY25) |
| Q4 | +57.9% (Q4 FY26) | +34.5% (Q4 FY25) |
| Full year | +60.9% (FY26) | +34.5% (FY25) |

NVDA's growth has been higher in every quarter where both companies have data. AMD's growth also accelerated: from about 35% in late FY25 to about 45% in the two most recent quarters.

**Correction to my previous answer:** I said AMD's Q2 FY26 growth was flattered by a weak prior-year quarter. The filing supports a narrower claim. It says the Q2 FY25 results were hit by "approximately $800 million in inventory and related charges" tied to export controls. The file shows that hit in gross margin, not revenue. Q2 FY25 gross margin was 39.8%, compared with 50.2% in Q1 FY25 and 53.6% in Q3 FY25. Q2 FY25 revenue of $7,685M is in line with its neighbors, so the +45.7% revenue growth is not clearly inflated. The base effect is real for margin and operating income comparisons, not for revenue growth.

## 4. Stock performance

| | 2025-12-31 close | 2026-08-31 close | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | +5.8% |
| AMD | $157.32 | $162.30 | +3.2% |

NVDA outperformed AMD by about 2.6 percentage points. The stock gap is much smaller than the profitability gap. NVDA's margins are roughly four to five times AMD's, but its stock is up only about 1.8 times AMD's rate of gain. The file has no valuation data, so I can't say whether the market is already pricing in that difference.

## 5. Timing

| | NVDA | AMD |
|---|---|---|
| Latest quarter in file | Q4 FY26, ended 2026-01-25 | Q2 FY26, ended 2026-06-27 |

AMD's file is about five months more current. This affects the comparisons in sections 1 to 3, since the quarters don't line up.

## What the evidence doesn't show

- **Why** NVDA's margins are higher or its growth faster.
- **Valuation:** there are no share counts, market caps, or EPS figures for either company.
- **Segment mix:** NVDA's segment data covers Q4 FY26 only, and AMD's segment data is absent, so no segment comparison is possible.
- **Forward expectations:** there is no guidance or consensus for either company.

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

NVIDIA's gross margin fell sharply in Q1 FY2026 (quarter ended 2025-04-27), even as revenue grew.

- **Q4 FY2025:** gross profit $28,723M on revenue $39,331M, a gross margin of about **73.0%**
- **Q1 FY2026:** gross profit $26,668M on revenue $44,062M, a gross margin of about **60.5%**

That is a drop of roughly **12.5 percentage points** in one quarter. Revenue rose about 12% sequentially, but gross profit fell about 7%.

The margin recovered in the next quarter. Q2 FY2026 gross profit was $33,853M on revenue of $46,743M, a margin of about **72.4%**.

The file does not say why the margin fell in Q1 FY2026. It contains no management commentary or filed explanation for NVIDIA. The only filed explanation on file is AMD's Q2 2025 disclosure about export-control charges on its MI308 GPUs. That relates to AMD, not NVIDIA, so it does not explain NVIDIA's margin move.

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

## NVDA vs AMD: comparison from the data on file

**Bottom line:** NVDA is much larger and more profitable, with faster revenue growth in its latest reported year. AMD's share price has gained less over the period covered by the price data, but its margins have improved sharply from a low base. The file has no valuation inputs, so I can't say which stock is cheaper.

### Scale and growth

| Metric | NVDA | AMD |
|---|---|---|
| Latest fiscal year revenue | $209.9B (FY2026) | $34.7B (FY2025) |
| Prior fiscal year revenue | $130.5B | $25.8B |
| Annual revenue growth | +60.9% | +34.5% |
| Annual net income growth | +54.4% | +154% (off a low base) |
| Latest quarter revenue y/y | +57.9% (Q4 FY2026: $62.1B) | +45.7% (Q2 FY2026: $11.2B) |

AMD's +154% net income growth is off a depressed FY2024 base of $1.6B, so it overstates the underlying improvement.

### Margins

| Metric | NVDA FY2025 → FY2026 | AMD FY2024 → FY2025 |
|---|---|---|
| Gross margin | 75.0% → 70.8% | 49.3% → 49.9% |
| Operating margin | 62.4% → 60.2% | 1.6% → 9.8% |
| Net margin | 55.8% → 53.6% | 6.4% → 12.0% |

NVDA's margins are far higher but slipped slightly in FY2026. AMD's operating and net margins rose sharply. Its latest reported quarter, Q2 FY2026, shows a 54.0% gross margin, 14.4% operating margin and 13.2% net margin.

### Context on AMD's depressed quarter

AMD's Q2 FY2025 results were hit by about $800M in inventory and related charges. AMD attributed these to U.S. export controls on its MI308 data center GPU. That quarter's operating loss of -$134M and 39.8% gross margin are therefore not representative. Year-over-year comparisons against that quarter flatter AMD's growth.

### Share price (daily bars, 2025-12-01 to 2026-08-31)

- **NVDA:** closed at $167.35 on 2025-12-01 and $178.40 on 2026-08-31, a gain of about +6.6%.
- **AMD:** closed at $156.68 on 2025-12-01 and $162.30 on 2026-08-31, a gain of about +3.6%.

### Gaps and caveats

- **No valuation data.** The file has no market cap, share count, P/E, EV/sales or cash flow, so I can't assess relative valuation.
- **Filing dates don't line up.** NVDA's most recent filed quarter in the file is Q4 FY2026 (ended 2026-01-25). AMD's is Q2 FY2026 (ended 2026-06-27). NVDA's later quarters are not in the data, so the comparison is about seven months less current for NVDA.
- **Segment detail is limited.** NVDA's segment split covers only Q4 FY2026, where Data Center was $55.2B of $62.1B (about 89%). The file has no AMD segment data.
- **Quote inconsistencies.** The quote "previous close" figures don't match the daily bar series. NVDA's quote shows a previous close of $176.10, but the bars show $178.34 on 2026-08-28. AMD's quote shows $164.90, but the bars show $162.27. I used the daily bars for the price comparison. These mismatches should be checked before anyone relies on the quote fields.
- **No guidance, balance sheet or qualitative outlook** is on file for either company.
