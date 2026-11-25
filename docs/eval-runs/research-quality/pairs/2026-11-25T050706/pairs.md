# Blinded answer pairs: 2026-11-25T050706

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

## NVDA vs. AMD: What the file supports

**Bottom line:** NVDA is much larger and more profitable, and it grew faster over the last fiscal year. AMD has a lower-margin business that is also growing, and its latest quarter shows improving margins. The file has no valuation data, so I can't say which stock is cheaper.

### Scale and growth

| Metric | NVDA | AMD |
|---|---|---|
| Latest fiscal year revenue | $209.9B (FY2026) | $34.7B (FY2025) |
| Prior fiscal year revenue | $130.5B | $25.8B |
| Annual revenue growth | **+60.9%** | **+34.5%** |
| Latest quarter revenue | $62.1B (Q4 FY2026) | $11.2B (Q2 FY2026) |
| Latest quarter YoY revenue growth | **+57.9%** vs. Q4 FY2025 | **+45.7%** vs. Q2 FY2025 |
| Latest annual net income growth | +54.4% (FY2026) | ~+154% (FY2025 $4.2B vs. FY2024 $1.6B) |

NVDA's revenue is about six times AMD's. Data Center made up $55.2B, or about 89%, of NVDA's Q4 FY2026 revenue. The file has no segment split for AMD.

### Profitability

| Margin | NVDA FY2026 | NVDA FY2025 | AMD FY2025 | AMD FY2024 |
|---|---|---|---|---|
| Gross | 70.8% | 75.0% | 49.9% | 49.4% |
| Operating | 60.2% | 62.4% | 9.8% | 1.6% |
| Net | 53.6% | 55.9% | 12.0% | 6.4% |

- NVDA's margins are high but slipped about 2 points at the gross level in FY2026.
- AMD's margins expanded sharply. Operating margin went from 1.6% to 9.8%. In its latest quarter (Q2 FY2026), AMD's gross margin was 54.0%, operating margin 14.4%, and net margin 13.2%.
- AMD's Q2 FY2025 results included roughly $800M in inventory and related charges tied to U.S. export controls on the MI308. That explains much of the weak quarter, which had an operating loss of $134M and a gross margin of 39.8%. The filing gives only the approximate charge, not a full adjusted P&L, so I can't calculate a precise "clean" margin.

### Share price (daily bars, 2025-12-01 to 2026-08-31)

- **NVDA:** closed at $167.35 on 2025-12-01 and $178.40 on 2026-08-31. That is **+6.6%**.
- **AMD:** closed at $156.68 on 2025-12-01 and $162.30 on 2026-08-31. That is **+3.6%**.

Both series trend up steadily, with no large daily moves in the file. Over this window, NVDA's price gain was roughly twice AMD's, while its fundamentals were also stronger.

### Gaps and data issues

- **No valuation data:** the file has no market cap, share count, EPS, P/E, EV/sales, or guidance. I can't judge relative value.
- **No balance sheet or cash flow:** I can't compare debt, cash, free cash flow, or capital spending.
- **Stale NVDA fundamentals:** the latest NVDA quarter on file is Q4 FY2026, which ended 2026-01-25. Later NVDA quarters are not in the file, while AMD's Q2 FY2026 (ended 2026-06-27) is. The two companies' latest reported periods are therefore not aligned.
- **Quote mismatch:** the "previous close" in the quote fields doesn't match the daily bars. NVDA's quote lists $176.10, but the 2026-08-28 bar closes at $178.34. AMD's quote lists $164.90, but the 2026-08-28 bar closes at $162.27. The quoted day-over-day moves (NVDA +1.3%, AMD −1.6%) therefore can't be verified against the bars, so I'd check the source before acting on them.

## 2. missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** Break down AMD's revenue by segment.

The data on file doesn't break AMD's revenue down by segment. It has only consolidated totals, so I can't give you a segment split.

