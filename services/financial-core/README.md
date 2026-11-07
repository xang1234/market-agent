# financial-core

Pure semantics for the verified financial-answer engine.
No database, provider, model, network, wall-clock, global arithmetic
configuration, or feature-service imports — `test/boundaries.test.ts` enforces this.

| Module | Responsibility |
|---|---|
| `contracts.ts` | `FinancialPlanV1` and `FinancialPlanV2` (P/E scenarios), bound-input, draft/finalized result types, server-only runtime authority. Mirrors `spec/financial_plan_schema.json` and `spec/financial_result_schema.json`. |
| `validate.ts` | Strict Ajv validation (`additionalProperties: false` everywhere), identity/reference checks, graph checks; returns deep-frozen copies. |
| `canonical.ts` | `canonical_json.v1` serialization and domain-separated SHA-256 (semantic vs. owner-bound binding hashes). |
| `exact-decimal.ts` | Legacy threshold contract (moved from `services/agents`, which keeps a facade) plus lossless source-token parsing and canonical rendering. No financial arithmetic. Dependency-free: the web build type-checks it. |
| `rational.ts` | All financial arithmetic: every operand value is an exact reduced fraction, so sums, quotients, thresholds, and rankings are exact. |
| `numeric-policy.ts` | `numeric-policy.v1`: private 50-significant-digit, half-even `decimal.js` clone that renders published values and display rounding. Never used by predicates. |
| `definitions.ts` | Catalog v1: approved metrics, margin numerators, and ratio pairs. |
| `operation-registry.ts` | The single table of per-operation facts: approved version, value vs. predicate, missing-operand tolerance, and evaluation. |
| `periods.ts`, `dimensions.ts` | Exact period identity (52/53-week aware), unit/scope/basis compatibility, typed dimensionless conversions. |
| `operations.ts`, `predicates.ts` | The approved operations and exact threshold/peer predicates; each composes its own compatibility checks; incompatibilities are named gaps. |
| `graph.ts`, `publication-units.ts`, `coverage.ts` | DAG validation and limits, frozen unit closures, dependency propagation, integrity isolation, and coverage. |

## P/E scenarios (#201)

A `scenario_eps_multiple` node multiplies one company's reported diluted EPS
for one fiscal year by a P/E the user supplied. The result is a mechanical
scenario value in the EPS currency per share, not a price target.

- A plan with scenarios is a `financial_plan.v2`: a v1 plan plus exactly three
  `assumptions`, bear, base, and bull in that order. Each is an exact, positive,
  canonical decimal attributed to the request that stated it, and exactly one
  scenario node reads each. A v1 plan can carry neither.
- An assumption is plan configuration, never a fact, a binding, or a run
  input, so it can never fill a missing reported input.
- Zero or negative EPS is `non_positive_base`. Basic EPS is
  `incompatible_definition`. A quarter or a year before the latest is
  `unsupported_period`.
- The scenario node's lineage hash and its computation's `input_refs` both name
  `{assumption_id, hash}` after the EPS ref. The `assumption` hash covers the
  id, scenario, value, and attribution, and `planSemanticHash` keeps the
  attribution. Every other node reads no assumption, so v1 hashes are unchanged.
- Content with a `scenarios` presentation is `financial-presentation.v3`. All
  other content stays v2.

## Numeric limits (numeric-policy.v1)

Source tokens ≤ 256 characters, |exponent| ≤ 1,000, coefficients ≤ 4,096 digits,
checked before expansion. Exceeding them returns `numeric_limit_exceeded`.

## Dependencies

Pinned exactly in `package.json`; `npm audit` reported 0 vulnerabilities when added.

| Package | Version | License |
|---|---|---|
| ajv | 8.20.0 (same as `web`) | MIT |
| decimal.js | 10.6.0 | MIT |
| fast-deep-equal, json-schema-traverse, require-from-string (via ajv) | locked | MIT |
| fast-uri (via ajv) | locked | BSD-3-Clause |

```bash
npm ci --prefix services/financial-core
npm test --prefix services/financial-core
```
