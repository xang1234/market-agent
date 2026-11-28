# Blinded answer pairs: 2026-11-28T095039

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

## 1. missing-cash-flow (missing data)

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

Commentary is unavailable for this answer.

### Answer B

**Q:** What is AMD's free cash flow?

I can't give you AMD's free cash flow because the data on file has no cash flow statement. There is no operating cash flow, capex, or working capital detail for AMD, and I won't estimate it from outside knowledge.

What I do have for AMD is the income statement and prices. For the trailing four quarters (Q3 FY2025 through Q2 FY2026, ended 2026-06-27):

- **Revenue:** $41,446M (9,246 + 10,300 + 10,700 + 11,200)
- **Operating income:** $5,850M (1,270 + 1,450 + 1,520 + 1,610)
- **Net income:** $5,473M (1,243 + 1,350 + 1,400 + 1,480)

These are accrual-based earnings, not cash. Operating income or net income could differ materially from free cash flow, depending on capex, working capital swings, stock compensation, and other non-cash items. None of that is in the data.

One relevant item is that AMD's Q2 FY2025 filing cites about $800M of inventory and related charges from the MI308 export restrictions. That was a quarter ended 2025-06-28, so it falls outside the trailing four quarters above. The filing doesn't say how it affected cash.

To get an FCF figure, we'd need AMD's cash flow statements (operating cash flow and capital expenditures) pulled into the file. I can then calculate trailing FCF, FCF margin, and FCF yield against the 162.30 last price, though I'd also need a share count for the per-share and yield figures.

## 2. peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Answer A

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, net margin, and price return rankings): It is the larger and far more profitable business at every level shown, while its share price has risen only modestly more than its peer's this year.

By revenue, highest first: NVDA **$209.9B**[1] (FY2026, ended Jan 2026), AMD **$34.7B**[2] (FY2025, ended Dec 2025).

By gross margin, highest first: NVDA **70.78%**[3] (FY2026, ended Jan 2026), AMD **49.92%**[4] (FY2025, ended Dec 2025).

By operating margin, highest first: NVDA **60.21%**[5] (FY2026, ended Jan 2026), AMD **9.78%**[6] (FY2025, ended Dec 2025).

By net margin, highest first: NVDA **53.60%**[7] (FY2026, ended Jan 2026), AMD **12.04%**[8] (FY2025, ended Dec 2025).

By price return, highest first: NVDA **5.81%**[9], AMD **3.17%**[10] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

> **Unverified analyst view on AMD** (not backed by the figures shown): Its net income sitting above operating income means its bottom-line margin overstates how profitable its operations are, which tempers the counterpoint to the profitability gap.

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

### Answer B

**Q:** Compare NVDA with AMD.

# NVDA vs. AMD, on the data on file as of 2026-09-01

**Bottom line:** NVDA is much larger, faster-growing and far more profitable. AMD is improving, with margins recovering from a low base. The file has no share counts, EPS or market caps, so I can't say which is cheaper.

## Latest full fiscal year

| | NVDA FY2026 (ended Jan 2026) | AMD FY2025 (ended Dec 2025) |
|---|---|---|
| Revenue | $209.9B | $34.7B |
| Revenue growth | +60.9% | +34.5% |
| Gross margin | 70.8% (FY25: 75.0%) | 49.9% (FY24: 49.4%) |
| Operating margin | 60.2% (FY25: 62.4%) | 9.8% (FY24: 1.6%) |
| Net margin | 53.6% (FY25: 55.9%) | 12.0% (FY24: 6.4%) |
| Net income | $112.5B (+54.4%) | $4.2B (+154%) |

NVDA's margins slipped year over year but remain very high. AMD's operating margin rose sharply from a very low base.

## Most recent quarter

| | NVDA Q4 FY26 (Jan 2026) | AMD Q2 FY26 (Jun 2026) |
|---|---|---|
| Revenue | $62.1B | $11.2B |
| YoY / QoQ growth | +57.9% / +8.9% | +45.7% / +4.7% |
| Gross margin | 74.4% | 54.0% |
| Operating margin | 64.9% | 14.4% |
| Net margin | 57.0% | 13.2% |

- **Staleness:** NVDA's latest reported quarter ended about five months before AMD's. Nothing for NVDA after January 2026 is on file, so this comparison is not like-for-like in time.
- **Trailing four quarters:** AMD has revenue of $41.4B, operating income of $5.85B and net income of $5.47B. NVDA's trailing four quarters are its FY2026 figures, so NVDA's revenue is about 5x AMD's and its net income about 20x.

## Quality and mix points

- **NVDA concentration:** Data Center was $55.2B of $62.1B in Q4 FY26, or 88.9% of revenue. Gaming was $4.3B.
- **NVDA gross margin dip:** Q1 FY26 gross margin was 60.5%, against 72–74% in the following three quarters. The file offers no explanation for it, so I won't attribute a cause.
- **AMD's Q2 FY25 charge:** AMD attributes about $800M of inventory and related charges to U.S. export controls on the MI308 GPU. Operating income that quarter was -$134M. Adding the charge back, which is my arithmetic, gives roughly $666M and a gross margin near 50% rather than the reported 39.8%.
- **AMD trend:** The trailing four quarters show steady gains. Gross margin rose from 53.6% in Q3 FY25 to 54.0% in Q2 FY26, and operating income rose each quarter from $1.27B to $1.61B.
- **AMD net income:** In FY2025 net income ($4.17B) exceeded operating income ($3.39B). The data doesn't say what drove the non-operating gain.

## Share price (daily closes, excluding dividends)

| | Last | 2025-12-01 close | Change |
|---|---|---|---|
| NVDA | $178.40 | $167.35 | +6.6% |
| AMD | $162.30 | $156.68 | +3.6% |

Both rose in a smooth, steady drift over roughly nine months. Note that the last-price figures equal the 2026-08-31 bar closes, but the quoted "previous close" values ($176.10 NVDA, $164.90 AMD) don't match the prior bars ($178.34 and $162.27). I'd treat the 9/1 daily move as unreliable until that's reconciled.

## Not covered by the data

- Valuation multiples (no share counts, EPS or market cap)
- Balance sheet, cash flow and capex
- Guidance or forward estimates
- Any segment breakdown for AMD
- NVDA results after Q4 FY2026

