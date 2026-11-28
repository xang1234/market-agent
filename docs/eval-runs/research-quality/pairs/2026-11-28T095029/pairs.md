# Blinded answer pairs: 2026-11-28T095029

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

## 1. follow-up-memory (conversation)

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

_Analyst commentary:_ **Takeaway:** NVDA's FY2026 (ended 2026-01-25) profitability is exceptional. The shares have risen only modestly this year, up 5.81% from the Dec 31, 2025 close to the Aug 31, 2026 close, at a last close of $178.40.

**What the figures show**
- Revenue was $209.9B and gross profit $148.6B, a 70.78% gross margin.
- Operating income was $126.4B, a 60.21% operating margin. Gross profit less operating income implies about $22.2B of operating costs, roughly 10.6% of revenue.
- Net income was $112.5B, a 53.60% net margin. That is about 89% of operating income, so little profit is lost below the operating line.
- Only one fiscal year is on file, so I can't say whether margins are expanding or contracting. There are no peers on file to rank them against.
- The 5.81% year-to-date return is small next to this earnings power. The packet has no valuation multiples or consensus, so I can't say whether the price is cheap or full.

**Counterpoint:** The cash side of the picture is missing. Operating cash flow, capex and free cash flow for the latest fiscal year could not be established from eligible pre-cutoff inputs. The profit figures are therefore unconfirmed by cash generation, and the cash-conversion check could not be run.

**Gaps in the evidence:** there is no analyst consensus from the 7 days before the cutoff, no industry peers and no earnings release with a GAAP to non-GAAP reconciliation. There is also no 10-K, so I can't cite business or risk-factor claims.

_The figures in this text could not be checked against the sources just now._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no industry peers are on file (no source gives its industry). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ NVDA has outperformed AMD year to date, though only modestly. From the Dec 31, 2025 close to the Aug 31, 2026 close, NVDA returned **5.81%**[1] against **3.17%**[2] for AMD, a gap of about 2.64 percentage points.

- **NVDA:** closed the Aug 31, 2026 session at **$178.40**[3] after the **5.81%**[4] year-to-date return.
- **AMD:** closed the same session at **$162.30**[5] after the **3.17%**[6] return.

Both stocks are up, but neither gain is large for eight months. NVDA's lead is the only differentiator in this data.

**Counterpoint:** the comparison rests on two price returns between two closing dates. It says nothing about earnings, valuation or the drivers of either move, so a 2.64-point gap is thin grounds for a view on relative quality. A different start or end date could easily change the ranking.

Gaps in the data: no analyst consensus is on file for NVDA, no industry peers are on file, and no 10-K or earnings release reconciliation is on file. The comparison therefore cannot go beyond price.

_2 figures could not be traced to the sources read._

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

_Analyst commentary:_ **NVDA is far larger and much more profitable than AMD on the latest fiscal-year figures, but its year-to-date share price lead is small.**

**Fundamentals**
- **Scale:** NVDA's FY2026 (ended 2026-01-25) revenue was **$209.9B**[7], about **6.0x**[8][9] AMD's **$34.7B**[10] for FY2025 (ended 2025-12-27). Operating income was **$126.4B**[11] against **$3.4B**[12], and net income was **$112.5B**[13] against **$4.2B**[14].
- **Gross margin:** **70.78%**[15] for NVDA against **49.92%**[16] for AMD, a gap of about **20.9 points**[17][18].
- **Operating margin:** **60.21%**[19] against **9.78%**[20], a gap of about **50.4 points**[21][22]. This is the widest difference between the two.
- **Net margin:** **53.60%**[23] against **12.04%**[24], a gap of about **41.6 points**[25][26].

**Share price, year to date (Dec 31, 2025 close to Aug 31, 2026 close)**
- NVDA returned **5.81%**[27], with a last close of **$178.40**[28].
- AMD returned **3.17%**[29], with a last close of **$162.30**[30].
- NVDA leads by about **2.6 points**[31][32].

