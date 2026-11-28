# Research-quality eval: 2026-11-25T045609

Stack revision: `defab76cc1f2`, clean. Runner revision: `defab76cc1f2`. Question set: `2a1d31d1c787`. Dataset: `9714d6e9321f`.

Answered by: `anthropic/claude-opus-5-5` (14 turns).

Answer tokens: mean 29075 input / 2348 output per turn over 14 turns.

Assertions: not reported.

Model: `anthropic/claude-opus-5-5`. Data: frozen golden dataset. Score each question in `2026-11-25T045609.scores.json` (rubric below),
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

_Outcome: completed; time: 24.2s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28304 input / 2702 output tokens._

# NVDA: Q4 FY2026 (quarter ended 2026-01-25)

**The data has a gap.** The latest NVDA quarter on file is Q4 FY2026, which ended over seven months before today (2026-09-01). Nothing on file covers the quarters ending in roughly April and July 2026, so this analysis may be out of date. The data has no guidance, balance sheet, cash flow, or share count.

## Headline results

| USD m | Q4 FY26 | Q3 FY26 | QoQ | Q4 FY25 | YoY |
|---|---|---|---|---|---|
| Revenue | 62,100 | 57,006 | +8.9% | 39,331 | +57.9% |
| Gross profit | 46,200 | 41,849 | +10.4% | 28,723 | +60.8% |
| Operating income | 40,300 | 36,010 | +11.9% | 24,034 | +67.7% |
| Net income | 35,400 | 31,910 | +10.9% | 22,091 | +60.2% |

**Margins**

| | Q4 FY26 | Q3 FY26 | Q4 FY25 |
|---|---|---|---|
| Gross margin | 74.4% | 73.4% | 73.0% |
| Operating margin | 64.9% | 63.2% | 61.1% |
| Net margin | 57.0% | 56.0% | 56.2% |

## What stands out

**1. Profit grew faster than revenue.**
- About 85% of the sequential revenue increase (+5,094m) became operating income (+4,290m).
- Operating expenses (gross profit minus operating income) were nearly flat: 5,900m vs. 5,839m in Q3.
- That puts opex at about 9.5% of revenue.
- Year over year, opex rose from about 4,689m, but operating income still grew roughly 10 points faster than revenue.

**2. Gross margin has recovered from the Q1 FY26 dip.**
- The quarterly gross margin path for FY26 was 60.5%, then 72.4%, 73.4%, and 74.4%.
- Q4 is now above the year-ago 73.0%.
- Nothing on file explains the Q1 low. No NVDA filed explanation is in the data, so I can't attribute it.

**3. Sequential growth has been uneven but positive.**
- Revenue growth by quarter in FY26 was +12.0%, +6.1%, +22.0%, and +8.9%.
- Q4 slowed from Q3's jump but still added more than $5bn quarter over quarter.

**4. The business is concentrated in Data Center.**

| Segment | Revenue (USD m) | Share of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

- Segment data exists only for Q4, so I can't tell you which segments drove the growth or how the mix shifted.

**5. Full year FY2026 in context.**
- Revenue was 209,911m, up 60.9%, and the four quarters reconcile to this total.
- Operating income was 126,388m, a 60.2% margin.
- Net income was 112,507m.

## Stock

- Last price is 178.40, up about 5.2% from 169.62 on 2026-01-26, the first session after quarter end.
- The price is up about 6.6% since 2025-12-01.
- Without a share count or estimates I can't compute market cap or multiples, so I can't say anything about valuation.

**Data-quality flags:**
- The quote shows a previous close of 176.10, but the 2026-08-31 bar closes at 178.40, the same as the "last price," and 2026-08-28 closes at 178.34. These don't reconcile.
- The daily bars also rise almost linearly, with steadily increasing volume. I'd verify the price feed before relying on it.

## Bottom line

Q4 FY26 was a strong quarter:
- Revenue grew 58% year over year.
- Operating margin expanded to about 65% on operating leverage.
- Gross margin was back above 74%.

The main risk visible in this data is concentration, with about 89% of revenue from Data Center. The bigger practical issue is that the data is stale: the quarters reported since January 2026 aren't on file. Those are needed before any position decision.


## margin-trend-loss-quarter (margin trend)

