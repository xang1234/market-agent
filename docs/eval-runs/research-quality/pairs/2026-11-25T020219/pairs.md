# Blinded answer pairs: 2026-11-25T020219

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

## 1. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): It operates at greater revenue scale than its peer, on the revenue comparison shown.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on NVDA:** Its fiscal year ended on a different calendar date than its peer's, so the comparison reflects offset time windows.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

**On the figures as reported, AAPL's fiscal 2025 revenue is about 3.2x NVDA's.**

| | Fiscal 2025 period | Revenue (USD M) |
|---|---|---|
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |

AAPL is ahead by about $285.7B.

**The fiscal years are not aligned.** NVDA's FY2025 ended in January 2025, while AAPL's ended in September 2025. NVDA's FY2025 mostly predates AAPL's, and the two overlap by only about four months. A closer match to AAPL's FY2025 is NVDA's FY2026 (2025-01-27 to 2026-01-25), which had revenue of 209,911. On that basis AAPL is only about 2.0x NVDA, and AAPL's FY2026 isn't complete on file.

**Other points from the filings:**
- **Growth:** NVDA's revenue rose 60.9% from FY2025 to FY2026. AAPL's rose 6.4% from FY2024 to FY2025 (391,035 to 416,161). I can't compute NVDA's FY2025 growth because FY2024 isn't on file.
- **Margins in each company's FY2025:**
  - Gross margin: NVDA 75.0%, AAPL 46.9%.
  - Operating margin: NVDA 62.4%, AAPL 32.0%.

## 2. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: 4 of 8 requested results verified*

- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- Advanced Micro Devices, Inc., Pretax income (including equity-method income), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Income tax expense (benefit), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- Advanced Micro Devices, Inc., EPS (basic), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., EPS (diluted), Q2 FY2025: gap (missing_input): No eligible input was public before the knowledge cutoff.

_Block sources: S1._

_Analyst commentary:_ AMD's gross profit was **$3.1B**[1] and operating income **-$134.0M**[2] in Q2 FY2025 (ended Jun 2025).

AMD's net income was **$872.0M**[3] and operating income **-$134.0M**[4] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** The data shows the operating loss came after gross profit was earned, so costs below gross profit exceeded it, but the evidence does not say which costs or why.

> **Analyst inference:** Positive net income alongside the operating loss means the operating loss does not reflect bottom-line results, though the evidence does not show what bridged the two.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [2] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [3] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- [4] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

AMD's Q2 FY2025 operating margin turned negative mainly because of about $800 million in inventory and related charges tied to U.S. export controls on its Instinct MI308 data center GPU.

**The numbers (Q2 FY2025, quarter ended 2025-06-28)**
- Revenue was $7,685M, gross profit $3,059M and operating income -$134M, an operating margin of about -1.7%.
- The prior quarter, Q1 FY2025, had operating income of $806M on revenue of $7,438M, a margin of about 10.8%.

**What the filing says**
AMD's Q2 2025 earnings release (8-K Exhibit 99.1, published 2025-08-05) states that results were impacted by the U.S. Government's export control on the MI308. It says the restrictions led to approximately $800M in inventory and related charges.

**Why the charge fits the margin drop**
- Revenue rose about $247M from Q1, but gross profit fell from $3,735M to $3,059M. Gross margin went from about 50.2% to about 39.8%, then recovered to about 53.6% in Q3 FY2025.
- Operating income swung by about $940M, from +$806M to -$134M. An $800M charge accounts for most of that swing.
- Operating expenses (gross profit less operating income) rose modestly, from about $2,929M to about $3,193M, so they were a smaller factor.

**Caveats**
- The filing excerpt doesn't say which income statement line carried the charge. The gross margin collapse and rebound suggest it was in cost of sales, but that is my inference.
- As an illustration, adding back $800M would put operating income around $666M, a margin of about 8.7%. That assumes the full amount hit operating income, and it isn't an AMD-reported figure.
- The data on file doesn't break out the remaining swing, so I can't say what else contributed.

## 3. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

Segment data on file for NVDA covers only Q4 FY2026 (2025-10-27 to 2026-01-25). Here is that quarter:

| Segment | Revenue (USD M) | % of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| OEM & Other | 1,050 | 1.7% |
| **Total** | **62,100** | 100% |

The segments sum to 62,100, which matches reported Q4 FY2026 revenue.

Data Center is close to 89% of revenue, and the other four segments together contribute about 6,900M.

I have no segment breakdown for any other quarter or for the full-year FY2025 and FY2026 figures. That means I can't show segment growth, mix shift over time, or full-year segment totals from the data on file.

### Answer B

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

## 4. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