Here is the consolidated revenue that is on file (USD millions):

| Period | Revenue |
|---|---|
| FY2024 | 25,785 |
| FY2025 | 34,669 |
| Q3 FY2024 | 6,819 |
| Q4 FY2024 | 7,658 |
| Q1 FY2025 | 7,438 |
| Q2 FY2025 | 7,685 |
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 | 11,200 |

The only related item on file is AMD's Q2 FY2025 8-K. It says U.S. export controls on the Instinct MI308 data center GPU led to about $800 million in inventory and related charges that quarter. It doesn't say which segment took the charge, and it doesn't give segment revenue.

For a segment breakdown, you'd need AMD's segment disclosures from its 10-K or 10-Q filings, which aren't in this file.

### Answer B

**Q:** Break down AMD's revenue by segment.

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

_Block sources: S1._

AMD has no 10-K on file, so no business or risk factor claims from one.

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

**Short answer:** NVDA is growing far faster and earns much higher margins than AAPL. AAPL's stock has moved about the same as NVDA's over the price data on file. The data does not include valuation metrics, so I can't say which stock is cheaper.

**Fundamentals (USD millions, as reported)**

| Metric | AAPL FY2025 (ends 2025-09-27) | NVDA FY2026 (ends 2026-01-25) |
|---|---|---|
| Revenue | 416,161 | 209,911 |
| Revenue growth vs prior FY | +6.4% (391,035 in FY2024) | +60.9% (130,497 in FY2025) |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net margin | 26.9% | 53.6% |
| Net income growth vs prior FY | +19.5% | +54.4% |

**Latest quarter**
- AAPL Q3 FY2026 (ended 2026-06-27): revenue 97,100, up 3.3% from 94,036 a year earlier. Operating margin 30.7%, net margin 25.6%.
- NVDA Q4 FY2026 (ended 2026-01-25): revenue 62,100, up 57.9% from 39,331 a year earlier. Operating margin 64.9%, net margin 57.0%. Data Center was 55,200, about 89% of revenue.

**Price action (daily closes, 2025-12-01 to 2026-08-31)**
- NVDA: 167.35 to 178.40, about +6.6%.
- AAPL: 218.38 to 231.60, about +6.1%.

Both stocks rose at a similar pace over this window even though their fundamentals diverge sharply. The price series alone doesn't explain why.

**Gaps in the data**
- No valuation data for either stock (no market cap, share count, P/E, EV/EBITDA, or forward estimates), so I can't compare valuations.
- AAPL's FY2026 annual results are not on file. Its latest full quarter is Q3 FY2026. Trailing four-quarter revenue is about 426,266 and operating income about 137,227, but that is my own sum, not a reported figure.
- No AAPL segment or product breakdown is on file. NVDA's segment split covers only Q4 FY2026.
- No balance sheet or cash flow data for either company, so I can't compare leverage, free cash flow, or capital returns.
- Prices exclude dividends, so total return for AAPL (which pays a dividend) is not captured.

**Data inconsistency to check:** The quotes don't match the bar series. NVDA's quote shows a previous close of 176.10, but the 2026-08-28 bar closed at 178.34. AAPL's quote shows 229.80, but the 2026-08-28 bar closed at 231.53. The quote's "last price" also equals the 2026-08-31 close, even though the quote is labelled as of 2026-09-01. Please verify the quote feed before using these prices.

## 4. cause-in-evidence (cause in evidence)

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

AMD's Q2 FY2025 operating loss came mainly from a roughly $800 million export-control charge tied to the MI308 data center GPU, which AMD attributed to inventory and related charges.