## 3. cause-in-evidence (cause in evidence)

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

_Analyst commentary:_ > **Analyst inference:** Its operating loss came despite a positive gross profit, so the loss arose below the gross line; the data shown does not say what drove it.

AMD's revenue was **$7.7B**[1] in Q2 FY2025 (ended Jun 2025).

AMD's gross profit was **$3.1B**[2] in Q2 FY2025 (ended Jun 2025).

AMD's operating income was **-$134.0M**[3] and operating margin **-1.74%**[4] in Q2 FY2025 (ended Jun 2025).

> **Analyst inference:** Its positive net income alongside an operating loss shows the loss was not carried through to the bottom line, so operating margin alone understates how profitable the quarter was.

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: the figures were not computed, as the turn reached its limit of model calls. AMD has no 10-K on file, so no business or risk factor claims from one.

_Cited:_

- [1] **$7.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2025 (ended 2025-06-28): $7.7B
- [2] **$3.1B**: engine result: Advanced Micro Devices, Inc., Gross profit, Q2 FY2025 (ended 2025-06-28): $3.1B
- [3] **-$134.0M**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2025 (ended 2025-06-28): -$134.0M
- [4] **-1.74%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2025 (ended 2025-06-28): -1.74%

### Answer B

**Q:** Why did AMD's operating margin turn negative in Q2 2025?

AMD's Q2 FY2025 operating margin turned negative mainly because of about $800 million in inventory and related charges tied to U.S. export controls on its MI308 data center GPU.

**What the numbers show (quarter ended 2025-06-28):**
- Revenue was $7,685M, up slightly from $7,438M in Q1.
- Gross profit was $3,059M, a gross margin of about 39.8%, down from about 50.2% in Q1 ($3,735M).
- Operating income was -$134M, a margin of about -1.7%, versus +$806M (about 10.8%) in Q1.

**The explanation on file:** AMD's Q2 2025 earnings release (8-K Exhibit 99.1, published 2025-08-05) says results were hit by the U.S. Government's export control on the MI308. It says the restrictions led to approximately $800M in inventory and related charges.

**Rough sizing (my arithmetic, not a company figure):** Adding $800M back to Q2 operating income gives roughly +$666M, or about an 8.7% margin. That would still be below Q1's 10.8%, so the charge explains most of the swing but not all of it. Adding it back to gross profit gives about $3,859M, or about 50.2%, in line with Q1's gross margin. That suggests the charge went through cost of sales, but the excerpt doesn't say which line item it hit.

**What the data doesn't cover:** There is no operating expense breakdown, so I can't say what else moved the rest of the gap. The gap between gross profit and operating income was about $3,193M in Q2 versus about $2,929M in Q1. There is also no detail on how much of the $800M was inventory write-downs versus other related charges.

The following quarters point to a one-time hit: operating income was $1,270M in Q3 FY2025 on $9,246M revenue (13.7% margin) and has stayed positive since.

## 4. follow-up-memory (conversation)

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

_Analyst commentary:_ > **Unverified analyst view** (not backed by the figures shown): Its latest fiscal year shows very high profitability at each level of the income statement, though cash flow could not be assessed and the stock's year-to-date gain is modest by comparison.

NVDA's operating income was **$126.4B**[1] and net income **$112.5B**[2] in FY2026 (ended Jan 2026).

NVDA's gross margin was **70.78%**[3], operating margin **60.21%**[4] and net margin **53.60%**[5] in FY2026 (ended Jan 2026).

> **Analyst inference:** Its operating cash flow, capital spending and free cash flow are unavailable, so the quality of these earnings in cash terms is not confirmed.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no industry peers are on file (no source gives its industry). 10-K claims for NVDA went unread, as the turn reached its limit of reads. NVDA has no 10-K on file, so no business or risk factor claims from one.

**Q:** Compare it with AMD YTD.

*[perf_comparison] Price return YTD 2026 (split-adjusted, excluding dividends)*

_Block sources: S2._

> Market prices use end-of-day data as of 2026-09-01T00:00:00.000Z; intraday moves may not be reflected.
> Returns are split-adjusted price returns; dividends are not included, so they are not total returns.

_Block sources: S2._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the price return ranking): Its price gain is ahead of the peer's, so the market has rewarded it more, though both moves are positive and modest.

Of NVDA and AMD, NVDA's price return was highest: NVDA **5.81%**[6], AMD **3.17%**[7] (the year to date, from the Dec 31, 2025 close to the Aug 31, 2026 close).

NVDA's last close was **$178.40**[8] in the Aug 31, 2026 session.

AMD's last close was **$162.30**[9] in the Aug 31, 2026 session.

> **Unverified analyst view on AMD** (not backed by the figures shown): Its smaller gain is still positive, so the return gap reflects a narrow lead rather than a split between a winner and a loser, and price alone says nothing about fundamentals.

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

_Analyst commentary:_ > **Unverified analyst view on NVDA** (not backed by the figures shown): Its profitability is far higher at every level of the income statement, and its year-to-date share price return is also higher, so the market reward looks much narrower than the operating gap.

AMD's operating income was **$3.4B**[10] and net income **$4.2B**[11] in FY2025 (ended Dec 2025).

> **Analyst inference on AMD:** Its net income exceeding operating income means its net margin overstates operating profitability, so the comparison on net margin is flattering to it.

_Cited:_

- [1] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B
- [2] **$112.5B**: engine result: NVIDIA Corporation, Net income, FY2026 (ended 2026-01-25): $112.5B
- [3] **70.78%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), FY2026 (ended 2026-01-25): 70.78%
- [4] **60.21%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), FY2026 (ended 2026-01-25): 60.21%
- [5] **53.60%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), FY2026 (ended 2026-01-25): 53.60%
- [6] **5.81%**: price series
- [7] **3.17%**: price series
- [8] **$178.40**: price series
- [9] **$162.30**: price series
- [10] **$3.4B**: engine result: Advanced Micro Devices, Inc., Operating income, FY2025 (ended 2025-12-27): $3.4B
- [11] **$4.2B**: engine result: Advanced Micro Devices, Inc., Net income, FY2025 (ended 2025-12-27): $4.2B