**Counterpoint**
- The market has not rewarded the fundamental gap much this year. A return gap of about **2.6 points**[33][34] is small next to a **50**[35][36]-point difference in operating margin.
- AMD's net income (**$4.2B**[37]) is above its operating income (**$3.4B**[38]), so its **12.04%**[39] net margin exceeds its **9.78%**[40] operating margin. Items below operating income helped AMD's bottom line. The packet does not say what they were.
- The fiscal years also end about a month apart, so the comparison is not perfectly aligned.

**Gaps**
- For AMD, there is no analyst consensus from the 7 days before the cutoff and no 10-K on file.
- Its own history shows no standout finding: one year in the operating margin window has no value, and inputs to its latest-year stock-based compensation and cash conversion measures were not certified.

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. AMD: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **5.81%**: price series
- [2] **3.17%**: price series
- [3] **$178.40**: price series
- [4] **5.81%**: price series
- [5] **$162.30**: price series
- [6] **3.17%**: price series
- [7] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [8] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [9] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [10] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [11] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [12] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [13] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [14] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [15] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [16] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [17] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [18] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [19] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [20] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [21] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [22] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [23] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [24] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [25] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [26] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [27] **5.81%**: price series
- [28] **$178.40**: price series
- [29] **3.17%**: price series
- [30] **$162.30**: price series
- [31] **5.81%**: price series
- [32] **3.17%**: price series
- [33] **5.81%**: price series
- [34] **3.17%**: price series
- [35] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [36] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [37] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [38] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [39] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [40] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

### Answer B

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

_Analyst commentary:_ > **Unverified analyst view** (not backed by the figures shown): It is extremely profitable at the operating level, with margins that show strong pricing power and cost leverage, but cash flow and valuation evidence is missing so the picture is incomplete.

NVDA's revenue was **$209.9B**[1] and gross profit **$148.6B**[2] in FY2026 (ended Jan 2026).

NVDA's operating income was **$126.4B**[3] and net income **$112.5B**[4] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[5], operating margin **60.21%**[6] and net margin **53.60%**[7] in FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close.

NVDA's last close was **$178.40**[9] in the Aug 31, 2026 session.

> **Unverified analyst view** (not backed by the figures shown): The modest year-to-date share gain is small beside the scale of its profitability, so the stock has not simply tracked earnings strength this year.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the price return ranking): Its price gain is larger than its peer's, so the market has rewarded it somewhat more so far, though both gains are modest.

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[10], AMD **3.17%**[11] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[12] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[13] in the Aug 31, 2026 session.

> **Analyst inference on AMD** (from the price return ranking): Its smaller gain is still positive, so the lead is a matter of degree and price return alone says nothing about business performance or valuation.

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

_Analyst commentary:_ > **Unverified analyst view on NVDA** (not backed by the figures shown): Its scale and profitability are far higher, and its year-to-date share price gain is also larger, so the market return gap is much smaller than the gap in business economics.

Of NVDA and AMD, NVDA's revenue was highest: NVDA **$209.9B**[14] (FY2026, ended Jan 2026), AMD **$34.7B**[15] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's gross margin was highest: NVDA **70.78%**[16] (FY2026, ended Jan 2026), AMD **49.92%**[17] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's operating margin was highest: NVDA **60.21%**[18] (FY2026, ended Jan 2026), AMD **9.78%**[19] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's net margin was highest: NVDA **53.60%**[20] (FY2026, ended Jan 2026), AMD **12.04%**[21] (FY2025, ended Dec 2025).

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[22], AMD **3.17%**[23] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[24] in the Aug 31, 2026 session; AMD's last close was **$162.30**[25] in the Aug 31, 2026 session.

AMD's operating income was **$3.4B**[26] and net income **$4.2B**[27] in FY2025 (ended Dec 2025); NVDA's operating income was **$126.4B**[28] and net income **$112.5B**[29] in FY2026 (ended Jan 2026).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its fiscal year ended earlier than the other company's, so the profit comparison covers different periods and the price gap may not reflect fundamentals alone.

_Block sources: S2._

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
- [22] **5.81%**: price series
- [23] **3.17%**: price series
- [24] **$178.40**: price series
- [25] **$162.30**: price series
- [26] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [27] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [28] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [29] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B