- **Operating income:** Q1 FY2025 was +$806M; Q2 was -$134M, a swing of about -$940M.
- **Gross profit fell while revenue rose:** Revenue went from $7,438M to $7,685M, but gross profit dropped from $3,735M to $3,059M. Gross margin fell from about 50.2% to 39.8%.
- **Opex also rose:** Implied operating expenses (gross profit minus operating income) went from about $2,929M to $3,193M, an increase of about $264M.
- **The charge explains most of the gross margin drop:** Adding back $800M to Q2 gross profit gives about $3,859M, or roughly 50% of revenue, in line with Q1. Without the charge, operating income would have been roughly +$666M (about 8.7% margin), a rough estimate that assumes the full charge sat in cost of sales and the opex increase is unchanged.

The filing states the charge was about $800M in "inventory and related charges" but does not say which income statement line it was booked to. The gross-margin math suggests it sat in cost of sales, but that is an inference. The data on file also doesn't explain the ~$264M rise in operating expenses.

## 5. what-changed-gross-margin (what changed)

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

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

NVDA's gross margin fell by about 12.5 percentage points in Q1 FY2026, from roughly 73.0% in Q4 FY2025 to roughly 60.5% in Q1 FY2026.

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q4 FY2025 (ended 2025-01-26) | 39,331 | 28,723 | 73.0% |
| Q1 FY2026 (ended 2025-04-27) | 44,062 | 26,668 | 60.5% |

Revenue rose about 12% quarter over quarter, but gross profit fell about 7%, so margin compressed. Operating margin fell from about 61% to about 49% over the same period.

The margin was already declining before Q1. It was about 78% in Q1 FY2025 and about 75% in Q2 and Q3 FY2025. The sharpest drop came in Q1 FY2026.

The data on file does not say what caused the drop. It contains no NVDA filed explanation, no cost breakdown, and no commentary on pricing, product mix, or inventory charges. The only filed explanation in the data is AMD's Q2 2025 export-control charge, which concerns AMD, not NVDA, so it does not explain NVDA's margin. Any attribution would need NVDA's Q1 FY2026 10-Q or earnings release.

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

The data on file doesn't include AMD's free cash flow. It has no cash flow statement, so there's no operating cash flow or capital expenditure figure to compute it from.

What the file does have for AMD is income statement data: quarterly and annual revenue, gross profit, operating income, and net income. For example, FY2025 net income was $4,174 million and Q2 FY2026 net income was $1,480 million. Net income doesn't measure free cash flow, though, because it includes non-cash items and ignores capital spending and working capital changes.

To answer this, we'd need AMD's cash flow statements (operating cash flow and capex) for the relevant periods. Once those are added, I can calculate free cash flow.

## 7. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**Scope note:** The latest quarter on file is Q4 FY2026 (2025-10-27 to 2026-01-25). The data has no filings after that quarter, so I can't tell whether NVIDIA has reported later quarters. The file also has no guidance, cash flow, balance sheet, share count, or prior-quarter segment detail.

## Headline

Q4 was another strong quarter. Revenue was $62.1B, up 8.9% sequentially and 57.9% year over year. Margins expanded again: gross margin reached 74.4% and operating margin 64.9%. Data Center was 88.9% of revenue.

## Income statement

| Metric | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue ($M) | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross margin | 74.4% | 73.4% | 73.0% | +1.0 pt | +1.4 pt |
| Operating margin | 64.9% | 63.2% | 61.1% | +1.7 pt | +3.8 pt |
| Net margin | 57.0% | 56.0% | 56.2% | +1.0 pt | +0.8 pt |
| Operating income ($M) | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income ($M) | 35,400 | 31,910 | 22,091 | +10.9% | +60.3% |

Operating income grew faster than revenue both sequentially and year over year, so operating leverage was positive. Net income grew about 60% year over year, roughly in line with revenue.

## Margin trend across FY2026

| Quarter | Gross margin | Operating margin |
|---|---|---|
| Q1 FY26 | 60.5% | 49.1% |
| Q2 FY26 | 72.4% | 60.8% |
| Q3 FY26 | 73.4% | 63.2% |
| Q4 FY26 | 74.4% | 64.9% |

