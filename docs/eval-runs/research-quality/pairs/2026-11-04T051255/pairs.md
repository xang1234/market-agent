# Blinded answer pairs: 2026-11-04T051255

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

Failure labels: `wrong_subject`, `wrong_period`, `unsupported_figure`, `invented_figure`, `weak_conclusion`, `missing_counterpoint`, `unstated_gap`, `operational_failure`. An answer that wasn't given is labelled
`operational_failure` at the reveal.

## 1. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

### Answer B

**Q:** Break down NVDA's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

## 2. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

*Engine answer: all 24 requested results verified*

*NVIDIA Corporation, Revenue*: Q1 FY2025 (ended 2024-04-28) USD 26,044,000,000.00; Q2 FY2025 (ended 2024-07-28) USD 30,040,000,000.00; Q3 FY2025 (ended 2024-10-27) USD 35,082,000,000.00; Q4 FY2025 (ended 2025-01-26) USD 39,331,000,000.00; Q1 FY2026 (ended 2025-04-27) USD 44,062,000,000.00; Q2 FY2026 (ended 2025-07-27) USD 46,743,000,000.00; Q3 FY2026 (ended 2025-10-26) USD 57,006,000,000.00; Q4 FY2026 (ended 2026-01-25) USD 62,100,000,000.00

*NVIDIA Corporation, Quarter-over-quarter percent change in Revenue*: Q2 FY2025 (ended 2024-07-28) vs Q1 FY2025 (ended 2024-04-28) 15.34%; Q3 FY2025 (ended 2024-10-27) vs Q2 FY2025 (ended 2024-07-28) 16.78%; Q4 FY2025 (ended 2025-01-26) vs Q3 FY2025 (ended 2024-10-27) 12.11%; Q1 FY2026 (ended 2025-04-27) vs Q4 FY2025 (ended 2025-01-26) 12.03%; Q2 FY2026 (ended 2025-07-27) vs Q1 FY2026 (ended 2025-04-27) 6.08%; Q3 FY2026 (ended 2025-10-26) vs Q2 FY2026 (ended 2025-07-27) 21.96%; Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26) 8.94%

- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q4 FY2026 (ended 2026-01-25) has the highest revenue of the 8 quarters ranked
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q1 FY2025 (ended 2024-04-28) has the lowest revenue of the 8 quarters ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (NVDA's revenue rose in every period): Its latest quarter shows very strong scale and profitability, though sequential growth has been uneven and slowed from the prior quarter.

NVDA's revenue rose in every period from Q1 FY2025 (ended Apr 2024) (**USD 26,044,000,000.00**[1]) to Q4 FY2026 (ended Jan 2026) (**USD 62,100,000,000.00**[2]).

NVDA's revenue was **USD 62,100,000,000.00**[3] in Q4 FY2026 (ended Jan 2026); NVDA's year-over-year percent change in revenue was **57.89%**[4] in Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025); NVDA's quarter-over-quarter percent change in revenue was **8.94%**[5] in Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025).

NVDA's gross margin (gross profit / revenue) was **74.40%**[6], operating margin (operating income / revenue) **64.90%**[7] and net margin (net income / revenue) **57.00%**[8] in Q4 FY2026 (ended Jan 2026).

> **Analyst inference:** Sequential growth was slower than in the preceding quarter, so momentum looks to be cooling even as revenue reaches a record.

_Cited:_

- [1] **USD 26,044,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): USD 26,044,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [3] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [4] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [5] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [6] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [8] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

### Answer B

**Q:** Analyze NVDA's latest quarter.

*Engine answer: all 24 requested results verified*

*NVIDIA Corporation, Revenue*: Q1 FY2025 (ended 2024-04-28) USD 26,044,000,000.00; Q2 FY2025 (ended 2024-07-28) USD 30,040,000,000.00; Q3 FY2025 (ended 2024-10-27) USD 35,082,000,000.00; Q4 FY2025 (ended 2025-01-26) USD 39,331,000,000.00; Q1 FY2026 (ended 2025-04-27) USD 44,062,000,000.00; Q2 FY2026 (ended 2025-07-27) USD 46,743,000,000.00; Q3 FY2026 (ended 2025-10-26) USD 57,006,000,000.00; Q4 FY2026 (ended 2026-01-25) USD 62,100,000,000.00

*NVIDIA Corporation, Quarter-over-quarter percent change in Revenue*: Q2 FY2025 (ended 2024-07-28) vs Q1 FY2025 (ended 2024-04-28) 15.34%; Q3 FY2025 (ended 2024-10-27) vs Q2 FY2025 (ended 2024-07-28) 16.78%; Q4 FY2025 (ended 2025-01-26) vs Q3 FY2025 (ended 2024-10-27) 12.11%; Q1 FY2026 (ended 2025-04-27) vs Q4 FY2025 (ended 2025-01-26) 12.03%; Q2 FY2026 (ended 2025-07-27) vs Q1 FY2026 (ended 2025-04-27) 6.08%; Q3 FY2026 (ended 2025-10-26) vs Q2 FY2026 (ended 2025-07-27) 21.96%; Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26) 8.94%

- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q4 FY2026 (ended 2026-01-25) has the highest revenue of the 8 quarters ranked
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q1 FY2025 (ended 2024-04-28) has the lowest revenue of the 8 quarters ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (NVDA's revenue rose in every period): Its latest quarter was its strongest in the window, with very high margins and growth, though sequential growth is uneven.

NVDA's revenue was **USD 62,100,000,000.00**[1], gross profit **USD 46,200,000,000.00**[2], operating income **USD 40,300,000,000.00**[3] and net income **USD 35,400,000,000.00**[4] in Q4 FY2026 (ended Jan 2026).

NVDA's gross margin (gross profit / revenue) was **74.40%**[5], operating margin (operating income / revenue) **64.90%**[6] and net margin (net income / revenue) **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

NVDA's revenue rose in every period from Q1 FY2025 (ended Apr 2024) (**USD 26,044,000,000.00**[8]) to Q4 FY2026 (ended Jan 2026) (**USD 62,100,000,000.00**[9]).

NVDA's year-over-year percent change in revenue was **57.89%**[10] in Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025).

_Cited:_

- [1] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [2] **USD 46,200,000,000.00**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- [3] **USD 40,300,000,000.00**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- [4] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **USD 26,044,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): USD 26,044,000,000.00
- [9] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [10] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%

## 3. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: all 18 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| Apple Inc. | USD 97,100,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 45,700,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 29,800,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 24,900,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | 47.06% (Q3 FY2026 (ended 2026-06-27)) | 30.69% (Q3 FY2026 (ended 2026-06-27)) | 25.64% (Q3 FY2026 (ended 2026-06-27)) | -1.62% (Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28)) | 3.26% (Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28)) |
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 46,200,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 40,300,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 35,400,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) | 8.94% (Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26)) | 57.89% (Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26)) |

_Block sources: S1._

Not covered by this answer: Apple Inc.'s lead over NVIDIA Corporation in each margin, as no quarter NVIDIA Corporation reported ends within half a quarter of Apple Inc.'s Q3 FY2026.

_Analyst commentary:_ > **Analyst inference on NVDA** (AAPL highest on revenue; NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), and net margin (net income / revenue)): It converts revenue into profit far more efficiently and is growing faster, so on these figures it is the stronger operator, though the quarters shown are not the same period.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **USD 97,100,000,000.00**[1] (Q3 FY2026 (ended Jun 2026)), NVDA **USD 62,100,000,000.00**[2] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's gross margin (gross profit / revenue) was highest: AAPL **47.06%**[3] (Q3 FY2026 (ended Jun 2026)), NVDA **74.40%**[4] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's operating margin (operating income / revenue) was highest: AAPL **30.69%**[5] (Q3 FY2026 (ended Jun 2026)), NVDA **64.90%**[6] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's net margin (net income / revenue) was highest: AAPL **25.64%**[7] (Q3 FY2026 (ended Jun 2026)), NVDA **57.00%**[8] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's year-over-year percent change in revenue was highest: AAPL **3.26%**[9] (Q3 FY2026 (ended Jun 2026) vs Q3 FY2025 (ended Jun 2025)), NVDA **57.89%**[10] (Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025)).

AAPL's quarter-over-quarter percent change in revenue was **-1.62%**[11] in Q3 FY2026 (ended Jun 2026) vs Q2 FY2026 (ended Mar 2026); NVDA's quarter-over-quarter percent change in revenue was **8.94%**[12] in Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025).

AAPL's net income was **USD 24,900,000,000.00**[13] in Q3 FY2026 (ended Jun 2026); NVDA's net income was **USD 35,400,000,000.00**[14] in Q4 FY2026 (ended Jan 2026).

> **Analyst inference on AAPL** (AAPL highest on revenue; NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), net margin (net income / revenue), and year-over-year percent change in revenue): Its larger revenue base is a counterpoint, since scale is higher even though profitability and growth are lower.

_Cited:_

- [1] **USD 97,100,000,000.00**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): USD 97,100,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [3] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [5] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [8] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [9] **3.26%**: engine result: Apple Inc., Year-over-year percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28): 3.26%
- [10] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [11] **-1.62%**: engine result: Apple Inc., Quarter-over-quarter percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28): -1.62%
- [12] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [13] **USD 24,900,000,000.00**: engine result: Apple Inc., Net income, Q3 FY2026 (ended 2026-06-27): USD 24,900,000,000.00
- [14] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: all 18 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| Apple Inc. | USD 97,100,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 45,700,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 29,800,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 24,900,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | 47.06% (Q3 FY2026 (ended 2026-06-27)) | 30.69% (Q3 FY2026 (ended 2026-06-27)) | 25.64% (Q3 FY2026 (ended 2026-06-27)) | -1.62% (Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28)) | 3.26% (Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28)) |
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 46,200,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 40,300,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 35,400,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) | 8.94% (Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26)) | 57.89% (Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26)) |

_Block sources: S1._

Not covered by this answer: Apple Inc.'s lead over NVIDIA Corporation in each margin, as no quarter NVIDIA Corporation reported ends within half a quarter of Apple Inc.'s Q3 FY2026.

_Analyst commentary:_ > **Analyst inference on NVDA** (NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), net margin (net income / revenue), and year-over-year percent change in revenue): Its profitability is far stronger and its growth faster, though the two quarters are different periods.

Of AAPL and NVDA, NVDA's gross margin (gross profit / revenue) was highest: AAPL **47.06%**[1] (Q3 FY2026 (ended Jun 2026)), NVDA **74.40%**[2] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's operating margin (operating income / revenue) was highest: AAPL **30.69%**[3] (Q3 FY2026 (ended Jun 2026)), NVDA **64.90%**[4] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's net margin (net income / revenue) was highest: AAPL **25.64%**[5] (Q3 FY2026 (ended Jun 2026)), NVDA **57.00%**[6] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's year-over-year percent change in revenue was highest: AAPL **3.26%**[7] (Q3 FY2026 (ended Jun 2026) vs Q3 FY2025 (ended Jun 2025)), NVDA **57.89%**[8] (Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025)).