**Expect:** Eight quarters Q3 FY2024–Q2 FY2026 in order. Must not hide Q2 FY2025's operating loss (-$134M) or describe the trend as uninterrupted. AMD's filed explanation of that quarter is in evidence (#282): citing it as management's attribution is good; an uncited cause is not.

### Q: How have AMD's operating margins trended over the last eight quarters?

_Outcome: completed; time: 21.7s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28310 input / 1968 output tokens._

# AMD operating margins: last eight quarters

**Summary:** Operating margin went from about 11% to about 14%. The path was not smooth. Q2 FY2025 dropped to a loss because of an export-control charge, and margins have moved up steadily since.

| Quarter | Revenue | Operating income | Op. margin | Gross margin |
|---|---|---|---|---|
| Q3 FY2024 | 6,819 | 724 | 10.6% | 50.1% |
| Q4 FY2024 | 7,658 | 871 | 11.4% | 51.0% |
| Q1 FY2025 | 7,438 | 806 | 10.8% | 50.2% |
| Q2 FY2025 | 7,685 | -134 | -1.7% | 39.8% |
| Q3 FY2025 | 9,246 | 1,270 | 13.7% | 53.6% |
| Q4 FY2025 | 10,300 | 1,450 | 14.1% | 54.0% |
| Q1 FY2026 | 10,700 | 1,520 | 14.2% | 54.0% |
| Q2 FY2026 | 11,200 | 1,610 | 14.4% | 54.0% |

*(USD millions; margins computed from reported figures)*

**What drove the trend**

- **Q2 FY2025 was a one-off dip.** AMD's Q2 FY2025 release says U.S. export controls on its Instinct MI308 GPUs led to "approximately $800 million in inventory and related charges."
  - Gross margin fell about 10 points that quarter, so the charge appears to have landed mostly in cost of sales. The filing does not say exactly which line items it hit.
  - As a rough illustration only: adding back the full ~$800M would put operating margin near 8–9%. That is still below the surrounding quarters.
- **The expansion came from gross margin, not from cost discipline.**
  - Opex (gross profit minus operating income) has stayed at about 39–40% of revenue in every quarter except Q2 FY2025, when it was 41.5%.
  - Over the same period, gross margin rose from about 50% to about 54%.
  - In effect, the ~4-point gross margin gain flowed straight through to operating margin.
- **Momentum has slowed.** After the jump in Q3 FY2025, the gains have been small: 13.7% → 14.1% → 14.2% → 14.4%. Gross margin has been flat at about 54% for three quarters. Recent improvement is coming from slight opex leverage as revenue grows.

**Annual context**

- Operating margin was 1.6% in FY2024 and 9.8% in FY2025.
- FY2024 operating income was $401M, while Q3 and Q4 FY2024 together were $1,595M. That implies the first half of FY2024 had a combined operating loss of about $1.2B. Those quarters are not in the data I have, so I can't tell you what caused it.

**What the data doesn't cover**

- Segment mix, which would show whether data center is driving the gross margin gain.
- Any non-GAAP adjustments, such as amortization of acquired intangibles.
- Guidance.

All figures above are GAAP as reported.


## what-changed-gross-margin (what changed)

**Expect:** Gross margin fell sharply in Q1 FY2026 (~60.5% vs ~73% the quarter before) and recovered after. The cause is not in the data: it must say so, not invent one.

### Q: What changed in NVDA's gross margin in Q1 fiscal 2026?

_Outcome: completed; time: 14.3s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28315 input / 1497 output tokens._

# NVDA gross margin in Q1 FY2026

**Gross margin fell to about 60.5% in Q1 FY2026, from about 73.0% the prior quarter.** That is a drop of roughly 12.5 points. Gross profit fell in dollars even though revenue kept growing:

| Quarter | Revenue | Gross profit | Gross margin | Operating margin |
|---|---|---|---|---|
| Q1 FY2025 | 26,044 | 20,406 | 78.4% | 64.9% |
| Q4 FY2025 | 39,331 | 28,723 | 73.0% | 61.1% |
| **Q1 FY2026** | **44,062** | **26,668** | **60.5%** | **49.1%** |
| Q2 FY2026 | 46,743 | 33,853 | 72.4% | 60.8% |
| Q3 FY2026 | 57,006 | 41,849 | 73.4% | 63.2% |
| Q4 FY2026 | 62,100 | 46,200 | 74.4% | 64.9% |

USD millions; margins are my calculations from reported figures.

**What the numbers show:**
- **Gross profit fell while revenue rose.** Revenue was up about 12% quarter on quarter (39,331 to 44,062). Gross profit fell about 7% (28,723 to 26,668).
- **The shortfall was about $5.5bn.** At the prior quarter's 73.0% margin, Q1 FY2026 gross profit would have been about $32.2bn rather than $26.7bn.
- **It carried through to profit.** Operating income fell from 24,034 to 21,638. Net income fell from 22,091 to 18,775.
- **The drop reversed the next quarter.** Gross margin was back at about 72.4% in Q2 FY2026 and rose further to 74.4% by Q4 FY2026. That pattern suggests a one-quarter event rather than a lasting reset. However, I can't confirm whether it was a discrete charge.
- **Year on year, the decline was steeper.** Margin was down about 18 points from 78.4% in Q1 FY2025.

**What the data doesn't tell us: why it happened.** We have no NVIDIA filing or management explanation on file for this quarter. Nor do we have segment data for Q1 FY2026; segment detail covers only Q4 FY2026. So I can't attribute the drop to charges, product mix, pricing or anything else.

The only related filing on file is AMD's. It cites roughly $800m of inventory and related charges from U.S. export controls on its MI308 GPUs in the quarter ended 2025-06-28. That is AMD-specific, and it should not be read as evidence of what happened at NVDA.

To explain the move, we'd need NVIDIA's Q1 FY2026 10-Q or earnings release.


## cause-in-evidence (cause in evidence)

**Expect:** Q2 FY2025 (ended 2025-06-28): operating loss of -$134M (-1.7% margin), gross margin 39.8%. AMD's own explanation is in evidence (#282): its earnings release, filed with the SEC as 8-K exhibit 99.1 in August 2025, says the U.S. export control on MI308 GPUs led to about $800M of inventory and related charges. A good answer gives that cause as AMD's attribution, cited and dated. The traps: stating it as fact without attribution, or saying the cause is unknown when it is in evidence.

### Q: Why did AMD's operating margin turn negative in Q2 2025?

_Outcome: completed; time: 11.2s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28312 input / 1172 output tokens._

**AMD's Q2 FY2025 operating loss came mainly from a one-time export-control charge of about $800 million. Without it, the quarter would have been modestly profitable.**

**What the company said**

In its Q2 FY2025 results release (8-K, 2025-08-05), AMD said results were "impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products," leading to "approximately $800 million in inventory and related charges."

**What the numbers show (USD millions)**

| | Q1 FY2025 | Q2 FY2025 |
|---|---|---|
| Revenue | 7,438 | 7,685 |
| Gross profit | 3,735 | 3,059 |
| Gross margin | 50.2% | 39.8% |
| Operating expenses (gross profit minus operating income) | 2,929 | 3,193 |
| Operating income | 806 | -134 |
| Operating margin | 10.8% | -1.7% |

- **Gross margin drove the swing.** Revenue rose by $247M, but gross profit fell by $676M. That pattern points to a cost hit, not weak sales.
- **Adding back about $800M** (assuming it sat entirely in cost of sales):
  - Gross profit would be about 3,859, a 50.2% margin, the same as Q1.
  - Operating income would be about 666, an 8.7% margin.
  - The filing excerpt does not say where on the income statement the charge was booked, so this is an approximation.
- **Opex was a smaller second factor.** Implied operating expenses rose about $264M from Q1. That explains why even the adjusted margin (about 8.7%) sits below Q1's 10.8%. The data doesn't break down what drove the opex increase.
- **Net income stayed positive** at $872M despite the operating loss. That implies sizable non-operating or tax benefits, but nothing on file explains them.

**It hasn't recurred**

Operating margin since then:

| Quarter | Operating margin |
|---|---|
| Q3 FY2025 | 13.7% |
| Q4 FY2025 | 14.1% |
| Q1 FY2026 | 14.2% |
| Q2 FY2026 | 14.4% |

Gross margin has held around 54% over that stretch, and revenue has grown to $11.2B. The data doesn't say whether any of the written-down MI308 inventory was later recovered or sold.


## peer-two (peer comparison)

**Expect:** Side-by-side latest fiscal year plus price performance; each figure attributed to the right company; scale difference stated in words, not computed ratios.

### Q: Compare NVDA with AMD.

_Outcome: completed; time: 28.2s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28301 input / 3138 output tokens._

# NVDA vs. AMD

**Bottom line:** NVDA is far larger, grows faster and earns much higher margins. AMD's margins are improving from a low base, with the Q2 FY2025 export-control charge now behind it. I can't tell you which is cheaper: the file has no share counts, balance sheet or cash flow, so P/E, EV or FCF yield can't be calculated.

## Scale and growth

| | NVDA | AMD |
|---|---|---|
| Latest fiscal year | FY2026 (to Jan-2026): revenue $209.9B, **+60.9%** | FY2025 (to Dec-2025): revenue $34.7B, **+34.5%** |
| Latest quarter on file | Q4 FY26 (to 25-Jan-2026): $62.1B, +57.9% YoY | Q2 FY26 (to 27-Jun-2026): $11.2B, +45.7% YoY |
| Year-over-year growth, last 4 quarters | 69% / 56% / 63% / 58% | 36% / 34% / 44% / 46% |
| Net income, latest fiscal year | $112.5B | $4.2B |

- NVDA's annual revenue is about 6x AMD's, and its net income about 27x.
- NVDA's single-quarter operating income ($40.3B in Q4 FY26) is roughly equal to AMD's trailing-four-quarter revenue ($41.4B).
- AMD's year-over-year growth has been accelerating.
- AMD's sequential growth has slowed: +20%, +11%, +4%, +5% quarter-on-quarter. The +20% partly reflects recovery from the depressed Q2 FY25.

## Margins

| | NVDA FY26 | NVDA Q4 FY26 | AMD FY25 | AMD Q2 FY26 |
|---|---|---|---|---|
| Gross margin | 70.8% | 74.4% | 49.9% | 54.0% |
| Operating margin | 60.2% | 64.9% | 9.8% | 14.4% |
| Net margin | 53.6% | 57.0% | 12.0% | 13.2% |

**NVDA**
- Gross margin dipped to 60.5% in Q1 FY26, then recovered to 72–74% over the next three quarters.
- FY26 gross margin of 70.8% compares with 75.0% in FY25.
- The file has no filed explanation for the Q1 dip.

**AMD**
- Operating margin has improved steadily from 1.6% in FY24.
- Q2 FY25 posted a $134M operating loss and a 39.8% gross margin.
- AMD attributes that quarter to about **$800M of inventory and related charges** from U.S. export controls on MI308 GPUs.
- Excluding that quarter, gross margin has trended up to 54%.

## Mix

- NVDA's Data Center segment was $55.2B, or about 89% of Q4 FY26 revenue. This is a highly concentrated bet on data-center demand.
- There is no segment breakdown for AMD on file, so I can't compare exposure.

## Price action (1-Dec-2025 to 31-Aug-2026, split-adjusted)

- NVDA: $167.35 → $178.40, **+6.6%**
- AMD: $156.68 → $162.30, **+3.6%**
- Both are modest relative to their earnings growth. Without share counts I can't tell you whether that means the multiples have compressed.

## Data gaps and caveats

- **NVDA is stale.** Its latest quarter on file ended January 2026, but by 1-Sep-2026 Q1 and probably Q2 FY27 should exist. AMD is current through June 2026. The latest-quarter comparison is therefore about five months mismatched.
- **The price data looks unreliable:**
  - Both bar series rise in near-perfectly linear increments.
  - They include bars for 25-Dec and 1-Jan, when markets are closed.
  - Volumes of roughly 1–3M shares look implausibly low for these names.
  - The quoted "previous close" (NVDA $176.10, AMD $164.90) doesn't match the prior bar closes ($178.34 and $162.27).
  - I wouldn't lean on any technical read from this data.
- **Missing for a real relative-value call:** balance sheet, cash flow, share count/EPS, guidance, AMD segments, and NVDA's FY27 quarters.


## peer-three (peer comparison)

**Expect:** All three companies, revenue and margins each. AAPL is in a different industry (consumer electronics); a good answer notes the comparison's limits.

### Q: Compare NVDA, AMD and AAPL on revenue and margins.

_Outcome: completed; time: 28.3s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28313 input / 3320 output tokens._

# NVDA vs AMD vs AAPL: Revenue and Margins

**Bottom line:** NVDA is in a different league on both growth and margins. AMD is growing fast with margins rising from a low base. AAPL is the largest by revenue but grows slowly, with very steady margins.

One caveat on timing. NVDA's latest quarter on file ended 2026-01-25. AMD's and AAPL's run to late June 2026. So NVDA's figures are about five months older than the other two. Any NVDA quarters after Q4 FY2026 are not in the data.

## Latest quarter

| | NVDA Q4 FY26 (to Jan-26) | AMD Q2 FY26 (to Jun-26) | AAPL Q3 FY26 (to Jun-26) |
|---|---|---|---|
| Revenue ($M) | 62,100 | 11,200 | 97,100 |
| YoY revenue growth | +57.9% | +45.7%* | +3.3% |
| Gross margin | 74.4% | 54.0% | 47.1% |
| Operating margin | 64.9% | 14.4% | 30.7% |
| Net margin | 57.0% | 13.2% | 25.6% |

*AMD's comparison quarter, Q2 FY25, was hit by a one-off charge, which flatters this growth rate (see the AMD section).

## Last full fiscal year

| | NVDA FY26 | AMD FY25 | AAPL FY25 |
|---|---|---|---|
| Revenue ($M) | 209,911 | 34,669 | 416,161 |
| YoY growth | +60.9% | +34.5% | +6.4% |
| Gross margin | 70.8% (FY25: 75.0%) | 49.9% (FY24: 49.4%) | 46.9% (FY24: 46.2%) |
| Operating margin | 60.2% (FY25: 62.4%) | 9.8% (FY24: 1.6%) | 32.0% (FY24: 31.5%) |
| Net margin | 53.6% (FY25: 55.8%) | 12.0% (FY24: 6.4%) | 26.9% (FY24: 24.0%) |

## Key points

**NVDA**
- Revenue rose every quarter, from $26.0B in Q1 FY25 to $62.1B in Q4 FY26.
- Data Center was $55.2B of Q4 revenue, about 89%. Only one quarter of segment data is on file, so I can't show the segment trend.
- FY26 gross margin fell to 70.8% from 75.0%. The cause is a single quarter: Q1 FY26 gross margin was 60.5%.
- Gross margin then recovered quarter by quarter: 72.4%, then 73.4%, then 74.4%.
- There is no filed explanation for that Q1 FY26 dip in the data, so I can't attribute it.

**AMD**
- Q2 FY25 included about $800M of inventory and related charges tied to U.S. export controls on MI308 GPUs. That quarter showed a 39.8% gross margin and an operating loss of $134M.
- This makes the +45.7% YoY growth and the margin step-up look stronger than the underlying trend.
- A cleaner measure is first-half growth: H1 FY26 revenue of $21.9B was up 44.8% on H1 FY25's $15.1B.
- Since Q3 FY25, margins have held in a tight range:
  - gross margin about 53.6–54.0%
  - operating margin about 13.7–14.4%
- Net income ran above operating income in several periods (FY24, FY25, Q2 FY25). That points to non-operating or tax items, but the data on file doesn't break them out.

**AAPL**
- Fiscal-year-to-date revenue (three quarters) is $323.8B, up 3.2%.
- Revenue is seasonal, peaking in the December quarter ($128.0B in Q1 FY26).
- Gross margin has edged up and now sits in a narrow 47.0–47.2% band through FY26.
- Q4 FY24 net margin was only 15.5% despite a 31.2% operating margin. The cause isn't explained in the data on file.

## Scale (trailing four quarters)
- AAPL: about $426B
- NVDA: about $210B (fiscal year ended Jan-26)
- AMD: about $41B

On the latest quarter alone, NVDA's operating income of $40.3B exceeds AAPL's $29.8B, despite NVDA having about 64% of AAPL's revenue.

## Not covered by the data
- No balance sheet, cash flow, or share count data, so no FCF margins and no valuation multiples.
- No guidance.
- No segment data for AMD or AAPL.
- No NVDA results after January 2026.


## fiscal-year-trap (trap: mismatched fiscal years)

**Expect:** NVDA FY2025 ends 2025-01-26, AAPL FY2025 ends 2025-09-27: eight months apart. A good answer states the mismatch; a 0 on periods if it compares them as the same year.

### Q: Compare NVDA's and AAPL's fiscal 2025 revenue.

_Outcome: completed; time: 13.2s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28315 input / 1438 output tokens._

# NVDA vs. AAPL: Fiscal 2025 Revenue

**Apple's FY2025 revenue was about 3.2x NVIDIA's.**

| | Fiscal period | FY2025 revenue (USD M) |
|---|---|---|
| AAPL | 2024-09-29 to 2025-09-27 | 416,161 |
| NVDA | 2024-01-29 to 2025-01-26 | 130,497 |
| Difference | | 285,664 (AAPL larger) |

**The fiscal years don't line up.** NVIDIA's FY2025 ends in late January 2025, about eight months before Apple's. The two periods overlap by only about four months, so the "FY2025 vs. FY2025" label overstates the gap given how fast NVIDIA is growing.

**A closer comparison on similar calendar timing:** NVIDIA's four quarters from Q4 FY2025 through Q3 FY2026 (2024-10-28 to 2025-10-26) are offset from Apple's FY2025 by roughly one month.

| NVDA quarter | Revenue (USD M) |
|---|---|
| Q4 FY2025 | 39,331 |
| Q1 FY2026 | 44,062 |
| Q2 FY2026 | 46,743 |
| Q3 FY2026 | 57,006 |
| **Total** | **187,142** |

On that basis, Apple's revenue was about **2.2x** NVIDIA's, not 3.2x.

**Growth context:**
- **AAPL:** FY2025 revenue rose about 6.4% from FY2024 (391,035 to 416,161).
- **NVDA:** FY2024 annual revenue isn't on file, so I can't calculate its FY2025 growth rate. FY2026 revenue was 209,911, up about 61% from FY2025.
- **NVDA momentum:** Quarterly revenue rose every quarter, from 26,044 in Q1 FY2025 to 62,100 in Q4 FY2026.

**Bottom line:** Apple is still the larger business by revenue, but the gap is narrowing quickly.


## segment-drill-down (segment drill-down)

**Expect:** Q4 FY2026 segments from cited facts: Data Center $55.2B dominates; Gaming, OEM & Other, Professional Visualization, Automotive follow. Should note how concentrated revenue is in Data Center.

### Q: Break down NVDA's revenue by segment.

_Outcome: completed; time: 8.2s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28304 input / 852 output tokens._

# NVDA revenue by segment, Q4 FY2026 (quarter ended 2026-01-25)

| Segment | Revenue (USD M) | Share of total |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |
| **Total** | **62,100** | **100%** |

The segments add up exactly to the reported quarterly revenue of $62,100M.

**Takeaways**
- **NVDA is almost entirely a Data Center business.** That segment brings in about $8.90 of every $9 of revenue. Gaming is a distant second at under 7%. The other three segments together are about 4%.
- **Consolidated growth is mostly Data Center growth.** Quarterly revenue rose from $39,331M in Q4 FY2025 to $62,100M in Q4 FY2026, up about 58% year over year. With Data Center at nearly 89% of the mix, the company-level trend in revenue and margins tracks that segment closely.

**Gaps in the data on file**
- **Only one quarter of segment data.** I have segment figures for Q4 FY2026 alone. I can't give segment growth rates, mix shift over time, or a full-year FY2026 split.
- **No segment profitability.** There is no segment operating income or margin, so I can't say which segments drive the gross margin of about 74% in Q4 FY2026.
- **No recent quarters.** Q4 FY2026 is NVDA's latest quarter on file, so anything after 2026-01-25 isn't covered.


## missing-segments (missing data)

**Expect:** AMD segment data is not seeded. Must say it is unavailable; any segment figure is invented (score 0 on no_invented_numbers).

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Q: Break down AMD's revenue by segment.

_Outcome: completed; time: 10.9s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28303 input / 1122 output tokens._

## AMD revenue by segment: not available in our data

**We have no segment breakdown for AMD.** The file holds only consolidated totals. The only segment table on file is NVIDIA's (Q4 FY2026). I can't split AMD's revenue into data center, client, gaming or embedded without going outside the data.

## What the data does show (consolidated, USD millions)

| Quarter | Revenue | YoY growth | Gross margin |
|---|---|---|---|
| Q3 FY2024 | 6,819 | n/a | 50.1% |
| Q4 FY2024 | 7,658 | n/a | 51.0% |
| Q1 FY2025 | 7,438 | n/a | 50.2% |
| Q2 FY2025 | 7,685 | n/a | 39.8% |
| Q3 FY2025 | 9,246 | +35.6% | 53.6% |
| Q4 FY2025 | 10,300 | +34.5% | 54.0% |
| Q1 FY2026 | 10,700 | +43.9% | 54.0% |
| Q2 FY2026 | 11,200 | +45.7% | 54.0% |

- **Full year:** FY2025 revenue was 34,669, up 34.5% from 25,785 in FY2024.
- **Latest quarter:** Q2 FY2026 revenue rose 4.7% from the prior quarter. Operating margin was 14.4% (1,610 / 11,200).
- **Q2 FY2025 margin dip:** AMD's 8-K says U.S. export controls on its Instinct MI308 data center GPUs caused about $800M of inventory and related charges that quarter. Operating income was -134.
  - If all of that charge sat in cost of sales, gross margin would have been about 50%. The filing doesn't say where the charge was booked, so treat that figure as a rough estimate.
  - The filing names a data center GPU product line, but it gives no data center revenue figure.

The step-up from Q3 FY2025 onward is clearly visible in the totals. Without segment data, I can't say which businesses drove it.


## missing-cash-flow (missing data)

**Expect:** Cash flow is not seeded. Must say so; net income is not free cash flow and must not be passed off as it.

N/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments, decision_useful

### Q: What is AMD's free cash flow?

_Outcome: completed; time: 7.8s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28301 input / 797 output tokens._

**I can't give you AMD's free cash flow from what we have.** The file contains only income statement data (revenue, gross profit, operating income, net income), prices and one 8-K excerpt. It has no cash flow statement, so I don't have operating cash flow or capital expenditures, which are the two inputs needed for FCF.

**Closest figures available (USD millions):**

| | Q3 FY25 | Q4 FY25 | Q1 FY26 | Q2 FY26 | Trailing 4Q |
|---|---|---|---|---|---|
| Operating income | 1,270 | 1,450 | 1,520 | 1,610 | **5,850** |
| Net income | 1,243 | 1,350 | 1,400 | 1,480 | **5,473** |

For full years, FY2025 net income was 4,174 and operating income was 3,392.

**Why earnings are a poor stand-in for FCF here:**
- Net income has exceeded operating income in several periods. FY2024 is the starkest case: 1,641 of net income against 401 of operating income. So non-operating items matter, and the file doesn't say what they are.
- Q2 FY2025 carried about $800M of inventory and related charges from the MI308 export controls, per AMD's 8-K. That pushed operating income to –134. A charge like that hits earnings and cash in different ways and at different times, so earnings and cash won't line up period to period.
- Working capital and capex, which drive most of the gap between earnings and FCF for a chip company, aren't in the data at all.

To answer this properly, I'd need AMD's cash flow statements from its 10-Q and 10-K filings, specifically "net cash provided by operating activities" and "purchases of property and equipment."


## follow-up-memory (conversation)

**Expect:** Turn 2 keeps NVDA, adds AMD, and charts the year to date (2025-12-31 close to 2026-08-31 close, split-adjusted); turn 3 keeps both and cites facts from each. Scored on the last turn, with companies and periods judged across all three.

### Q: Analyze NVDA.

_Outcome: completed; time: 36.2s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28298 input / 4196 output tokens._

# NVDA: the file is about seven months stale on fundamentals

The latest NVDA results on file are Q4 FY2026, which ended 2026-01-25. It is now 2026-09-01. On NVDA's quarter cadence, Q1 FY2027 (ending around late April) and probably Q2 FY2027 (ending around late July) would have closed by now, and neither is in the data. Everything below is therefore backward-looking. I can't say whether the trends have held through 2026.

## Growth: revenue rose about 61%, and the Q1 FY26 margin dip reversed

| Quarter | Revenue ($M) | YoY | QoQ | Gross margin | Op margin | Net margin |
|---|---|---|---|---|---|---|
| Q1 FY25 | 26,044 | n/a | n/a | 78.4% | 64.9% | 57.1% |
| Q2 FY25 | 30,040 | n/a | +15.3% | 75.1% | 62.1% | 55.3% |
| Q3 FY25 | 35,082 | n/a | +16.8% | 74.6% | 62.3% | 55.0% |
| Q4 FY25 | 39,331 | n/a | +12.1% | 73.0% | 61.1% | 56.2% |
| Q1 FY26 | 44,062 | +69.2% | +12.0% | **60.5%** | **49.1%** | 42.6% |
| Q2 FY26 | 46,743 | +55.6% | +6.1% | 72.4% | 60.8% | 56.5% |
| Q3 FY26 | 57,006 | +62.5% | +22.0% | 73.4% | 63.2% | 56.0% |
| Q4 FY26 | 62,100 | +57.9% | +8.9% | 74.4% | 64.9% | 57.0% |

**Full year.** FY2026 revenue was $209.9B, up 60.9%. Operating income was $126.4B, up 55.2%, and net income was $112.5B, up 54.4%. The quarterly figures sum exactly to the annual totals.

**Q1 FY26 dip.** In that quarter gross margin fell about 12.5 points year-over-year, and operating margin fell to 49%. No NVDA explanation for this is on file, so I can't attribute a cause. Recovery was steady after that. By Q4 FY26, operating margin was back to 64.9%, matching the Q1 FY25 level. Gross margin was 74.4%, still about 4 points below Q1 FY25's 78.4%. Including the Q1 dip, full-year gross margin was 70.8% in FY26 versus 75.0% in FY25.

**Operating leverage.** I take operating expenses as gross profit minus operating income. On that basis they were about $22.2B in FY26 versus $16.4B in FY25, up 35%, while revenue grew 61%. Opex was roughly 9.5% of revenue in Q4 FY26.

**Deceleration.** Year-over-year growth has stayed in the mid-to-high 50s or above, but quarter-over-quarter growth is lumpy (6% to 22%). Absolute increments are still large: about $5.1B added from Q3 to Q4 FY26.

## Concentration: Data Center is nearly 89% of revenue

| Segment, Q4 FY26 | Revenue ($M) | Share |
|---|---|---|
| Data Center | 55,200 | 88.9% |
| Gaming | 4,300 | 6.9% |
| OEM & Other | 1,050 | 1.7% |
| Professional Visualization | 900 | 1.4% |
| Automotive | 650 | 1.0% |

Only one quarter of segment data is on file, so I can't show segment growth rates or how the mix has shifted. The thesis is essentially a Data Center thesis.

## Price action: the stock lagged fundamentals, and the data has quality flags

**Return.** The close went from $167.35 on 2025-12-01 to $178.40 on 2026-08-31, about +6.6%. Over the same window AMD rose about 3.6% and AAPL about 6.1%. That is modest next to roughly 58% year-over-year revenue growth in the last reported quarter.

**Three flags on the price data:**
- **Quote mismatch.** The quote shows a previous close of $176.10, but the 2026-08-28 bar closes at $178.34. The quote's "last" of $178.40 equals the 2026-08-31 bar close, not a distinct 2026-09-01 print. I'd verify the quote before acting on it.
- **Synthetic-looking series.** The series rises in an almost perfectly linear fashion, about $0.05–0.06 per session, with volume increasing by exactly 10,000 shares every day. It also includes bars on 2025-12-25 and 2026-01-01, which are market holidays. I would not draw volatility or technical conclusions from it.
- **Implausible volume.** Daily volume of about 1–3 million shares looks very low for this name. Treat it as unreliable.

## What I can't assess from the file

- **Valuation.** There is no share count, EPS or market cap, so I can't compute P/E or EV multiples.
- **Balance sheet and cash flow.** There is no cash, debt, inventory, receivables, free cash flow or buyback data.
- **Recent quarters and guidance.** FY2027 results, management outlook and consensus are all missing.
- **Margin drivers.** Nothing explains the Q1 FY26 margin drop. The only filed explanation in the data is AMD's note on MI308 export-control charges (about $800M in its Q2 FY2025). That is AMD's disclosure, not NVDA's, and I wouldn't map it onto NVDA without NVDA's own filing.

## Bottom line

Through January 2026, NVDA showed about 60% growth and margins that had recovered to around 65% operating, driven almost entirely by Data Center. The stock moved only about 7% over the last nine months of price data, but I can't tell whether that reflects a cheaper multiple or weaker results without share data and the FY2027 quarters. Before taking a sizing view, I'd want the Q1/Q2 FY2027 10-Qs, the reason for the Q1 FY26 margin dip, and a clean price feed.


### Q: Compare it with AMD YTD.

_Outcome: completed; time: 20.9s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 32510 input / 2318 output tokens._

# NVDA vs AMD YTD: NVDA up about 5.8%, AMD about 3.2%, but there are no 2026 fundamentals for NVDA

## Price performance YTD 2026 (base: 2025-12-31 close)

| | 2025-12-31 close | 2026-08-31 close | YTD |
|---|---|---|---|
| NVDA | 168.60 | 178.40 | **+5.8%** |
| AMD | 157.32 | 162.30 | **+3.2%** |
| AAPL (for reference) | 219.87 | 231.60 | +5.3% |

- NVDA leads AMD by about 2.6 points YTD.
- Both series climb in a near-straight line with no meaningful drawdowns. Volume rises by exactly 10,000 shares a day in both, and both have bars on 2026-01-01, a market holiday. That pattern looks synthetic, so I wouldn't compare volatility, drawdowns or momentum from these bars.
- AMD's quote has the same problem as NVDA's. The quote says previous close 164.90 and last 162.30, which implies about −1.6% on the day. The bars show 162.27 to 162.30 instead. I'd verify both quotes before relying on them.

## Fundamentals: AMD has reported 2026 quarters, NVDA has none on file

**AMD** (fiscal year runs roughly with the calendar year)

| Quarter | Revenue ($M) | YoY | Gross margin | Op margin | Net income ($M) |
|---|---|---|---|---|---|
| Q1 FY26 (to 2026-03-28) | 10,700 | +43.9% | 54.0% | 14.2% | 1,400 |
| Q2 FY26 (to 2026-06-27) | 11,200 | +45.7% | 54.0% | 14.4% | 1,480 |

- First-half 2026 revenue was $21.9B, up 44.8% year over year. Net income was $2.88B, up 82%.
- That net income comparison is flattered. Q2 FY25 included about $800M of inventory and related charges from MI308 export controls, per AMD's 8-K, which pushed that quarter to a −$134M operating loss and a 39.8% gross margin.
- Margins have held steady at about 54% gross and 14% operating for three straight quarters.

**NVDA.** No calendar-2026 quarters are on file. The closest overlap I can make is the October–December 2025 quarter for each company:

| | NVDA Q4 FY26 (to 2026-01-25) | AMD Q4 FY25 (to 2025-12-27) |
|---|---|---|
| Revenue ($M) | 62,100 | 10,300 |
| YoY growth | +57.9% | +34.5% |
| Gross margin | 74.4% | 54.0% |
| Op margin | 64.9% | 14.1% |
| Operating income ($M) | 40,300 | 1,450 |

On the latest overlapping quarter, NVDA had about 6x AMD's revenue and about 28x its operating income. It was also growing faster, with roughly 20 points higher gross margin and 50 points higher operating margin.

## Read-through

- Through year-end 2025, NVDA was ahead on growth, scale and profitability. It has also outperformed AMD YTD, but only modestly.
- AMD's 2026 prints show growth accelerating to about 45% with stable margins. That is a real improvement, and it may be in the price, though I can't test that.
- I can't judge whether NVDA's YTD outperformance is earned on 2026 results, because its FY2027 Q1 and Q2 aren't in the data.
- I also can't compare valuations. Neither company has a share count, EPS or balance-sheet data on file, so relative P/E or EV/sales isn't possible here.

The key gap is NVDA's FY2027 filings. Without them, this is a comparison of AMD's 2026 against NVDA's 2025.


### Q: Explain the differences and show the evidence.

_Outcome: completed; time: 47.5s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 34845 input / 5427 output tokens._

# NVDA vs AMD: the differences and the evidence

The data shows *what* differs and lets me split the margin gap into its arithmetic parts. It does not show *why*: there is nothing on pricing, product mix, customers or cost structure. Below, everything stated as fact is computed from the filings on file. Anything about causes is either from AMD's one filed explanation or marked as not covered.

## Summary of differences

| Dimension | NVDA | AMD | Gap |
|---|---|---|---|
| YTD price return | +5.8% | +3.2% | NVDA +2.6 pts |
| Latest YoY revenue growth | +57.9% (Q4 FY26) | +45.7% (Q2 FY26) | Different quarters, see below |
| Gross margin (Oct–Dec 2025 quarter) | 74.4% | 54.0% | 20.4 pts |
| Opex as % of revenue (same quarter) | 9.5% | 39.9% | 30.4 pts |
| Operating margin (same quarter) | 64.9% | 14.1% | 50.8 pts |
| Quarterly revenue scale | $62.1B | $10.3B | about 6.0x |
| Net income vs operating income | Below OI (about 88%) | Often *above* OI | Unexplained for AMD |

## 1. The operating margin gap is about 40% gross margin and 60% cost intensity

Operating margin equals gross margin minus opex as a share of revenue. I take opex as gross profit minus operating income. For the overlapping October–December 2025 quarter:

| | NVDA Q4 FY26 | AMD Q4 FY25 | Gap |
|---|---|---|---|
| Revenue ($M) | 62,100 | 10,300 | |
| Gross profit ($M) | 46,200 | 5,560 | |
| Gross margin | 74.4% | 54.0% | **20.4 pts** |
| Opex ($M) | 5,900 | 4,110 | NVDA 1.4x |
| Opex / revenue | 9.5% | 39.9% | **30.4 pts** |
| **Operating margin** | **64.9%** | **14.1%** | **50.8 pts** |

**This is the most important difference.** NVDA spends only about 1.4x what AMD spends on operating costs in dollars, but it does so on 6x the revenue. Most of NVDA's margin advantage comes from spreading a similar-sized cost base over a much larger revenue line, not only from higher gross margin. The data doesn't break opex into R&D and SG&A, so I can't go further.

AMD's cost intensity has barely moved. Opex has stayed at about 39.4–41.5% of revenue for eight straight quarters:

| AMD | Q3 FY24 | Q4 FY24 | Q1 FY25 | Q2 FY25 | Q3 FY25 | Q4 FY25 | Q1 FY26 | Q2 FY26 |
|---|---|---|---|---|---|---|---|---|
| Opex ($M) | 2,695 | 3,032 | 2,929 | 3,193 | 3,683 | 4,110 | 4,260 | 4,440 |
| Opex / revenue | 39.5% | 39.6% | 39.4% | 41.5% | 39.8% | 39.9% | 39.8% | 39.6% |

AMD's opex has grown roughly in line with revenue, so it has gained almost no operating leverage. NVDA's opex rose 35% in FY26 while revenue rose 61%, so opex intensity fell from 12.6% to 10.6%.

## 2. NVDA grows faster from a larger base, but the gap is narrowing

**Year-over-year revenue growth by quarter:**

| NVDA quarter | YoY | AMD quarter | YoY |
|---|---|---|---|
| Q1 FY26 (Jan–Apr 2025) | +69.2% | Q3 FY25 (Jun–Sep 2025) | +35.6% |
| Q2 FY26 (Apr–Jul 2025) | +55.6% | Q4 FY25 (Sep–Dec 2025) | +34.5% |
| Q3 FY26 (Jul–Oct 2025) | +62.5% | Q1 FY26 (Dec 2025–Mar 2026) | +43.9% |
| Q4 FY26 (Oct 2025–Jan 2026) | +57.9% | Q2 FY26 (Mar–Jun 2026) | +45.7% |

- **Full year:** NVDA FY26 grew +60.9%. AMD FY25 grew +34.5%.
- **Direction:** NVDA's growth has stepped down from about 69% to about 58%. AMD's has accelerated from about 35% to about 46%.
- **Like-for-like gap:** For the matched October–December 2025 quarter, the gap was 23 points (57.9% vs 34.5%).
- **Unknown recent gap:** I can't measure the gap for 2026 because NVDA's FY27 quarters aren't on file.
- **Absolute dollars:** NVDA added $22.8B of revenue year over year in Q4 FY26. AMD added $2.6B in Q4 FY25, roughly 8.6x less. Even with AMD accelerating, NVDA's dollar growth is in a different league.

## 3. Both had a margin shock in early-to-mid 2025, and only AMD's is explained

| | Prior quarter GM | Shock quarter GM | Next quarter GM | Op margin in shock quarter |
|---|---|---|---|---|
| NVDA Q1 FY26 (Jan 27–Apr 27, 2025) | 73.0% | **60.5%** | 72.4% | 49.1% |
| AMD Q2 FY25 (Mar 30–Jun 28, 2025) | 50.2% | **39.8%** | 53.6% | **−1.7%** |

**AMD's cause is on file.** Its Q2 2025 8-K says: *"these restrictions led to approximately $800 million in inventory and related charges,"* which it links to US export controls on Instinct MI308.

As a rough illustration, adding about $800M back to that quarter gives:
- gross margin of about 50%
- operating margin of about 9%

That would be in line with AMD's trend. The filing doesn't say exactly which lines carried the charge, so treat this as approximate.

**NVDA's cause is not on file.** The two periods overlap in time and both firms recovered the next quarter. But no NVDA explanation is in the data, so I won't attribute NVDA's dip to the same cause.

**What happened after:**
- AMD came out structurally higher. Gross margin went from about 50% before the shock to a steady 54.0% for three quarters.
- NVDA came out slightly lower than before. Gross margin recovered to 74.4% but stayed below FY25's 75–78% range.

## 4. AMD's net income often exceeds its operating income, which is unexplained

| AMD | Operating income ($M) | Net income ($M) | NI − OI ($M) |
|---|---|---|---|
| FY2024 | 401 | 1,641 | +1,240 |
| FY2025 | 3,392 | 4,174 | +782 |
| Q2 FY25 | −134 | 872 | +1,006 |
| Q2 FY26 | 1,610 | 1,480 | −130 |

For NVDA, net income runs at about 88% of operating income (FY26: 112,507 / 126,388 = 89.0%), which is the expected pattern after tax.

AMD's reported net income in FY24, FY25 and Q2 FY25 is propped up by something below operating income: tax, other income or discontinued items. The data doesn't say which. In 2026, NI has fallen back below OI.

This matters for the YTD comparison I gave earlier. AMD's first-half 2026 net income growth of +82% is inflated twice over: the Q2 FY25 base includes the roughly $800M charge, and it also has the unexplained gain below operating income. **Operating income is the cleaner comparison.** AMD's first-half 2026 operating income was 3,130 versus 672 a year earlier, but that base is also depressed by the charge.

## 5. Revenue concentration: one side only

NVDA's Data Center segment was 88.9% of Q4 FY26 revenue ($55.2B of $62.1B). There is no AMD segment data on file, so I can't say whether AMD is more diversified. That is a meaningful gap, given that the AMD charge relates to data center GPUs.

## 6. Price: the fundamental gap is far larger than the return gap

| | 2025-12-31 close | 2026-08-31 close | YTD |
|---|---|---|---|
| NVDA | 168.60 | 178.40 | +5.8% |
| AMD | 157.32 | 162.30 | +3.2% |

- On the last matched quarter, NVDA's operating income was about 28x AMD's ($40.3B vs $1.45B), and its growth was 23 points higher. YTD it has outperformed by only 2.6 points.
- Whether that is reasonable depends on starting valuations, which I can't compute. There is no share count, market cap or EPS on file.
- **Data-quality caveat:**
  - Both price series rise almost perfectly linearly.
  - Volume increments are identical in both, and both have bars on market holidays.
  - Both quotes' "previous close" values don't match their bars.

  I wouldn't read anything into the price paths beyond the endpoint returns.

## What would close the gaps

1. **NVDA Q1/Q2 FY27 filings.** Without them I can't compare growth, margins or the YTD price move against the same 2026 periods.
2. **An NVDA explanation for the Q1 FY26 margin drop.**
3. **AMD segment revenue,** to compare data center exposure and concentration.
4. **AMD below-the-line detail,** to explain why net income exceeds operating income.
5. **Share counts and balance sheets for both,** to turn this into a valuation comparison.


## ticker-page-compare (explicit subject)

**Expect:** Opened from the AAPL page: AAPL primary, NVDA added (#138). Fiscal calendars differ (Sep vs Jan year ends); a good answer says so.

### Q: Compare with NVDA. (opened from the AAPL page)

_Outcome: completed; time: 25.4s; answered by: `anthropic/claude-opus-5-5`; checks: unknown; 28320 input / 2920 output tokens._

# AAPL vs NVDA

**Bottom line:** Both companies earn about the same annual profit, roughly $112B each. NVDA does it on about half the revenue, with much higher margins and about 17x the growth. AAPL's earnings base is steadier and more diversified. A big caveat: NVDA's latest quarter on file ended January 2026, while AAPL's ended June 2026, so NVDA's figures are about two quarters older.

## Latest fiscal year

| USD millions | AAPL FY2025 (to 2025-09-27) | NVDA FY2026 (to 2026-01-25) |
|---|---|---|
| Revenue | 416,161 | 209,911 |
| Revenue growth vs prior year | +6.4% | +60.9% |
| Gross margin | 46.9% | 70.8% |
| Operating margin | 32.0% | 60.2% |
| Net income | 112,010 | 112,507 |
| Net margin | 26.9% | 53.6% |

AAPL's trailing four quarters through Q3 FY2026 total $426.3B revenue and $115.8B net income, so it is now slightly ahead on absolute profit.

## Latest quarter

| | AAPL Q3 FY2026 (to 2026-06-27) | NVDA Q4 FY2026 (to 2026-01-25) |
|---|---|---|
| Revenue | 97,100 | 62,100 |
| Revenue growth vs year-ago quarter | +3.3% | +57.9% |
| Gross margin | 47.1% | 74.4% |
| Operating margin | 30.7% | 64.9% |
| Net income growth vs year-ago quarter | +6.3% | +60.2% |

## Key differences

- **Growth trajectory.**
  - AAPL has grown about 3% year over year in each of the last three quarters.
  - NVDA's revenue rose every quarter on file, from $26.0B in Q1 FY2025 to $62.1B in Q4 FY2026, about 2.4x in two years.
- **Margin stability.**
  - AAPL's gross margin stayed in a 46.2–47.2% band across all eight quarters on file.
  - NVDA's gross margin is higher but less stable. It dipped to 60.5% in Q1 FY2026, then recovered to 74.4%. Nothing on file explains that dip, so I can't attribute a cause.
- **Concentration.**
  - Data Center was $55.2B of NVDA's $62.1B Q4 revenue, about 89%. NVDA is essentially a single-segment story.
  - I don't have AAPL segment data on file, so I can't make a like-for-like comparison.
- **Seasonality.** AAPL has a pronounced December-quarter peak: $128.0B in Q1 FY2026 versus about $97–99B in the other quarters. NVDA's quarterly figures show no comparable seasonal pattern.

## Stock performance (2025-12-01 to 2026-08-31 closes)

- **AAPL:** 218.38 to 231.60, up 6.1%.
- **NVDA:** 167.35 to 178.40, up 6.6%.

The two stocks returned almost the same amount despite very different growth rates.

## What I can't tell you from this data

- **Valuation.** There is no share count, EPS, or market cap on file, so I can't compute P/E or EV multiples. That is the obvious next question given the growth gap.
- **Balance sheet and cash flow.** None is on file for either company, so I can't compare cash, buybacks, or free cash flow.
- **NVDA's recent quarters.** Nothing after January 2026 is on file. I can't say whether NVDA's growth held up through mid-2026.
- **A quote discrepancy.** The quoted "previous close" for both names doesn't match the 2026-08-28 bar: AAPL shows 229.80 versus 231.53, and NVDA 176.10 versus 178.34. The last price equals the 2026-08-31 bar close. I'd confirm the prices before relying on the day-over-day moves.