### Answer B

**Q:** Analyze NVDA.

# NVDA: Analysis (data as of 2026-09-01)

## Bottom line
Fundamentals are very strong through the latest reported quarter (Q4 FY2026, ended 2026-01-25). Revenue is growing about 58% year over year and operating margins are above 60%. The data on file can't tell us whether the stock is cheap or expensive, and it has no reported results after January 2026.

## Growth
| Quarter | Revenue ($M) | YoY | QoQ |
|---|---|---|---|
| Q1 FY26 | 44,062 | +69.2% | |
| Q2 FY26 | 46,743 | +55.6% | +6.1% |
| Q3 FY26 | 57,006 | +62.5% | +22.0% |
| Q4 FY26 | 62,100 | +57.9% | +8.9% |

- FY2026 revenue was $209.9B, up 60.9% from $130.5B. Operating income rose 55.2% to $126.4B and net income rose 54.4% to $112.5B.
- Profit grew slightly slower than revenue, so margins compressed a little on the year.

## Margins
| | FY25 | FY26 | Q4 FY25 | Q4 FY26 |
|---|---|---|---|---|
| Gross | 75.0% | 70.8% | 73.0% | 74.4% |
| Operating | 62.4% | 60.2% | 61.1% | 64.9% |
| Net | 55.8% | 53.6% | 56.2% | 57.0% |

- **Q1 FY26 dip:** Gross margin fell to 60.5% and operating margin to 49.1%. This drags down the FY26 full-year figures.
- **Recovery since:** Gross margin has improved each quarter since (72.4%, 73.4%, 74.4%). Q4 operating margin of 64.9% is the highest in the eight quarters on file.
- **Cause unknown:** The data doesn't say why Q1 FY26 dipped. The only filed explanation on file is AMD's, about its own MI308 charges, and it shouldn't be read across to NVDA.

## Mix
Data Center was $55.2B of Q4 FY26 revenue, or 88.9%. Gaming was 6.9%, OEM & Other 1.7%, Professional Visualization 1.4% and Automotive 1.0%. Segment data is only given for Q4 FY26, so I can't show how mix has shifted over time.

## Price action
- The last price is $178.40, up 6.6% from the $167.35 close on 2025-12-01, the start of the window on file. The drift has been steady with no sharp drawdowns. The window low is $165.68 intraday and the high is $180.18 intraday, on 2026-08-31.
- Over the same window, AAPL is up about 6.1% and AMD about 3.6%.
- **Data inconsistency:** The quote shows a previous close of $176.10, but the daily bars show a prior close of $178.34 (2026-08-28). The last price of $178.40 matches the 2026-08-31 bar, not a separate 2026-09-01 session. I'd treat the quoted +1.3% daily move as unreliable until confirmed.

## Relative to peers on file
Q4 FY26 operating margin of 64.9% compares with AMD's 14.4% (Q2 FY26) and Apple's 30.7% (Q3 FY26). Those are different fiscal quarters, so this is only a rough comparison.

## What the data doesn't cover
- **Valuation:** There are no share count, EPS, market cap, enterprise value or multiples, so I can't say whether the price is attractive.
- **Recent results:** There are no results for the quarters ended around April and July 2026, which leaves the most recent two quarters unseen.
- **Other missing items:** The data has no balance sheet, cash flow, guidance, consensus estimates, or an explanation of the Q1 FY26 margin dip.

A useful next step would be to pull the latest quarterly filings and share count so we can build a valuation and see whether the 60%+ growth rate has held.

**Q:** Compare it with AMD YTD.

# NVDA vs. AMD, year to date (calendar 2026)

## Price performance
I used the 2025-12-31 close as the starting point and the last price on file as the end point. Prices exclude dividends.

| | 2025-12-31 close | Last price | YTD |
|---|---|---|---|
| NVDA | $168.60 | $178.40 | **+5.8%** |
| AMD | $157.32 | $162.30 | **+3.2%** |

NVDA has outperformed by about 2.6 percentage points. Both stocks drifted up steadily with no sharp drawdowns in the bars on file.

The quoted previous closes ($176.10 for NVDA, $164.90 for AMD) don't match the prior closes in the daily bars. The last prices on file match the 2026-08-31 bars, not a separate 2026-09-01 session. I used the last price, but the quoted one-day moves are unreliable.

## Fundamentals over the same period
The fiscal calendars differ, so the comparison is not clean.

| | NVDA | AMD |
|---|---|---|
| Latest quarter on file | Q4 FY26 (ended 2026-01-25) | Q2 FY26 (ended 2026-06-27) |
| Quarters reported in 2026 | Effectively none (Q4 is mostly Nov-Jan) | Two (Q1, Q2 FY26) |
| Latest-quarter revenue | $62.1B | $11.2B |
| Revenue growth YoY, latest quarter | +57.9% | +45.7% |
| Gross margin, latest quarter | 74.4% | 54.0% |
| Operating margin, latest quarter | 64.9% | 14.4% |
| Last full fiscal year revenue growth | +60.9% (FY26) | +34.5% (FY25) |
| Last full fiscal year operating margin | 60.2% | 9.8% |

- **AMD in 2026:** Revenue was $10.7B in Q1 (+43.9% YoY) and $11.2B in Q2. Operating margin was steady at about 14%, with Q1 at 14.2% and Q2 at 14.4%.
- **NVDA in 2026:** I can't give a true 2026 YTD fundamental view because there are no results after January 2026. The stock's gain has come with no new reported quarters on file.
- **Scale and profitability:** NVDA's latest quarterly revenue is about 5.5x AMD's. Its operating margin is roughly 4.5x higher.

## Takeaways
- NVDA has the stronger growth rate and a far higher margin profile, and it has modestly outperformed in price YTD.
- AMD's 2026 numbers show consistent sequential growth and slightly improving margins, but at a much lower profitability level.
- The price gap between them (+5.8% vs. +3.2%) is small relative to the fundamental gap. Whether that means NVDA is underpriced or AMD is richly priced can't be judged here, because the data has no EPS, share counts or multiples for either company.

If you want a cleaner like-for-like read, we'd need NVDA's quarters ended around April and July 2026.

