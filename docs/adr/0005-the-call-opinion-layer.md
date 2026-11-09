# ADR 0005: The Call, an Opinion Layer Separate from Facts

## Status

Accepted by the owner on 2026-11-09 for the separation rules, the stance wording, the hurdle settings and the trigger. This ADR authorizes no code. The valuation model a Call runs on is #226's to define and approve. Implementation issues follow once both are approved.

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

The **fact layer** is everything that exists today: facts, consensus captures, stored price observations and certified arithmetic. The **Call layer** refers to fact-layer items by identity and adds its own labelled assumptions and judgment.

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
3. **Declined: unstable.** The stance below changes under a one-point move in growth, share change or required return, or a 1x move in the exit multiple.
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

A declined Call shows rows 1 to 3, then the decline rule that matched and the evidence that is missing or the move that flips it. It shows no stance, hurdle price, scenario differences or falsifiers.

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

- **Prerequisites for a stated stance.** Two anchors don't exist yet. The exit multiple needs about ten years of daily prices (the current Polygon key returns two). The bear case needs debt, cash and securities, pretax income, income tax, stock compensation and remaining performance obligations in the metric map (`services/fundamentals/src/sec-edgar.ts`). Until then every Call declines its stance, and shows only what the price requires.
- **Attributed consensus depends on #592.** Once merged, `consensus_captures` records Finviz consensus each time its capture runs, so a Call can cite consensus as of a day and later Calls can be compared with what consensus did. Running it daily is a separate step: #592 documents a crontab line and schedules nothing.
- **Single user.** The app has one user, the owner. Opinions about specific stocks shown to anyone else would need a separate review. This ADR covers only the owner's own use.
- **No change to existing answers.** Factual answers, scenarios (#201) and scenario price comparisons (#224) keep their wording rules.

## Not decided here

- **The valuation model.** Which cash-flow model a Call runs on, its horizon, terminal treatment and bridge. #226 defines these.
- **Tuning.** The near band's 10% default and the stability moves (one point, 1x) are starting values, tuned through the Call eval.