## 2. what-changed-gross-margin (what changed)

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

_Analyst commentary:_ NVDA's gross margin was **60.52%**[1] in Q1 FY2026 (ended Apr 2025); NVDA's gross margin was **73.03%**[2] in Q4 FY2025 (ended Jan 2025); NVDA's gross margin was **78.35%**[3] in Q1 FY2025 (ended Apr 2024).

NVDA's gross profit was highest in Q4 FY2025 (ended Jan 2025), at **$28.7B**[4], of the periods from Q1 FY2025 (ended Apr 2024) to Q1 FY2026 (ended Apr 2025).

The figures do not show why NVDA's gross margin changed.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file.

_Cited:_

- [1] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [2] **73.03%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- [3] **78.35%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- [4] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B

### Answer B

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

*Engine answer: all 3 requested results verified*

- NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B

_Block sources: S1._

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

_Analyst commentary:_ NVDA's gross margin fell sharply in Q1 FY2026: it was **60.52%**[1] [F4], down from **73.03%**[2] in Q4 FY2025 [F7] and **78.35%**[3] in Q1 FY2025 [F1]. That is about 12.5 points lower sequentially and about 17.8 points lower year over year.

- **Revenue grew while margin fell.** Q1 FY2026 revenue was **$44.1B**[4] [F6], versus **$39.3B**[5] in Q4 FY2025 [F9] and **$26.0B**[6] in Q1 FY2025 [F3]. That is roughly 12% sequential growth and about 70% year-over-year growth.
- **Gross profit dollars rose year over year but fell sequentially.** Gross profit was **$26.7B**[7] [F5], up from **$20.4B**[8] a year earlier [F2] but below Q4's **$28.7B**[9] [F8]. Revenue added $4.8B sequentially while gross profit fell about $2.0B, so the margin compression more than offset the higher sales.
- **The sequential drop is the weak point.** Q1 FY2026 was the lowest of the three periods shown, and ~~the decline was larger than the year-over-year revenue growth could absorb at the profit line~~ (the sequential margin decline was larger than the sequential revenue growth could absorb at the profit line, though year over year the revenue growth more than covered it).

**Counterpoint:** the figures show that margin compressed but not why. Absolute gross profit is still 31% above the year-ago quarter (**$26.7B**[10] against **$20.4B**[11]), so the business is earning more gross profit on a much larger base even at a lower margin. The packet holds no earnings release reconciliation and no 10-K read, so I can't tie the decline to any specific driver such as a charge or a product mix shift.

_7 figures could not be traced to the sources read._

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **60.52%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2026 (ended 2025-04-27): 60.52%
- [2] **73.03%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2025 (ended 2025-01-26): 73.03%
- [3] **78.35%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q1 FY2025 (ended 2024-04-28): 78.35%
- [4] **$44.1B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2026 (ended 2025-04-27): $44.1B
- [5] **$39.3B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2025 (ended 2025-01-26): $39.3B
- [6] **$26.0B**: engine result: NVIDIA Corporation, Revenue, Q1 FY2025 (ended 2024-04-28): $26.0B
- [7] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [8] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
- [9] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [10] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [11] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B

## 3. margin-trend-loss-quarter (margin trend)

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

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads. Standout findings for AMD went unread, as the turn reached its limit of reads.

### Answer B

**Q:** How have AMD's operating margins trended over the last eight quarters?

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2025 (ended 2025-03-29): 10.84%

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

_Block sources: S1._

_Analyst commentary:_ AMD's operating margin can't be traced across eight quarters from what's on file; only three data points exist, and they show a volatile, not a steady, picture.

- **Q1 FY2025 (ended 2025-03-29):** **10.84%**[1] [F2]
- **Q2 FY2025 (ended 2025-06-28):** **-1.74%**[2] [F3]
- **FY2025 full year (ended 2025-12-27):** **9.78%**[3] [F1]

The swing from Q1 to Q2 is 12.58 percentage points (**10.84%**[4] to **-1.74%**[5]). The full-year **9.78%**[6] is only about 1.06 points below Q1's level. Because the full year includes the negative Q2, the remaining quarters (Q3 and Q4) would have to have run at healthy margins to pull the annual figure back up. That is an inference from the arithmetic, and the quarterly figures themselves are not in the packet.

