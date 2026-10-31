# Blinded answer pairs: 2026-10-27T110325

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

## 1. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

*Engine answer: all 24 requested results verified*

*NVIDIA Corporation, Revenue*: Q1 FY2025 USD 26,044,000,000.00; Q2 FY2025 USD 30,040,000,000.00; Q3 FY2025 USD 35,082,000,000.00; Q4 FY2025 USD 39,331,000,000.00; Q1 FY2026 USD 44,062,000,000.00; Q2 FY2026 USD 46,743,000,000.00; Q3 FY2026 USD 57,006,000,000.00; Q4 FY2026 USD 62,100,000,000.00

*NVIDIA Corporation, Quarter-over-quarter percent change in Revenue*: Q2 FY2025 vs Q1 FY2025 15.34%; Q3 FY2025 vs Q2 FY2025 16.78%; Q4 FY2025 vs Q3 FY2025 12.11%; Q1 FY2026 vs Q4 FY2025 12.03%; Q2 FY2026 vs Q1 FY2026 6.08%; Q3 FY2026 vs Q2 FY2026 21.96%; Q4 FY2026 vs Q3 FY2026 8.94%

- NVIDIA Corporation, Gross profit, Q4 FY2026: USD 46,200,000,000.00
- NVIDIA Corporation, Operating income, Q4 FY2026: USD 40,300,000,000.00
- NVIDIA Corporation, Net income, Q4 FY2026: USD 35,400,000,000.00
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%
- NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 to Q4 FY2026: Q4 FY2026 has the highest revenue of the 8 quarters ranked
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 to Q4 FY2026: Q1 FY2025 has the lowest revenue of the 8 quarters ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (NVDA's revenue rose in every period): Its latest quarter is the strongest of the eight shown, with revenue still climbing and very high margins, though sequential growth has been uneven.

NVDA's revenue rose in every period from Q1 FY2025 (**USD 26,044,000,000.00**[1]) to Q4 FY2026 (**USD 62,100,000,000.00**[2]).

NVDA's revenue was **USD 62,100,000,000.00**[3] in Q4 FY2026; NVDA's year-over-year percent change in revenue was **57.89%**[4] in Q4 FY2026 vs Q4 FY2025; NVDA's quarter-over-quarter percent change in revenue was **8.94%**[5] in Q4 FY2026 vs Q3 FY2026.

NVDA's gross margin (gross profit / revenue) was **74.40%**[6], operating margin (operating income / revenue) **64.90%**[7] and net margin (net income / revenue) **57.00%**[8] in Q4 FY2026.

The figures do not show why NVDA's quarter-over-quarter percent change in revenue changed.

> **Analyst inference** (NVDA's revenue rose in every period): Its sequential growth has cooled after a sharp surge, even as revenue keeps setting new highs, so the counterpoint is that momentum is slowing at the margin.

_Cited:_

- [1] **USD 26,044,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025: USD 26,044,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026: USD 62,100,000,000.00
- [3] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026: USD 62,100,000,000.00
- [4] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- [5] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 vs Q3 FY2026: 8.94%
- [6] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- [8] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%

### Answer B

**Q:** Analyze NVDA's latest quarter.

NVDA's revenue was **$62.1B**[1], gross profit **$46.2B**[2] and operating income **$40.3B**[3] in Q4 2026 (ended Jan 2026).

NVDA's net income was **$35.4B**[4], net margin **57.0%**[5], gross margin **74.4%**[6] and operating margin **64.9%**[7] in Q4 2026 (ended Jan 2026).

NVDA's revenue growth (QoQ) was **8.9%**[8] and revenue growth (YoY) **57.9%**[9] in Q4 2026 (ended Jan 2026).

NVDA's revenue rose in every period from Q1 2025 (**$26.0B**[10]) to Q4 2026 (**$62.1B**[11]).

The figures do not show why NVDA's revenue growth (QoQ) changed.

> **Analyst inference** (NVDA's revenue rose in every period): Its latest quarter shows very high profitability on a much larger revenue base, with growth still strong year over year.

> **Analyst inference:** Counterpoint: sequential growth in the latest quarter was slower than in the prior quarter, so the pace of expansion is not steady.

_Block sources: S1, S2._

*[metric_row] Latest quarter (Q4 2026)*: Revenue $62.1B, Gross profit $46.2B, Operating income $40.3B, Net income $35.4B, Gross margin 74.4%, Operating margin 64.9%, Net margin 57.0%, Revenue growth (QoQ) 8.9%, Revenue growth (YoY) 57.9%

_Block sources: S1._

*[revenue_bars] Quarterly revenue*: Q1 2025 $26.0B, Q2 2025 $30.0B, Q3 2025 $35.1B, Q4 2025 $39.3B, Q1 2026 $44.1B, Q2 2026 $46.7B, Q3 2026 $57.0B, Q4 2026 $62.1B

_Block sources: S1._

_Cited:_

- [1] **$62.1B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [2] **$46.2B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [3] **$40.3B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [4] **$35.4B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [5] **57.0%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [6] **74.4%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [7] **64.9%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [8] **8.9%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [9] **57.9%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [10] **$26.0B**: fact: Q1 2025 (2024-01-29 to 2024-04-28), currency, as of 2026-09-01T00:00:00.000Z
- [11] **$62.1B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z

## 2. missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments

### Answer A

**Q:** Break down AMD's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

### Answer B

**Q:** Break down AMD's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

## 3. peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Answer A

**Q:** Compare NVDA with AMD.

*Engine answer: all 21 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026) | USD 46,200,000,000.00 (Q4 FY2026) | USD 40,300,000,000.00 (Q4 FY2026) | USD 35,400,000,000.00 (Q4 FY2026) | 74.40% (Q4 FY2026) | 64.90% (Q4 FY2026) | 57.00% (Q4 FY2026) | 8.94% (Q4 FY2026 vs Q3 FY2026) | 57.89% (Q4 FY2026 vs Q4 FY2025) |
| Advanced Micro Devices, Inc. | USD 11,200,000,000.00 (Q2 FY2026) | USD 6,050,000,000.00 (Q2 FY2026) | USD 1,610,000,000.00 (Q2 FY2026) | USD 1,480,000,000.00 (Q2 FY2026) | 54.02% (Q2 FY2026) | 14.38% (Q2 FY2026) | 13.21% (Q2 FY2026) | 4.67% (Q2 FY2026 vs Q1 FY2026) | 45.74% (Q2 FY2026 vs Q2 FY2025) |

- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q4 FY2025: 20.42 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q4 FY2025: 50.82 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q4 FY2025: 43.90 pp

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), and net margin (net income / revenue)): Its profitability is far stronger than its peer's, with higher margins at every level, though the two are measured over different quarters.