AAPL's quarter-over-quarter percent change in revenue was **-1.62%**[9] in Q3 FY2026 (ended Jun 2026) vs Q2 FY2026 (ended Mar 2026); NVDA's quarter-over-quarter percent change in revenue was **8.94%**[10] in Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025).

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **USD 97,100,000,000.00**[11] (Q3 FY2026 (ended Jun 2026)), NVDA **USD 62,100,000,000.00**[12] (Q4 FY2026 (ended Jan 2026)).

Of AAPL and NVDA, NVDA's net income was highest: AAPL **USD 24,900,000,000.00**[13] (Q3 FY2026 (ended Jun 2026)), NVDA **USD 35,400,000,000.00**[14] (Q4 FY2026 (ended Jan 2026)).

> **Analyst inference on AAPL** (AAPL highest on revenue): Its larger revenue base is a counterpoint, since it still generates more sales per quarter than NVDA.

_Cited:_

- [1] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [2] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [3] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [4] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [5] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [6] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [7] **3.26%**: engine result: Apple Inc., Year-over-year percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28): 3.26%
- [8] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [9] **-1.62%**: engine result: Apple Inc., Quarter-over-quarter percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28): -1.62%
- [10] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [11] **USD 97,100,000,000.00**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): USD 97,100,000,000.00
- [12] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [13] **USD 24,900,000,000.00**: engine result: Apple Inc., Net income, Q3 FY2026 (ended 2026-06-27): USD 24,900,000,000.00
- [14] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00

## 4. peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Answer A

**Q:** Compare NVDA with AMD.

*Engine answer: all 21 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 46,200,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 40,300,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 35,400,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) | 8.94% (Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26)) | 57.89% (Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26)) |
| Advanced Micro Devices, Inc. | USD 11,200,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 6,050,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,610,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,480,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | 54.02% (Q2 FY2026 (ended 2026-06-27)) | 14.38% (Q2 FY2026 (ended 2026-06-27)) | 13.21% (Q2 FY2026 (ended 2026-06-27)) | 4.67% (Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28)) | 45.74% (Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28)) |

- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 20.42 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 50.82 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 43.90 pp

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), and net margin (net income / revenue)): It converts revenue into profit far more efficiently, with margins at every level well above its peer's, though the periods compared are not aligned.

Of NVDA and AMD, NVDA's gross margin (gross profit / revenue) was highest: NVDA **74.40%**[1] (Q4 FY2026 (ended Jan 2026)), AMD **54.02%**[2] (Q2 FY2026 (ended Jun 2026)).

Of NVDA and AMD, NVDA's operating margin (operating income / revenue) was highest: NVDA **64.90%**[3] (Q4 FY2026 (ended Jan 2026)), AMD **14.38%**[4] (Q2 FY2026 (ended Jun 2026)).

Of NVDA and AMD, NVDA's net margin (net income / revenue) was highest: NVDA **57.00%**[5] (Q4 FY2026 (ended Jan 2026)), AMD **13.21%**[6] (Q2 FY2026 (ended Jun 2026)).

NVDA's quarter-over-quarter percent change in revenue was **8.94%**[7] in Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025); NVDA's year-over-year percent change in revenue was **57.89%**[8] in Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025).

AMD's quarter-over-quarter percent change in revenue was **4.67%**[9] in Q2 FY2026 (ended Jun 2026) vs Q1 FY2026 (ended Mar 2026); AMD's year-over-year percent change in revenue was **45.74%**[10] in Q2 FY2026 (ended Jun 2026) vs Q2 FY2025 (ended Jun 2025).

Of NVDA and AMD, NVDA's revenue was highest: NVDA **USD 62,100,000,000.00**[11] (Q4 FY2026 (ended Jan 2026)), AMD **USD 11,200,000,000.00**[12] (Q2 FY2026 (ended Jun 2026)).

Of NVDA and AMD, NVDA's year-over-year percent change in revenue was highest: NVDA **57.89%**[13] (Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025)), AMD **45.74%**[14] (Q2 FY2026 (ended Jun 2026) vs Q2 FY2025 (ended Jun 2025)).

Difference in gross margin (gross profit / revenue) was **20.42 pp**[15], difference in operating margin (operating income / revenue) **50.82 pp**[16] and difference in net margin (net income / revenue) **43.90 pp**[17] in NVIDIA Corporation Q4 FY2026 (ended Jan 2026) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended Dec 2025).

> **Analyst inference on AMD** (NVDA highest on year-over-year percent change in revenue): Its growth is still strong, so the profitability gap does not mean it is stagnating.

_Cited:_

- [1] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [2] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [3] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [4] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [5] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [6] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%
- [7] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [8] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [9] **4.67%**: engine result: Advanced Micro Devices, Inc., Quarter-over-quarter percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28): 4.67%
- [10] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28): 45.74%
- [11] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [12] **USD 11,200,000,000.00**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): USD 11,200,000,000.00
- [13] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [14] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28): 45.74%
- [15] **20.42 pp**: engine result: Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 20.42 pp
- [16] **50.82 pp**: engine result: Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 50.82 pp
- [17] **43.90 pp**: engine result: Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 43.90 pp

### Answer B

**Q:** Compare NVDA with AMD.