Q2 is the weak outlier against Q1 and the full year. The packet gives no cause for that dip, so I won't attribute one.

Counterpoint: the full-year **9.78%**[7] could suggest margins recovered after Q2, but ~~with only one quarterly figure on either side of the trough~~ (with only one quarterly figure before the trough and none after it) and no data for any other quarter, I can't confirm a recovery or any direction beyond FY2025.

Gaps: no AMD earnings release with the GAAP to non-GAAP reconciliation is on file, so I can't say whether the figures include adjustments. Certified AMD figures also went unread because the turn hit its read limit, which is why the quarterly series is incomplete.

_2 figures could not be traced to the sources read._

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. Certified figures for AMD went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **10.84%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2025 (ended 2025-03-29): 10.84%
- [2] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [3] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [4] **10.84%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2025 (ended 2025-03-29): 10.84%
- [5] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [6] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [7] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%

## 4. missing-segments (missing data)

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

*Engine answer: all 1 requested results verified*

- Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

_Block sources: S1._

_Analyst commentary:_ AMD's segment split isn't available here, so I can't break revenue down by segment. The only figure on hand is total revenue: **$34.7B**[1] for FY2025 (ended 2025-12-27) [F1].

That total is a single period for one company, so there is nothing to compare it against, and I can't say which segments are strong or weak.

The counterpoint is that the **$34.7B**[2] headline could hide very different trends underneath. A strong total can mask a weak segment, and the packet gives no way to test that.

Note on what's missing: AMD has no 10-K on file, so there are no business or risk factor claims from one. A segment breakdown would need that filing or another segment-level source.

AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [2] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

## 5. missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Answer A

**Q:** What is AMD's free cash flow?

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal year: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal year: gap (blocked_by_dependency): A required input or calculation is unavailable.

*Engine answer: 0 of 3 requested results verified*

- Advanced Micro Devices, Inc., Operating cash flow, latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Capital expenditures (PP&E cash payments), latest fiscal quarter: gap (missing_input): No eligible input was public before the knowledge cutoff.
- Advanced Micro Devices, Inc., Free cash flow (OCF less PP&E cash capex), latest fiscal quarter: gap (blocked_by_dependency): A required input or calculation is unavailable.

_Analyst commentary:_ I can't give you AMD's free cash flow from the data available here. The figure isn't in the packet, and I won't estimate one.

- **Latest fiscal year:** operating cash flow and PP&E cash capex have no eligible input public before the knowledge cutoff, so free cash flow (operating cash flow less PP&E cash capex) can't be calculated.
- **Latest fiscal quarter:** the same applies. Operating cash flow and capex are both unavailable, so quarterly free cash flow can't be calculated either.

That leaves nothing to compare across periods, and nothing on AMD's cash generation relative to peers. A counterpoint grounded in the data isn't possible, since no cash-flow figure exists to challenge or support one.

To answer this, you would need AMD's cash flow statement from its latest annual and quarterly filings. Free cash flow is operating cash flow minus purchases of property and equipment.

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

## 6. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

_Analyst commentary:_ NVDA's segment breakdown isn't available here; the only figure I can give is total revenue of **$209.9B**[1] for FY2026 (ended 2026-01-25) [F1]. That figure can't be split into segments or compared with other periods or companies from this data.

Note on what's missing: NVDA has no 10-K on file, so there are no business or risk factor claims from one.

The counterpoint is that the total hides the mix. Without segment figures, it isn't possible to tell whether the **$209.9B**[2] is driven by one business or spread across several, so the headline number alone says nothing about concentration.

NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

### Answer B

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

## 7. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

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

_Analyst commentary:_ **Takeaway:** The most recent quarter with figures in the packet is Q4 FY2026 (ended 2026-01-25), and its profitability is very strong. Revenue was **$62.1B**[1], with **$46.2B**[2] of gross profit, **$40.3B**[3] of operating income and **$35.4B**[4] of net income.