Of NVDA and AMD, NVDA's gross margin (gross profit / revenue) was highest: NVDA **74.40%**[1] (Q4 FY2026), AMD **54.02%**[2] (Q2 FY2026).

Of NVDA and AMD, NVDA's operating margin (operating income / revenue) was highest: NVDA **64.90%**[3] (Q4 FY2026), AMD **14.38%**[4] (Q2 FY2026).

Of NVDA and AMD, NVDA's net margin (net income / revenue) was highest: NVDA **57.00%**[5] (Q4 FY2026), AMD **13.21%**[6] (Q2 FY2026).

Of NVDA and AMD, NVDA's revenue was highest: NVDA **USD 62,100,000,000.00**[7] (Q4 FY2026), AMD **USD 11,200,000,000.00**[8] (Q2 FY2026).

NVDA's quarter-over-quarter percent change in revenue was **8.94%**[9] in Q4 FY2026 vs Q3 FY2026; NVDA's year-over-year percent change in revenue was **57.89%**[10] in Q4 FY2026 vs Q4 FY2025.

AMD's quarter-over-quarter percent change in revenue was **4.67%**[11] in Q2 FY2026 vs Q1 FY2026; AMD's year-over-year percent change in revenue was **45.74%**[12] in Q2 FY2026 vs Q2 FY2025.

> **Analyst inference on NVDA:** Its growth is faster on both a sequential and yearly basis, adding to the profitability lead.

> **Analyst inference on AMD** (NVDA highest on gross margin (gross profit / revenue)): Its growth is still strong, which is a counterpoint to the profitability gap, but its margins remain well below its peer's.

_Cited:_

- [1] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- [2] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026: 54.02%
- [3] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- [4] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026: 14.38%
- [5] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%
- [6] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026: 13.21%
- [7] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026: USD 62,100,000,000.00
- [8] **USD 11,200,000,000.00**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026: USD 11,200,000,000.00
- [9] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 vs Q3 FY2026: 8.94%
- [10] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- [11] **4.67%**: engine result: Advanced Micro Devices, Inc., Quarter-over-quarter percent change in Revenue, Q2 FY2026 vs Q1 FY2026: 4.67%
- [12] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 vs Q2 FY2025: 45.74%

### Answer B

**Q:** Compare NVDA with AMD.

> **Analyst inference on NVDA** (revenue highest first: NVDA, AMD; gross margin highest first: NVDA, AMD; net margin highest first: NVDA, AMD; revenue growth (YoY) highest first: NVDA, AMD): It is the larger, faster-growing and more profitable business of the two, with higher margins at both gross and net levels.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.8%**[3] (FY2026, ended Jan 2026), AMD **49.9%**[4] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.6%**[5] (FY2026, ended Jan 2026), AMD **12.0%**[6] (FY2025, ended Dec 2025).

By revenue growth (YoY), highest first: NVDA **60.9%**[7] (FY2026, ended Jan 2026), AMD **34.5%**[8] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **6.6%**[9], AMD **3.58%**[10] (Dec 2025 to Aug 2026).

According to a source dated Aug 2025, effective Jun 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[11]