Margins rose every quarter after Q1. The data does not explain the Q1 step-up, so I can't say what drove it.

## Segment mix (Q4 FY26 only)

| Segment | Revenue ($M) | Share of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

The segments sum to the reported $62.1B total. Data Center is the business that matters for this quarter. The file has no prior-quarter segment data, so I can't calculate segment growth rates or show how the mix has shifted.

## Full-year context

- FY2026 revenue was $209.9B, up 60.9% from $130.5B in FY2025. The four FY2026 quarters sum to this total.
- FY2026 operating margin was 60.2% ($126.4B on $209.9B), against 62.4% in FY2025.
- Q4 contributed 29.6% of FY2026 revenue.

## Share price (as of 2026-09-01)

- Last close: $178.40. The file's quote shows a previous close of $176.10, but the daily bars show an 8/28 close of $178.34. I can't reconcile those two figures from the data.
- Since the quarter-end sessions: the close on 2026-01-26 was $169.62, so the stock is up about 5.2%.
- Over the bar window (2025-12-01 to 2026-08-31), the stock rose from $167.35 to $178.40, about 6.6%. That is a slow, steady climb, and it is well behind the fundamental growth in the quarter.

## Valuation

I can't assess valuation. The file has no share count or market capitalization, so I can't calculate P/E, EV/sales, or yield. Share-price performance alone doesn't tell us whether the stock is cheap or expensive relative to these results.

## Takeaways

1. **Fundamentals:** Q4 showed strong growth, expanding margins, and high Data Center dependence. Results were consistent with the trend since Q2 FY26.
2. **Concentration:** About 89% of revenue came from Data Center, so the story depends heavily on that segment. The file doesn't show Data Center's trend over time.
3. **Stock reaction:** The price has moved only modestly since the quarter ended, which is far below the 58% revenue growth. Whether that gap is an opportunity or a signal depends on expectations and valuation, which this file doesn't cover.
4. **Missing for a full decision:** Guidance, the post-Q4 quarters (if any), cash flow, balance sheet, share count, and segment history.

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

NVDA's segment breakdown is only on file for one quarter, Q4 FY2026 (2025-10-27 to 2026-01-25). The five segments sum to the reported Q4 revenue of $62,100M.

| Segment | Revenue ($M) | Share of Q4 revenue |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

Data Center accounts for nearly 90% of the quarter's revenue. Gaming is a distant second at under 7%, and the other three segments together are about 4%.

The file does not include segment data for any other quarter or for the FY2025 or FY2026 annual totals. I can't show how the mix has shifted over time or give a full-year segment split. Pulling the segment disclosures for the other quarters would be needed to answer that.

## 9. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

AMD's operating margin has risen from about 11% to about 14% over the last eight reported quarters, with one sharp dip in Q2 FY2025.

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

- **Mid-2024 to early 2025:** Margins were steady at roughly 11%.
- **Q2 FY2025 trough:** Margin fell to -1.7%. AMD's filed Q2 FY2025 8-K says export restrictions on the MI308 data center GPU led to "approximately $800 million in inventory and related charges." Gross margin also dropped to about 39.8%, from roughly 50% in the adjacent quarters. Adding back $800M would put operating margin near 8.7%. That is my own estimate, not a figure AMD reported, and the filing doesn't say exactly which line items the charges hit.
- **Q3 FY2025 onward:** Margins stepped up to about 14% and have stayed in a narrow 13.7–14.4% band. Gross margin has held near 54% in the last three quarters, so the recent gains are modest.

The data doesn't include a breakdown of operating expenses, so I can't say whether the improvement came from gross margin, cost discipline, or both.

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

## 10. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

## NVDA: Analysis as of 2026-09-01

**Bottom line:** On the filed numbers, NVIDIA's growth is strong and still accelerating in dollar terms. Gross margin has come down from its FY2025 level, and the file has no explanation for the drop. The stock has drifted up about 6.6% since December 2025 with low volatility. I can't assess valuation because the file has no share count, EPS, or balance sheet.