- **Margins:** Gross margin was **74.40%**[5], operating margin **64.90%**[6] and net margin **57.00%**[7]. Operating costs implied by the gross-to-operating gap were about $5.9B (gross profit less operating income), or roughly **9.5 points**[8][9][10] of revenue. Operating income less net income was about $4.9B.
- **Stock:** NVDA closed at **$178.40**[11] on Aug 31, 2026, a **5.81%**[12] price return year to date from the Dec 31, 2025 close. That is modest next to the quarter's margins, though the packet gives no valuation or consensus data to explain it.
- **Counterpoint:** The profit figures are not backed by cash figures. Diluted EPS, operating cash flow, capex and free cash flow for the latest fiscal quarter are unavailable, so I can't check whether a **57.00%**[13] net margin turned into cash. The packet also flags that cash conversion and stock-based compensation relative to free cash flow could not be certified for the latest year.
- **Not on file:** There is no analyst consensus from the 7 days before the cutoff, so I can't say whether the quarter beat or missed expectations. No earnings release was read for the GAAP to non-GAAP reconciliation, so the margins above are as reported in the packet only. There is also no year-over-year or sequential comparison, so I can't say whether margins are rising or falling.

_2 figures could not be traced to the sources read._

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [9] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [10] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [11] **$178.40**: price series
- [12] **5.81%**: price series
- [13] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

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

_Analyst commentary:_ > **Analyst inference:** The latest reported quarter with verified data shows very high profitability at every level, though cash flow and per-share data are not available to confirm earnings quality.

NVDA's revenue was **$62.1B**[1] in Q4 FY2026 (ended Jan 2026).

NVDA's gross profit was **$46.2B**[2] and gross margin **74.40%**[3] in Q4 FY2026 (ended Jan 2026).

NVDA's operating income was **$40.3B**[4] and operating margin **64.90%**[5] in Q4 FY2026 (ended Jan 2026).

NVDA's net income was **$35.4B**[6] and net margin **57.00%**[7] in Q4 FY2026 (ended Jan 2026).

NVDA's price return was **5.81%**[8] in the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close; NVDA's last close was **$178.40**[9] in the Aug 31, 2026 session.

> **Unverified analyst view** (not backed by the figures shown): A counterpoint is that the quarter shown is not clearly the most recent one before the cutoff, and the absence of cash flow, capex and EPS data means the profit strength is not checked against cash generation.

_Block sources: S2._

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [4] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [5] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [6] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [8] **5.81%**: price series
- [9] **$178.40**: price series

## 8. peer-three (peer comparison)

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

_Analyst commentary:_ **Takeaway:** ~~NVDA leads on both scale of growth-era profitability and margins.~~ (NVDA leads on margins, while AAPL leads on revenue scale.) AAPL has the largest revenue base but much lower margins than NVDA. AMD is the smallest and the least profitable at the operating line.

**Revenue (latest fiscal year shown):**
- AAPL: **$416.2B**[1] (FY2025, ended 2025-09-27)
- NVDA: **$209.9B**[2] (FY2026, ended 2026-01-25)
- AMD: **$34.7B**[3] (FY2025, ended 2025-12-27)

AAPL's revenue is about **2x**[4][5] NVDA's and roughly **12x**[6][7] AMD's. NVDA's is about **6x**[8][9] AMD's.

**Margins:**

| | Gross | Operating | Net |
|---|---|---|---|
| NVDA | **70.78%**[10] | **60.21%**[11] | **53.60%**[12] |
| AAPL | **46.91%**[13] | **31.97%**[14] | **26.92%**[15] |
| AMD | **49.92%**[16] | **9.78%**[17] | **12.04%**[18] |

- NVDA is strongest at every level. Its operating margin is about 28 points above AAPL's and about 50 points above AMD's.
- AMD's gross margin (**49.92%**[19]) is slightly above AAPL's (**46.91%**[20]), by about 3 points. But AMD keeps only **9.78%**[21] at the operating line versus AAPL's **31.97%**[22], so its costs below gross profit absorb far more of revenue.
- AMD's net margin (**12.04%**[23]) is above its operating margin (**9.78%**[24]), meaning non-operating items or taxes added to profit. The packet does not say which.