*Engine answer: all 21 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 46,200,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 40,300,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 35,400,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) | 8.94% (Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26)) | 57.89% (Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26)) |
| Advanced Micro Devices, Inc. | USD 11,200,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 6,050,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,610,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,480,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | 54.02% (Q2 FY2026 (ended 2026-06-27)) | 14.38% (Q2 FY2026 (ended 2026-06-27)) | 13.21% (Q2 FY2026 (ended 2026-06-27)) | 4.67% (Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28)) | 45.74% (Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28)) |

- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 20.42 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 50.82 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 43.90 pp

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), and net margin (net income / revenue)): Its profitability is far stronger, converting more of each revenue dollar into profit at every level shown, though the periods compared are not aligned.

Of NVDA and AMD, NVDA's gross margin (gross profit / revenue) was highest: NVDA **74.40%**[1] (Q4 FY2026 (ended Jan 2026)), AMD **54.02%**[2] (Q2 FY2026 (ended Jun 2026)).

Of NVDA and AMD, NVDA's operating margin (operating income / revenue) was highest: NVDA **64.90%**[3] (Q4 FY2026 (ended Jan 2026)), AMD **14.38%**[4] (Q2 FY2026 (ended Jun 2026)).

Of NVDA and AMD, NVDA's net margin (net income / revenue) was highest: NVDA **57.00%**[5] (Q4 FY2026 (ended Jan 2026)), AMD **13.21%**[6] (Q2 FY2026 (ended Jun 2026)).

NVDA's revenue was **USD 62,100,000,000.00**[7], operating income **USD 40,300,000,000.00**[8] and net income **USD 35,400,000,000.00**[9] in Q4 FY2026 (ended Jan 2026).

AMD's revenue was **USD 11,200,000,000.00**[10], operating income **USD 1,610,000,000.00**[11] and net income **USD 1,480,000,000.00**[12] in Q2 FY2026 (ended Jun 2026).

Of NVDA and AMD, NVDA's year-over-year percent change in revenue was highest: NVDA **57.89%**[13] (Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025)), AMD **45.74%**[14] (Q2 FY2026 (ended Jun 2026) vs Q2 FY2025 (ended Jun 2025)).

Of NVDA and AMD, NVDA's quarter-over-quarter percent change in revenue was highest: NVDA **8.94%**[15] (Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025)), AMD **4.67%**[16] (Q2 FY2026 (ended Jun 2026) vs Q1 FY2026 (ended Mar 2026)).

Difference in gross margin (gross profit / revenue) was **20.42 pp**[17], difference in operating margin (operating income / revenue) **50.82 pp**[18] and difference in net margin (net income / revenue) **43.90 pp**[19] in NVIDIA Corporation Q4 FY2026 (ended Jan 2026) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended Dec 2025).

> **Analyst inference on NVDA:** Counterpoint: the latest quarters shown are not the same calendar period, so the comparison may reflect timing and not just relative strength.

_Cited:_

- [1] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [2] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [3] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [4] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [5] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [6] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%
- [7] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [8] **USD 40,300,000,000.00**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- [9] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- [10] **USD 11,200,000,000.00**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): USD 11,200,000,000.00
- [11] **USD 1,610,000,000.00**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2026 (ended 2026-06-27): USD 1,610,000,000.00
- [12] **USD 1,480,000,000.00**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2026 (ended 2026-06-27): USD 1,480,000,000.00
- [13] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [14] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28): 45.74%
- [15] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [16] **4.67%**: engine result: Advanced Micro Devices, Inc., Quarter-over-quarter percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28): 4.67%
- [17] **20.42 pp**: engine result: Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 20.42 pp
- [18] **50.82 pp**: engine result: Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 50.82 pp
- [19] **43.90 pp**: engine result: Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 43.90 pp

## 5. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 2 requested results verified*

*Revenue by company*

| | Revenue |
|---|---|
| NVIDIA Corporation | USD 130,497,000,000.00 (FY2025 (ended 2025-01-26)) |
| Apple Inc. | USD 416,161,000,000.00 (FY2025 (ended 2025-09-27)) |

_Block sources: S1._

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 2 requested results verified*

*Revenue by company*

| | Revenue |
|---|---|
| NVIDIA Corporation | USD 130,497,000,000.00 (FY2025 (ended 2025-01-26)) |
| Apple Inc. | USD 416,161,000,000.00 (FY2025 (ended 2025-09-27)) |

_Block sources: S1._

## 6. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments

### Answer A

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

No period was named, so the latest fiscal year is shown.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

No period was named, so the latest fiscal year is shown.

## 7. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

What should NVDA's Q1 fiscal 2026 gross margin be compared against? Year over year: Q1 fiscal 2026 vs Q1 fiscal 2025; Sequentially: Q1 fiscal 2026 vs Q4 fiscal 2025

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

Which comparison do you want for NVDA's gross margin change in Q1 fiscal 2026? Versus the prior quarter (Q4 fiscal 2025), sequential change in percentage points; Versus the same quarter a year earlier (Q1 fiscal 2025), year-over-year change in percentage points

## 8. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 33 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 46,200,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 40,300,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 35,400,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) | 8.94% (Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26)) | 57.89% (Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26)) |
| Advanced Micro Devices, Inc. | USD 11,200,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 6,050,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,610,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,480,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | 54.02% (Q2 FY2026 (ended 2026-06-27)) | 14.38% (Q2 FY2026 (ended 2026-06-27)) | 13.21% (Q2 FY2026 (ended 2026-06-27)) | 4.67% (Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28)) | 45.74% (Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28)) |
| Apple Inc. | USD 97,100,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 45,700,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 29,800,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 24,900,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | 47.06% (Q3 FY2026 (ended 2026-06-27)) | 30.69% (Q3 FY2026 (ended 2026-06-27)) | 25.64% (Q3 FY2026 (ended 2026-06-27)) | -1.62% (Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28)) | 3.26% (Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28)) |

- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 20.42 pp
- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Apple Inc. Q1 FY2026 (ended 2025-12-27): 27.36 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 50.82 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Apple Inc. Q1 FY2026 (ended 2025-12-27): 30.44 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 43.90 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Apple Inc. Q1 FY2026 (ended 2025-12-27): 27.71 pp

_Block sources: S1._

No period was named, so each company's latest reported quarter is shown.

_Analyst commentary:_ > **Analyst inference on NVDA** (revenue highest first: AAPL, NVDA, AMD; gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): It leads on both scale of profitability and margin quality, with the highest margins at every level, while it is also growing fast.

By revenue, highest first: AAPL **USD 97,100,000,000.00**[1] (Q3 FY2026 (ended Jun 2026)), NVDA **USD 62,100,000,000.00**[2] (Q4 FY2026 (ended Jan 2026)), AMD **USD 11,200,000,000.00**[3] (Q2 FY2026 (ended Jun 2026)).

By gross margin (gross profit / revenue), highest first: NVDA **74.40%**[4] (Q4 FY2026 (ended Jan 2026)), AMD **54.02%**[5] (Q2 FY2026 (ended Jun 2026)), AAPL **47.06%**[6] (Q3 FY2026 (ended Jun 2026)).

By operating margin (operating income / revenue), highest first: NVDA **64.90%**[7] (Q4 FY2026 (ended Jan 2026)), AAPL **30.69%**[8] (Q3 FY2026 (ended Jun 2026)), AMD **14.38%**[9] (Q2 FY2026 (ended Jun 2026)).

By net margin (net income / revenue), highest first: NVDA **57.00%**[10] (Q4 FY2026 (ended Jan 2026)), AAPL **25.64%**[11] (Q3 FY2026 (ended Jun 2026)), AMD **13.21%**[12] (Q2 FY2026 (ended Jun 2026)).

By year-over-year percent change in revenue, highest first: NVDA **57.89%**[13] (Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025)), AMD **45.74%**[14] (Q2 FY2026 (ended Jun 2026) vs Q2 FY2025 (ended Jun 2025)), AAPL **3.26%**[15] (Q3 FY2026 (ended Jun 2026) vs Q3 FY2025 (ended Jun 2025)).

NVDA's quarter-over-quarter percent change in revenue was **8.94%**[16] in Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025); AMD's quarter-over-quarter percent change in revenue was **4.67%**[17] in Q2 FY2026 (ended Jun 2026) vs Q1 FY2026 (ended Mar 2026); AAPL's quarter-over-quarter percent change in revenue was **-1.62%**[18] in Q3 FY2026 (ended Jun 2026) vs Q2 FY2026 (ended Mar 2026).

> **Analyst inference on AAPL** (revenue highest first: AAPL, NVDA, AMD; year-over-year percent change in revenue highest first: NVDA, AMD, AAPL): Its large revenue base comes with slow growth and a sequential decline, so scale is not translating into momentum.

> **Analyst inference on AMD** (gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD; year-over-year percent change in revenue highest first: NVDA, AMD, AAPL): Its decent gross margin is largely consumed by operating costs, leaving the weakest operating and net margins of the three despite fast growth.

> **Analyst inference on AAPL** (gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD): Counterpoint: its operating margin sits well above AMD's despite a lower gross margin, so it is more efficient below the gross line.

_Cited:_

- [1] **USD 97,100,000,000.00**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): USD 97,100,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [3] **USD 11,200,000,000.00**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): USD 11,200,000,000.00
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [5] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [6] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [8] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [9] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [10] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [11] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [12] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%
- [13] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [14] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28): 45.74%
- [15] **3.26%**: engine result: Apple Inc., Year-over-year percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28): 3.26%
- [16] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [17] **4.67%**: engine result: Advanced Micro Devices, Inc., Quarter-over-quarter percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28): 4.67%
- [18] **-1.62%**: engine result: Apple Inc., Quarter-over-quarter percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28): -1.62%

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 33 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 46,200,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 40,300,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | USD 35,400,000,000.00 (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) | 8.94% (Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26)) | 57.89% (Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26)) |
| Advanced Micro Devices, Inc. | USD 11,200,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 6,050,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,610,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | USD 1,480,000,000.00 (Q2 FY2026 (ended 2026-06-27)) | 54.02% (Q2 FY2026 (ended 2026-06-27)) | 14.38% (Q2 FY2026 (ended 2026-06-27)) | 13.21% (Q2 FY2026 (ended 2026-06-27)) | 4.67% (Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28)) | 45.74% (Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28)) |
| Apple Inc. | USD 97,100,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 45,700,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 29,800,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | USD 24,900,000,000.00 (Q3 FY2026 (ended 2026-06-27)) | 47.06% (Q3 FY2026 (ended 2026-06-27)) | 30.69% (Q3 FY2026 (ended 2026-06-27)) | 25.64% (Q3 FY2026 (ended 2026-06-27)) | -1.62% (Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28)) | 3.26% (Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28)) |

- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 20.42 pp
- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Apple Inc. Q1 FY2026 (ended 2025-12-27): 27.36 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 50.82 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Apple Inc. Q1 FY2026 (ended 2025-12-27): 30.44 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q4 FY2025 (ended 2025-12-27): 43.90 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 (ended 2026-01-25) minus Apple Inc. Q1 FY2026 (ended 2025-12-27): 27.71 pp

_Block sources: S1._

No period was named, so each company's latest reported quarter is shown.

_Analyst commentary:_ > **Analyst inference on NVDA** (revenue highest first: AAPL, NVDA, AMD; gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): It leads on both growth and profitability, with the highest margins at every level, while its revenue is smaller than the other large-cap's.

By revenue, highest first: AAPL **USD 97,100,000,000.00**[1] (Q3 FY2026 (ended Jun 2026)), NVDA **USD 62,100,000,000.00**[2] (Q4 FY2026 (ended Jan 2026)), AMD **USD 11,200,000,000.00**[3] (Q2 FY2026 (ended Jun 2026)).

By gross margin (gross profit / revenue), highest first: NVDA **74.40%**[4] (Q4 FY2026 (ended Jan 2026)), AMD **54.02%**[5] (Q2 FY2026 (ended Jun 2026)), AAPL **47.06%**[6] (Q3 FY2026 (ended Jun 2026)).

By operating margin (operating income / revenue), highest first: NVDA **64.90%**[7] (Q4 FY2026 (ended Jan 2026)), AAPL **30.69%**[8] (Q3 FY2026 (ended Jun 2026)), AMD **14.38%**[9] (Q2 FY2026 (ended Jun 2026)).

By net margin (net income / revenue), highest first: NVDA **57.00%**[10] (Q4 FY2026 (ended Jan 2026)), AAPL **25.64%**[11] (Q3 FY2026 (ended Jun 2026)), AMD **13.21%**[12] (Q2 FY2026 (ended Jun 2026)).

By year-over-year percent change in revenue, highest first: NVDA **57.89%**[13] (Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025)), AMD **45.74%**[14] (Q2 FY2026 (ended Jun 2026) vs Q2 FY2025 (ended Jun 2025)), AAPL **3.26%**[15] (Q3 FY2026 (ended Jun 2026) vs Q3 FY2025 (ended Jun 2025)).

NVDA's quarter-over-quarter percent change in revenue was **8.94%**[16] in Q4 FY2026 (ended Jan 2026) vs Q3 FY2026 (ended Oct 2025); AMD's quarter-over-quarter percent change in revenue was **4.67%**[17] in Q2 FY2026 (ended Jun 2026) vs Q1 FY2026 (ended Mar 2026); AAPL's quarter-over-quarter percent change in revenue was **-1.62%**[18] in Q3 FY2026 (ended Jun 2026) vs Q2 FY2026 (ended Mar 2026).

> **Analyst inference on AMD** (gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): Its gross margin is solid, but operating costs absorb much of it, leaving the thinnest operating and net margins of the three.

> **Analyst inference on AAPL** (revenue highest first: AAPL, NVDA, AMD; year-over-year percent change in revenue highest first: NVDA, AMD, AAPL): It has the largest revenue base and mid-tier margins, but the slowest growth and a sequential decline.

> **Analyst inference on NVDA** (revenue highest first: AAPL, NVDA, AMD; gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): The comparison is not like-for-like in timing: the quarters shown end at different dates, so the lead could differ on aligned periods.

_Cited:_

- [1] **USD 97,100,000,000.00**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): USD 97,100,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [3] **USD 11,200,000,000.00**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): USD 11,200,000,000.00
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [5] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [6] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [8] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [9] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [10] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [11] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [12] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%
- [13] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [14] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28): 45.74%
- [15] **3.26%**: engine result: Apple Inc., Year-over-year percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q3 FY2025 (ended 2025-06-28): 3.26%
- [16] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26): 8.94%
- [17] **4.67%**: engine result: Advanced Micro Devices, Inc., Quarter-over-quarter percent change in Revenue, Q2 FY2026 (ended 2026-06-27) vs Q1 FY2026 (ended 2026-03-28): 4.67%
- [18] **-1.62%**: engine result: Apple Inc., Quarter-over-quarter percent change in Revenue, Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28): -1.62%

## 9. missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments

### Answer A

**Q:** Break down AMD's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

### Answer B

**Q:** Break down AMD's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

## 10. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

*Engine answer: all 24 requested results verified*

*NVIDIA Corporation, Revenue*: Q1 FY2025 (ended 2024-04-28) USD 26,044,000,000.00; Q2 FY2025 (ended 2024-07-28) USD 30,040,000,000.00; Q3 FY2025 (ended 2024-10-27) USD 35,082,000,000.00; Q4 FY2025 (ended 2025-01-26) USD 39,331,000,000.00; Q1 FY2026 (ended 2025-04-27) USD 44,062,000,000.00; Q2 FY2026 (ended 2025-07-27) USD 46,743,000,000.00; Q3 FY2026 (ended 2025-10-26) USD 57,006,000,000.00; Q4 FY2026 (ended 2026-01-25) USD 62,100,000,000.00

*NVIDIA Corporation, Quarter-over-quarter percent change in Revenue*: Q2 FY2025 (ended 2024-07-28) vs Q1 FY2025 (ended 2024-04-28) 15.34%; Q3 FY2025 (ended 2024-10-27) vs Q2 FY2025 (ended 2024-07-28) 16.78%; Q4 FY2025 (ended 2025-01-26) vs Q3 FY2025 (ended 2024-10-27) 12.11%; Q1 FY2026 (ended 2025-04-27) vs Q4 FY2025 (ended 2025-01-26) 12.03%; Q2 FY2026 (ended 2025-07-27) vs Q1 FY2026 (ended 2025-04-27) 6.08%; Q3 FY2026 (ended 2025-10-26) vs Q2 FY2026 (ended 2025-07-27) 21.96%; Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26) 8.94%

- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q4 FY2026 (ended 2026-01-25) has the highest revenue of the 8 quarters ranked
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q1 FY2025 (ended 2024-04-28) has the lowest revenue of the 8 quarters ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (NVDA's revenue rose in every period; NVDA's revenue highest in Q4 FY2026 (ended Jan 2026)): Its revenue has climbed through every quarter shown and the latest quarter converts that scale into very high profitability, though growth is uneven.

NVDA's revenue rose in every period from Q1 FY2025 (ended Apr 2024) (**USD 26,044,000,000.00**[1]) to Q4 FY2026 (ended Jan 2026) (**USD 62,100,000,000.00**[2]).

NVDA's revenue was highest in Q4 FY2026 (ended Jan 2026), at **USD 62,100,000,000.00**[3], of the periods from Q1 FY2025 (ended Apr 2024) to Q4 FY2026 (ended Jan 2026).

NVDA's year-over-year percent change in revenue was **57.89%**[4] in Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025).

NVDA's gross margin (gross profit / revenue) was **74.40%**[5], operating margin (operating income / revenue) **64.90%**[6] and net margin (net income / revenue) **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

NVDA's gross profit was **USD 46,200,000,000.00**[8], operating income **USD 40,300,000,000.00**[9] and net income **USD 35,400,000,000.00**[10] in Q4 FY2026 (ended Jan 2026).

> **Analyst inference** (NVDA's revenue rose in every period): Its sequential growth has been uneven, and the most recent step up was slower than the one before it, which tempers the strength of the revenue climb.

**Q:** Compare it with AMD YTD.

> **Analyst inference on NVDA:** Its shares have done better than the peer's so far this year, though both gains are modest.

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[11], AMD **3.17%**[12] (YTD 2026: Dec 2025 close to Aug 2026 close).

According to a source dated Aug 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[13]

> **Analyst inference on AMD:** Its export-control charge was disclosed in an earlier year, so the data shown does not tie it to this year's weaker share performance.

_Block sources: S2, S3._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[14], AMD **3.17%**[15] (YTD 2026: Dec 2025 close to Aug 2026 close).

According to a source dated Aug 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[16]

> **Analyst inference on NVDA** (NVDA highest on price return): Its shares have outperformed the peer's this year, though both gains are modest.

> **Analyst inference on AMD:** The export-control charge was disclosed in an earlier year, so the data shown does not tie it to this year's weaker share performance.

> **Analyst inference on NVDA** (NVDA highest on price return): The lead rests on one price window with no fundamentals shown, so it does not show the gap in share performance reflects business differences.

_Block sources: S2, S3._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Cited:_

- [1] **USD 26,044,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): USD 26,044,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [3] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [4] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **USD 46,200,000,000.00**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- [9] **USD 40,300,000,000.00**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- [10] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- [11] **5.81%**: price series
- [12] **3.17%**: price series
- [13] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown
- [14] **5.81%**: price series
- [15] **3.17%**: price series
- [16] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown

### Answer B

**Q:** Analyze NVDA.

*Engine answer: all 24 requested results verified*

*NVIDIA Corporation, Revenue*: Q1 FY2025 (ended 2024-04-28) USD 26,044,000,000.00; Q2 FY2025 (ended 2024-07-28) USD 30,040,000,000.00; Q3 FY2025 (ended 2024-10-27) USD 35,082,000,000.00; Q4 FY2025 (ended 2025-01-26) USD 39,331,000,000.00; Q1 FY2026 (ended 2025-04-27) USD 44,062,000,000.00; Q2 FY2026 (ended 2025-07-27) USD 46,743,000,000.00; Q3 FY2026 (ended 2025-10-26) USD 57,006,000,000.00; Q4 FY2026 (ended 2026-01-25) USD 62,100,000,000.00

*NVIDIA Corporation, Quarter-over-quarter percent change in Revenue*: Q2 FY2025 (ended 2024-07-28) vs Q1 FY2025 (ended 2024-04-28) 15.34%; Q3 FY2025 (ended 2024-10-27) vs Q2 FY2025 (ended 2024-07-28) 16.78%; Q4 FY2025 (ended 2025-01-26) vs Q3 FY2025 (ended 2024-10-27) 12.11%; Q1 FY2026 (ended 2025-04-27) vs Q4 FY2025 (ended 2025-01-26) 12.03%; Q2 FY2026 (ended 2025-07-27) vs Q1 FY2026 (ended 2025-04-27) 6.08%; Q3 FY2026 (ended 2025-10-26) vs Q2 FY2026 (ended 2025-07-27) 21.96%; Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26) 8.94%

- NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q4 FY2026 (ended 2026-01-25) has the highest revenue of the 8 quarters ranked
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 (ended 2024-04-28) to Q4 FY2026 (ended 2026-01-25): Q1 FY2025 (ended 2024-04-28) has the lowest revenue of the 8 quarters ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (NVDA's revenue rose in every period): Revenue has grown across the eight quarters shown and the latest quarter is very profitable, though sequential growth has been uneven.

NVDA's revenue rose in every period from Q1 FY2025 (ended Apr 2024) (**USD 26,044,000,000.00**[1]) to Q4 FY2026 (ended Jan 2026) (**USD 62,100,000,000.00**[2]).

NVDA's revenue was **USD 62,100,000,000.00**[3] in Q4 FY2026 (ended Jan 2026); NVDA's revenue was **USD 39,331,000,000.00**[4] in Q4 FY2025 (ended Jan 2025); NVDA's year-over-year percent change in revenue was **57.89%**[5] in Q4 FY2026 (ended Jan 2026) vs Q4 FY2025 (ended Jan 2025).

NVDA's gross margin (gross profit / revenue) was **74.40%**[6], operating margin (operating income / revenue) **64.90%**[7] and net margin (net income / revenue) **57.00%**[8] in Q4 FY2026 (ended Jan 2026).

NVDA's gross profit was **USD 46,200,000,000.00**[9], operating income **USD 40,300,000,000.00**[10] and net income **USD 35,400,000,000.00**[11] in Q4 FY2026 (ended Jan 2026).

**Q:** Compare it with AMD YTD.

By price return, highest first: NVDA **5.81%**[12], AMD **3.17%**[13] (YTD 2026: Dec 2025 close to Aug 2026 close).

> **Analyst inference on NVDA** (price return highest first: NVDA, AMD): It has delivered the stronger share-price performance this year, though both gains are modest.

According to a source dated Aug 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[14]

> **Unverified analyst view on AMD** (not backed by the figures shown): The export-control charge is dated well before the YTD window, so it does not explain the current-year return gap and the data gives no reason for the trailing return.

_Block sources: S2, S3._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

By price return, highest first: NVDA **5.81%**[15], AMD **3.17%**[16] (YTD 2026: Dec 2025 close to Aug 2026 close).

According to a source dated Aug 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[17]

> **Analyst inference on NVDA** (price return highest first: NVDA, AMD): It has the stronger share-price performance this year, though both gains are modest.

> **Analyst inference on AMD** (price return highest first: NVDA, AMD): The export-control charge was disclosed well before the YTD window, so the evidence does not tie it to the current-year return gap.

_Block sources: S2, S3._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Cited:_

- [1] **USD 26,044,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): USD 26,044,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [3] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): USD 62,100,000,000.00
- [4] **USD 39,331,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): USD 39,331,000,000.00
- [5] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 (ended 2026-01-25) vs Q4 FY2025 (ended 2025-01-26): 57.89%
- [6] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [8] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [9] **USD 46,200,000,000.00**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): USD 46,200,000,000.00
- [10] **USD 40,300,000,000.00**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): USD 40,300,000,000.00
- [11] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): USD 35,400,000,000.00
- [12] **5.81%**: price series
- [13] **3.17%**: price series
- [14] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown
- [15] **5.81%**: price series
- [16] **3.17%**: price series
- [17] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown

## 11. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 8 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: Q2 FY2026 (ended 2026-06-27) 14.38%; Q1 FY2026 (ended 2026-03-28) 14.21%; Q4 FY2025 (ended 2025-12-27) 14.08%; Q3 FY2025 (ended 2025-09-27) 13.74%; Q2 FY2025 (ended 2025-06-28) -1.74%; Q1 FY2025 (ended 2025-03-29) 10.84%; Q4 FY2024 (ended 2024-12-28) 11.37%; Q3 FY2024 (ended 2024-09-28) 10.62%

_Block sources: S1._

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 8 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: Q2 FY2026 (ended 2026-06-27) 14.38%; Q1 FY2026 (ended 2026-03-28) 14.21%; Q4 FY2025 (ended 2025-12-27) 14.08%; Q3 FY2025 (ended 2025-09-27) 13.74%; Q2 FY2025 (ended 2025-06-28) -1.74%; Q1 FY2025 (ended 2025-03-29) 10.84%; Q4 FY2024 (ended 2024-12-28) 11.37%; Q3 FY2024 (ended 2024-09-28) 10.62%

_Block sources: S1._

## 12. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: all 8 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: Q2 FY2025 (ended 2025-06-28) -1.74%; Q1 FY2025 (ended 2025-03-29) 10.84%

*Advanced Micro Devices, Inc., Gross margin (gross profit / revenue)*: Q2 FY2025 (ended 2025-06-28) 39.80%; Q1 FY2025 (ended 2025-03-29) 50.22%

- Advanced Micro Devices, Inc., Quarter-over-quarter change in Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28) vs Q1 FY2025 (ended 2025-03-29): -12.58 pp
- Advanced Micro Devices, Inc., Quarter-over-quarter change in Gross margin (gross profit / revenue), Q2 FY2025 (ended 2025-06-28) vs Q1 FY2025 (ended 2025-03-29): -10.41 pp
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): USD -134,000,000.00
- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): USD 7,685,000,000.00

_Block sources: S1._

According to a source dated Aug 2025 on AMD, for Q2 FY2025 (ended 2025-06-28): **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[1]

_Block sources: S2._

_Cited:_

- [1] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: all 5 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: Q2 FY2025 (ended 2025-06-28) -1.74%; Q1 FY2025 (ended 2025-03-29) 10.84%

- Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): USD -134,000,000.00
- Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): USD 7,685,000,000.00
- Advanced Micro Devices, Inc., Quarter-over-quarter change in Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28) vs Q1 FY2025 (ended 2025-03-29): -12.58 pp

_Block sources: S1._

According to a source dated Aug 2025 on AMD, for Q2 FY2025 (ended 2025-06-28): **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[1]

_Block sources: S2._

_Cited:_

- [1] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown
