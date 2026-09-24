# financial-core

Pure semantics for the verified financial-answer engine
([design](../../docs/superpowers/specs/2026-09-23-verified-financial-answer-engine-design.md),
[plan](../../docs/superpowers/plans/2026-09-23-verified-financial-answer-engine.md)).
No database, provider, model, network, wall-clock, global arithmetic
configuration, or feature-service imports — `test/boundaries.test.ts` enforces this.

| Module | Responsibility |
|---|---|
| `contracts.ts` | `FinancialPlanV1`, bound-input, draft/finalized result types, server-only runtime authority. Mirrors `spec/financial_plan_schema.json` and `spec/financial_result_schema.json`. |
| `validate.ts` | Strict Ajv validation (`additionalProperties: false` everywhere), identity/reference checks, graph checks; returns deep-frozen copies. |
| `canonical.ts` | `canonical_json.v1` serialization and domain-separated SHA-256 (semantic vs. owner-bound binding hashes). |
| `exact-decimal.ts` | Legacy threshold contract (moved from `services/agents`, which keeps a facade) plus lossless source-token parsing and bounded exact arithmetic. Dependency-free: the web build type-checks it. |
| `numeric-policy.ts` | `numeric-policy.v1`: private 50-significant-digit, half-even `decimal.js` clone for division and display. |
| `rational.ts` | Exact rational lineage so chained results are compared exactly even when their published representation is rounded. |
| `definitions.ts` | Catalog v1: approved metrics, margin numerators, ratio pairs, and operation versions. |
| `periods.ts`, `dimensions.ts` | Exact period identity (52/53-week aware), scope/basis/unit compatibility, typed dimensionless conversions. |
| `operations.ts`, `predicates.ts` | The approved operations and exact threshold/peer predicates; incompatibilities are named gaps. |
| `graph.ts`, `publication-units.ts`, `coverage.ts` | DAG validation and limits, frozen unit closures, dependency propagation, integrity isolation, and coverage. |

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