**Counterpoint:** NVDA's periods are not identical to the others. Its fiscal year ended January 2026, while AAPL's ended September 2025 and AMD's December 2025, so the comparison is not perfectly like-for-like. The gap is also wide enough that the ranking is unlikely to depend on timing alone. Even so, AAPL's operating profit is larger in dollar terms than AMD's by a wide margin (about **31.97%**[25] of **$416.2B**[26] versus **9.78%**[27] of **$34.7B**[28]), so a lower margin does not mean lower earnings power.

_3 figures could not be traced to the sources read._

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [4] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [5] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [6] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [7] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [8] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [9] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [10] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [11] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [12] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [13] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [14] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [15] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [16] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [17] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [18] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [19] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [20] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [21] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [22] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [23] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [24] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [25] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [26] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [27] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [28] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its margins are the strongest of the three at every level, while its revenue sits between the other two, so it converts sales into profit most efficiently.

By revenue, highest first: AAPL **$416.2B**[1], NVDA **$209.9B**[2], AMD **$34.7B**[3].

By gross margin, highest first: NVDA **70.78%**[4], AMD **49.92%**[5], AAPL **46.91%**[6].

By operating margin, highest first: NVDA **60.21%**[7], AAPL **31.97%**[8], AMD **9.78%**[9].

By net margin, highest first: NVDA **53.60%**[10], AAPL **26.92%**[11], AMD **12.04%**[12].

> **Unverified analyst view on AAPL** (not backed by the figures shown): Its much larger revenue base comes with lower gross margin than the other two, so its profit rests on scale and operating discipline rather than gross margin.

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

## 9. ticker-page-compare (explicit subject)

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, and operating margin rankings): Its profitability is far stronger on every margin shown, while the other's larger revenue base does not translate into higher margins.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

> **Unverified analyst view on AAPL** (not backed by the figures shown): Its earnings are comparable in dollar terms to the other's despite lower margins, and the year-to-date price returns are close, so the market has not separated them much.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL has no 10-K on file, so no business or risk factor claims from one. NVDA has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [4] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [5] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [6] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%

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

_Analyst commentary:_ NVDA is the far more profitable business per dollar of sales, while AAPL matches it on absolute profit with about twice the revenue. Share performance this year has been nearly identical.

- **Scale:** AAPL's FY2025 revenue (ended 2025-09-27) was **$416.2B**[1], against **$209.9B**[2] for NVDA's FY2026 (ended 2026-01-25). That makes AAPL about **1.98x**[3][4] larger. The fiscal years end four months apart, so the comparison is not like-for-like in timing.
- **Margins:** NVDA leads on every line.
  - Gross margin was **70.78%**[5] vs **46.91%**[6], a gap of **23.87 points**[7][8].
  - Operating margin was **60.21%**[9] vs **31.97%**[10], a gap of **28.24 points**[11][12].
  - Net margin was **53.60%**[13] vs **26.92%**[14], a gap of **26.68 points**[15][16].
- **Profit dollars:** Net income is essentially level, at **$112.5B**[17] for NVDA and **$112.0B**[18] for AAPL. NVDA converts about twice as much of each revenue dollar into net income.
- **Share price:** Year to date through Aug 31, 2026, NVDA returned **5.81%**[19] and AAPL **5.34%**[20], a **0.47**[21][22]-point gap. The last closes were **$178.40**[23] for NVDA and **$231.60**[24] for AAPL.

**Counterpoint:** The margin gap doesn't translate into more profit for NVDA. AAPL's operating income was **$133.0B**[25] vs **$126.4B**[26] for NVDA, so AAPL is ahead by **$6.6B**[27][28] in absolute terms. Its profit rests on a revenue base twice as large, so NVDA's margin advantage is offset by AAPL's scale.

Operating cash flow, capex and free cash flow could not be computed for either company. No analyst consensus is on file for either in the week before the cutoff.

_Block sources: S2._