# NVDA analysis (data as of 2026-09-01)

**Bottom line:** The fundamentals on file are very strong, but they stop at the quarter ended 2026-01-25. The data has no valuation inputs, no guidance and no estimates, so I can't say whether the stock is cheap or expensive.

## Growth
- **FY2026 revenue** was $209.9B, up 60.9% from $130.5B in FY2025.
- **FY2026 operating income** was $126.4B (+55.2%) and **net income** was $112.5B (+54.4%).
- **Q4 FY2026 revenue** was $62.1B, up 57.9% year over year and 8.9% sequentially.
- **Sequential growth** has been uneven: +6.1% in Q2 FY26, +22.0% in Q3 and +8.9% in Q4.
- **Q4 net income** was $35.4B, up 60.2% year over year.

## Margins
| | Gross | Operating | Net |
|---|---|---|---|
| FY2025 | 75.0% | 62.4% | 55.8% |
| FY2026 | 70.8% | 60.2% | 53.6% |

- **Annual margins** compressed by about 4 points at the gross line, and the cause is one weak quarter.
- **Q1 FY26** gross margin fell to 60.5% (operating margin 49.1%).
- **Recovery:** gross margin rebuilt to 72.4%, 73.4% and 74.4% over the next three quarters. Q4 operating margin was 64.9%, above any FY2025 quarter's operating margin.
- **Cause of the Q1 dip:** the data on file doesn't explain it. The only filed explanation covers AMD's export-control charge, and I wouldn't assume it applies to NVDA.

## Mix
Data Center was $55.2B of Q4 revenue, or 88.9%. The rest was:
- Gaming: $4.3B (6.9%)
- OEM & Other: $1.05B (1.7%)
- Professional Visualization: $0.9B (1.4%)
- Automotive: $0.65B (1.0%)

This is highly concentrated in one segment. I have no prior-period segment data, so I can't say how fast each segment is growing.

## Price action
- **Last price** is $178.40, up 1.3% from the $176.10 previous close.
- **Since 2025-12-01** (close $167.35), the stock is up 6.6%, in a very steady climb with no large drawdowns in the bars.
- **Volume** rose gradually from about 1.0M to about 3.0M shares a day over the window.
- **Data inconsistency:** the bars show 2026-08-31 closing at $178.40, the same as the "last price" on the 2026-09-01 quote. But the quote's previous close is $176.10, which doesn't match the bars. Treat the 1.3% daily move with caution.

## What the data doesn't cover
- **Stale fundamentals:** nothing after Q4 FY2026 (quarter ended 2026-01-25) is on file. The price data runs about seven months past that.
- **Valuation:** there are no share count, EPS, market cap or multiples, so I can't compute P/E or any other multiple.
- **Balance sheet and cash flow:** there are no balance sheet or cash flow figures, so I can't assess capex, cash returns or free cash flow.
- **Outlook:** there is no guidance or consensus, and no explanation from NVDA for the Q1 FY26 margin dip.
- **Peers:** AMD and AAPL are on file, but NVDA's margins and growth aren't comparable to them without more context. Say if you want a side-by-side on the reported figures.

**Q:** Compare it with AMD YTD.

# NVDA vs AMD, year to date (as of 2026-09-01)

**Bottom line:** NVDA has outperformed AMD YTD, +5.8% vs +3.2%, and it also leads on growth and margins. The data has no valuation inputs, so I can't say which is the better buy.

## Price performance
I used the 2025-12-31 close as the YTD base. These are price returns only, since the bars exclude dividends.

| | 2025-12-31 close | Latest ($) | YTD |
|---|---|---|---|
| NVDA | 168.60 | 178.40 | +5.8% |
| AMD | 157.32 | 162.30 | +3.2% |

- **Since 2025-12-01:** NVDA is up 6.6% and AMD is up 3.6%.
- **Path:** both stocks climbed steadily in the bars, with no sharp drawdowns for either.
- **Quote caveat:** for both names, the 2026-09-01 "last price" equals the 2026-08-31 bar close. The quote's previous close doesn't match the bars (NVDA $176.10, AMD $164.90). The quote implies NVDA +1.3% and AMD -1.6% on the day, but I wouldn't rely on that.

## Fundamentals
The fiscal calendars are nearly aligned: NVDA's FY2026 ended 2026-01-25 and AMD's FY2025 ended 2025-12-27.

| | NVDA FY2026 | AMD FY2025 |
|---|---|---|
| Revenue | $209.9B | $34.7B |
| Revenue growth | +60.9% | +34.5% |
| Gross margin | 70.8% | 49.9% |
| Operating margin | 60.2% | 9.8% |
| Net margin | 53.6% | 12.0% |

