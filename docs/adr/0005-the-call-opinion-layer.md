# ADR 0005: The Call, an Opinion Layer Separate from Facts

## Status

Accepted by the owner on 2026-11-09 for the separation rules, the stance wording, the hurdle settings and the trigger. This ADR authorizes no code. The valuation model a Call runs on is #226's to define and approve. Implementation issues follow once both are approved.

Amended on 2026-11-24 with the bear case's anchor (see "Bear case anchor" below), and on 2026-11-25 with the base case (see "Base case" below). A Call can now state a stance.

## Context

The app answers with facts: reported figures, stored prices and verified arithmetic over them. #201 and #224 forbid it from turning those into a view. A scenario result is "a mechanical scenario, not a price target", and a difference from the price is "never expected return, upside, target, forecast, or recommendation". The research-quality rubric scores factual answers against advice wording (`scripts/research-quality-questions.ts`, `decision_useful`).

The owner wants a second layer: the agent's own view on a stock, with its reasoning, given only when asked. The risk is that a view borrows the authority of the facts it sits next to. A guessed exit multiple shown beside a cited operating margin reads as equally certain.

Five Calls written by hand on 2026-11-09 (AAPL, NVDA, COST, CAT, ADBE) measured that risk.

- **Which inputs decide the stance.** The stance turned on the exit multiple and the bear scenario. Neither has an anchor in any filing. The year-5 exit was 67% to 85% of base value.
- **Probabilities.** The 25/50/25 weights had no anchor, and they alone decided skew.
- **Falsifiers.** One of 13 thresholds changed a stance. NVDA flipped on about a one-point move in almost any driver.
- **What held up.** "What growth the price requires" at today's multiple and a 10% hurdle used only reported inputs, and gave checkable answers. AAPL needs 7.4% a year against 7.7% trailing, and ADBE needs 1.3% against 10.5%.

#226 already requires every valuation input to be labelled as a reported fact, an attributed analyst expectation, a user assumption or a deterministic result, and says "no category may stand in for another". This ADR builds the opinion layer on that rule.

`CONTEXT.md` has the nearest precedent: a thesis version is a saved, immutable view with conditions and falsifiers, and "absence of evidence is unresolved, never support". A thesis is the user's view. A Call is the agent's.

## Decision

### Two layers, dependencies point one way

The **fact layer** is facts, stored price observations, certified arithmetic and, once #592 merges, consensus captures. The **Call layer** refers to fact-layer items by identity and adds its own labelled assumptions and judgment.

- The fact layer never reads a Call.
- A Call is never written to `facts`, never cited as a source, and never carries a verified badge.
- A factual answer never contains stance wording. That rule and its eval stay as they are.

### Every input is labelled with its kind