**Q:** Explain the differences and show the evidence.

# Why NVDA and AMD differ, and the evidence

The statements explain the differences in growth and profitability well. They can't explain the difference in share-price performance, because nothing on file (news, estimates, valuation) speaks to what drove the prices.

## 1. Share price: NVDA +5.8% vs. AMD +3.2% YTD

| Date | NVDA close | NVDA YTD | AMD close | AMD YTD |
|---|---|---|---|---|
| 2025-12-31 (base) | 168.60 | n/a | 157.32 | n/a |
| 2026-03-31 | 172.22 | +2.1% | 159.16 | +1.2% |
| 2026-06-30 | 175.91 | +4.3% | 161.03 | +2.4% |
| 2026-09-01 (last) | 178.40 | +5.8% | 162.30 | +3.2% |

NVDA has been ahead at every checkpoint, so the gap built gradually rather than from one event. Why it built is not in the data.

## 2. Growth: NVDA is faster and AMD is accelerating

Revenue growth YoY, from the quarterly tables:

| NVDA quarter | Revenue ($M) | YoY | AMD quarter | Revenue ($M) | YoY |
|---|---|---|---|---|---|
| Q1 FY26 | 44,062 | +69.2% | Q3 FY25 | 9,246 | +35.6% |
| Q2 FY26 | 46,743 | +55.6% | Q4 FY25 | 10,300 | +34.5% |
| Q3 FY26 | 57,006 | +62.5% | Q1 FY26 | 10,700 | +43.9% |
| Q4 FY26 | 62,100 | +57.9% | Q2 FY26 | 11,200 | +45.7% |

- NVDA's growth is higher but has been choppy, in a 56-69% range.
- AMD's growth stepped up from the mid-30s to the mid-40s.
- AMD's Q2 FY26 growth is measured against a Q2 FY25 base that AMD's filing says was hit by export controls on its MI308 GPU. That may flatter the comparison, though the filing doesn't quantify any lost revenue.

## 3. Profitability: the main difference, and where it comes from

| Latest quarter | NVDA Q4 FY26 | AMD Q2 FY26 | Gap |
|---|---|---|---|
| Revenue ($M) | 62,100 | 11,200 | |
| Gross margin | 74.4% | 54.0% | 20.4 pts |
| Gross profit minus operating income ($M) | 5,900 | 4,440 | |
| ...as % of revenue | 9.5% | 39.6% | 30.1 pts |
| Operating margin | 64.9% | 14.4% | 50.5 pts |

The 50.5-point operating margin gap splits into two parts (20.4 + 30.1):
- **Gross margin** accounts for about 20 points.
- **Operating costs below gross profit** account for about 30 points. NVDA's are only 1.3x AMD's in dollars ($5.9B vs. $4.4B) against 5.5x the revenue.

I derived the cost line as gross profit minus operating income, since the statements on file don't break out operating expenses.

## 4. Margin trajectory

| | NVDA op. margin | AMD gross margin | AMD op. margin |
|---|---|---|---|
| Q4 FY25 / Q3 FY25 | 61.1% | 53.6% | 13.7% |
| Next quarter | 49.1% | 54.0% | 14.1% |
| Next quarter | 60.8% | 54.0% | 14.2% |
| Latest | 64.9% | 54.0% | 14.4% |

The NVDA column starts at Q4 FY25. The AMD columns start at Q3 FY25 and are one quarter ahead of NVDA's labels. The next rows are NVDA's Q1 and Q2 FY26 against AMD's Q4 FY25 and Q1 FY26.
- NVDA's margin had a sharp Q1 FY26 dip (gross margin 60.5%) and then recovered to a new high. The data doesn't explain the dip.
- AMD's margins are very stable. Gross margin has been 54.0% for four straight quarters and operating margin has crept up only 0.7 points.

## 5. AMD's one-off in Q2 FY25

AMD's filing says export restrictions on its MI308 GPU led to approximately $800 million in inventory and related charges in Q2 FY25. The numbers fit that:
- Gross margin dropped to 39.8% ($3,059M on $7,685M), from 50.2% the prior quarter.
- Operating income was -$134M.
- Adding back $800M gives gross margin of about 50.2% and operating income of about $666M (8.7% margin).

The filing doesn't say which income statement line the charge sits in, so the add-back is an estimate. Even adjusted, AMD's operating margin then was far below NVDA's.

## 6. Comparability limits

- **Calendar mismatch:** AMD has two 2026 quarters, through 2026-06-27. NVDA's latest is Q4 FY26, ended 2026-01-25, so there are no NVDA fundamentals for most of the YTD window.
- **Missing valuation inputs:** There are no EPS, share counts or multiples for either company, so the data can't tell us which stock is better value or why the market treated them differently.

## 5. missing-segments (missing data)

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

The data on file has no segment breakdown for AMD. The only segment table covers NVIDIA (Q4 FY2026). For AMD I have consolidated figures only, so I can't split revenue into Data Center, Client, Gaming, Embedded or anything else.

**What I can give you on AMD revenue (USD millions):**

| Period | Revenue |
|---|---|
| Q3 FY2025 | 9,246 |
| Q4 FY2025 | 10,300 |
| Q1 FY2026 | 10,700 |
| Q2 FY2026 | 11,200 |
| FY2024 | 25,785 |
| FY2025 | 34,669 |

Total revenue has risen each quarter since Q2 FY2025 (7,685), reaching 11,200 in Q2 FY2026.

**The only segment-related information on file** is AMD's Q2 FY2025 8-K, which says U.S. export controls on the AMD Instinct MI308 data center GPU led to about $800 million in inventory and related charges that quarter. That is a charge, not a revenue figure, and it doesn't say how much revenue the Data Center segment contributed.

To get the segment split, you would need AMD's segment disclosures from its 10-Q/10-K filings or earnings releases, which aren't in the data I have. If it would help, I can use the consolidated figures to look at AMD's margin trends or compare it with NVIDIA, whose segment data is on file.

## 6. fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Answer A

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

**Fiscal 2025 revenue**

| | Fiscal period | Revenue (USD M) |
|---|---|---|
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |

AAPL's FY2025 revenue was about $285.7B higher than NVDA's, or roughly 3.2x as large.