- **Operating income:** NVDA's grew 55.2%. AMD's rose from $401M to $3,392M, off a very low base.
- **AMD net income:** it exceeded operating income ($4,174M vs $3,392M). The data doesn't say why.

## Latest quarter on file
| | NVDA Q4 FY26 (to 2026-01-25) | AMD Q2 FY26 (to 2026-06-27) |
|---|---|---|
| Revenue | $62.1B | $11.2B |
| YoY revenue growth | +57.9% | +45.7% |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |

- **Recency:** AMD's data is about five months more recent than NVDA's, so the comparison is not apples to apples.
- **AMD sequential growth:** revenue grew 3.9% in Q1 FY26 and 4.7% in Q2, a slower pace than its year-over-year rate.
- **AMD's easy comp:** its Q2 FY25 included about $800M of inventory and related charges from the U.S. export control on MI308 GPUs, per AMD's filing. That quarter had an operating loss of $134M, which flatters the year-over-year comparison in AMD's operating income.

## What the data doesn't cover
- **Valuation:** there are no share counts, EPS, market caps or multiples for either company, so I can't compare valuations.
- **NVDA after January:** nothing is on file for NVDA after Q4 FY2026, so its recent quarters are missing.
- **Outlook and balance sheet:** there is no guidance, consensus, balance sheet or cash flow for either company.
- **Segments:** I have segment data for NVDA only, and only for Q4 FY26.

**Q:** Explain the differences and show the evidence.

# Why NVDA and AMD differ, with the evidence

**Short answer:** NVDA's lead comes mainly from a much leaner cost structure, plus faster growth. The data shows what differs, but it doesn't show why. I flag where I'm inferring.

## 1. Margins: the biggest gap, and mostly below the gross line
Gross profit minus operating income is the cost between the two lines. The data doesn't break it out, so this is derived.

| | NVDA FY2026 | AMD FY2025 |
|---|---|---|
| Revenue | $209,911M | $34,669M |
| Gross profit | $148,570M (70.8%) | $17,307M (49.9%) |
| Costs below gross profit | $22,182M (10.6% of revenue) | $13,915M (40.1% of revenue) |
| Operating income | $126,388M (60.2%) | $3,392M (9.8%) |

The 50.4-point operating margin gap splits into:
- **Gross margin gap:** 20.9 points.
- **Cost-ratio gap:** 29.6 points.

NVDA spends about 1.6x AMD's dollars below gross profit ($22.2B vs $13.9B) on about 6.1x the revenue. Most of the margin gap is operating leverage, not just a gross margin difference.

**AMD's charge doesn't close the gap.** AMD's filing cites about $800M of MI308 export-control charges in Q2 FY25. Its Q2 FY25 gross margin was 39.8%, against 50.2% in Q1 and 53.6% in Q3. That is consistent with the charge hitting gross profit, though the filing doesn't say which line. Adding it back gives roughly 52.2% for FY25, still well below NVDA's 70.8%.

## 2. Growth
- **NVDA:** FY26 revenue grew +60.9% ($130,497M to $209,911M). Q4 FY26 grew +57.9% year over year.
- **AMD:** FY25 revenue grew +34.5% ($25,785M to $34,669M). Q2 FY26 grew +45.7% ($7,685M to $11,200M).
- **AMD acceleration:** AMD's latest quarter is growing faster than its fiscal year did, so it is accelerating. NVDA's latest quarter is slightly below its full-year rate.
- **Cause:** NVDA's Q4 revenue was 88.9% Data Center ($55.2B of $62.1B). That concentration is consistent with the growth, but I have no prior-period NVDA segments and no AMD segments. I can't show that Data Center drove either company's growth.

## 3. Margin stability
- **AMD:** very steady. Gross margin was 54.0% in each of the last three quarters, and operating margin ran 14.1%, 14.2% and 14.4%.
- **NVDA:** Q1 FY26 gross margin dropped to 60.5% (operating margin 49.1%), then recovered to 72.4%, 73.4% and 74.4%.
- **Cause:** nothing on file explains NVDA's dip. AMD's export-control charge landed in a similar calendar window (Mar-Jun 2025 vs Jan-Apr 2025), but that explanation is AMD-specific, and I have no evidence NVDA was affected the same way.

## 4. Below the operating line
- **NVDA:** net income was 89.0% of operating income ($112,507M / $126,388M).
- **AMD:** net income was 123.0% of operating income ($4,174M / $3,392M).

AMD's net income exceeds its operating income, so something non-operating added to it. Items below the operating line aren't on file, so I can't say what.