| Kind | Example | Set by |
|---|---|---|
| Reported fact | TTM operating income, with its filing | Filings |
| Attributed consensus | FY2027 EPS 10.46, Finviz, captured 2026-11-09 | Analysts, as captured in `consensus_captures` (#592) |
| Market observation | Close on 2026-11-06 | Price feed |
| Owner policy | Required return, margin of safety, bear-loss limit | The owner, in settings |
| Agent assumption | Exit multiple 22x, basis "25th percentile of its own 10-year range" | The agent, with a stated basis |
| Deterministic result | Required growth 7.4% a year | Verified arithmetic over the rows above |

An agent assumption always carries its basis: anchored (a cited range it falls inside) or judgment. A judgment assumption is shown as one.

### Only on explicit request

A Call is produced only when the owner asks for one, by a command or a Call control. A factual answer never offers one, prompts for one, or produces one as a side effect.

### Stance wording is relative to the owner's hurdle

A Call says one of three things, each relative to the owner's own policy settings:

- **Clears your hurdle.**
- **Near your hurdle.**
- **Falls short of your hurdle.**

It never says buy, sell, hold, target, upside, expected return or recommendation.

### Hurdle settings belong to the owner

Required return (initially 10%), margin of safety (initially 1.25), bear-loss limit (initially 25%) and the "near" band (initially 10%) live in the owner's settings. Every Call shows the values it used. A Call made under other values is a different Call.

Valid ranges: required return above 0, margin of safety at least 1, bear-loss limit above 0 and below 1, near band above 0. Settings save only inside those ranges.

### Hurdle price replaces "flip price"

The hurdle price `H` is the price at which the Call's two financial tests meet, given its listed inputs. The tests are base value per share `V >= P x margin_of_safety`, and bear loss `(P - B) / P <= bear_loss_limit` for bear value per share `B`. Both hold exactly when `P <= H`, where `H = min(V / margin_of_safety, B / (1 - bear_loss_limit))`.

`H` is a boundary of the financial tests, computed before the decline rules. It is not a promise that the stance at `H` is stated. It is always labelled with the hurdle values and the assumptions it depends on, and is never called a target.

When `V` or `B` is zero or negative there is no positive hurdle price. The Call declines and says so.

### How the stance is decided

The rules apply in this order, and the first that matches decides.

1. **Declined: unanchored deciding input.** The exit multiple or the bear case has no anchor. One example is less than a full cycle of the company's own multiple history.
2. **Declined: no positive hurdle price.** `V` or `B` is zero or negative.
3. **Declined: unstable.** The stance from rules 4 to 6 changes under a one-point move up or down in growth, share change or required return, or a 1x move up or down in the exit multiple. A move that would leave a setting's valid range, or make the exit multiple zero or negative, is not tested in that direction, and the Call lists it as untested.
4. **Clears your hurdle.** `P <= H`.
5. **Near your hurdle.** `H < P <= H x (1 + near_band)`.
6. **Falls short of your hurdle.** `P > H x (1 + near_band)`.

### Skew shows a range, not probabilities

A stated Call shows the conditional difference between the price and the bull case value, and between the price and the bear case value, each labelled with its case's basis. It assigns no probabilities and no probability-weighted value, and the differences are never called upside, downside or expected return.

### A Call is a separate, saved block

A Call renders as its own block type, headed "Agent opinion", dated, with no verified badge.

A stated Call reads in this order:

1. Facts used, each cited.
2. Assumptions, each with its kind and basis.
3. What the price requires.
4. The stance and its reasoning, citing rows 1 to 3, with the hurdle price and the scenario differences.
5. What would change it: thresholds checkable against the next filings.
6. Stability: what flips the stance, and by how much.

A declined Call shows rows 1 to 3, then the decline rule that matched and the evidence that is missing or the move that flips it. When what the price requires can't be computed (a missing input, or no solution in the solver's domain), row 3 names that outcome instead. #226 defines the solver's domain and outcomes. It shows no stance, hurdle price, scenario differences or falsifiers.

Each Call is stored unchanged with its date, the owner settings it used and a fingerprint of its inputs.

### A Call's falsifiers reach a thesis only by owner adoption

The owner may adopt a stated Call's falsifiers as a thesis version's conditions, so the existing thesis assessment tracks them. Adoption is an explicit owner action, never automatic. An adopted condition keeps the identity of the Call it came from and the kind and basis of each assumption behind its threshold. When its numerical check carries a financial certificate, that certificate verifies the comparison against the reported figure, not the investment judgment that chose the threshold.

### A Call has its own eval

The research-quality rubric keeps scoring factual answers and keeps forbidding advice wording in them. A Call is scored on its own rubric.

- Does every reason cite an input row?
- Is every input labelled with its kind and basis?
- Did it decline when the decline rule says it must?
- Does any stance wording leak into a factual answer?

## Consequences