### Growth
- **FY2026 revenue:** $209.9B, up 60.9% from $130.5B in FY2025.
- **Quarterly YoY revenue growth:** Q1 +69%, Q2 +56%, Q3 +63%, Q4 +58%.
- **Q4 FY2026 revenue:** $62.1B, up 8.9% sequentially from $57.0B in Q3.
- **Net income:** FY2026 $112.5B, up 54% from $72.9B. Q4 FY2026 net income of $35.4B was up 60% YoY.

Dollar growth is still rising. Quarterly revenue went from $44.1B in Q1 to $62.1B in Q4. Growth rates are running in the high-50s to mid-60s percent range.

### Margins
| | FY2025 | FY2026 | Q4 FY2026 |
|---|---|---|---|
| Gross margin | 75.0% | 70.8% | 74.4% |
| Operating margin | 62.4% | 60.2% | 64.9% |
| Net margin | 55.8% | 53.6% | 57.0% |

- Q1 FY2026 gross margin fell to 60.5% (from 78.4% in Q1 FY2025), then recovered to 72–74% over Q2–Q4.
- Q4 FY2026 operating margin of 64.9% is the highest of the FY2026 quarters.
- The file doesn't explain the Q1 FY2026 gross margin dip. The AMD filing on file describes export-control charges on AMD's MI308 in AMD's Q2 2025. It is about AMD, not NVIDIA, so I wouldn't attribute NVIDIA's margin movement to it.

### Segment mix (Q4 FY2026 only)
- Data Center: $55.2B, about 89% of revenue.
- Gaming: $4.3B. Professional Visualization: $0.9B. Automotive: $0.65B. OEM & Other: $1.05B.

The segments sum to the reported $62.1B. The file has segment data for one quarter only, so I can't show segment growth or trends. Data Center's share is the main concentration risk in the file.

### Stock
- Last close (2026-08-31): $178.40, up from $167.35 on 2025-12-01, a gain of about 6.6%.
- Range in the bar series: low $165.68 (2025-12-01), high $180.18 (2026-08-31).
- Daily moves are small, around $0.05–0.06 a day, and volume rose steadily from about 1.0M to 3.0M shares. The bars show no visible spikes near the Q4 FY2026 period end. The file doesn't include report dates, so I can't say how the stock reacted to earnings.

### Valuation
I can't compute P/E, EV/sales, or any multiple. The file has no share count, market cap, EPS, or net debt. Annualizing Q4 FY2026 net income ($35.4B × 4 ≈ $141.6B) gives a run-rate but no per-share or price-based figure.

### Data issues to check
- The quote's "previous close" of $176.10 doesn't match the bar series, which shows $178.34 on 2026-08-28. The $178.40 last price does match the bar series.
- The Q4 FY2026 figures are rounded to the nearest $100M, which may indicate preliminary or estimated numbers. I'd confirm against the filed 10-K.
- The latest income statement in the file is Q4 FY2026 (ended 2026-01-25). Q1 and Q2 FY2027 would normally have been filed by 2026-09-01, but neither appears in the file. Either they're missing or they weren't filed, and I can't tell which from this data.

### Not in the file
- Balance sheet, cash flow, capex, and inventory
- Share count, EPS, and valuation multiples
- Management guidance and analyst consensus
- Any filings or news after Q4 FY2026
- Stock price history before 2025-12-01

### Suggested next steps
1. Pull the Q1 and Q2 FY2027 filings and the FY2026 10-K to fill the gap after Q4 FY2026 and confirm the rounded figures.
2. Get the share count to compute EPS and P/E.
3. Get the Q1 FY2026 gross margin explanation from the 10-Q filing.
4. Get segment history to test whether Data Center growth is holding up.

**Q:** Compare it with AMD YTD.

## NVDA vs. AMD, 2026 YTD