## 5. Share prices
- **YTD:** NVDA is up +5.8% ($168.60 to $178.40) and AMD is up +3.2% ($157.32 to $162.30).
- **Cause:** NVDA's lead is consistent with its stronger growth and margins, but the data can't establish that link. There is no valuation, consensus or news data.
- **Data timing:** AMD's financials run through June 2026 and NVDA's stop at January 2026. Newer NVDA results would not be reflected in what I've shown.

### Answer B

**Q:** Analyze NVDA.

*Engine answer: 7 of 14 requested results verified*

- NVIDIA Corporation, Cash and equivalents (excluding restricted cash), end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Total assets, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Total liabilities, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- NVIDIA Corporation, Stockholders' equity, end of latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
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

_Analyst commentary:_ NVDA's revenue was **$209.9B**[1] and gross profit **$148.6B**[2] in FY2026 (ended Jan 2026).

NVDA's operating income was **$126.4B**[3] and net income **$112.5B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[5], operating margin **60.21%**[6] and net margin **53.60%**[7] in FY2026 (ended Jan 2026).

> **Analyst inference:** Its income statement shows very high profitability, with most of each revenue dollar surviving to operating and net income.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[8], AMD **3.17%**[9] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[10] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[11] in the Aug 31, 2026 session.

> **Analyst inference on NVDA** (from the price return ranking): It has delivered the stronger share price gain so far this year, though both stocks are up only modestly.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is still positive, so the return lead is a matter of degree and the data shown says nothing about why the two differ.

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is far stronger at every level shown, and its year-to-date share price gain is also larger, though the fiscal years end at different dates.

By revenue, highest first: NVDA **$209.9B**[12] (FY2026, ended Jan 2026), AMD **$34.7B**[13] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[14] (FY2026, ended Jan 2026), AMD **49.92%**[15] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[16] (FY2026, ended Jan 2026), AMD **9.78%**[17] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[18] (FY2026, ended Jan 2026), AMD **12.04%**[19] (FY2025, ended Dec 2025).

NVDA's operating income was **$126.4B**[20] and net income **$112.5B**[21] in FY2026 (ended Jan 2026); AMD's operating income was **$3.4B**[22] and net income **$4.2B**[23] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD:** Its net income exceeding operating income shows below-the-line items lift its bottom line, so its net margin overstates operating profitability.

AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$148.6B**: engine result: NVIDIA Corporation, Gross profit, FY2026 (ended 2026-01-25): $148.6B
- [3] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [4] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [5] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
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
- [20] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [21] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [22] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [23] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B

## 5. ticker-page-compare (explicit subject)

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): It converts far more of each revenue dollar into profit at every level, so its profitability is stronger, while the other company's scale of revenue is larger.

By revenue, highest first: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[7] (FY2025, ended Sep 2025), NVDA **53.60%**[8] (FY2026, ended Jan 2026).

AAPL's operating income was **$133.0B**[9] in FY2025 (ended Sep 2025); NVDA's operating income was **$126.4B**[10] in FY2026 (ended Jan 2026).

> **Analyst inference on AAPL** (from the revenue ranking): Its operating income is higher despite lower margins, so its profit rests on a larger revenue base, which cuts against the margin-based takeaway.

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

# AAPL vs NVDA

**Bottom line:** NVDA is growing much faster and earns much higher margins, while AAPL is a larger-revenue, slower-growth business. The stocks have moved about the same over the past nine months. I can't compare valuation because the file has no share counts, EPS or market caps.

**Latest fiscal year (the year-ends are not aligned)**

| | AAPL FY2025 (to Sep 2025) | NVDA FY2026 (to Jan 2026) |
|---|---|---|
| Revenue | $416.2B | $209.9B |
| Revenue growth | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net margin | 26.9% | 53.6% |
| Operating income growth | +8.0% | +55.2% |
| Net income growth | +19.5% | +54.4% |

AAPL's net income growth outpaced its operating income growth. The file doesn't say why, and I won't guess.

**Most recent quarter on file**

| | AAPL Q3 FY2026 (to Jun 2026) | NVDA Q4 FY2026 (to Jan 2026) |
|---|---|---|
| Revenue | $97.1B | $62.1B |
| Revenue growth year over year | +3.3% | +57.9% |
| Gross margin | 47.1% | 74.4% |
| Operating margin | 30.7% | 64.9% |
| Net income | $24.9B | $35.4B |
| Net income growth year over year | +6.3% | +60.2% |