**The fiscal years don't line up.** NVDA's FY2025 ended in January 2025, about eight months before AAPL's FY2025 ended in September 2025. For a closer calendar match, NVDA's FY2026 (2025-01-27 to 2026-01-25) revenue was 209,911, so AAPL's FY2025 was about 2.0x that.

**Growth over the last two fiscal years on file:**
- AAPL's revenue rose about 6.4% in FY2025, from 391,035 in FY2024.
- NVDA's revenue rose about 60.9% in FY2026, from 130,497 in FY2025. The data has no NVDA FY2024 figure, so I can't give NVDA's FY2025 growth rate.

Revenue is the only metric I've compared here. The data doesn't include share counts or market capitalization.

### Answer B

**Q:** Compare NVDA's and AAPL's fiscal 2025 revenue.

*Engine answer: all 1 requested results verified*

- Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B

_Block sources: S1._

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on AAPL** (from the revenue ranking): Its sales base is larger than its peer's, so it is the bigger business by revenue.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1], NVDA **$130.5B**[2].

> **Analyst inference on NVDA:** Its fiscal year ends at a different point on the calendar than its peer's, so the two periods are not aligned, which tempers a direct comparison.

Periods: AAPL FY2025 (ended Sep 2025), NVDA FY2025 (ended Jan 2025).

_Cited:_

- [1] **$416.2B**: engine result: Apple Inc., Revenue, FY2025 (ended 2025-09-27): $416.2B
- [2] **$130.5B**: engine result: NVIDIA Corporation, Revenue, FY2025 (ended 2025-01-26): $130.5B

## 7. peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Answer A

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

# Revenue and margins: NVDA vs AMD vs AAPL

The three companies have different fiscal calendars, so the periods below do not line up exactly. I've shown the latest fiscal year and the latest quarter on file for each.

## Latest fiscal year

| | Period | Revenue ($M) | YoY growth | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|---|
| NVDA | FY2026 (to Jan 2026) | 209,911 | +60.9% | 70.8% | 60.2% | 53.6% |
| AMD | FY2025 (to Dec 2025) | 34,669 | +34.5% | 49.9% | 9.8% | 12.0% |
| AAPL | FY2025 (to Sep 2025) | 416,161 | +6.4% | 46.9% | 32.0% | 26.9% |

## Latest quarter on file

| | Quarter | Revenue ($M) | YoY growth | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|---|---|
| NVDA | Q4 FY2026 (to Jan 2026) | 62,100 | +57.9% | 74.4% | 64.9% | 57.0% |
| AMD | Q2 FY2026 (to Jun 2026) | 11,200 | +45.7% | 54.0% | 14.4% | 13.2% |
| AAPL | Q3 FY2026 (to Jun 2026) | 97,100 | +3.3% | 47.1% | 30.7% | 25.6% |

## Trailing four quarters

| | Revenue ($M) | Gross margin | Operating margin | Net margin |
|---|---|---|---|---|
| NVDA (to Jan 2026) | 209,911 | 70.8% | 60.2% | 53.6% |
| AMD (to Jun 2026) | 41,446 | 53.9% | 14.1% | 13.2% |
| AAPL (to Jun 2026) | 426,266 | 47.1% | 32.2% | 27.2% |

## Takeaways

- **Scale vs profit:** Apple has about twice NVDA's revenue, but NVDA's FY2026 operating income of $126.4B is close to Apple's FY2025 $133.1B and trailing-four-quarter $137.2B. AMD's trailing operating income is $5.9B.
- **Growth:** NVDA is growing fastest in absolute terms, and AMD is accelerating, with its latest quarter up 45.7% against 34.5% for FY2025. Apple is growing in the low-to-mid single digits.
- **Margin trends:**
  - NVDA's gross margin fell from 75.0% in FY2025 to 70.8% in FY2026. It dipped to 60.5% in Q1 FY2026 and recovered to 74.4% by Q4. The data on file doesn't explain the dip.
  - AMD's margins are well below the other two but improving. Operating margin went from 1.6% in FY2024 to 9.8% in FY2025 and 14.4% in the latest quarter.
  - Apple is the most stable, with operating margin around 30–32% across periods.
- **AMD's comparison base:** AMD's Q2 FY2025 results (operating loss of $134M, 39.8% gross margin) included about $800M of inventory and related charges. The company tied these to U.S. export controls on its MI308 data center GPU. That makes the year-over-year margin improvement look larger than the underlying trend.
- **Mix:** NVDA's Data Center segment was $55.2B of $62.1B in Q4 FY2026, about 89% of revenue. Segment data for AMD and AAPL isn't on file.

**Data gaps:** NVDA's latest quarter on file ends January 2026, so its figures are about five months older than AMD's and Apple's. Nothing on file covers NVDA's more recent quarters.

### Answer B

**Q:** Compare NVDA, AMD and AAPL on revenue and margins.

*Engine answer: all 12 requested results verified*

*Revenue, Gross margin (gross profit / revenue), Operating margin (operating income / revenue), Net margin (net income / revenue) by company*

| | Revenue | Gross margin (gross profit / revenue) | Operating margin (operating income / revenue) | Net margin (net income / revenue) |
|---|---|---|---|---|
| NVIDIA Corporation | $62.1B (Q4 FY2026 (ended 2026-01-25)) | 74.40% (Q4 FY2026 (ended 2026-01-25)) | 64.90% (Q4 FY2026 (ended 2026-01-25)) | 57.00% (Q4 FY2026 (ended 2026-01-25)) |
| Advanced Micro Devices, Inc. | $11.2B (Q2 FY2026 (ended 2026-06-27)) | 54.02% (Q2 FY2026 (ended 2026-06-27)) | 14.38% (Q2 FY2026 (ended 2026-06-27)) | 13.21% (Q2 FY2026 (ended 2026-06-27)) |
| Apple Inc. | $97.1B (Q3 FY2026 (ended 2026-06-27)) | 47.06% (Q3 FY2026 (ended 2026-06-27)) | 30.69% (Q3 FY2026 (ended 2026-06-27)) | 25.64% (Q3 FY2026 (ended 2026-06-27)) |

_Block sources: S1._

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its margins sit well above the other two at every level, while the revenue lead belongs to a different company, so profitability and scale point to different leaders.