AAPL: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file.

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [4] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [5] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [6] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [7] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [8] **46.91%**: engine result: Apple Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-09-27): 46.91%
- [9] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [10] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [11] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [12] **31.97%**: engine result: Apple Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-09-27): 31.97%
- [13] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [14] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [15] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [16] **26.92%**: engine result: Apple Inc., Net margin (net income / revenue), FY2025 (ended 2025-09-27): 26.92%
- [17] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [18] **$112.0B**: engine result: Apple Inc., Net income, FY2025 (ended 2025-09-27): $112.0B
- [19] **5.81%**: price series
- [20] **5.34%**: price series
- [21] **5.81%**: price series
- [22] **5.34%**: price series
- [23] **$178.40**: price series
- [24] **$231.60**: price series
- [25] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [26] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [27] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [28] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B

## 10. peer-two (peer comparison)

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

_Analyst commentary:_ NVDA is far larger and more profitable than AMD on every reported measure, and its shares have also returned slightly more this year. The gap is in scale and margins, not in share-price performance.

- **Scale:** NVDA's FY2026 revenue (ended 2026-01-25) was **$209.9B**[1], about **6.0x**[2][3] AMD's FY2025 revenue of **$34.7B**[4]. ~~The gap widens down the income statement.~~ (The gap widens from revenue to operating income, then narrows somewhat at net income.) NVDA's operating income was **$126.4B**[5] against AMD's **$3.4B**[6], roughly **37x**[7][8]. Its net income was **$112.5B**[9] against **$4.2B**[10], roughly **27x**[11][12].
- **Margins:** NVDA's gross margin was **70.78%**[13] against AMD's **49.92%**[14], a **20.9**[15][16]-point gap. Operating margin was **60.21%**[17] against **9.78%**[18], a **50.4**[19][20]-point gap. Net margin was **53.60%**[21] against **12.04%**[22], a **41.6**[23][24]-point gap. AMD keeps about half of revenue as gross profit but converts little of it into operating profit.
- **Share prices:** From the Dec 31, 2025 close to the Aug 31, 2026 close, NVDA returned **5.81%**[25] (last close **$178.40**[26]) and AMD **3.17%**[27] (last close **$162.30**[28]). That is a **2.6**[29][30]-point gap, small next to the difference in fundamentals.

**Counterpoint:** AMD's net income ($4.2B) is above its operating income ($3.4B), so its 12.04% net margin is higher than its 9.78% operating margin. Some of its bottom-line profit therefore comes from outside operations, and the figures don't say what. AMD's operating margin is the cleaner read on its core business. The two companies' fiscal years also end about a month apart, so the comparison is not exactly like-for-like.

**Notes on what's missing:** Operating cash flow, capex and free cash flow for both companies could not be calculated, because no eligible input was public before the cutoff. No analyst consensus is on file for either company. This comparison therefore rests on income-statement figures and price returns only.

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no industry peers are on file (no source gives its industry). Standout findings for NVDA went unread, as the turn reached its limit of reads. Standout findings for AMD went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [2] **$209.9B**: engine result: NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B
- [3] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [4] **$34.7B**: engine result: Advanced Micro Devices, Inc., Revenue, FY2025 (ended 2025-12-27): $34.7B
- [5] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [6] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [7] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [8] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [9] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [10] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [11] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [12] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B
- [13] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [14] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [15] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [16] **49.92%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), FY2025 (ended 2025-12-27): 49.92%
- [17] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [18] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [19] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [20] **9.78%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), FY2025 (ended 2025-12-27): 9.78%
- [21] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [22] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [23] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [24] **12.04%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), FY2025 (ended 2025-12-27): 12.04%
- [25] **5.81%**: price series
- [26] **$178.40**: price series
- [27] **3.17%**: price series
- [28] **$162.30**: price series
- [29] **5.81%**: price series
- [30] **3.17%**: price series

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

_Analyst commentary:_ > **Unverified analyst view on NVDA** (not backed by the figures shown): Its fiscal-year profitability is far stronger than its peer's at every level shown, though the year to date share price gain is only modestly higher.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

NVDA's revenue was **$209.9B**[9], operating income **$126.4B**[10] and net income **$112.5B**[11] in FY2026 (ended Jan 2026).