- **Net income:** NVDA's quarterly net income is already about 42% higher than AAPL's, on about 36% less revenue.
- **Timing gap:** NVDA's latest filed quarter ended in January 2026, about five months before AAPL's. Nothing later is on file for NVDA, so the comparison favors AAPL on recency and likely understates how far apart the two are today.
- **Trailing four quarters:** AAPL's four quarters through June 2026 total $426.3B of revenue and $115.8B of net income, a 27.2% net margin. For NVDA, FY2026 is the latest full year on file.

**Mix and consistency**
- **NVDA concentration:** Data Center was $55.2B of the $62.1B Q4 revenue, or 88.9%. That is a heavy single-segment exposure.
- **NVDA margin dip:** NVDA's gross margin was 60.5% in Q1 FY2026, then recovered to 74.4% by Q4 FY2026. The file doesn't explain the dip.
- **AAPL seasonality:** AAPL's revenue peaks in the December quarter ($128.0B in Q1 FY2026) and is otherwise steady at $94–103B per quarter. No segment breakdown is on file for AAPL.

**Share price (daily bars exclude dividends)**
- **Since 2025-12-01 through 2026-08-31:** AAPL rose 6.1% ($218.38 to $231.60) and NVDA rose 6.6% ($167.35 to $178.40).
- **Takeaway:** NVDA's roughly 60% earnings growth has not shown up in the share price over this window. I can't tell from this data whether that reflects expectations already priced in or something else.
- **Data caveat:** The quote's "previous close" figures (AAPL $229.80, NVDA $176.10) don't match the 2026-08-28 bar closes (AAPL $231.53, NVDA $178.34). I haven't relied on the one-day moves implied by the quote.

**Not covered by the data:** valuation multiples, guidance, balance sheet and cash flow, buybacks and dividends, and any NVDA results after January 2026.

## 6. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

# Revenue and margins: NVDA vs AMD vs AAPL

Fiscal calendars differ, so I show the latest full fiscal year and the trailing four quarters (TTM) on the latest filed data. All figures are in USD millions.

## Latest full fiscal year

| | Period end | Revenue | YoY growth | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|---|
| NVDA FY2026 | Jan 2026 | 209,911 | +60.9% | 70.8% | 60.2% | 53.6% |
| AMD FY2025 | Dec 2025 | 34,669 | +34.5% | 49.9% | 9.8% | 12.0% |
| AAPL FY2025 | Sep 2025 | 416,161 | +6.4% | 46.9% | 32.0% | 26.9% |

## Trailing four quarters and latest quarter

| | TTM through | TTM revenue | TTM gross margin | TTM operating margin | Latest-quarter revenue | Latest-quarter gross / operating margin |
|---|---|---|---|---|---|---|
| NVDA | Q4 FY2026 (Jan 2026) | 209,911 | 70.8% | 60.2% | 62,100 | 74.4% / 64.9% |
| AMD | Q2 FY2026 (Jun 2026) | 41,446 | 53.9% | 14.1% | 11,200 | 54.0% / 14.4% |
| AAPL | Q3 FY2026 (Jun 2026) | 426,266 | 47.1% | 32.2% | 97,100 | 47.1% / 30.7% |

## Takeaways

- **NVDA** has by far the highest margins and the fastest growth. Operating margin is about 60%, roughly double AAPL's. Its gross margin dipped to 60.5% in Q1 FY2026 and recovered to 74.4% by Q4 FY2026. The data doesn't say why it dipped. Data Center was $55.2B of Q4 FY2026's $62.1B revenue (about 89%), so the profile is concentrated in one segment.
- **AMD** is the smallest, but growth is strong: Q2 FY2026 revenue is up 45.7% on Q2 FY2025. Margins are expanding from a low base. Operating margin went from 1.6% in FY2024 to 9.8% in FY2025 and 14.4% in the latest quarter. Q2 FY2025 is a distorted comparison: AMD filed that about $800M of inventory and related charges came from US export controls on its MI308 GPU. That quarter's operating income was -134 and gross margin 39.8%, so part of the year-over-year improvement is the charge not repeating.
- **AAPL** is the largest by revenue (about $426B TTM) but the slowest grower. The latest quarter is up 3.3% year over year. Margins are stable and mid-tier: gross margin around 47%, operating margin around 31–32%. Revenue is seasonal, with the December quarter at $128.0B against about $97–99B in the other recent quarters.

## Caveats

- NVDA's latest filed quarter ends January 2026, while AMD and AAPL are filed through June 2026. NVDA's comparison is therefore about five months staler, and nothing on file covers its more recent quarters.
- The data has no segment breakdown for AMD or AAPL, so I can't compare mix.
- This covers revenue and margins only. I haven't compared valuation, since there are no share counts, EPS or balance sheet data on file to build multiples from.

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 4 requested results verified*

- Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%

_Block sources: S1._

*Engine answer: all 4 requested results verified*

- NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue and gross margin rankings): Its margins are far higher than the other shown company's at every level, so it keeps much more of each revenue dollar, though the quarters differ and AMD is not covered.

By revenue, highest first: AAPL **$97.1B**[1], NVDA **$62.1B**[2]. No revenue is shown for AMD.

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **47.06%**[3], NVDA **74.40%**[4]. No gross margin is shown for AMD.

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **30.69%**[5], NVDA **64.90%**[6]. No operating margin is shown for AMD.

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **25.64%**[7], NVDA **57.00%**[8]. No net margin is shown for AMD.

> **Analyst inference on AAPL** (from the revenue ranking): Its larger revenue base cuts against the margin story, since it produces more sales even with much lower profitability, and the different quarters limit the comparison.

Periods: AAPL Q3 FY2026 (ended Jun 2026), NVDA Q4 FY2026 (ended Jan 2026). No figures are shown for AMD.

AMD: the figures were not computed, as the turn reached its limit of model calls. Reading stopped at the turn's limit of model calls, so part of the question may be unanswered.

_Cited:_

- [1] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [2] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [3] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [5] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [8] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

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

I can't break down AMD's revenue by segment because the data on file has no segment or product-line revenue for AMD. Segment revenue is provided only for NVIDIA (Q4 FY2026), and AMD's income statements show consolidated totals only.

What I can give you for AMD is total revenue:

| Period | Revenue (USD M) |
|---|---|
| FY2024 | 25,785 |
| FY2025 | 34,669 |
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 | 11,200 |

The only filed commentary on AMD, from its Q2 FY2025 release, says U.S. export controls on the Instinct MI308 data center GPU led to about $800 million in inventory and related charges. That is a cost item and doesn't tell us how much revenue came from data center or any other line.

For a real segment split, we would need AMD's segment disclosures from its 10-Q or 10-K filings, which aren't in what I have. If you'd like, I can pull the NVIDIA segment mix for comparison or go deeper on AMD's consolidated margins.

## 8. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

AMD's operating margin was flat at about 11% through Q1 FY2025, dropped below zero in Q2 FY2025, and has since stepped up to about 14%.

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

- **Q3 FY2024 to Q1 FY2025:** The margin held in a 10.6–11.4% range.
- **Q2 FY2025:** Operating income was a loss of $134M. AMD's 8-K attributes this to U.S. export controls on its MI308 data center GPU, which led to about $800M of inventory and related charges. Gross margin fell to 39.8%, from about 50% in the prior quarters.
- **Rough adjusted margin:** Adding the $800M back to operating income gives about $666M, or about 8.7% of revenue. That is only my arithmetic. The filing does not break out how much of the charge ran through operating income, so treat it as approximate. Even on that basis, the margin would have been below the prior quarters.
- **Q3 FY2025 onward:** The margin recovered to 13.7% and has edged up each quarter to 14.4% in Q2 FY2026. Gross margin has been about 54% for the last three quarters, up from about 50–51% before the charge, and operating margin has moved with it. Revenue growth over this stretch (from 7.7B to 11.2B) has also helped.

The data on file doesn't explain why gross margin stepped up after Q2 FY2025, such as product mix or pricing. I can't say whether the 14% level will hold.

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q4 FY2025 (ended 2025-12-27): 14.08%

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q3 FY2025 (ended 2025-09-27): 13.74%

_Block sources: S1._

_Analyst commentary:_ AMD's operating margin was **9.78%**[1] in FY2025 (ended Dec 2025).

AMD's operating margin rose from **13.74%**[2] in Q3 FY2025 (ended Sep 2025) to **14.08%**[3] in Q4 FY2025 (ended Dec 2025).

> **Analyst inference:** The full-year margin sitting below both late-year quarters implies earlier quarters of the year were weaker, yet the figures shown do not include those quarters, so the late-year strength cannot be confirmed as a sustained trend.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [2] **13.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q3 FY2025 (ended 2025-09-27): 13.74%
- [3] **14.08%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q4 FY2025 (ended 2025-12-27): 14.08%

## 9. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

I can't give you AMD's free cash flow because the data on file has no cash flow statement. Free cash flow is operating cash flow minus capital expenditures, and neither figure is here. The file also has no balance sheet, so I can't back into it from working capital or capex changes either.

The file does have income statement data. Net income and operating income are not substitutes for FCF, since they exclude capex, working capital swings, and non-cash items like stock comp and depreciation. For context, the last four reported quarters (Q3 FY2025 through Q2 FY2026) sum to:

- **Revenue:** $41,446M
- **Operating income:** $5,850M
- **Net income:** $5,473M

