# ADR 0006: The Valuation Model a Call Runs On

## Status

Proposed on 2026-11-10 for #226. The owner has not yet decided. This ADR authorizes no code. Once the owner approves the definitions below, implementation issues are filed under #205 before #226 closes.

## Context

ADR 0005 accepted the Call: the agent's opinion, kept apart from facts, with a stance relative to the owner's hurdle. It left the valuation model to #226. #226 asks for one bounded model with every input classified, two issuer probes, worked examples, and named outcomes for every failure.

The owner postponed #226 on 2026-10-06 "until annual FCF and dated forward evidence exist". Both exist now.

- **Annual free cash flow** (#211) is `free_cash_flow.v1`: FY operating cash flow less PP&E capex, both as reported (`services/financial-core/src/operations.ts:296`). It certifies only from `NetCashProvidedByUsedInOperatingActivities` and `PaymentsToAcquirePropertyPlantAndEquipment` (`services/fundamentals/src/sec-facts-repository.ts:1278`).
- **Dated forward evidence** (#592) is `consensus_captures`, captured daily since 2026-11-09. It holds EPS estimates, EPS growth, a target price and a recommendation. It holds no revenue, cash-flow or capex estimates (`services/dev-providers/dev_providers/finviz_consensus.py:46-54`).

What exists in the repo today, and what doesn't:

- **The engine refuses forecasts.** `forecast` ("guidance, estimates or forecasts") is an unsupported reason (`services/financial-engine/src/planner.ts:48-55`). No operation discounts, compounds or solves: there is no CAGR, present value, terminal value or solver in financial-core.
- **A result is exact or a named gap.** Arithmetic uses exact rationals; division keeps 50 significant digits, rounded half-even (`services/financial-core/src/numeric-policy.ts:17-22`). A failed computation is a gap with a reason code such as `missing_input`, `stale_input`, `incompatible_period`, `incompatible_currency`, `non_positive_base` or `numeric_limit_exceeded` (`services/financial-core/src/contracts.ts:86-142`).
- **Debt and cash are reported as components.** `sec-edgar.ts` maps the four debt parts and five cash and securities parts, and defers total debt to "a reviewed debt definition (#226)" (`services/fundamentals/src/sec-edgar.ts:290-292`).
- **Balances certify only from a 10-K** (`sec-facts-repository.ts:1306-1311`).
- **Shares** are the newest cover count; a count past the age limit is `stale_input` (`SHARE_COUNT_MAX_AGE_DAYS`, `services/financial-engine/src/select-inputs.ts:87`).

The hand-worked Calls of 2026-11-09 (`.audit/hand-calls-2026-11-09/`, not in git) used a seven-driver model: revenue growth, margin path, tax rate, cash conversion, share change, exit multiple and discount rate. Their audit found that the stance turned on the exit multiple and the bear case, and that the part that held up was the reverse solve at today's multiple, which used only reported inputs.

## Decision

### Model: per-share free cash flow, five years, exit multiple

For growth `g`, value per share at the Call date is

```
V(g) = Σ_{t=1..5} F0 (1+g)^t / (S0 (1+d)^t) / (1+r)^t
     + X · F0 (1+g)^5 / (S0 (1+d)^5) / (1+r)^5
     + N / S0
```

| Symbol | Meaning | Kind | Source and rule |
|---|---|---|---|
| `F0` | Starting free cash flow | Deterministic result over reported facts | `free_cash_flow.v1` for the latest fiscal year whose 10-K was filed on or before the Call date. Certified inputs only. |
| `S0` | Shares outstanding | Reported fact | Newest cover count on or before the Call date, under the engine's age rule. |
| `N` | Net cash | Deterministic result over reported facts | `net_cash.v1` below, from the same 10-K's balance sheet. |
| `P` | Price | Market observation | Close on or before the Call date from `price_observations`. |
| `r` | Required return | Owner policy | ADR 0005 hurdle setting, annual, effective. |
| `g` | Annual growth of free cash flow per share before dilution | Agent assumption, or the solved result | An assumption carries its basis (ADR 0005). |
| `d` | Annual share change | Agent assumption | Default value: last fiscal year's `stock_based_compensation` ÷ market cap at the Call date. The ratio is computed from reported figures, but using it as the future rate is judgment, so its basis is judgment unless a cited range backs it. Valid range: `d > −100%`. Buybacks are not counted: they are paid out of the free cash flow already valued. |
| `X` | Exit multiple of year-5 free cash flow | Agent assumption, or today's multiple | Today's multiple is the deterministic result `(P · S0 − N) / F0`. Any other value needs an anchor (ADR 0005 decline rule 1). Valid range: `X > 0`. |

Fixed conventions:

- **Horizon**: five annual periods. Cash flow `t` is discounted `t` full years from the Call date. The stub between the fiscal year end and the Call date is ignored; that is a known simplification.
- **Terminal**: the exit multiple at year 5 values the operating business only. Net cash is added once, at the Call date, undiscounted.
- **Units and currency**: USD. `F0` and `N` in USD, `S0` in shares, `V` in USD per share. A non-USD reporting currency, or a price in another currency, is the outcome `incompatible_currency`.
- **Rounding**: exact arithmetic throughout. Displayed values per share are rounded half-even to 2 decimals and growth to 0.1 percentage point, as in `services/financial-core/src/presentation.ts`.

Base, bear and bull cases are three assumption sets (`g`, `d`, `X`) on the same reported inputs. ADR 0005's `V` and `B` are `V(g)` under the base and bear sets.

### Net cash: a new reviewed definition

`net_cash.v1` = cash and securities − debt, every component taken from the same 10-K, at the same balance-sheet date.

- **Cash and securities**: `cash_and_equivalents` + `marketable_securities_current` + `marketable_securities_noncurrent` + `short_term_investments` + `debt_securities_current`. `cash_and_equivalents` is required; the other components are added when reported.
- **Debt**: `long_term_debt_current` + `long_term_debt_noncurrent` + `commercial_paper` + `short_term_borrowings`. At least one is required; the others are added when reported.
- **An absent component is never read as zero.** With no `cash_and_equivalents`, or none of the four debt keys, the result is `missing_input`. That includes a filer tagging only `LongTermDebt`, and a filer with no debt. Both are excluded from v1, which is a named limitation: a filer with no debt reports no debt line, and tags can't distinguish that from unmapped debt.
- **Excluded**: operating lease liabilities, equity investments, restricted cash, pension deficits and finance-arm receivables.
- **Overlap rule**: the cash and securities keys are distinct lines on a balance sheet. If a filer reports both `short_term_investments` and `marketable_securities_current`, or both `debt_securities_current` and `marketable_securities_current`, for one date, the result is `conflicting_evidence`, not a sum. Two keys for one line would count it twice.
- **Debt overlap**: a filer that reports commercial paper inside `ShortTermBorrowings` is not detectable from tags. This is a named limitation, listed among the Call's facts.

`total_debt.v1` is the debt half on its own. Both definitions become engine definitions and also resolve the net-debt half of #598.

### What the reverse solve solves for

**Required growth** is the `g` that makes `V(g) = P`, with `d`, `X` and `r` fixed. A Call shows it twice:

1. At today's multiple, with `X = (P · S0 − N) / F0`. This is the row the hand audit found checkable.
2. At the Call's assumed exit multiple, when that assumption is anchored.

**Domain**: `g` ∈ [−50%, +100%] a year.

**Monotonicity**: with `F0 > 0`, `S0 > 0`, `X > 0` and `r > 0`, and with `g > −1` and `d > −1`, each free-cash-flow and exit term of `V` is a positive constant times `(1+g)^t`, so it strictly increases in `g`. The net-cash term `N / S0` doesn't depend on `g` (and is negative under net debt), so `V` strictly increases in `g`. A unique solution exists exactly when `V(−50%) ≤ P ≤ V(100%)`.

**Method**: bisection to a bracket under 0.0001 (0.01 percentage point), at most 100 steps, shown to 0.1 point. With a bracketing check first and a strictly increasing `V`, bisection always converges inside 100 steps. Non-convergence is still a named outcome, so a coding error can't show a number.

### Named outcomes

Every outcome is shown in row 3 of the declined layout ("What the price requires") instead of a number.

This ADR adds **rule 0** ahead of ADR 0005's ordered stance rules: *Declined: an input outcome.* Any outcome below on `F0`, `S0`, `N`, `P`, currency or an input range leaves `V` and `B` uncomputable. The declined layout names that outcome as the matched rule.

The solver outcomes (below or above the domain, `numeric_limit_exceeded`) and the no-multiple-today outcome affect only the required-growth row. `V` and `B` come from the assumed `g`, not the solved one, so those outcomes don't decide the stance by themselves. ADR 0005's rules 1 to 6 still apply.

| Condition | Outcome |
|---|---|
| No certified FY free cash flow (missing OCF or capex, or capex tagged only as `PaymentsToAcquireProductiveAssets`) | Free cash flow is `blocked_dependency` on the missing input: no starting free cash flow |
| `F0 ≤ 0` | `non_positive_base`: the model needs positive free cash flow |
| Latest 10-K period ended more than 15 months before the Call date | `stale_input` |
| Shares missing or zero | `missing_input` |
| Shares past the engine's age rule, or a split gap from the engine's share-count rules | The engine's own reason (`stale_input`, `split_history_*`) |
| No price on or before the Call date | `missing_input` |
| No price within 5 trading days of the Call date | `stale_input` |
| No `cash_and_equivalents`, or no debt key, in the 10-K | `missing_input` (see net cash) |
| A net-cash component from a different filing or date than `F0`'s 10-K | `incompatible_period` |
| A cash and securities overlap above | `conflicting_evidence` |
| Reporting or price currency not USD | `incompatible_currency` |
| `P · S0 − N ≤ 0` (net cash at least the market cap) | `non_positive_base`: no positive multiple today, so required growth at today's multiple isn't computed |
| `r ≤ 0`, `X ≤ 0` or `d ≤ −100%` | Rejected at input. The `r` range is ADR 0005's setting range; the `X` and `d` ranges are defined above. |
| `V(−50%) > P` | Below the domain: the price requires a shrink faster than 50% a year |
| `V(100%) < P` | Above the domain: the price requires growth faster than 100% a year |
| Bisection not within 0.01 point after 100 steps | `numeric_limit_exceeded` |

### Consensus is shown alongside, never fed in

Finviz consensus has no cash-flow estimates, so no consensus field is a model input. A Call may show `eps_growth_next_5y` beside the required growth, labelled "attributed consensus: Finviz EPS growth, next 5 years, captured <date>". The comparison is EPS growth against free-cash-flow growth, and the label says so.

- **Cutoff**: the newest capture on or before the Call date, at most 7 days old.
- **Missing or older**: the row reads "no consensus within 7 days". The Call is otherwise unchanged.
- A consensus value never stands in for `g`.

### Prerequisites, stated rather than assumed

- **Historical consensus reconstruction**: not needed. A Call is made as of its own date, and consensus is shown only from captures on or before it.
- **Public-time proof**: not needed. Inputs are filings and stored captures with their own dates.
- **New provider work**: not needed for this model. Anchoring an exit multiple other than today's needs about ten years of daily prices and fiscal-year free cash flow (ADR 0005, Consequences). That is the next step and may need a price source beyond the current key. Until then, a Call shows required growth at today's multiple and declines its stance.

### Rejected alternative: two-stage DCF with a growth-in-perpetuity terminal

The same five years, with terminal value `F5 (1+gT) / (r − gT)`.

- `gT` has no reported anchor, as the exit multiple doesn't, and value diverges as `gT` approaches `r`. The hand audit showed a ±1x exit move changes value by 2% to 5%. A ±1 point move in `gT` near a 10% `r` changes it far more.
- Its unanchored input can't be anchored even with ten years of prices. An exit multiple can be, against the company's own history.

The exit multiple's implied perpetual growth, `gT = (X · r − 1) / (X + 1)`, may be shown as a deterministic diagnostic row. At `X = 15` and `r = 10%` it is 3.1%.

### Also excluded

- The hand model's margin path, tax rate and cash conversion. Each adds an unanchored driver, and a tax rate is a derived figure (#598).
- Quarterly or TTM starting cash flow. #211 is annual-only, and 10-Q cash flows are year-to-date.
- Options, RSUs and convertibles beyond the share-change rate; leases; finance arms; segment sums; non-USD issuers.
- Probability weights (ADR 0005 already forbids them).
- Any API, prompt or UI contract.

## Evidence

### Two issuers

**AAPL: every input forms.**

- **Inputs**: FY2026 10-K, accession 0000320193-26-000026, pulled live for the hand audit on 2026-11-09.
  - OCF 145.097B and capex 9.041B, so `F0` = 136.056B.
  - Cover shares 14,532,182,000 (2026-10-23).
  - Cash 36.305B and marketable securities 20.417B + 80.213B.
  - Debt: commercial paper 1.997B, long-term debt current 9.906B and noncurrent 68.208B.
  - `N` = 56.824B.
- **Price**: 342.37 (Polygon, 2026-11-06).
- **Today's multiple**: `X` = (342.37 × 14.532182B − 56.824B) / 136.056B = 36.15x.
- **Result**: with `d` = 0.277% (SBC ÷ market cap) and `r` = 10%, required growth at today's multiple is **7.3%** a year. The hand model's revenue-driven figure was 7.4%, and trailing three-year revenue growth is 7.7%.
- **Diagnostic**: the implied perpetual growth of 36.15x is 7.0%.

**NVDA: the starting cash flow is missing.**

- NVIDIA (CIK 1045810) tags capex as `PaymentsToAcquireProductiveAssets` (`services/fundamentals/test/sec-edgar.test.ts:869`). `free_cash_flow.v1` certifies capex only from `PaymentsToAcquirePropertyPlantAndEquipment`, so capex is `missing` and free cash flow is `blocked_dependency` (`services/chat/test/financial-free-cash-flow.test.ts:117-124`).
- The outcome is no starting free cash flow, so the Call declines.
- The local fixture (`services/fundamentals/test/sec-call-inputs.companyfacts.json`) also has no NVDA cash facts, and no balance facts from a 10-K (its debt facts are 10-Q only), so `N` would be `missing_input` too.
- This is the intended behavior: a capex tag the owner hasn't reviewed doesn't silently become free cash flow.

**Consensus for both**: AAPL `eps_growth_next_5y` 8.18%, captured 2026-11-09. Every captured `fiscal_period` is null in the dev DB because the listing and SEC issuers are split (#597, which also affects NVDA). This doesn't affect the consensus row, which needs no fiscal period.

**Dev DB coverage**: the local root DB holds only golden SEC facts (revenue, gross profit, operating income, net income) and no OCF, capex, share, debt or cash facts. The probes above therefore use the hand audit's live pull and the repo fixture, not the local DB.

### Worked example (synthetic)

Inputs: `F0` = 100 (USD m), `S0` = 10 (m), `N` = 50 (USD m), `r` = 10%, `d` = 0, `X` = 15.

- **Hand check at `g` = 10%**: each year's discounted cash flow per share is 10 × 1.1^t / 1.1^t = 10, so five years give 50. The exit is 15 × 10 = 150, and net cash adds 50 / 10 = 5. **V = 205.00.**
- **At `g` = 5%**: V = 167.45.
- **Monotonicity**: V(−50%) = 16.08, V(0%) = 136.05, V(5%) = 167.45, V(10%) = 205.00, V(100%) = 3,404.74. Strictly increasing.
- **Reverse solve at P = 200.00**: bracket [16.08, 3,404.74] contains 200, so the solve runs and gives required growth **9.4%** (9.382% before rounding, 14 bisection steps).
- **Reverse solve at P = 100.00**: required growth **−7.2%**, which is inside the domain.
- **Reverse solve at P = 10.00**: V(−50%) = 16.08 > 10, so the outcome is below the domain, with no number shown.

**Hurdle price** (ADR 0005), with base `V` = 205.00 (g 10%) and bear `B` = 136.05 (g 0%):

- Settings: margin of safety 1.25, bear-loss limit 25%.
- `H` = min(205.00 / 1.25, 136.05 / 0.75) = min(164.00, 181.39) = **164.00**.

These figures were computed with a 20-line script during drafting (not committed). The `g` = 10% case is exact by hand.

## Consequences

- **Owner decision needed on**:
  - the model and its conventions;
  - `net_cash.v1` and `total_debt.v1`, with their exclusions and overlap rule;
  - the 15-month, 5-trading-day and 7-day staleness limits;
  - the solver domain;
  - rule 0, which adds an input-outcome decline ahead of ADR 0005's stance rules;
  - excluding filers with no reported debt line from v1.
- **After approval**, implementation issues:
  1. `total_debt.v1` and `net_cash.v1` as engine definitions (closes the net-debt half of #598).
  2. The model and solver as financial-core operations, with exact arithmetic and the outcomes above. This lifts the engine's `forecast` refusal only for a Call, never for a factual answer.
  3. The Call block (ADR 0005) wired to them.
  4. Ten years of prices and FY free cash flow to anchor an exit multiple.
- **Until item 4 ships**, every Call shows required growth at today's multiple and declines its stance under ADR 0005 rule 1.
- **NVDA-style capex tagging** keeps those issuers out until the owner reviews `PaymentsToAcquireProductiveAssets` as capex.

## Owner decision

Pending.