AMD's revenue was **$34.7B**[12], operating income **$3.4B**[13] and net income **$4.2B**[14] in FY2025 (ended Dec 2025).

By price return, highest first: NVDA **5.81%**[15], AMD **3.17%**[16] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[17] in the Aug 31, 2026 session; AMD's last close was **$162.30**[18] in the Aug 31, 2026 session.

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income above operating income means its net margin overstates the profitability of its core operations.

_Block sources: S2._

AMD: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA has no 10-K on file, so no business or risk factor claims from one. AMD has no 10-K on file, so no business or risk factor claims from one.

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

_Analyst commentary:_ The packet shows that AMD's Q2 FY2025 (ended 2025-06-28) operating margin was **-1.74%**[1], but it does not say why. Operating expenses absorbed more than the gross profit. No management statement of the cause is on file, so I won't offer one.

- **Top line and gross profit:** revenue was **$7.7B**[2] [F1] and gross profit was **$3.1B**[3] [F2]. That implies a gross margin of roughly **40%**[4][5].
- **Operating result:** operating income was **-$134.0M**[6] [F3], which gives the **-1.74%**[7] operating margin [F6]. Gross profit minus operating income implies operating costs of about **$3.2B**[8][9], slightly above gross profit. This is arithmetic on rounded figures, not a stated breakdown.
- **Comparison:** the packet holds only this one quarter for AMD, so I can't say whether the margin fell from earlier periods or how it compares with peers.

**Counterpoint:** the operating loss did not reach the bottom line. Net income was positive at **$872.0M**[10] [F4], about **$1.0B**[11][12] above operating income. The packet does not say what bridged that gap, and diluted EPS is not available [F5]. The negative operating margin is therefore not the same as an unprofitable quarter on a net basis.

**Notes on the packet:** no earnings release with a GAAP to non-GAAP reconciliation is on file, and AMD has no 10-K on file, so there are no business or risk-factor claims to draw on.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. Certified figures for AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [2] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [3] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [4] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [5] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [6] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [7] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [8] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [9] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [10] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- [11] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M
- [12] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M

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

_Analyst commentary:_ > **Analyst inference:** Its operating margin turned negative because gross profit was not enough to cover operating costs in the quarter, but the data shown does not say which expense or charge drove this.

AMD's revenue was **$7.7B**[1] and gross profit **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[3] and operating margin **-1.74%**[4] in Q2 FY2025 (ended Jun 2025).

AMD's net income was **$872.0M**[5] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** The positive net income shows the operating loss did not translate into a bottom-line loss, so the negative margin may not reflect the whole earnings picture.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. Standout findings for AMD went unread, as the turn reached its limit of reads. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [4] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%
- [5] **$872.0M**: engine result: Advanced Micro Devices, Inc., Net income, Q2 FY2025 (ended 2025-06-28): $872.0M

## 12. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): Its revenue is the larger of the two, so it operates from a bigger revenue base.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on NVDA:** The two fiscal years end at different times, so the revenue comparison does not cover the same twelve months.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

_Analyst commentary:_ Apple's fiscal 2025 revenue was roughly **3.2x**[1][2] Nvidia's: AAPL reported **$416.2B**[3] (FY ended 2025-09-27) against NVDA's **$130.5B**[4] (FY ended 2025-01-26). That is a gap of about $285.7B.

- **NVDA:** **$130.5B**[5] in FY2025 [F1].
- **AAPL:** **$416.2B**[6] in FY2025 [F2].
- **Relative size:** NVDA's revenue is about **31%**[7][8] of AAPL's (**$130.5B**[9] ÷ **$416.2B**[10]).

**Counterpoint:** the two fiscal years are not aligned. NVDA's FY2025 ended in January 2025, while AAPL's ended in September 2025, about eight months later. The packet gives only one year for each company, so it cannot show growth or margins. The size comparison is therefore not like-for-like on timing, and it says nothing about which business is growing faster.

_1 figure could not be traced to the sources read._

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [3] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [4] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [5] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [6] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [7] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [8] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [9] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B
- [10] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