By revenue, highest first: AAPL **$97.1B**[1], NVDA **$62.1B**[2], AMD **$11.2B**[3].

By gross margin, highest first: NVDA **74.40%**[4], AMD **54.02%**[5], AAPL **47.06%**[6].

By operating margin, highest first: NVDA **64.90%**[7], AAPL **30.69%**[8], AMD **14.38%**[9].

By net margin, highest first: NVDA **57.00%**[10], AAPL **25.64%**[11], AMD **13.21%**[12].

> **Analyst inference on AAPL** (from the operating margin, net margin, and gross margin rankings): Its lower gross margin yet higher operating margin than AMD shows it keeps more of each revenue dollar after operating costs, while the quarters compared differ and only one period is shown per company.

Periods: NVDA Q4 FY2026 (ended Jan 2026), AMD Q2 FY2026 (ended Jun 2026), AAPL Q3 FY2026 (ended Jun 2026).

_Cited:_

- [1] **$97.1B**: engine result: Apple Inc., Revenue, Q3 FY2026 (ended 2026-06-27): $97.1B
- [2] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [3] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [4] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [5] **54.02%**: engine result: Advanced Micro Devices, Inc., Gross margin (gross profit / revenue), Q2 FY2026 (ended 2026-06-27): 54.02%
- [6] **47.06%**: engine result: Apple Inc., Gross margin (gross profit / revenue), Q3 FY2026 (ended 2026-06-27): 47.06%
- [7] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [8] **30.69%**: engine result: Apple Inc., Operating margin (operating income / revenue), Q3 FY2026 (ended 2026-06-27): 30.69%
- [9] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [10] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%
- [11] **25.64%**: engine result: Apple Inc., Net margin (net income / revenue), Q3 FY2026 (ended 2026-06-27): 25.64%
- [12] **13.21%**: engine result: Advanced Micro Devices, Inc., Net margin (net income / revenue), Q2 FY2026 (ended 2026-06-27): 13.21%

## 8. margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Answer A

**Q:** How have AMD's operating margins trended over the last eight quarters?

AMD's operating margin was roughly flat around 11% through Q1 FY2025, collapsed in Q2 FY2025, then recovered to a higher, steadily rising level of about 14%.

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

- **Q2 FY2025 dip:** AMD's filing attributes it to U.S. export controls on the MI308 data center GPU, which led to about $800M of inventory and related charges. Gross margin fell to about 39.8% that quarter, from about 50.2% in Q1 FY2025. Adding the $800M back to operating income gives roughly $666M, or about 8.7% of revenue. That is my own rough adjustment. The filing excerpt doesn't say how the charge was split across line items, so treat it as approximate. Even on that basis, the margin was below the prior quarters.
- **Recovery:** The margin rose to 13.7% in Q3 FY2025 and has edged up each quarter since. It has been in a narrow 13.7–14.4% band for the last four quarters.
- **Operating leverage:** Revenue grew from $7.7B in Q2 FY2025 to $11.2B in Q2 FY2026, and operating income grew faster. Over the past three quarters the margin gain has been small, about 0.1–0.2 points per quarter.

The data doesn't include guidance or a breakdown of what drove the post-Q2 FY2025 improvement beyond the charge not recurring, so I can't say how durable the roughly 14% level is.

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

_Analyst commentary:_ AMD's operating margin rose from **14.21%**[1] in Q1 FY2026 (ended Mar 2026) to **14.38%**[2] in Q2 FY2026 (ended Jun 2026).

AMD's revenue rose from **$10.7B**[3] in Q1 FY2026 (ended Mar 2026) to **$11.2B**[4] in Q2 FY2026 (ended Jun 2026).

AMD's operating income rose from **$1.5B**[5] in Q1 FY2026 (ended Mar 2026) to **$1.6B**[6] in Q2 FY2026 (ended Jun 2026).

AMD: no earnings release read for its GAAP to non-GAAP reconciliation is on file. AMD: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified). Certified figures for AMD went unread, as the turn reached its limit of reads.

Some of the analysis was left out, as the turn reached its limit of model calls.

_Cited:_

- [1] **14.21%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q1 FY2026 (ended 2026-03-28): 14.21%
- [2] **14.38%**: engine result: Advanced Micro Devices, Inc., Operating margin (operating income / revenue), Q2 FY2026 (ended 2026-06-27): 14.38%
- [3] **$10.7B**: engine result: Advanced Micro Devices, Inc., Revenue, Q1 FY2026 (ended 2026-03-28): $10.7B
- [4] **$11.2B**: engine result: Advanced Micro Devices, Inc., Revenue, Q2 FY2026 (ended 2026-06-27): $11.2B
- [5] **$1.5B**: engine result: Advanced Micro Devices, Inc., Operating income, Q1 FY2026 (ended 2026-03-28): $1.5B
- [6] **$1.6B**: engine result: Advanced Micro Devices, Inc., Operating income, Q2 FY2026 (ended 2026-06-27): $1.6B

## 9. segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Answer A

**Q:** Break down NVDA's revenue by segment.

*Engine answer: all 1 requested results verified*

- NVIDIA Corporation, Revenue, FY2026 (ended 2026-01-25): $209.9B

_Block sources: S1._

NVDA has no 10-K on file, so no business or risk factor claims from one.

### Answer B

**Q:** Break down NVDA's revenue by segment.

**NVDA revenue by segment, Q4 FY2026 (2025-10-27 to 2026-01-25), USD millions**

| Segment | Revenue | % of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| OEM & Other | 1,050 | 1.7% |
| **Total** | **62,100** | 100% |

The segments sum to the reported Q4 FY2026 revenue of $62,100M.

- **Data Center dominates.** At roughly 89% of revenue, it is the story for NVDA this quarter. Gaming is the only other segment above 2%.
- **Coverage is limited.** The data on file has a segment split only for Q4 FY2026. There is no segment breakdown for the other quarters or for the full-year FY2025 and FY2026, so I can't show segment growth or how the mix has shifted over time. I also can't say which segments drove the sequential increase from Q3 FY2026 ($57,006M) to Q4 ($62,100M).