For the most recent fiscal year, FY2025, revenue was $34,669M, operating income $3,392M, and net income $4,174M.

To get FCF, I'd need AMD's cash flow statement (operating cash flow and capex) from its 10-K and 10-Q filings, which isn't in what I have.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

Commentary is unavailable for this answer.

## 10. single-latest-quarter (single company)

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

*Engine answer: 7 of 8 requested results verified*

- NVIDIA Corporation, EPS (diluted), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
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

_Analyst commentary:_ > **Analyst inference:** Its latest quarter shows very high profitability, with margins at every level above the full-year figures, though the data shown does not explain what drove that.

NVDA's revenue was **$62.1B**[1], gross profit **$46.2B**[2], operating income **$40.3B**[3] and net income **$35.4B**[4] in Q4 FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[5] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[6] in the Aug 31, 2026 session.

> **Analyst inference:** Against this strength, the stock's year-to-date return is modest, and the quarter shown is the one ended in January, well before the latest price date, so it may not reflect current trading.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [5] **5.81%**: price series
- [6] **$178.40**: price series

### Answer B

**Q:** Analyze NVDA's latest quarter.

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Data caveat:** Q4 FY2026 is the latest quarter on file, and it ended about 7 months before 2026-09-01. Nothing on file covers later quarters, so this may not be the most recent print. There are also no estimates, guidance, or consensus, so I can't say whether the quarter beat or missed.

## Headline results (USD M)

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

Operating income grew faster than revenue both sequentially and year over year. Operating margin rose about 170 bp QoQ and about 380 bp YoY. Gross margin explains roughly 100 bp of the QoQ gain, so the rest came from operating leverage. The data doesn't break out opex, so I can't say more about cost drivers.

## Segment mix (Q4 FY26)

| Segment | Revenue (USD M) | % of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

The segments sum to the 62,100 total. Data Center is nearly 89% of revenue, so results depend heavily on that one segment. No prior-period segment figures are on file, so I can't give segment growth rates.

## Full-year context

FY2026 revenue was 209,911 (+60.9% vs FY2025's 130,497) and net income was 112,507 (+54.4% vs 72,880). Q4 contributed about 30% of the year's revenue. Revenue has risen every quarter since Q1 FY26, from 44.1B to 62.1B.

## Valuation and price

The last price is 178.40. No share count or EPS is on file, so I can't compute market cap, P/E, or any other multiple. The price is up about 6.6% from 167.35 on 2025-12-01. The quote's previous close (176.10) doesn't match the 2026-08-28 bar close (178.34), so I wouldn't rely on the one-day move shown. I also can't assess the price reaction to the print, because no report date is on file.

## Takeaways

- Q4 was strong on growth (+58% YoY revenue) and on profitability, with a record operating margin of 64.9% in the data on file.
- Concentration in Data Center is the main thing to monitor.
- To judge whether this still describes the business, I'd need the subsequent quarters' filings, guidance, and share count, none of which are on file.

## 11. peer-two (peer comparison)

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

_Analyst commentary:_ By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

NVDA's revenue was **$209.9B**[9], operating income **$126.4B**[10] and net income **$112.5B**[11] in FY2026 (ended Jan 2026).

AMD's revenue was **$34.7B**[12], operating income **$3.4B**[13] and net income **$4.2B**[14] in FY2025 (ended Dec 2025).

By price return, highest first: NVDA **5.81%**[15], AMD **3.17%**[16] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[17] in the Aug 31, 2026 session; AMD's last close was **$162.30**[18] in the Aug 31, 2026 session.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no analyst consensus captured in the 7 days to the cutoff is on file. 10-K claims for NVDA and AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one. NVDA has no 10-K on file, so no business or risk factor claims from one.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [5] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [8] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [9] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [10] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [11] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [12] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [13] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [14] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [15] **5.81%**: price series
- [16] **3.17%**: price series
- [17] **$178.40**: price series
- [18] **$162.30**: price series

### Answer B

**Q:** Compare NVDA with AMD.

# NVDA vs AMD

**Bottom line:** On the data on file, NVDA is much larger, faster-growing and far more profitable. AMD is improving, with margins and growth both rising through its latest quarters. I can't comment on valuation because the file has no share counts, EPS, balance sheet or estimates.

## Latest fiscal year / trailing four quarters (USD M)

| | NVDA (FY2026, ended 2026-01-25) | AMD (last 4 qtrs, ended 2026-06-27) |
|---|---|---|
| Revenue | 209,911 | 41,446 |
| Gross margin | 70.8% | 53.9% |
| Operating margin | 60.2% | 14.1% |
| Net margin | 53.6% | 13.2% |
| Operating income | 126,388 | 5,850 |

Scale: NVDA's revenue is about 5x AMD's, and its operating income is about 22x.

## Growth and trend

- **NVDA:** FY2026 revenue grew 60.9% and operating income 55.2% on FY2025. Q4 FY2026 revenue of 62,100 was up 57.9% year on year and 8.9% sequentially. Q4 operating margin was 64.9%.
- **AMD:** FY2025 revenue grew 34.5% (25,785 to 34,669). Q2 FY2026 revenue of 11,200 was up 45.7% year on year and 4.7% sequentially. Operating margin rose from 9.8% in FY2025 to 14.4% in Q2 FY2026, and gross margin from 49.9% to 54.0%.
- **Margin direction:** NVDA's FY2026 margins were below FY2025 (gross 70.8% vs 75.0%, operating 60.2% vs 62.4%), driven by a weak Q1 FY2026 (gross margin 60.5%). The data doesn't explain that dip. Margins recovered to 74.4% gross in Q4.

## Mix

- **NVDA:** Data Center was 55,200 of 62,100 in Q4 FY2026, or 88.9% of revenue.
- **AMD:** No segment breakdown is on file.

## One-off at AMD

AMD's Q2 FY2025 operating loss of -134 included roughly $800M of inventory and related charges from the U.S. export controls on its MI308 data center GPU. Adding that back gives a rough operating income of about +666 and gross margin of about 50%. The filing doesn't say how the charge is split between line items, so treat that as approximate. It also means AMD's year-over-year comparisons against that quarter are flattered.

## Share price (split-adjusted closes, ex-dividends)

| | 2025-12-01 | 2026-08-31 | Change |
|---|---|---|---|
| NVDA | 167.35 | 178.40 | +6.6% |
| AMD | 156.68 | 162.30 | +3.6% |

Both drifted up steadily over the window, and NVDA outperformed modestly.

## Caveats

- **Reporting dates don't line up.** NVDA's latest quarter on file ended January 2026, about five months before AMD's. NVDA's newer quarters aren't in the data, so the comparison favors AMD in recency.
- **Quote inconsistency.** The 2026-09-01 quote lists previous closes (NVDA 176.10, AMD 164.90) that don't match the prior daily bars (178.40 and 162.30 on 8/31 for the last price, with AMD's 8/28 close at 162.27). I used the bar data and can't reliably state a one-day move.
- **Not covered:** valuation multiples, market cap, cash flow, balance sheet, guidance, or competitive and product detail beyond the filed AMD note.

