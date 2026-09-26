# Verified Finance — Evaluation and Release Gate

This is the evidence the release gate (plan T30) produces, and what it does
not show. It makes no universal accuracy claim: every number below is a count
of named cases, and anything unmeasured is listed as unmeasured.

## 1. What the gate checks

### 1.1 Golden cases against an independent oracle

`scripts/verified-finance-fixtures.ts` holds each case's plan, bound inputs, or
candidate disclosures. Expected outcomes are computed in that file from the
source tokens, using exact BigInt rationals
(`services/financial-core/test/rational-oracle.ts`) and its own half-even
rounding. None of the production arithmetic, rounding, or selection code is
used. Production runs through the same functions the engine and the verifier
use: `evaluateBoundPlan` for computations and `selectInput` for which
disclosure is bound.

| Category | Rule under test | Cases |
|---|---|---|
| Exact source tokens | A reported value is the source token exactly, or the token times its declared scale | 2 |
| 52/53-week calendars | A 14-week Q4 is still a quarter and sums exactly; a 15-week span is not a quarter | 2 |
| Restatements | As reported = the original disclosure; as restated = the latest disclosure public by the cutoff | 3 |
| Public vs ingestion time | Public time, not ingestion time, decides eligibility | 1 |
| Date-only uncertainty | A date-only proof counts only at the end of its local day; an instant proof counts at its instant | 2 |
| Negative bases | Percent change needs a positive prior; a positive base follows the numeric policy | 2 |
| Zero denominators | A margin over zero revenue is a declared gap | 1 |
| Precision limits | 50 significant digits, ties to even, correct `exact` flag; thresholds compare exactly | 5 |
| Partial cohorts | A cohort with a missing member names no leader; a complete cohort names every tie | 2 |

The harness is itself tested (`scripts/verified-finance-fixture.test.ts`).
Each of these engines fails the valid cases it should fail:
- an engine that only ever declares gaps;
- one that is off by one in the last digit;
- one that always prefers the restatement;
- one that treats date-only proofs as instants.

### 1.2 Mutants against the snapshot verifier

A correct sealed unit (`services/snapshot/test/financial-fixtures.ts`) is
tampered with one change at a time, always keeping valid source and fact ids:

- a changed result value or last digit;
- a changed unit;
- an input bound for a different fiscal year;
- a later run or plan cutoff;
- a different definition version;
- a changed peer count;
- a number written as words.

`verifyFinancialUnit` must reject every mutant. A verifier that rejects
everything fails the gate on the valid baseline. A verifier that accepts
everything fails it on the mutants.

### 1.3 Cross-surface parity through the real adapters

`services/financial-engine/test/cross-surface-parity.test.ts` sends
equivalent requests through each surface's own adapter against one evidence
database, and compares the ledger records each one certified.

| Group | Surfaces | Must agree on | Allowed differences |
|---|---|---|---|
| As reported | Chat (model-planned turn), Analyze `revenue_trend`, grid `latest_revenue` | Value payload, bound fact and period, basis, unit state, coverage | Chat's cutoff is the turn's own time; memo and grid pin theirs. Ids and layout. |
| Saved rules (as restated) | Thesis condition, Discovery criterion ("annual revenue > 1") | Value and predicate payloads, cutoff, basis, bound facts, coverage | Parent (thesis version vs campaign run) and threshold attribution |

The two groups differ only in basis: the saved rules bind the restated
disclosure for the same fiscal period, and the test asserts exactly that.

### 1.4 Plan fidelity on held-out questions

Equal arithmetic cannot show that a plan answers the question that was asked.
`HELD_OUT_QUESTIONS` states each question's intended companies, metrics,
periods, and operations. `scripts/verified-finance-eval.ts` plans each question
and compares the validated plan with that intent.

- **Recorded mode (default, used in CI):** uses recorded drafts. No provider
  secrets are needed.
- **`--live` mode:** asks the configured model, and only then records planning
  latency.

A plan that answers a different question fails, and so does a planner that
drops a requested company; the tests prove both.

**Every held-out question is still `pending_analyst_review`.** Until an
analyst confirms the intended plans, fidelity results show consistency with
the stated intent, not correctness of that intent.

## 2. Running it