If it helps, I can show the consolidated trend (revenue, gross profit, operating income) across the eight quarters on file.

## 10. single-latest-quarter (single company)

**Expect:** Q4 FY2026 (ended 2026-01-25): revenue, gross/operating/net income, margins, with the quarter-over-quarter direction. NVDA only.

### Answer A

**Q:** Analyze NVDA's latest quarter.

**Bottom line:** The latest NVDA quarter on file is Q4 FY2026 (Oct 27, 2025 to Jan 25, 2026). It was strong: revenue grew about 58% year over year, and margins expanded both year over year and sequentially. This quarter ended about 7 months before 2026-09-01, so NVDA's later quarters are not in the data. I can't speak to anything more recent.

**Q4 FY2026 (USD millions)**

| | Q4 FY26 | Q3 FY26 | Q4 FY25 | QoQ | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | 39,331 | +8.9% | +57.9% |
| Gross profit | 46,200 | 41,849 | 28,723 | +10.4% | +60.8% |
| Operating income | 40,300 | 36,010 | 24,034 | +11.9% | +67.7% |
| Net income | 35,400 | 31,910 | 22,091 | +10.9% | +60.2% |

**Margins**
- **Gross margin:** 74.4%, vs 73.4% in Q3 and 73.0% a year ago.
- **Operating margin:** 64.9%, vs 63.2% in Q3 and 61.1% a year ago.
- **Net margin:** 57.0%, vs 56.0% in Q3.
- Operating income grew faster than revenue, so there was operating leverage on top of the gross margin gain.

**Segment mix**
- Data Center was 55,200, or 88.9% of revenue.
- Gaming was 4,300 (6.9%), OEM & Other 1,050 (1.7%), Professional Visualization 900 (1.4%) and Automotive 650 (1.0%).
- The company is essentially a data center story. The data has no prior-period segment figures, so I can't say which segments drove the growth.

**Full-year context (FY2026)**
- Revenue was 209,911, up 60.8% from 130,497.
- Gross margin was 70.8%, operating margin 60.2% and net margin 53.6%.
- Q4 was the highest quarter of the year. Revenue stepped up every quarter, from 44,062 in Q1.
- Q1 FY2026 gross margin was only 60.5% (26,668 on 44,062). There is no filed explanation for it in the data, so I can't say why it dipped.

**Stock**
- The last price is 178.40, up 1.3% from the prior close of 176.10.
- The close on 2026-01-26, the first session after the quarter ended, was 169.62, so the stock is up about 5% since.
- The quote is inconsistent with the daily bars. The bars show the 2026-08-31 close at 178.40, and the 08-28 close at 178.34, not 176.10. I'd treat the day-over-day move with caution.

**What the data doesn't cover**
- There is no guidance, no cash flow or balance sheet, no share count or EPS, and no consensus estimates.
- That means I can't give you a valuation view or say how the quarter compared with expectations.
- There are no NVDA filed explanations, so I can't attribute the margin or growth drivers beyond what the numbers show.

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

> **Analyst inference:** The quarter shows very high profitability, with most of each revenue dollar surviving to operating and net income, though the data shown covers only one period.

> **Unverified analyst view** (not backed by the figures shown): The counterpoint is that this quarter is not the latest by the stock's date, and the share price has risen only modestly since year start, so the profitability shown may already be reflected in how the market treats it.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. NVDA: no standout finding in its own history (operating margin: a year in its window has no value; stock-based compensation as a multiple of free cash flow: an input to its latest year was not certified; cash conversion (operating cash flow / net income): an input to its latest year was not certified).

_Cited:_

- [1] **$62.1B**: engine result: NVIDIA Corporation, Revenue, Q4 FY2026 (ended 2026-01-25): $62.1B
- [2] **$46.2B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2026 (ended 2026-01-25): $46.2B
- [3] **$40.3B**: engine result: NVIDIA Corporation, Operating income, Q4 FY2026 (ended 2026-01-25): $40.3B
- [4] **$35.4B**: engine result: NVIDIA Corporation, Net income, Q4 FY2026 (ended 2026-01-25): $35.4B
- [5] **74.40%**: engine result: NVIDIA Corporation, Gross margin (gross profit / revenue), Q4 FY2026 (ended 2026-01-25): 74.40%
- [6] **64.90%**: engine result: NVIDIA Corporation, Operating margin (operating income / revenue), Q4 FY2026 (ended 2026-01-25): 64.90%
- [7] **57.00%**: engine result: NVIDIA Corporation, Net margin (net income / revenue), Q4 FY2026 (ended 2026-01-25): 57.00%

## 11. ticker-page-compare (explicit subject)

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

_Analyst commentary:_ > **Analyst inference on NVDA** (from the revenue, gross margin, operating margin, and net margin rankings): Its profitability is far stronger than its peer's at every level of the income statement, while net income is nearly the same on a much smaller revenue base.

Of AAPL and NVDA, AAPL's revenue was highest: AAPL **$416.2B**[1] (FY2025, ended Sep 2025), NVDA **$209.9B**[2] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's gross margin was highest: AAPL **46.91%**[3] (FY2025, ended Sep 2025), NVDA **70.78%**[4] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's operating margin was highest: AAPL **31.97%**[5] (FY2025, ended Sep 2025), NVDA **60.21%**[6] (FY2026, ended Jan 2026).

Of AAPL and NVDA, NVDA's net margin was highest: AAPL **26.92%**[7] (FY2025, ended Sep 2025), NVDA **53.60%**[8] (FY2026, ended Jan 2026).

AAPL's net income was **$112.0B**[9] in FY2025 (ended Sep 2025); NVDA's net income was **$112.5B**[10] in FY2026 (ended Jan 2026).

AAPL's operating income was **$133.0B**[11] in FY2025 (ended Sep 2025); NVDA's operating income was **$126.4B**[12] in FY2026 (ended Jan 2026).

> **Analyst inference on AAPL** (from the revenue ranking): Its operating income is still larger than its peer's on a larger revenue base, so its profit pool is not smaller despite the lower margins.

NVDA: no analyst consensus captured in the 7 days to the cutoff is on file. AAPL: no analyst consensus captured in the 7 days to the cutoff is on file.

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
- [11] **$133.0B**: engine result: Apple Inc., Operating income, FY2025 (ended 2025-09-27): $133.0B
- [12] **$126.4B**: engine result: NVIDIA Corporation, Operating income, FY2026 (ended 2026-01-25): $126.4B

### Answer B

**Q:** Compare with NVDA. (opened from the AAPL page)

**Bottom line:** NVDA is growing much faster and earns far higher margins. AAPL is about twice the revenue and has a slightly larger trailing net income. The data on file can't support a valuation comparison.

**Fundamentals (USD millions)**

The two fiscal calendars differ, so I used the latest four reported quarters for each. AAPL's window is Q4 FY25 through Q3 FY26 (to 2026-06-27). NVDA's is FY2026 (to 2026-01-25).

| | AAPL (TTM to Jun-26) | NVDA (FY2026, to Jan-26) |
|---|---|---|
| Revenue | 426,266 | 209,911 |
| Gross profit | 200,841 | 148,570 |
| Operating income | 137,227 | 126,388 |
| Net income | 115,766 | 112,507 |
| Gross margin | 47.1% | 70.8% |
| Operating margin | 32.2% | 60.2% |
| Net margin | 27.2% | 53.6% |
| Revenue growth, vs prior 4 quarters | +4.3% | +60.9% |
| Net income growth, vs prior 4 quarters | +16.6% | +54.4% |
| Latest quarter revenue growth, YoY | +3.3% (Q3 FY26) | +57.9% (Q4 FY26) |

- **Margin trends:** AAPL's quarterly gross margin is steady at about 46-47%, rising to 47.0% in Q1 FY26 on the seasonally strong holiday quarter. NVDA's gross margin dipped to 60.5% in Q1 FY26, then rose each quarter to 74.4% in Q4 FY26. The data doesn't say why it dipped.
- **Mix:** NVDA's Q4 FY26 revenue was about 89% Data Center (55,200 of 62,100). There is no segment data on file for AAPL, so I can't compare concentration.
- **AAPL's earnings base:** AAPL's net income growth is flattered by a low prior-period base. Q4 FY24 net income was only 14,736 on 94,930 of revenue, and the data doesn't explain it.

**Stock prices (split-adjusted, excluding dividends)**

| | AAPL | NVDA |
|---|---|---|
| Last price | 231.60 | 178.40 |
| 2025-12-01 to 2026-08-31 | +6.1% | +6.6% |

The two stocks returned about the same over this window, even though NVDA's earnings grew far faster. Both rose in a smooth, near-linear way on steadily rising volume.

**Caveats**
- **No valuation:** There are no share counts, EPS, market caps, balance sheets or cash flows on file, so I can't give P/E, EV/EBIT or FCF yield.
- **NVDA is staler:** Its latest reported quarter ends January 2026, about five months before AAPL's. NVDA has no later quarters on file, so the comparison isn't like-for-like in time.
- **Quote mismatch:** The quoted previous closes (AAPL 229.80, NVDA 176.10) don't match the 2026-08-28 bar closes (231.53 and 178.34). The quote implies one-day moves of +0.8% for AAPL and +1.3% for NVDA, but the bars show about +0.03% for each. I wouldn't rely on the one-day change until that is reconciled.

## 12. what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Answer A

**Q:** What changed in NVDA's gross margin in Q1 fiscal 2026?

**NVDA's gross margin fell sharply in Q1 FY2026 (quarter ended 2025-04-27), to about 60.5% from about 73.0% in the prior quarter.**

| Quarter | Revenue ($M) | Gross profit ($M) | Gross margin |
|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | 78.3% |
| Q4 FY2025 | 39,331 | 28,723 | 73.0% |
| **Q1 FY2026** | **44,062** | **26,668** | **60.5%** |
| Q2 FY2026 | 46,743 | 33,853 | 72.4% |

- **Sequentially:** Revenue rose about 12% from Q4 FY2025, but gross profit fell about 7% in dollars (28,723 to 26,668). The margin dropped about 12.5 points.
- **Year over year:** The margin was down about 17.8 points from 78.3% in Q1 FY2025, even though revenue was up about 69%.
- **Operating income:** It fell from 24,034 to 21,638, and operating margin from about 61.1% to about 49.1%. Implied operating expenses (gross profit minus operating income) rose only modestly, from about 4,689 to 5,030. So the squeeze came almost entirely at the gross profit line.
- **Recovery:** The margin rebounded to about 72.4% in Q2 FY2026 and stayed in the 70s through Q4 FY2026 (46,200 / 62,100, about 74.4%). Q1 FY2026 looks like a one-quarter dip.

**Cause:** The data on file doesn't explain it. There is no NVDA filing, management commentary, or cost breakdown for that quarter, so I can't say whether it came from charges, product mix, or something else. The only filed explanation on file is AMD's, about export-control charges at AMD. It says nothing about NVDA, so I wouldn't read it across. The explanation would need to come from NVDA's own Q1 FY2026 earnings release or 10-Q, which isn't in the data I have.

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

_Analyst commentary:_ > **Analyst inference:** Its gross margin fell sharply in the latest quarter, even as revenue and gross profit dollars grew from a year earlier, so growth came with much lower profitability per dollar of sales.

NVDA's gross profit was **$26.7B**[1] in Q1 FY2026 (ended Apr 2025); NVDA's gross profit was **$28.7B**[2] in Q4 FY2025 (ended Jan 2025); NVDA's gross profit was **$20.4B**[3] in Q1 FY2025 (ended Apr 2024).

The figures do not show why NVDA's gross margin changed.

> **Analyst inference:** Even so, gross profit dollars remain well above the year-earlier quarter, which cuts against reading the margin drop as weakening earnings power.

NVDA: no earnings release read for its GAAP to non-GAAP reconciliation is on file. 10-K claims for NVDA went unread, as the turn reached its limit of reads.

_Cited:_

- [1] **$26.7B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2026 (ended 2025-04-27): $26.7B
- [2] **$28.7B**: engine result: NVIDIA Corporation, Gross profit, Q4 FY2025 (ended 2025-01-26): $28.7B
- [3] **$20.4B**: engine result: NVIDIA Corporation, Gross profit, Q1 FY2025 (ended 2024-04-28): $20.4B