- **Prerequisites for a stated stance** (as of 2026-11-09; met by #605, the bear case anchor and the base case above). Two anchors don't exist yet. The exit multiple needs about ten years of daily prices (the current Polygon key returns two). The bear case needs debt, cash and securities, pretax income, income tax, stock compensation and remaining performance obligations in the metric map (`services/fundamentals/src/sec-edgar.ts`). Until then every Call declines its stance and uses the declined layout above.
- **Attributed consensus depends on #592.** Once merged, `consensus_captures` records Finviz consensus each time its capture runs, so a Call can cite consensus as of a day and later Calls can be compared with what consensus did. Running it daily is a separate step: #592 documents a crontab line and schedules nothing.
- **Single user.** The app has one user, the owner. Opinions about specific stocks shown to anyone else would need a separate review. This ADR covers only the owner's own use.
- **No change to existing answers.** Factual answers, scenarios (#201) and scenario price comparisons (#224) keep their wording rules.

## Bear case anchor (owner, 2026-11-24)

The owner decided the bear case's anchor on 2026-11-24:

- **Bear growth.** The 25th percentile of five-year free cash flow growth, among windows that began at a comparable size (by starting revenue). The bear exit multiple is the anchored exit multiple (#605), and the share change is `d`.
- **Measured quantity.** Decided as free cash flow per share on 2026-11-24, and changed to total free cash flow on 2026-11-25 (see "Base case"). Revenue growth is shown beside it and never fed into the model.
- **Source.** One download of SEC's bulk `companyfacts.zip`, cached with its sha256 and never fetched again. `services/fundamentals/src/growth-base-rates.ts` builds a table from it, offline, as `services/financial-core/data/growth-base-rates/<sha256>.json`, named by the sha256 of its text. `CURRENT` names the table a new Call reads. A Call records the table it read (`base_rate_table`), and the seal regenerates it from that table, so a rebuilt table never breaks a saved Call. A Call naming no committed table fails the seal (`base_rates`).

**What a base rate is.** It is a frequency of reported history: of N five-year windows that began at a similar size, K delivered at least a given growth. It is not an assigned probability, and a Call never calls it one. A window whose filer stopped filing before year 5 is a named outcome beside N (`ended_early`), never dropped. A window that ended at or below zero counts at −100%.

**What it decides.** Rule 1's bear-case half is met when the exit multiple is anchored and the Call's bucket holds at least 100 windows. Rule 0 matches when the 25th percentile is the −100% floor, since `g` must stay above −100% (ADR 0006).

## Base case (owner, 2026-11-25)

The owner decided the base case on 2026-11-25, with three decisions:

1. **Base growth.** The median (nearest-rank 50th percentile) of five-year growth among windows that began at a similar size: the bear case's table and bucket.
2. **Both cases read total free cash flow growth** (`fcf` in the base-rate table), not growth per share. The bear case moves from `fcf_per_share` to `fcf`, and so does the base-rate row's "share at or above".
3. **Base exit multiple.** The anchored exit multiple, as for the bear case. The share change is `d`.

**Why total, not per share.** ADR 0006's `g` is free cash flow growth before dilution. The model applies only `d`, the share change that stock-based compensation implies, and leaves buybacks out, because they are paid from the free cash flow already valued. A filer's history per share includes its buybacks. Fed in as `g`, it would count them a second time, on top of the cash flow that paid for them. In the USD 50B and up bucket the gap is 2.5 points: a median of 6.7% per share against 4.2% in total (`docs/eval-runs/growth-base-rates/2026-11-24.md`). `fcf_per_share` and `revenue` stay in the table.

**What it decides.**

- The base case shares the bear case's bucket, so it is anchored exactly when the bear case is. Rule 1 still names the exit multiple and the bear case, as written.
- A median at the −100% floor matches rule 0, as the bear case's 25th percentile does.
- With both cases anchored, `callStance` (`services/financial-core/src/valuation-model.ts`) runs rules 2 to 6 and the stability rule. A Call states "Clears your hurdle", "Near your hurdle" or "Falls short of your hurdle", or declines under rule 2 or 3.
- A stated Call shows `V`, `B`, `H` and the hurdle price under each stability move. A Call declined under rule 3 names each move that changes it and shows no hurdle price, as the declined layout requires.

**Measured at the default settings** (`docs/eval-runs/growth-base-rates/2026-11-24.md`). AAPL on ADR 0006's probe inputs falls short of the hurdle: `H` is USD 132.68 against a price of USD 342.37. A synthetic large cap with no net cash, whose own median EV/FCF is above today's multiple, clears only below about 7x its free cash flow per share and falls short from about 13x up. Two inputs drive that. At a 10% required return the anchored exit multiple is never above 17.33x, and never above today's multiple. The median growth, 4.2% a year for the largest bucket, is far below the required return. The value test binds in both large-cap buckets. Doubling the bear-loss limit to 50% leaves `H` unchanged. These are the owner's settings and anchors; nothing here changes them.

**Gaps this ADR leaves.** A stated Call names the two it does not show (`not_shown`), and the ADRs define neither:

- **A bull case**, for the skew row.
- **Falsifiers**, for "what would change it".

One reading is the implementation's, not the ADR's. **Which growth a stability move moves**: the implementation moves base and bear growth together, and both exit multiples together. A required-return move keeps the anchored exit multiple fixed, though the 4% cap depends on the required return.

## Not decided here

- **The valuation model.** Which cash-flow model a Call runs on, its horizon, terminal treatment and bridge. #226 defines these.
- **Tuning.** The near band's 10% default and the stability moves (one point, 1x) are starting values, tuned through the Call eval.