```bash
node --experimental-strip-types --test scripts/verified-finance-fixture.test.ts scripts/verified-finance-eval.test.ts
(cd services/financial-engine && node --experimental-strip-types --test test/cross-surface-parity.test.ts)
node --experimental-strip-types scripts/verified-finance-eval.ts --out report.json          # deterministic
node --experimental-strip-types scripts/verified-finance-eval.ts --live --out report.json   # budgeted, needs LLM env
```

The report (`verified_finance_eval.v1`) contains:
- the fixture revision (a sha256 of the fixtures file);
- the catalog, numeric-policy, certificate, verifier, and presentation versions;
- golden counts per category, with named failures and mismatches;
- the declared gaps;
- the mutant counts, naming any mutant that was accepted;
- plan fidelity, with pending reviews;
- what was not measured.

`cost` is always null (not measured), and latency is null outside live mode.
The CLI exits non-zero when the gate fails. CI runs all of this in the
`scripts` and `financial-engine` jobs, with `REQUIRE_DOCKER=1`, so the parity
test cannot silently skip.

## 3. Results at this revision

Deterministic report: 20 of 20 golden cases passed. Four of them expect a
declared gap: `ttm-overlong-quarter`, `growth-negative-base`,
`margin-zero-revenue`, and `date-only-same-day`. The verifier rejected all 9
mutants and verified the baseline. All 5 recorded plans matched their stated
intent, and all 5 are still pending analyst review. Latency and cost were not
measured.

All 14 regression suites pass (section 4); the only skips are the three
external-service tests listed there.

## 4. Regression re-run

The plan asks for these re-runs:
- frozen-base migration and schema/version compatibility: `db`;
- two-client authorization and fence races: `financial-engine` finalization races and lease;
- commit/restart recovery: `financial-engine` recovery, analyze, and grids;
- erasure: `financial-engine` erasure and the surface erasure subtests;
- every reachable numerical producer path: the surface suites.

Run in this container on the T30 change (on top of `4c8397f`), with
`REQUIRE_DOCKER=1` so no Docker-backed suite could skip:

| Suite | Command | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|---|
| `services/financial-core` | `npm test --prefix services/financial-core` | 106 | 106 | 0 | 0 |
| `services/financial-engine` | `npm test --prefix services/financial-engine` | 118 | 118 | 0 | 0 |
| `services/snapshot` | `npm test --prefix services/snapshot` | 134 | 134 | 0 | 0 |
| `services/evidence` | `npm test --prefix services/evidence` | 542 | 541 | 0 | 1 |
| `services/fundamentals` | `npm test --prefix services/fundamentals` | 312 | 312 | 0 | 0 |
| `services/chat` | `npm test --prefix services/chat` | 231 | 231 | 0 | 0 |
| `services/analyze` | `npm test --prefix services/analyze` | 161 | 161 | 0 | 0 |
| `services/analyst-grids` | `npm test --prefix services/analyst-grids` | 116 | 116 | 0 | 0 |
| `services/agents` | `npm test --prefix services/agents` | 103 | 103 | 0 | 0 |
| `services/discovery` | `npm test --prefix services/discovery` | 215 | 215 | 0 | 0 |
| `services/dev-api` | `npm test --prefix services/dev-api` | 83 | 81 | 0 | 2 |
| `db` | `npm test --prefix db` | 85 | 85 | 0 | 0 |
| `scripts` | `node --experimental-strip-types --test "scripts/*.test.ts"` | 51 | 51 | 0 | 0 |
| `web` | `npm test --prefix web` | 679 | 679 | 0 | 0 |

The three skips are gated on external services, not on Docker:
- evidence's live sec.gov 10-K download;
- dev-api's two live-fact end-to-end tests, which need `E2E_URL`.

The same three skip on `main`.

## 5. What this does not show

- **No live-model plan quality.** Recorded drafts show that the checker works,
  not how a production model plans. A `--live` run on a reviewed question set
  is a separate, budgeted step.
- **No analyst review of the held-out intents or the golden rules yet.** Both
  are listed for sign-off in T31.
- **No SEC publication attestations.** SEC-ingested facts bind as
  `publication_time_unknown` until a reviewed acceptance-time mapping exists,
  so enforced surfaces show declared gaps for them.
- **Open dispositions** (inventory §2.7): legacy numeric blocks and Chat
  narrative turns are not labelled, and some Analyze producers stay legacy.