## 12. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

**NVDA's gross margin fell sharply in Q1 FY2026, to about 60.5% from 73.0% in the prior quarter, then largely recovered the next quarter.**

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | 78.4% |
| Q4 FY2025 | 39,331 | 28,723 | 73.0% |
| **Q1 FY2026** | **44,062** | **26,668** | **60.5%** |
| Q2 FY2026 | 46,743 | 33,853 | 72.4% |

- **Sequential:** Revenue rose about 12% (+$4.7B) from Q4 FY2025, but gross profit fell about $2.1B. The margin dropped roughly 12.5 points.
- **Year over year:** Margin was down about 17.8 points from 78.4% in Q1 FY2025.
- **Operating margin:** It fell to about 49.1% from 61.1%. Gross profit less operating income (a rough proxy for operating expenses) rose only about $0.3B, from $4.7B to $5.0B. So the operating income decline came almost entirely from the gross profit decline.
- **Recovery:** In Q2 FY2026, gross margin was back at 72.4%, and it was about 73.4% in Q3 FY2026 and 74.4% in Q4 FY2026. The Q1 dip looks like a one-quarter event rather than a lasting reset.

**Cause:** The data on file doesn't say why the margin fell. There is no NVDA filing, commentary or cost breakdown for that quarter. The only filed explanation in the data is AMD's, about export-control-related inventory charges in its own Q2 FY2025, and I can't attribute that to NVDA. Any link would be speculation. To pin down the driver (for example, inventory charges versus mix), we'd need NVDA's Q1 FY2026 earnings release or 10-Q.

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

_Analyst commentary:_ > **Analyst inference:** Its gross margin fell sharply in the quarter, both from the prior quarter and from a year earlier, even as revenue kept growing.

NVDA's gross profit was **$26.7B**[1] and revenue **$44.1B**[2] in Q1 FY2026 (ended Apr 2025); NVDA's gross profit was **$28.7B**[3] and revenue **$39.3B**[4] in Q4 FY2025 (ended Jan 2025).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Gross profit dollars were still well above the year-earlier quarter, so the margin compression did not stop absolute profit growth versus that period.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [3] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [4] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B