> **Analyst inference on AMD:** Its margins may understate underlying profitability, given the export-control charge management disclosed.

The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.

_Block sources: S1, S2, S3._

*Side by side: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025)*

| | Revenue | Gross Margin | Net Margin | Revenue Growth (YoY) |
|---|---|---|---|---|
| NVDA | $209.9B | 70.8% | 53.6% | 60.9% |
| AMD | $34.7B | 49.9% | 12.0% | 34.5% |

_Block sources: S1._

*[perf_comparison] Price return (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Cited:_

- [1] **$209.9B**: fact: FY 2026 (2025-01-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [2] **$34.7B**: fact: FY 2025 (2024-12-29 to 2025-12-27), currency, as of 2026-09-01T00:00:00.000Z
- [3] **70.8%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [4] **49.9%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [5] **53.6%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [6] **12.0%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [7] **60.9%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [8] **34.5%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [9] **6.6%**: price series
- [10] **3.58%**: price series
- [11] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown

## 4. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

### Answer B

**Q:** Break down NVDA's revenue by segment.

This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.

## 5. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments

### Answer A

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

### Answer B

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

No period was named, so the latest fiscal year is shown.

## 6. follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Answer A

**Q:** Analyze NVDA.

*Engine answer: all 24 requested results verified*

*NVIDIA Corporation, Revenue*: Q1 FY2025 USD 26,044,000,000.00; Q2 FY2025 USD 30,040,000,000.00; Q3 FY2025 USD 35,082,000,000.00; Q4 FY2025 USD 39,331,000,000.00; Q1 FY2026 USD 44,062,000,000.00; Q2 FY2026 USD 46,743,000,000.00; Q3 FY2026 USD 57,006,000,000.00; Q4 FY2026 USD 62,100,000,000.00

*NVIDIA Corporation, Quarter-over-quarter percent change in Revenue*: Q2 FY2025 vs Q1 FY2025 15.34%; Q3 FY2025 vs Q2 FY2025 16.78%; Q4 FY2025 vs Q3 FY2025 12.11%; Q1 FY2026 vs Q4 FY2025 12.03%; Q2 FY2026 vs Q1 FY2026 6.08%; Q3 FY2026 vs Q2 FY2026 21.96%; Q4 FY2026 vs Q3 FY2026 8.94%

- NVIDIA Corporation, Gross profit, Q4 FY2026: USD 46,200,000,000.00
- NVIDIA Corporation, Operating income, Q4 FY2026: USD 40,300,000,000.00
- NVIDIA Corporation, Net income, Q4 FY2026: USD 35,400,000,000.00
- NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%
- NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 to Q4 FY2026: Q4 FY2026 has the highest revenue of the 8 quarters ranked
- NVIDIA Corporation, Revenue ranked across periods, Q1 FY2025 to Q4 FY2026: Q1 FY2025 has the lowest revenue of the 8 quarters ranked

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference** (NVDA's revenue rose in every period): Revenue has climbed every quarter to a new high with very high profitability, though growth is uneven, so it looks like a strong compounding business whose pace of sequential gains is irregular.

NVDA's revenue rose in every period from Q1 FY2025 (**USD 26,044,000,000.00**[1]) to Q4 FY2026 (**USD 62,100,000,000.00**[2]).

NVDA's year-over-year percent change in revenue was **57.89%**[3] in Q4 FY2026 vs Q4 FY2025.

NVDA's gross margin (gross profit / revenue) was **74.40%**[4], operating margin (operating income / revenue) **64.90%**[5] and net margin (net income / revenue) **57.00%**[6] in Q4 FY2026.

NVDA's gross profit was **USD 46,200,000,000.00**[7], operating income **USD 40,300,000,000.00**[8] and net income **USD 35,400,000,000.00**[9] in Q4 FY2026.

The figures do not show why NVDA's quarter-over-quarter percent change in revenue changed.

> **Unverified analyst view** (not backed by the figures shown): Sequential growth in the latest quarter was slower than in the prior quarter, so the pace of acceleration is not steady and the high revenue base may be harder to extend.

**Q:** Compare it with AMD YTD.

By price return, highest first: NVDA **5.81%**[10], AMD **3.17%**[11] (YTD 2026: Dec 2025 close to Aug 2026 close).

> **Analyst inference on NVDA** (price return highest first: NVDA, AMD): It has delivered the stronger year-to-date share price performance of the two, though both gains are modest.

According to a source dated Aug 2025, effective Jun 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[12]

> **Unverified analyst view on AMD** (not backed by the figures shown): The export-control charge it disclosed is a past-year issue and does not by itself explain its smaller year-to-date return, so the gap should not be read as a verdict on fundamentals.

_Block sources: S2, S3._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

By price return, highest first: NVDA **5.81%**[13], AMD **3.17%**[14] (YTD 2026: Dec 2025 close to Aug 2026 close).

According to a source dated Aug 2025, effective Jun 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[15]

> **Analyst inference on NVDA** (price return highest first: NVDA, AMD): It has delivered the stronger year-to-date share price performance, though both gains are modest.

> **Analyst inference on AMD:** The export-control charge dates from an earlier period, and the evidence does not show it as the cause of its smaller year-to-date return.

_Block sources: S2, S3._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Cited:_

- [1] **USD 26,044,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025: USD 26,044,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026: USD 62,100,000,000.00
- [3] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- [5] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- [6] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%
- [7] **USD 46,200,000,000.00**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026: USD 46,200,000,000.00
- [8] **USD 40,300,000,000.00**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026: USD 40,300,000,000.00
- [9] **USD 35,400,000,000.00**: engine result: NVIDIA Corporation, Net income, Q4 FY2026: USD 35,400,000,000.00
- [10] **5.81%**: price series
- [11] **3.17%**: price series
- [12] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown
- [13] **5.81%**: price series
- [14] **3.17%**: price series
- [15] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown

### Answer B

**Q:** Analyze NVDA.

> **Analyst inference** (NVDA's revenue rose in every period): Its growth is strong and margins are very high, though sequential growth has been uneven across the quarters shown.

NVDA's revenue rose in every period from Q1 2025 (**$26.0B**[1]) to Q4 2026 (**$62.1B**[2]).

NVDA's revenue was **$62.1B**[3], revenue growth (YoY) **57.9%**[4] and revenue growth (QoQ) **8.9%**[5] in Q4 2026 (ended Jan 2026).

NVDA's gross margin was **74.4%**[6], operating margin **64.9%**[7], net margin **57.0%**[8] and net income **$35.4B**[9] in Q4 2026 (ended Jan 2026).

The figures do not show why NVDA's revenue growth (QoQ) changed.

_Block sources: S1, S2._

*[metric_row] Latest quarter (Q4 2026)*: Revenue $62.1B, Gross profit $46.2B, Operating income $40.3B, Net income $35.4B, Gross margin 74.4%, Operating margin 64.9%, Net margin 57.0%, Revenue growth (QoQ) 8.9%, Revenue growth (YoY) 57.9%

_Block sources: S1._

*[revenue_bars] Quarterly revenue*: Q1 2025 $26.0B, Q2 2025 $30.0B, Q3 2025 $35.1B, Q4 2025 $39.3B, Q1 2026 $44.1B, Q2 2026 $46.7B, Q3 2026 $57.0B, Q4 2026 $62.1B

_Block sources: S1._

**Q:** Compare it with AMD YTD.

Of NVDA and AMD, NVDA's revenue was highest: NVDA **$209.9B**[10] (FY2026, ended Jan 2026), AMD **$34.7B**[11] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's gross margin was highest: NVDA **70.8%**[12] (FY2026, ended Jan 2026), AMD **49.9%**[13] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's net margin was highest: NVDA **53.6%**[14] (FY2026, ended Jan 2026), AMD **12.0%**[15] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's revenue growth (YoY) was highest: NVDA **60.9%**[16] (FY2026, ended Jan 2026), AMD **34.5%**[17] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[18], AMD **3.17%**[19] (YTD 2026: Dec 2025 close to Aug 2026 close).

According to a source dated Aug 2025, effective Jun 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[20]

> **Unverified analyst view on NVDA** (not backed by the figures shown): It leads on scale, growth, profitability and YTD share performance, so the fundamental edge is reflected in the stock's stronger return.

> **Unverified analyst view on AMD** (not backed by the figures shown): Its margins may understate underlying profitability given the export-control charges management cited, which tempers the gap.

The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.

_Block sources: S1, S2, S3._

*Side by side: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025)*

| | Revenue | Gross Margin | Net Margin | Revenue Growth (YoY) |
|---|---|---|---|---|
| NVDA | $209.9B | 70.8% | 53.6% | 60.9% |
| AMD | $34.7B | 49.9% | 12.0% | 34.5% |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

**Q:** Explain the differences and show the evidence.

> **Analyst inference on NVDA** (revenue highest first: NVDA, AMD; gross margin highest first: NVDA, AMD; net margin highest first: NVDA, AMD; revenue growth (YoY) highest first: NVDA, AMD; price return highest first: NVDA, AMD): It leads on scale, growth, profitability and year-to-date share performance, so the fundamental edge is matched by a stronger stock return.

By revenue, highest first: NVDA **$209.9B**[21] (FY2026, ended Jan 2026), AMD **$34.7B**[22] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.8%**[23] (FY2026, ended Jan 2026), AMD **49.9%**[24] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.6%**[25] (FY2026, ended Jan 2026), AMD **12.0%**[26] (FY2025, ended Dec 2025).

By revenue growth (YoY), highest first: NVDA **60.9%**[27] (FY2026, ended Jan 2026), AMD **34.5%**[28] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**[29], AMD **3.17%**[30] (YTD 2026: Dec 2025 close to Aug 2026 close).

According to a source dated Aug 2025, effective Jun 2025 on AMD: **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**[31]

> **Unverified analyst view on AMD** (not backed by the figures shown): Its margins may be understated by the export-control charges management cited, which tempers the gap.

> **Analyst inference on NVDA** (revenue highest first: NVDA, AMD; price return highest first: NVDA, AMD): The stock return lead is much narrower than the fundamental lead, and the fiscal years compared end at different times, so the comparison is not perfectly aligned.

The periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.

_Block sources: S1, S2, S3._

*Side by side: NVDA FY2026 (ended Jan 2026), AMD FY2025 (ended Dec 2025)*

| | Revenue | Gross Margin | Net Margin | Revenue Growth (YoY) |
|---|---|---|---|---|
| NVDA | $209.9B | 70.8% | 53.6% | 60.9% |
| AMD | $34.7B | 49.9% | 12.0% | 34.5% |

_Block sources: S1._

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Cited:_

- [1] **$26.0B**: fact: Q1 2025 (2024-01-29 to 2024-04-28), currency, as of 2026-09-01T00:00:00.000Z
- [2] **$62.1B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [3] **$62.1B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [4] **57.9%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [5] **8.9%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [6] **74.4%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [7] **64.9%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [8] **57.0%**: fact: Q4 2026 (2025-10-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [9] **$35.4B**: fact: Q4 2026 (2025-10-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [10] **$209.9B**: fact: FY 2026 (2025-01-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [11] **$34.7B**: fact: FY 2025 (2024-12-29 to 2025-12-27), currency, as of 2026-09-01T00:00:00.000Z
- [12] **70.8%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [13] **49.9%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [14] **53.6%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [15] **12.0%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [16] **60.9%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [17] **34.5%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [18] **5.81%**: price series
- [19] **3.17%**: price series
- [20] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown
- [21] **$209.9B**: fact: FY 2026 (2025-01-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [22] **$34.7B**: fact: FY 2025 (2024-12-29 to 2025-12-27), currency, as of 2026-09-01T00:00:00.000Z
- [23] **70.8%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [24] **49.9%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [25] **53.6%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [26] **12.0%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [27] **60.9%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [28] **34.5%**: fact: FY 2025 (2024-12-29 to 2025-12-27), ratio, as of 2026-09-01T00:00:00.000Z
- [29] **5.81%**: price series
- [30] **3.17%**: price series
- [31] **As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.**: filed claim, quoted as shown

## 7. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

Which comparison do you mean by 'what changed' in NVDA's Q1 fiscal 2026 gross margin? Change versus the prior quarter (Q4 fiscal 2025); Change versus the same quarter a year earlier (Q1 fiscal 2025); Just the reported Q1 fiscal 2026 gross margin, with no comparison

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

What should NVDA's Q1 fiscal 2026 gross margin be compared against to show what changed? Compare with the prior quarter (Q4 fiscal 2025); Compare with the same quarter a year earlier (Q1 fiscal 2025); Just report the Q1 fiscal 2026 gross margin with no comparison

## 8. ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Answer A

**Q:** Compare with NVDA. (opened from the AAPL page)

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's revenue growth (YoY) was highest: AAPL **6.4%**[3] (FY2025, ended Sep 2025), NVDA **60.9%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.9%**[5] (FY2025, ended Sep 2025), NVDA **70.8%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.9%**[7] (FY2025, ended Sep 2025), NVDA **53.6%**[8] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's price return was highest: AAPL **6.05%**[9], NVDA **6.6%**[10] (Dec 2025 to Aug 2026).

> **Analyst inference** (AAPL highest on revenue; NVDA highest on revenue growth (YoY), gross margin, net margin, and price return): NVDA looks like the stronger operator, with faster growth and richer margins on a smaller revenue base, while the share price gains were similar.

> **Analyst inference on AAPL** (AAPL highest on revenue; NVDA highest on revenue growth (YoY), gross margin, and net margin): Its larger revenue base is not matched by faster growth or richer margins, so the scale lead alone does not make it the stronger operator.

The periods compared end at different times, so they do not line up: AAPL's FY2025 ended Sep 2025 and NVDA's FY2026 ended Jan 2026.

_Block sources: S1, S2._

*Side by side: AAPL FY2025 (ended Sep 2025), NVDA FY2026 (ended Jan 2026); fiscal years end 4 months apart*

| | Revenue | Gross Margin | Net Margin | Revenue Growth (YoY) |
|---|---|---|---|---|
| AAPL | $416.2B | 46.9% | 26.9% | 6.4% |
| NVDA | $209.9B | 70.8% | 53.6% | 60.9% |

_Block sources: S1._

*[perf_comparison] Price return (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Cited:_

- [1] **$416.2B**: fact: FY 2025 (2024-09-29 to 2025-09-27), currency, as of 2026-09-01T00:00:00.000Z
- [2] **$209.9B**: fact: FY 2026 (2025-01-27 to 2026-01-25), currency, as of 2026-09-01T00:00:00.000Z
- [3] **6.4%**: fact: FY 2025 (2024-09-29 to 2025-09-27), ratio, as of 2026-09-01T00:00:00.000Z
- [4] **60.9%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [5] **46.9%**: fact: FY 2025 (2024-09-29 to 2025-09-27), ratio, as of 2026-09-01T00:00:00.000Z
- [6] **70.8%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [7] **26.9%**: fact: FY 2025 (2024-09-29 to 2025-09-27), ratio, as of 2026-09-01T00:00:00.000Z
- [8] **53.6%**: fact: FY 2026 (2025-01-27 to 2026-01-25), ratio, as of 2026-09-01T00:00:00.000Z
- [9] **6.05%**: price series
- [10] **6.6%**: price series

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

*Engine answer: all 18 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| Apple Inc. | USD 97,100,000,000.00 (Q3 FY2026) | USD 45,700,000,000.00 (Q3 FY2026) | USD 29,800,000,000.00 (Q3 FY2026) | USD 24,900,000,000.00 (Q3 FY2026) | 47.06% (Q3 FY2026) | 30.69% (Q3 FY2026) | 25.64% (Q3 FY2026) | -1.62% (Q3 FY2026 vs Q2 FY2026) | 3.26% (Q3 FY2026 vs Q3 FY2025) |
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026) | USD 46,200,000,000.00 (Q4 FY2026) | USD 40,300,000,000.00 (Q4 FY2026) | USD 35,400,000,000.00 (Q4 FY2026) | 74.40% (Q4 FY2026) | 64.90% (Q4 FY2026) | 57.00% (Q4 FY2026) | 8.94% (Q4 FY2026 vs Q3 FY2026) | 57.89% (Q4 FY2026 vs Q4 FY2025) |

_Block sources: S1._

Not covered by this answer: Apple Inc.'s lead over NVIDIA Corporation in each margin, as no quarter NVIDIA Corporation reported ends within half a quarter of Apple Inc.'s Q3 FY2026.

_Analyst commentary:_ > **Analyst inference on NVDA** (NVDA highest on gross margin (gross profit / revenue), operating margin (operating income / revenue), net margin (net income / revenue), and year-over-year percent change in revenue): It converts revenue to profit far more efficiently and is growing much faster, so on these figures it is the stronger operator, though its quarter is a different fiscal period.

Of AAPL and NVDA, NVDA's gross margin (gross profit / revenue) was highest: AAPL **47.06%**[1] (Q3 FY2026), NVDA **74.40%**[2] (Q4 FY2026).

Of AAPL and NVDA, NVDA's operating margin (operating income / revenue) was highest: AAPL **30.69%**[3] (Q3 FY2026), NVDA **64.90%**[4] (Q4 FY2026).

Of AAPL and NVDA, NVDA's net margin (net income / revenue) was highest: AAPL **25.64%**[5] (Q3 FY2026), NVDA **57.00%**[6] (Q4 FY2026).

Of AAPL and NVDA, NVDA's year-over-year percent change in revenue was highest: AAPL **3.26%**[7] (Q3 FY2026 vs Q3 FY2025), NVDA **57.89%**[8] (Q4 FY2026 vs Q4 FY2025).

AAPL's quarter-over-quarter percent change in revenue was **-1.62%**[9] in Q3 FY2026 vs Q2 FY2026; NVDA's quarter-over-quarter percent change in revenue was **8.94%**[10] in Q4 FY2026 vs Q3 FY2026.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **USD 97,100,000,000.00**[11] (Q3 FY2026), NVDA **USD 62,100,000,000.00**[12] (Q4 FY2026).

AAPL's gross profit was **USD 45,700,000,000.00**[13] in Q3 FY2026; NVDA's gross profit was **USD 46,200,000,000.00**[14] in Q4 FY2026.

> **Analyst inference on AAPL** (AAPL highest on revenue): Its larger revenue base shows scale, but it yields less gross profit and lower margins than the peer.

_Cited:_

- [1] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026: 47.06%
- [2] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- [3] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026: 30.69%
- [4] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- [5] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026: 25.64%
- [6] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%
- [7] **3.26%**: engine result: Apple Inc., Year-over-year percent change in Revenue, Q3 FY2026 vs Q3 FY2025: 3.26%
- [8] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- [9] **-1.62%**: engine result: Apple Inc., Quarter-over-quarter percent change in Revenue, Q3 FY2026 vs Q2 FY2026: -1.62%
- [10] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 vs Q3 FY2026: 8.94%
- [11] **USD 97,100,000,000.00**: engine result: Apple Inc., Revenue, Q3 FY2026: USD 97,100,000,000.00
- [12] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026: USD 62,100,000,000.00
- [13] **USD 45,700,000,000.00**: engine result: Apple Inc., Gross profit, Q3 FY2026: USD 45,700,000,000.00
- [14] **USD 46,200,000,000.00**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026: USD 46,200,000,000.00

## 9. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: 2 of 3 requested results verified*

*Revenue by company*

| | Revenue, FY2025 |
|---|---|
| NVIDIA Corporation | USD 130,497,000,000.00 |
| Apple Inc. | USD 416,161,000,000.00 |

- Revenue ranking, FY2025: gap (incompatible_period): The cohort members cover different periods.

_Block sources: S1._

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: 2 of 3 requested results verified*

*Revenue by company*

| | Revenue, FY2025 |
|---|---|
| NVIDIA Corporation | USD 130,497,000,000.00 |
| Apple Inc. | USD 416,161,000,000.00 |

- Revenue ranking, FY2025: gap (incompatible_period): The cohort members cover different periods.

_Block sources: S1._

## 10. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 8 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: latest fiscal quarter 14.38%; fiscal quarter 1 before latest 14.21%; fiscal quarter 2 before latest 14.08%; fiscal quarter 3 before latest 13.74%; fiscal quarter 4 before latest -1.74%; fiscal quarter 5 before latest 10.84%; fiscal quarter 6 before latest 11.37%; fiscal quarter 7 before latest 10.62%

_Block sources: S1._

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 8 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: latest fiscal quarter 14.38%; fiscal quarter 1 before latest 14.21%; fiscal quarter 2 before latest 14.08%; fiscal quarter 3 before latest 13.74%; fiscal quarter 4 before latest -1.74%; fiscal quarter 5 before latest 10.84%; fiscal quarter 6 before latest 11.37%; fiscal quarter 7 before latest 10.62%

_Block sources: S1._

## 11. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 33 requested results verified*

*Revenue, Gross profit, Operating income, Net income, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue), Quarter-over-quarter percent change in Revenue, Year-over-year percent change in Revenue by company*

| | Revenue | Gross profit | Operating income | Net income | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) | Quarter-over-quarter percent change in Revenue | Year-over-year percent change in Revenue |
|---|---|---|---|---|---|---|---|---|---|
| NVIDIA Corporation | USD 62,100,000,000.00 (Q4 FY2026) | USD 46,200,000,000.00 (Q4 FY2026) | USD 40,300,000,000.00 (Q4 FY2026) | USD 35,400,000,000.00 (Q4 FY2026) | 74.40% (Q4 FY2026) | 64.90% (Q4 FY2026) | 57.00% (Q4 FY2026) | 8.94% (Q4 FY2026 vs Q3 FY2026) | 57.89% (Q4 FY2026 vs Q4 FY2025) |
| Advanced Micro Devices, Inc. | USD 11,200,000,000.00 (Q2 FY2026) | USD 6,050,000,000.00 (Q2 FY2026) | USD 1,610,000,000.00 (Q2 FY2026) | USD 1,480,000,000.00 (Q2 FY2026) | 54.02% (Q2 FY2026) | 14.38% (Q2 FY2026) | 13.21% (Q2 FY2026) | 4.67% (Q2 FY2026 vs Q1 FY2026) | 45.74% (Q2 FY2026 vs Q2 FY2025) |
| Apple Inc. | USD 97,100,000,000.00 (Q3 FY2026) | USD 45,700,000,000.00 (Q3 FY2026) | USD 29,800,000,000.00 (Q3 FY2026) | USD 24,900,000,000.00 (Q3 FY2026) | 47.06% (Q3 FY2026) | 30.69% (Q3 FY2026) | 25.64% (Q3 FY2026) | -1.62% (Q3 FY2026 vs Q2 FY2026) | 3.26% (Q3 FY2026 vs Q3 FY2025) |

- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q4 FY2025: 20.42 pp
- Difference in Gross margin (gross profit / revenue), NVIDIA Corporation Q4 FY2026 minus Apple Inc. Q1 FY2026: 27.36 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q4 FY2025: 50.82 pp
- Difference in Operating margin (operating income / revenue), NVIDIA Corporation Q4 FY2026 minus Apple Inc. Q1 FY2026: 30.44 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 minus Advanced Micro Devices, Inc. Q4 FY2025: 43.90 pp
- Difference in Net margin (net income / revenue), NVIDIA Corporation Q4 FY2026 minus Apple Inc. Q1 FY2026: 27.71 pp

_Block sources: S1._

No period was named, so each company's latest reported quarter is shown.

_Analyst commentary:_ > **Analyst inference on NVDA** (revenue highest first: AAPL, NVDA, AMD; gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): It has the strongest profile of the three, with the highest margins at every level and fast revenue growth, though the quarters compared are not aligned.

By revenue, highest first: AAPL **USD 97,100,000,000.00**[1] (Q3 FY2026), NVDA **USD 62,100,000,000.00**[2] (Q4 FY2026), AMD **USD 11,200,000,000.00**[3] (Q2 FY2026).

By gross margin (gross profit / revenue), highest first: NVDA **74.40%**[4] (Q4 FY2026), AMD **54.02%**[5] (Q2 FY2026), AAPL **47.06%**[6] (Q3 FY2026).

By operating margin (operating income / revenue), highest first: NVDA **64.90%**[7] (Q4 FY2026), AAPL **30.69%**[8] (Q3 FY2026), AMD **14.38%**[9] (Q2 FY2026).

By net margin (net income / revenue), highest first: NVDA **57.00%**[10] (Q4 FY2026), AAPL **25.64%**[11] (Q3 FY2026), AMD **13.21%**[12] (Q2 FY2026).

By year-over-year percent change in revenue, highest first: NVDA **57.89%**[13] (Q4 FY2026 vs Q4 FY2025), AMD **45.74%**[14] (Q2 FY2026 vs Q2 FY2025), AAPL **3.26%**[15] (Q3 FY2026 vs Q3 FY2025).

NVDA's quarter-over-quarter percent change in revenue was **8.94%**[16] in Q4 FY2026 vs Q3 FY2026; AMD's quarter-over-quarter percent change in revenue was **4.67%**[17] in Q2 FY2026 vs Q1 FY2026; AAPL's quarter-over-quarter percent change in revenue was **-1.62%**[18] in Q3 FY2026 vs Q2 FY2026.

> **Analyst inference on AMD** (gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): Its gross margin is above AAPL's, but its operating and net margins are lower, so operating costs absorb much of the gross profit.

> **Analyst inference on AAPL** (revenue highest first: AAPL, NVDA, AMD; year-over-year percent change in revenue highest first: NVDA, AMD, AAPL): It has the largest revenue base but the slowest growth and a sequential decline, so scale is not translating into momentum.

> **Analyst inference on NVDA** (revenue highest first: AAPL, NVDA, AMD; gross margin (gross profit / revenue) highest first: NVDA, AMD, AAPL; operating margin (operating income / revenue) highest first: NVDA, AAPL, AMD; net margin (net income / revenue) highest first: NVDA, AAPL, AMD): The caveat is that the three companies are shown for different fiscal quarters, so the margin gaps are not like-for-like and could shift on aligned periods.

_Cited:_

- [1] **USD 97,100,000,000.00**: engine result: Apple Inc., Revenue, Q3 FY2026: USD 97,100,000,000.00
- [2] **USD 62,100,000,000.00**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026: USD 62,100,000,000.00
- [3] **USD 11,200,000,000.00**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026: USD 11,200,000,000.00
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026: 74.40%
- [5] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026: 54.02%
- [6] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026: 47.06%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026: 64.90%
- [8] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026: 30.69%
- [9] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026: 14.38%
- [10] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026: 57.00%
- [11] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026: 25.64%
- [12] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026: 13.21%
- [13] **57.89%**: engine result: NVIDIA Corporation, Year-over-year percent change in Revenue, Q4 FY2026 vs Q4 FY2025: 57.89%
- [14] **45.74%**: engine result: Advanced Micro Devices, Inc., Year-over-year percent change in Revenue, Q2 FY2026 vs Q2 FY2025: 45.74%
- [15] **3.26%**: engine result: Apple Inc., Year-over-year percent change in Revenue, Q3 FY2026 vs Q3 FY2025: 3.26%
- [16] **8.94%**: engine result: NVIDIA Corporation, Quarter-over-quarter percent change in Revenue, Q4 FY2026 vs Q3 FY2026: 8.94%
- [17] **4.67%**: engine result: Advanced Micro Devices, Inc., Quarter-over-quarter percent change in Revenue, Q2 FY2026 vs Q1 FY2026: 4.67%
- [18] **-1.62%**: engine result: Apple Inc., Quarter-over-quarter percent change in Revenue, Q3 FY2026 vs Q2 FY2026: -1.62%

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

Which margin should be compared for NVDA, AMD and AAPL alongside revenue? The comparison would use each company's latest annual fiscal period. Gross margin; Operating margin; Net margin; All three: gross, operating and net margin

## 12. cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Answer A

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: all 3 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: Q2 FY2025 -1.74%; Q1 FY2025 10.84%

- Advanced Micro Devices, Inc., Quarter-over-quarter change in Operating margin (operating income / revenue), Q2 FY2025 vs Q1 FY2025: -12.58%

_Block sources: S1._

Not covered by this answer: the cause of these figures.

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

*Engine answer: all 5 requested results verified*

*Advanced Micro Devices, Inc., Operating margin (operating income / revenue)*: Q2 FY2025 -1.74%; Q1 FY2025 10.84%

- Advanced Micro Devices, Inc., Quarter-over-quarter change in Operating margin (operating income / revenue), Q2 FY2025 vs Q1 FY2025: -12.58%
- Advanced Micro Devices, Inc., Operating income, Q2 FY2025: USD -134,000,000.00
- Advanced Micro Devices, Inc., Revenue, Q2 FY2025: USD 7,685,000,000.00

_Block sources: S1._

Not covered by this answer: the cause of these figures.