**Bottom line:** NVIDIA has outperformed AMD year to date on price, by about 2.6 points. Its fundamentals are much stronger: faster growth, far higher margins, and much larger earnings. AMD's Q2 FY2026 growth rate is flattered by a depressed comparison base. Neither company's valuation can be compared from this file because it has no share counts.

### Stock performance (2026 YTD, from 2025-12-31 close)
| | 2025-12-31 close | 2026-08-31 close | YTD return |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | +5.8% |
| AMD | $157.32 | $162.30 | +3.2% |

- Both stocks rose steadily with small daily moves and no visible spikes.
- Since 2025-12-01, NVDA's range is $165.68–$180.18 and AMD's is $156.68–$163.92.
- The file doesn't include a benchmark index, so I can't say how either stock did relative to the market.

### Growth
| | NVDA | AMD |
|---|---|---|
| Latest quarter | Q4 FY26 (ended 2026-01-25) | Q2 FY26 (ended 2026-06-27) |
| Latest quarter revenue | $62.1B | $11.2B |
| YoY revenue growth, latest quarter | +58% | +46% |
| YoY growth, prior quarter | +63% (Q3) | +44% (Q1) |
| Full-year revenue growth | +61% (FY26) | +35% (FY25) |

AMD's Q2 FY2026 growth of +46% is measured against Q2 FY2025, which included about $800M in inventory and related charges tied to export controls on the MI308 (per AMD's 2025-08-05 filing). That base effect flatters AMD's growth rate, so the underlying gap is likely somewhat wider than the headline numbers suggest. The filing doesn't quantify the effect on the growth rate.

### Margins (most recent full-year or quarter on file)
| | NVDA (FY26) | AMD (FY25) | AMD (Q2 FY26) |
|---|---|---|---|
| Gross margin | 70.8% | 49.9% | 54.0% |
| Operating margin | 60.2% | 9.8% | 14.4% |
| Net margin | 53.6% | 12.0% | 13.2% |

NVIDIA's margins are roughly four to six times AMD's on operating and net measures. AMD's latest quarter shows some improvement, but the level is still far below NVIDIA's.

### Scale
- NVIDIA FY26 net income: $112.5B. AMD FY25 net income: $4.2B.
- NVIDIA's latest quarter revenue is about 5.5 times AMD's.

### What I can't compare
- **Valuation:** the file has no share counts, EPS, market caps, or multiples. Price alone doesn't tell you which stock is cheaper.
- **Balance sheets, cash flow, guidance, and consensus** for either company.
- **Matching periods:** NVIDIA's latest filing is Q4 FY26 (ended January 2026). AMD's file runs through Q2 FY26 (ended June 2026). The two companies' latest periods don't line up, and NVIDIA's file has no quarters after Q4 FY26.

### Data notes
- AMD's quote shows a previous close of $164.90, but the bar series shows $162.27 on 2026-08-27 and $162.27 on 2026-08-28. The last price of $162.30 matches the bar series. This is the same kind of discrepancy I flagged for NVDA.

**Q:** Explain the differences and show the evidence.

## NVDA vs. AMD: Differences and Evidence

The two companies differ in four areas: growth, margins, scale, and stock performance. The stock gap is small, and the fundamental gap is large. I also need to correct two points from my last answer, covered at the end.

### 1. Growth: NVIDIA is growing about 15–25 points faster

| Quarter | NVDA revenue YoY | AMD revenue YoY |
|---|---|---|
| Q1 (latest in file: NVDA Q1 FY26, AMD Q1 FY26) | 44,062 / 26,044 = **+69.2%** | 10,700 / 7,438 = **+43.9%** |
| Q2 (NVDA Q2 FY26, AMD Q2 FY26) | 46,743 / 30,040 = **+55.6%** | 11,200 / 7,685 = **+45.7%** |
| Q3 (NVDA Q3 FY26, AMD Q3 FY25 base) | 57,006 / 35,082 = **+62.5%** | 9,246 / 6,819 (Q3 FY24 base) = **+35.6%** (prior year) |
| Q4 (NVDA Q4 FY26, AMD Q4 FY25) | 62,100 / 39,331 = **+57.9%** | 10,300 / 7,658 = **+34.5%** |
| Full year (NVDA FY26, AMD FY25) | 209,911 / 130,497 = **+60.9%** | 34,669 / 25,785 = **+34.5%** |

Across the periods where both companies have data, NVIDIA's growth ran 12–25 points higher. For the NVDA FY2026 vs AMD FY2025 comparison, the fiscal periods are close: NVIDIA's year ended 2026-01-25 and AMD's ended 2025-12-27.

### 2. Margins: NVIDIA earns roughly 4–6× AMD's operating margin

| Measure | NVDA FY26 | AMD FY25 | Calculation |
|---|---|---|---|
| Gross margin | 70.8% | 49.9% | 148,570/209,911 vs 17,307/34,669 |
| Operating margin | 60.2% | 9.8% | 126,388/209,911 vs 3,392/34,669 |
| Net margin | 53.6% | 12.0% | 112,507/209,911 vs 4,174/34,669 |

Quarterly gross margins show the gap is persistent, not a single-year effect:

- **NVDA:** 78.4% (Q1 FY25), 75.2%, 74.6%, 73.0%, 60.5% (Q1 FY26), 72.4%, 73.4%, 74.4% (Q4 FY26)
- **AMD:** 50.2% (Q1 FY25), 39.8% (Q2 FY25), 53.6%, 54.0%, 54.0% (Q1 FY26), 54.0% (Q2 FY26)

NVIDIA's lowest gross margin in the file (60.5%) is still above AMD's highest (54.0%). The file doesn't explain NVIDIA's Q1 FY26 dip.

### 3. Scale: NVIDIA's revenue is about 5–6× AMD's

- NVDA Q4 FY26 revenue: $62,100M. AMD Q4 FY25 revenue: $10,300M. Ratio: **6.0×**.
- NVDA Q4 FY26 revenue vs AMD Q2 FY26 (latest AMD quarter): **5.5×**.
- NVDA FY26 net income: $112,507M. AMD FY25 net income: $4,174M. Ratio: **27×**.

The net income gap is much larger than the revenue gap because of the margin difference.

### 4. Revenue concentration: a NVIDIA-specific feature

NVIDIA Q4 FY26 segments:
- Data Center: $55,200M (**88.9%** of $62,100M)
- Gaming: $4,300M (6.9%)
- Other segments combined: $2,600M (4.2%)

The file doesn't include AMD's segment breakdown, so I can't say whether AMD is less concentrated.

### 5. Stock performance: a small gap with no explanation in the file

| | 2025-12-31 close | 2026-08-31 close | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | 9.80 / 168.60 = **+5.8%** |
| AMD | $157.32 | $162.30 | 4.98 / 157.32 = **+3.2%** |

- Both stocks rose steadily, with daily moves of about $0.05 for NVIDIA and about $0.03 for AMD in the bar series.
- The file has no earnings dates, guidance, news, or index data, so I can't attribute the 2.6-point gap to any cause.
- Price levels ($178 vs $162) don't indicate relative value. The file has no share counts.

### Corrections to my previous answer

1. **AMD's Q2 FY2025 charge and revenue growth.** I said the ~$800M charge flattered AMD's Q2 FY2026 revenue growth. That was overstated. AMD's filing describes the charge as "inventory and related charges," which affect cost of revenue, gross profit, and operating income. It doesn't say revenue was reduced. The charge does depress the Q2 FY2025 base for margin and earnings comparisons (Q2 FY25 gross margin 39.8%, operating income -$134M), but not necessarily the revenue growth rate.

2. **AMD's previous-close discrepancy.** I wrote that the bar series shows $162.27 on 2026-08-27 and 2026-08-28. The correct figures are **$162.24 on 2026-08-27 and $162.27 on 2026-08-28**. The quote's previous close of $164.90 still doesn't match either date.

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

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): It operates at greater revenue scale than its peer, on the revenue comparison shown.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on NVDA:** Its fiscal year ended on a different calendar date than its peer's, so the comparison reflects offset time windows.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

**Apple's fiscal 2025 revenue was about 3.2 times NVIDIA's.**

| | Fiscal 2025 revenue (USD millions) | Period |
|---|---|---|
| AAPL | 416,161 | 2024-09-29 to 2025-09-27 |
| NVDA | 130,497 | 2024-01-29 to 2025-01-26 |

Apple's revenue was about $285.7 billion higher.

The two fiscal years are not the same calendar period. NVIDIA's fiscal 2025 ended in January 2025, while Apple's ended in September 2025, so they overlap by only about four months. The gap is partly a timing effect, but NVIDIA's revenue grew sharply after its fiscal 2025 ended. Its fiscal 2026 revenue (ended 2026-01-25) was 209,911, which is still about half of Apple's fiscal 2025 figure.

## 12. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

# NVDA vs. AMD vs. AAPL: Revenue and Margins

**Data gap:** NVDA's latest quarter on file is Q4 FY2026 (ended 2026-01-25). AMD's latest is Q2 FY2026 (ended 2026-06-27), and AAPL's is Q3 FY2026 (ended 2026-06-27). NVDA's later quarters are not in the data, so its most recent figures are roughly two quarters older than the others.

## Latest full fiscal year

| | NVDA FY2026 | AMD FY2025 | AAPL FY2025 |
|---|---|---|---|
| Revenue ($M) | 209,911 | 34,669 | 416,161 |
| Revenue growth YoY | +60.9% | +34.4% | +6.4% |
| Gross margin | 70.8% | 49.9% | 46.9% |
| Operating margin | 60.2% | 9.8% | 32.0% |
| Net margin | 53.6% | 12.0% | 26.9% |

Prior-year comparison:
- **NVDA FY2025:** gross 75.0%, operating 62.4%, net 55.9%. FY2026 margins were lower by about 2 to 4 points.
- **AMD FY2024:** gross 49.4%, operating 1.6%, net 6.4%. AMD's margins improved in FY2025.
- **AAPL FY2024:** gross 46.2%, operating 31.5%, net 24.0%. AAPL's margins were stable to slightly higher in FY2025.

## Latest quarter on file

| | NVDA Q4 FY2026 | AMD Q2 FY2026 | AAPL Q3 FY2026 |
|---|---|---|---|
| Revenue ($M) | 62,100 | 11,200 | 97,100 |
| Revenue growth YoY | +57.9% | +45.7% | +3.3% |
| Gross margin | 74.4% | 54.0% | 47.1% |
| Operating margin | 64.9% | 14.4% | 30.7% |
| Net margin | 57.0% | 13.2% | 25.6% |

## Takeaways

- **Scale:** AAPL has by far the largest revenue base, at about 2x NVDA's FY2026 revenue. NVDA has the fastest growth of the three.
- **Margins:** NVDA leads on every margin measure. AAPL has a mid-to-high-30s to low-30s operating margin with much lower gross margin than NVDA. AMD is the lowest on operating and net margin, though its latest-quarter margins are the highest they have been in this data set.
- **AMD's trend:** Its margins have risen sharply. The Q2 FY2025 gross margin was depressed by the export-control charge, which AMD put at about $800M of "inventory and related charges." If that entire amount sat in cost of sales, Q2 FY2025 gross margin would be about 50% excluding the charge, versus 39.8% reported. The filing does not say exactly where the charge was recorded, so treat this as an approximation.
- **AAPL's growth:** Growth has slowed to +3.3% YoY in the latest quarter, while its margins remain steady.

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
