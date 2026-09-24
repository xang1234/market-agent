# Verified Financial-Answer Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one verified financial execution capability across Chat, Analyze, analyst grids, numerical thesis checks, and Discovery numerical assessments, with independently useful partial results, public-information historical eligibility, and exact saved-run replay.

**Architecture:** A pure TypeScript `financial-core` owns financial contracts, approved operations, arithmetic, predicates, and presentation validation. `financial-engine` owns planning, authorized evidence binding, durable execution, and publication preparation. The existing snapshot service reloads trustworthy records and verifies calculations inside the same transaction that publishes the parent artifact. Existing workflows remain the entry points.

**Tech Stack:** Existing Node/TypeScript conventions, PostgreSQL 15+, JSON Schema/Ajv, the repository's exact-decimal helper, privately configured decimal.js, lossless-json at financial JSON boundaries, existing model router/tool policies, React/block renderer, Node test runner, and the existing Docker/PostgreSQL test harness.

**Approved specification:** [Verified financial-answer engine architecture](../specs/2026-09-23-verified-financial-answer-engine-design.md), approved by the user before this plan was written. The specification's requirements take precedence over implementation convenience.

**Baseline:** `feat/discovery-campaigns` at `19c84e4f21358f99384e4f5984b9a5cc07bf480a`. The reviewed design is committed at `268cde7db4b049d190fcad0141320b4d81f319d5`. This plan is added to the same documentation PR; it does not authorize product implementation or merging.

**Status:** Implementation plan for review. Every task below is unchecked. Commands, examples, and acceptance outcomes are instructions for future execution, not claims that code or tests already exist or pass.

---

## 1. Execution rules and completion definition

Do not reopen the agreed comprehensive scope, partial-results policy, public-information cutoff, or replay/recalculation distinction without a documented new conflict. Do not expand into workbook export, a filing viewer, forecasting, trading, methodology memory, or a new general-purpose agent framework.

The engine verifies agreement with pinned evidence and approved financial rules, not the truthfulness of disclosures or the correctness of investment opinions. Verification labels must maintain that distinction.

Every task follows RED → implementation → GREEN → reviewable commit. A meaningful RED is the expected behavioral assertion failing after the test harness is valid. Missing dependencies, syntax errors, unavailable Docker, and unrelated failing tests are setup failures, not proof of a regression test. Add only the smallest contract stub necessary to make a new-package test exercise its assertion, then record the expected failure before implementing behavior.

Use an isolated implementation branch descended from the approved base plus documentation. Preserve other work. Do not implement on the documentation branch, force-push, merge automatically, or enable production features as a side effect of tests. Follow `AGENTS.md` and the repository's issue-tracking workflow where available; record tooling limitations rather than claiming a `bd` or push operation succeeded when it did not.

**Completion requires all five integrations.** A merged core or a functioning Chat demo is not comprehensive completion. New code may land behind flags in phases, but no enforced surface may silently retain a numerical producer on the legacy path. Unsupported calculations must return explicit gaps.

### Repository command conventions

All commands below run from the repository root unless stated otherwise. Read `.nvmrc` and use its Node version. The repository has per-service packages/lockfiles, not an assumed root workspace. `db/package.json` does not exist at the inspected base.

```bash
# Focused service test; new test paths are created by their task.
node --experimental-strip-types --test services/financial-core/test/contracts.test.ts

# Existing service suite, after its dependencies and imported services are installed.
npm test --prefix services/snapshot

# Database tests use the root Node runner, not "cd db && npm test".
node --experimental-strip-types --test db/test/schema-migrations.test.ts

# Web verification uses its established scripts.
(cd web && npm run sync:schema && npm test && npm run typecheck && npm run build && npm run lint)
```

`db/test/docker-pg.ts` provides `bootstrapDatabase`, `hasDocker`, a pool/query executor, `close()`, and `schemaOverride`. It imports `pg` from the installed Evidence package. Install that package before using the harness. It creates the canonical schema; it does **not** demonstrate an upgrade from the existing schema. Dedicated upgrade tests are required below.

Every database test uses `try/finally` cleanup. Concurrency tests use two real acquired clients and explicit barriers/locks, not timing-dependent sleeps. Developer machines can report an explicit Docker skip; release validation requires Docker and no unexpected database-test skips.

Every commit step means: rerun the task's focused tests, run affected existing suites, inspect `git diff --check` and staged paths, then commit only intended changes. Repeated commands in the plan do not permit skipping adjacent regression suites.

## 2. Task sequence and dependency graph

| Wave | Tasks | Review gate |
|---|---|---|
| Baseline and semantic kernel | T00–T04 | Contracts, exact arithmetic, financial definitions, and partial-result semantics reviewed. |
| Evidence and durable execution | T05–T13 | Fresh/upgrade schema parity, lossless binding, historical selection, and restart-safe computation. |
| Trusted publication | T14–T18 | Recomputed certificates, atomic parent publication, authorization, rendering, and replay. |
| Five feature integrations | T19–T27 | Each surface has actual end-to-end tests and no numerical bypass under enforcement. |
| Privacy and release | T28–T31 | Erasure, rollout, cross-surface evaluation, migration/recovery, and operational review. |

Primary order: `T00 -> T01 -> T02/T03 -> T04`; `T05 -> T06 -> T07`; `T05 + T08 + T09 -> T10`; `T01 + T03 -> T11`; `T06 -> T12`; `T04 + T10 + T12 -> T13`; `T07 + T13 -> T14 -> T15`; `T14 + T16 -> T17`; `T12 + T15 + T17 -> T18`. Surface tasks consume that completed foundation. T24–T26 preserve Discovery's separate approval and lease boundaries. T28–T31 gate release of everything.

After the shared contracts stabilize, independent worktrees may implement the pure core tests, evidence adapters, and controlled renderer in parallel. Do not concurrently edit schema numbering, the sealer, or shared block schemas without one integration owner. Parallel task completion is not integration evidence.

## 3. Implementation tasks

### T00 — Establish the executable baseline and numerical producer inventory

**Depends on:** Written plan approval and execution-method selection. **Acceptance:** prerequisite for V01–V38.

**Create:** `docs/engineering/verified-finance-producer-inventory.md`; `db/test/fixtures/financial-base-19c84e4.sql`.

**Read:** `AGENTS.md`, `.nvmrc`, `.github/workflows/ci.yml`, existing package scripts, canonical schema, approved design, and the source files listed in each task.

- [ ] Fetch the intended refs, record `git rev-parse HEAD`, verify the inspected base is an ancestor, and create an isolated implementation branch/worktree. If the base has evolved, record changed contracts and migration numbering before editing. Do not silently switch to `main`.
- [ ] Inventory every numerical producer and transport reachable from the five features: input loader, computation, prose/label emitter, block type, sealer, parent persistence, and public read path. Include market-cap columns, reader-question prose, tool previews, and Discovery criteria. Record one eventual migration or explicit unsupported disposition per producer.
- [ ] Identify the repository's canonical OpenAPI document and its existing alignment test through the tracked file list; record its exact path in the inventory. Subsequent financial HTTP schemas are referenced there, not published as a conflicting API specification.
- [ ] Capture the existing schema without editing it:

```bash
git show 19c84e4f21358f99384e4f5984b9a5cc07bf480a:spec/finance_research_db_schema.sql \
  > db/test/fixtures/financial-base-19c84e4.sql
```

- [ ] Install existing packages using the CI's per-directory procedure. Record baseline results for relevant service suites, the existing DB test commands, and web checks. An existing failure gets a reproducible issue; it must not disappear into a new-test skip.
- [ ] Record the last migration. It is `0092_immutable_filing_evidence` at the inspected base. This plan reserves illustrative next names 0093–0095 only for that base; renumber the three together if another migration landed.
- [ ] Commit the fixture/inventory only: `docs: record verified finance implementation baseline`.

**Gate:** Clean isolated starting point, test infrastructure understood, every existing numerical entry point accounted for. No product behavior changed.

### T01 — Add packages and versioned financial contracts

**Depends on:** T00. **Acceptance:** V01, V20, V26, V38.

**Create:** `services/financial-core/package.json`, its lockfile, `src/contracts.ts`, `src/validate.ts`, `src/canonical.ts`, `src/index.ts`, `test/contracts.test.ts`, `test/canonical.test.ts`; `services/financial-engine/package.json`, its lockfile, `src/ports.ts`; `spec/financial_plan_schema.json`, `spec/financial_result_schema.json`.

- [ ] RED: reject a plan containing `user_id`, `verified`, arbitrary SQL, an unknown operation, duplicate node IDs, or a reference to an undeclared subject. Assert that authority cannot be supplied through plan JSON. Reject additional properties at every trusted contract boundary.
- [ ] Define `FinancialPlanV1`, immutable bound-input contracts, result/disposition unions, publication-unit IDs, and server-only runtime authority. The plan carries metric/catalog versions, cutoff/timezone, public mode, period/basis/source/freshness policies, requested outputs, dependency graph, attributed parameters, and explicit limits. Authority carries owner/channel/parent/version/fence and is injected separately.
- [ ] Implement strict JSON Schema validation with Ajv in the core package. Keep canonical subject contracts compatible with `services/shared/src/subject-ref.ts`; no raw ticker can become a bound identity. Pin compatible dependency versions and commit lockfiles; do not use floating versions in deployment artifacts.
- [ ] Implement versioned canonical serialization and SHA-256 hashing. Sort object keys; preserve meaningful array order; normalize decimal tokens and explicit null semantics. Exclude random persistence IDs from semantic hashes but include them in record-binding hashes. Domain-separate plan, input, computation, result, and presentation hashes.
- [ ] GREEN: object-key reordering retains a semantic hash; reordered peer display order or changed threshold/cutoff changes the relevant hash; two owners cannot share a stored run solely because their semantic hashes match.

```bash
node --experimental-strip-types --test services/financial-core/test/contracts.test.ts services/financial-core/test/canonical.test.ts
```

- [ ] Commit: `feat(finance): define versioned plan and result contracts`.

**Gate:** Schemas and TypeScript discriminated unions agree; no database, model, network, or feature-runtime import enters `financial-core`.

### T02 — Preserve exact-decimal behavior and bounded derived arithmetic

**Depends on:** T01. **Acceptance:** V03, V05, V14, V15, V34, V38.

**Create:** `services/financial-core/src/exact-decimal.ts`, `src/numeric-policy.ts`, `test/exact-decimal.test.ts`, `test/numeric-policy.test.ts`.

**Modify:** `services/agents/src/exact-decimal.ts` as a compatibility facade, plus the core dependency lockfile.

- [ ] RED: exercise existing threshold validation and exact comparison behavior before moving implementation. New public fractional thresholds remain decimal strings; unsafe integers do not become accepted JSON numbers. Add values `9007199254740993`, `0.1000000000000000000001`, negative zero, exponent bounds, and scale multiplication.
- [ ] Move/reuse bounded coefficient/scale arithmetic and add exact finite-decimal addition/subtraction. Keep `BigInt` private. Validate digit/exponent/allocation bounds before expansion. Preserve the existing stricter threshold-write contract behind the compatibility facade rather than globally accepting newly expanded input forms.
- [ ] Add a private decimal.js constructor with versioned 50-significant-digit, half-even policy for division/display. No global `Decimal.set`. Exact predicates do not compare a displayed or rounded ratio.
- [ ] Test ratio predicates using exact cross-products with explicit denominator signs. For `1 / 3`, the display may round; a threshold above or below the exact ratio must be decided from operands. Unsupported chained precision returns `precision_indeterminate`, never a boolean based on approximation.
- [ ] GREEN: run new core tests and all existing agent exact-decimal/thesis tests. Use independent integer/rational expectations in test code, not the production helper as its own oracle.

```bash
node --experimental-strip-types --test services/financial-core/test/exact-decimal.test.ts services/financial-core/test/numeric-policy.test.ts
npm test --prefix services/agents
```

- [ ] Commit: `feat(finance): centralize exact decimal arithmetic without threshold regressions`.

### T03 — Implement the approved operation and financial-compatibility catalog

**Depends on:** T01–T02. **Acceptance:** V11–V15, V19, V34.

**Create:** `services/financial-core/src/definitions.ts`, `src/dimensions.ts`, `src/periods.ts`, `src/operations.ts`, `src/predicates.ts`; corresponding `test/operations.test.ts`, `test/periods.test.ts`, `test/predicates.test.ts`.

- [ ] RED: the same numeric operands with different periods/currencies/scopes must not produce a ratio. A partial quarter set, overlapping year-to-date rows, diluted EPS, balances, or margins cannot pass `trailing_sum`. A negative growth baseline cannot produce the positive-base operation.
- [ ] Register only `reported_metric`, `absolute_change`, `percent_change_positive_base`, approved gross/operating/net margins, approved ratio pairs, additive trailing sums, thresholds, and explicit-peer comparisons. Store version, metric requirements, dimensions, denominator constraints, interpretation, precision rule, and predicate evaluator per operation.
- [ ] Represent period dates, instant/duration, fiscal calendar, dimensions, reporting basis, adjustment/share basis, and currency explicitly. Calendar labels alone do not establish equality. Keep calendarization/interpolation/FX and unreviewed quarter-from-YTD extraction unsupported.
- [ ] Define `gross_margin = gross_profit / revenue`, with identical period/scope/basis and positive revenue. Define growth as `(current - prior) / prior` only for a positive prior. Distinguish ratios, percentages, percentage points, and basis points with typed scaling rules.
- [ ] GREEN: 52/53-week fiscal cases retain exact period semantics; zero denominators and non-additive metrics return named dispositions; exact threshold predicates and explicit ties are deterministic.

```bash
node --experimental-strip-types --test services/financial-core/test/operations.test.ts services/financial-core/test/periods.test.ts services/financial-core/test/predicates.test.ts
```

- [ ] Commit: `feat(finance): add reviewed operations and dimensional rules`.

**Gate:** Each operation has approved successful, boundary, and incompatible examples. A generic division endpoint is not a substitute for the catalog.

### T04 — Implement graph validation, output coverage, and dependency isolation

**Depends on:** T01–T03. **Acceptance:** V01, V16, V17, V21, V27, V38.

**Create:** `services/financial-core/src/graph.ts`, `src/coverage.ts`, `src/publication-units.ts`, `test/graph.test.ts`, `test/coverage.test.ts`.

- [ ] RED: a four-company plan with one missing input must not emit a full-cohort maximum or universal threshold statement. An independent revenue result must survive missing gross profit. A database error cannot be rewritten as `missing`.
- [ ] Validate DAG identity, closure, publication units, requested output slots, and limits before any provider call. Keep coverage independent from execution. Every requested output has a disposition; missing rows cannot simply vanish from the output list.
- [ ] Implement dependency propagation: ordinary gaps block downstream nodes, scope/owner/common-manifest violations are fatal, and isolated integrity failures reject their predeclared closure. Unit membership cannot be revised after failure to make the same certificate pass.
- [ ] Freeze cohort membership/counts and support ties explicitly. Available-row sorting is permitted with coverage labels; full-cohort conclusions require all relevant comparables. Available-case aggregation requires an explicit restricted-population plan.
- [ ] GREEN: distinguish a complete zero-match screen from a requested numerical answer with zero verified outputs. Test subject/node/output/candidate caps and no silent truncation.

```bash
node --experimental-strip-types --test services/financial-core/test/graph.test.ts services/financial-core/test/coverage.test.ts
```

- [ ] Commit: `feat(finance): propagate partial results through declared dependencies`.

### T05 — Add evidence precision, context, and publication-attestation schema

**Depends on:** T00–T01. **Acceptance:** V03–V09, V11, V12, V37.

**Create:** `db/migrations/0093_financial_evidence_attestations.up.sql`, matching `.down.sql`; `db/test/financial-evidence-migration.test.ts`; `db/test/financial-migration-helpers.ts`.

**Modify:** `spec/finance_research_db_schema.sql`.

- [ ] RED: initialize the frozen base schema with `schemaOverride`, insert representative original/superseded/private facts, apply the new migration, and assert the expected attestation tables/constraints while preserving old data. The fresh canonical schema must produce equivalent normalized catalog definitions.
- [ ] Add `source_publication_attestations`, `fact_precision_attestations`, and `fact_financial_contexts`. Include source/document/version hashes, proof references, typed timing bounds/timezone/precision, token/scale proof, context versions, and immutable supersession links. Unknown metadata does not default to verified.
- [ ] Require ordered time bounds, valid precision/method enums, nonempty hashes, fact/source ownership consistency, and correct foreign keys. Represent proof references into licensed storage without duplicating forbidden raw content into unrestricted columns.
- [ ] Backfill nothing by assumption: existing `reported_at`, `observed_at`, decimal strings, and document dates do not automatically become valid attestations. Test that no legacy row acquires a proof solely by running migration.
- [ ] GREEN: fresh/upgrade parity, insertion rejection, source-version mismatch, existing-fact preservation, and an empty-data down/up cycle. Down migration must refuse when certified dependencies would be destroyed; production rollback later uses flags, not dropping proof history.

```bash
node --experimental-strip-types --test db/test/financial-evidence-migration.test.ts db/test/schema-migrations.test.ts
```

- [ ] Commit: `feat(db): add source-version and numeric precision attestations`.

### T06 — Add immutable definitions and the owner-scoped run ledger

**Depends on:** T05. **Acceptance:** V01, V21, V24–V26, V29, V38.

**Create:** `db/migrations/0094_financial_run_ledger.up.sql`, matching `.down.sql`; `db/test/financial-ledger-migration.test.ts`.

**Modify:** canonical schema pack and migration helper from T05.

- [ ] RED: reject duplicate owner/parent/request keys with incompatible request hashes, duplicated node/input slots, cross-owner parent bindings, and mutation of bound plan/input payloads. Lifecycle transitions cannot modify immutable financial payloads.
- [ ] Add `financial_definition_versions`, `financial_plans`, `financial_runs`, `financial_run_units`, `financial_run_inputs`, and `financial_run_events`. Store `user_id`, parent kind/ID/version, semantic/binding hashes, cutoff/policies, lease epoch/expiry, execution state, coverage, binding time, and replay parent.
- [ ] Separate mutable run/unit state from immutable validated plan, dependency closure, and bound-input payload. Enforce foreign keys/uniqueness; model-owned fields cannot select owner, lease, or certification state.
- [ ] Add indexes for owner-scoped lookups, expired leases, pending units, event cursor retrieval, and request-key recovery. Canonicalize lock order by run then unit and stable parent/access resources in the finalizer contract.
- [ ] GREEN: run fresh/upgrade and preservation tests; confirm canonical schema matches sequential migrations and rollback refuses unsafe data destruction.

```bash
node --experimental-strip-types --test db/test/financial-ledger-migration.test.ts db/test/financial-evidence-migration.test.ts
```

- [ ] Commit: `feat(db): persist financial plans runs units and bound inputs`.

### T07 — Extend computation lineage and snapshot certificate storage

**Depends on:** T06. **Acceptance:** V18, V20, V22, V28–V30, V36, V37.

**Create:** `db/migrations/0095_financial_publication.up.sql`, matching `.down.sql`; `db/test/financial-publication-migration.test.ts`.

**Modify:** existing `computations` and `snapshots`-related schema definitions without renaming legacy columns.

- [ ] RED: reject cross-run computation/result links, duplicate output slots, mutable certified payloads, orphan certificate links, and a certificate referring to an unfinalized unit. Existing legacy computations and snapshots remain readable.
- [ ] Add `financial_results` and `snapshot_financial_runs`; extend existing `computations` with versioned financial run/node, definition/operation/numeric-policy, immutable input references, and output hash. Avoid creating globally authoritative derived `facts` to fit an old block reference.
- [ ] Define one result per requested output slot and computation per operation node, with explicit output-reference validation. Draft state and terminal dispositions remain distinguishable; certificates bind the finalized publication unit and parent snapshot.
- [ ] Add sealed-payload guards and restricted writer conventions. Immutability does not make the normal application role a cryptographic trust boundary; server reload/verification and audited erasure are still required.
- [ ] GREEN: migrate the frozen base through all three upgrades, compare normalized catalogs, test old rows and new foreign keys, and assert no old artifact receives a financial badge/certificate through backfill.

```bash
node --experimental-strip-types --test db/test/financial-publication-migration.test.ts db/test/schema-migrations.test.ts db/test/privacy-erasure.test.ts
```

- [ ] Commit: `feat(db): bind financial results and computations to sealed snapshots`.

**Schema review gate:** inspect all three migrations together before proceeding to certificate writers. Do not postpone upgrade testing to release week.

### T08 — Implement authorized proof and financial-input repositories

**Depends on:** T05–T07. **Acceptance:** V04–V09, V11, V12, V22.

**Create:** `services/evidence/src/financial-attestations.ts`, `src/financial-context.ts`, `src/financial-input-repo.ts`, `test/financial-attestations.test.ts`, `test/financial-input-repo.test.ts`.

**Modify:** `services/evidence/src/index.ts` and relevant fact/source repository exports.

- [ ] RED: a source-version proof for one document cannot validate another version; a public-time proof cannot be supplied by the analyst model. A user cannot discover another user's private candidate count or proof metadata.
- [ ] Implement append-only, validated attestation creation and strict candidate reads. Project `value_num::text` and `scale::text`; return period/context/promotion/source metadata explicitly. Do not globally change PostgreSQL type parsing or legacy reader return types.
- [ ] Apply full owner/channel/source deletion and entitlement filtering before returning candidates. Fetch proof references, not raw documents across service boundaries. Exclude estimated and invalidated inputs; reviewed extractions require source-token proof; legacy derived values require certified lineage.
- [ ] Implement proof supersession with distinct economic disclosure versus extraction correction reason. Unsupported legacy history returns a reconciliation gap; current `superseded_by is null` is not the historical selection rule.
- [ ] GREEN: real PostgreSQL tests preserve exact strings, source ownership, immutable proof versions, and non-enumerating access failure.

```bash
node --experimental-strip-types --test services/evidence/test/financial-attestations.test.ts services/evidence/test/financial-input-repo.test.ts
npm test --prefix services/evidence
```

- [ ] Commit: `feat(evidence): expose authorized exact financial inputs and proofs`.

### T09 — Preserve numeric tokens during ingestion and revalidate legacy facts

**Depends on:** T02, T08. **Acceptance:** V03–V05, V09, V34, V38.

**Create:** `services/fundamentals/src/lossless-financial-json.ts`, `test/lossless-financial-json.test.ts`; `services/evidence/src/financial-proof-backfill.ts`, `test/financial-proof-backfill.test.ts`.

**Modify:** `services/fundamentals/src/sec-edgar.ts`, compatible statement-input types/adapters, `services/dev-api/src/sec-fact-writer.ts`, strict source-fetch wiring, package dependencies/lockfiles.

- [ ] RED: parse a fixture containing `9007199254740993`, `0.1000000000000000000001`, and `1.234567890123456789e+6`; the original lexical values and native scale must survive into database writes and strict reads. Duplicate JSON keys and oversized tokens fail deterministically.
- [ ] Place lossless-json before ordinary JSON-number conversion at the actual fetch boundary. Adapt strict ingestion into string-valued financial inputs; bounded identifiers/years may become integers after validation. A wrapper applied after `response.json()` is not a fix.
- [ ] Retain source-token/hash/locator proof under existing storage policy, and issue precision/context attestations only after validation. Ensure normalization and the writer do not convert strings back through `Number` or apply scale twice.
- [ ] Implement an idempotent, dry-run-first backfill helper that revalidates authorized retained source material and writes new attestations/corrective fact versions. Missing bytes, mismatched values, or uncertain context remain explicit failures/gaps. No bulk production backfill runs during deployment.
- [ ] GREEN: old non-financial consumers retain their API contract; the strict path round-trips exactly; existing statement/SEC tests run; corrective extraction does not mutate old snapshot values.

```bash
node --experimental-strip-types --test services/fundamentals/test/lossless-financial-json.test.ts services/evidence/test/financial-proof-backfill.test.ts
npm test --prefix services/fundamentals
npm test --prefix services/evidence
```

- [ ] Commit: `feat(ingest): preserve financial numeric tokens and explicit legacy proof gaps`.

### T10 — Bind historical inputs and freeze selection provenance

**Depends on:** T03, T08–T09. **Acceptance:** V06–V13, V16, V17, V29.

**Create:** `services/financial-core/src/public-time.ts`, `test/public-time.test.ts`; `services/financial-engine/src/select-inputs.ts`, `src/bind-inputs.ts`, `src/evidence-adapter.ts`, `test/historical-selection.test.ts`, `test/input-binding.test.ts`.

- [ ] RED: the original Jan 10 disclosure is eligible at Jan 15 despite Feb 1 ingestion, but a Jan 20 restatement is not. A date-only source cannot be assumed available intraday. A changed page URL cannot carry proof from earlier bytes.
- [ ] Implement conservative availability-bound comparison with explicit source timezone. A controlled public observation proves availability no earlier than its own observation bound. Use reviewed provider mappings, never assume receipt/acceptance equals dissemination. Unknown timing remains a gap.
- [ ] Select `as_reported` or `as_restated` under the cutoff, definitions, context, promotion/access, and freshness rules. Preserve original eligible historical facts despite later economic supersession; do not revive invalidated extraction errors. Conflicts not resolved by an approved rule remain conflicts.
- [ ] Bind through one consistent database read and persist input slots, candidate-set digest, proof IDs, policy versions, cohort counts, and binding time. A retry reuses that binding; a new evidence arrival requires explicit recalculation, not substitution during finalization.
- [ ] GREEN: test source-local date boundaries, exact fiscal periods, cutoff-relative freshness, equivalent duplicates, conflicting values, capped candidate reads, and private-source exclusion from public-information mode.

```bash
node --experimental-strip-types --test services/financial-core/test/public-time.test.ts services/financial-engine/test/historical-selection.test.ts services/financial-engine/test/input-binding.test.ts
```

- [ ] Commit: `feat(finance): bind public-information historical evidence deterministically`.

### T11 — Translate full requests into bounded approved plans

**Depends on:** T01, T03–T04. **Acceptance:** V01, V02, V17, V19, V33, V38.

**Create:** `services/financial-engine/src/planner.ts`, `src/plan-interpretation.ts`, `src/plan-authority.ts`, `test/planner.test.ts`, `test/plan-interpretation.test.ts`.

**Modify:** only the existing model-router/tool interfaces needed to inject the planner; do not add a new model framework.

- [ ] RED: a prompt naming four companies must produce four resolved subject slots or a clarification, never silently the first successful ticker. An unrecognized EBITDA definition asks for a choice. Model JSON containing owner/budget/verified fields is rejected.
- [ ] Build an adapter over the existing model router for planning, with deterministic mode for grid/condition inputs. Give it the approved catalog, not raw database access. Allow one bounded schema repair only under the parent budget.
- [ ] Generate the visible interpretation from the validated plan: subject set, metric definitions, periods, basis, cutoff/TZ, population, and material assumptions. Do not rely on free model text to explain a different plan than the one executed.
- [ ] Version interactive clarification responses against their proposed plan. Background ambiguity returns a configuration-needed outcome; it cannot mutate a thesis or Discovery brief or wait forever for a user response.
- [ ] GREEN: model-stub tests show no acquisition before approval/validation, no scope escalation, no arbitrary SQL/expression execution, and deterministic adapters require zero model calls.

```bash
node --experimental-strip-types --test services/financial-engine/test/planner.test.ts services/financial-engine/test/plan-interpretation.test.ts
```

- [ ] Commit: `feat(finance): plan complete financial requests within server authority`.

### T12 — Implement durable run idempotency, leases, and unit state

**Depends on:** T06–T07. **Acceptance:** V21, V24–V26, V28, V38.

**Create:** `services/financial-engine/src/run-repo.ts`, `src/unit-repo.ts`, `src/events-repo.ts`, `src/lease.ts`, `test/run-repo.test.ts`, `test/lease.test.ts`.

- [ ] RED: two concurrent creators with one owner/parent/request key return one run; different payload hashes conflict. A stale epoch cannot write checkpoints or finalize. Another owner cannot reuse the same run even with the same semantic plan hash.
- [ ] Implement transactional request reservation, validated lifecycle transitions, monotonically fenced leases, cancellation, per-unit dispositions, and durable sanitized event cursors. Bound payloads remain immutable when state changes.
- [ ] Tie leases to the parent authority: standalone hosts may recover their own finance runs; Discovery-owned runs require a valid parent epoch. Do not let a generic worker reclaim a campaign child without the parent's authorization.
- [ ] Distinguish execution state, unit finalization, and coverage. Progress increments are derived/idempotent, not repeated blindly on retries. Return conflicts explicitly rather than overwriting a completed run.
- [ ] GREEN: exercise concurrent clients with explicit barriers and inspect resulting rows/events. Test cancelled and expired leases, unchanged parent/version reuse, and post-commit lookup.

```bash
node --experimental-strip-types --test services/financial-engine/test/run-repo.test.ts services/financial-engine/test/lease.test.ts
```

- [ ] Commit: `feat(finance): persist idempotent fenced execution state`.

### T13 — Execute bound graphs with checkpoints and typed failures

**Depends on:** T04, T10, T12. **Acceptance:** V05, V14–V17, V21, V25, V27, V38.

**Create:** `services/financial-engine/src/execute.ts`, `src/checkpoints.ts`, `src/result-repo.ts`, `src/budget.ts`, `test/execution.test.ts`, `test/execution-recovery.test.ts`.

- [ ] RED: kill execution after one persisted independent result; resume without reselecting evidence or duplicating that computation. Missing gross profit blocks margin, not revenue. A provider/DB failure remains `execution_error` rather than absent evidence.
- [ ] Topologically execute only approved core operations over bound inputs. Persist draft computation/result hashes and requested-output gaps idempotently. Draft results are not externally visible as verified.
- [ ] Enforce plan limits and parent limits before allocating large graphs or acquiring extra evidence. Cap concurrent evidence tasks; do not make unlogged acquisition calls from arithmetic nodes. Check cancellation between bounded units.
- [ ] Compute exact dependency closure and coverage. Persist all requested output dispositions, including blocked descendants. Distinguish fatal shared integrity failures from ordinary gaps; do not catch all thrown exceptions as partial success.
- [ ] GREEN: repeated execution of a pinned graph yields the same values and hashes; cancellation/recovery obeys fencing; complete empty results and zero-covered answers are distinct.

```bash
node --experimental-strip-types --test services/financial-engine/test/execution.test.ts services/financial-engine/test/execution-recovery.test.ts
```

- [ ] Commit: `feat(finance): execute bounded financial graphs with durable partial results`.

### T14 — Recompute from database-backed records at the snapshot boundary

**Depends on:** T07, T13. **Acceptance:** V18–V22, V29, V38.

**Create:** `services/snapshot/src/financial-verifier-loader.ts`, `src/financial-verifier.ts`, `test/financial-verifier.test.ts`, `test/financial-verifier-db.test.ts`.

**Modify:** `snapshot-verifier.ts`, `manifest-staging.ts`, and `seal-input.ts` in `services/snapshot/src/`.

- [ ] RED: keep valid citation IDs but change a computed value, unit, scale, cutoff, definition version, or cohort. Certification must reject each mutation. A caller-supplied `verified: true` or fabricated numeric array does not change the result.
- [ ] Load pinned plan/input/attestation/definition/computation/result records using the finalization transaction client. Verify ownership, hashes, closure, current source access, invalidation, and public-time/context eligibility. Do not import `financial-engine` into Snapshot.
- [ ] Independently recompute through the pure core and compare canonical outputs and evaluated predicates. Verify result-to-computation and computation-to-result references. Require certificates for legacy derived dependencies or recompute them; a `fact_id` alone is insufficient.
- [ ] Add deterministic financial reason codes and sanitized diagnostics. Preserve existing manifest/tool-call/disclosure validation. Finance checks augment rather than replace it.
- [ ] GREEN: wrong values with right sources fail, true calculations with full lineage pass, partial units retain only valid closures, and all existing Snapshot tests remain green.

```bash
node --experimental-strip-types --test services/snapshot/test/financial-verifier.test.ts services/snapshot/test/financial-verifier-db.test.ts
npm test --prefix services/snapshot
```

- [ ] Commit: `feat(snapshot): verify financial computations from trusted records`.

### T15 — Publish snapshot, certificate, and parent artifact atomically

**Depends on:** T12–T14. **Acceptance:** V21–V28, V35.

**Create:** `services/financial-engine/src/finalize.ts`, `services/evidence/src/financial-access-lock.ts`; `services/financial-engine/test/finalization.test.ts`, `test/finalization-races.test.ts`.

**Modify:** `services/snapshot/src/snapshot-sealer.ts`, `services/evidence/src/zero-export-erasure.ts` coordination, relevant parent transaction callback contracts.

- [ ] RED: inject failure after snapshot insertion but before parent persistence; no new public artifact/certificate may survive. A fake result that passes an earlier outside-transaction check must fail the authoritative inside-transaction reload.
- [ ] Introduce a finalization entry point accepting an already pinned transaction client and a parent persistence callback using that same client. Lock run/unit and parent version/fence, reload/verify, insert snapshot/certificate, save parent references, append publication event, then commit. No provider/model call or second pool connection inside the callback.
- [ ] Define stable source/access lock rows and canonical ordering. Publication and revocation/erasure writers take compatible locks; retrieval still checks current permissions. Parent edits/cancellation use compatible version checks/fencing. Document the order to prevent deadlocks.
- [ ] Test two-client races with explicit barriers: completed revocation before finalization rejects publication; revocation after commit hides subsequent reads; stale parent version/lease aborts; identical retries return the existing artifact. Repeatable-read alone is not the solution.
- [ ] GREEN: existing legacy sealing contracts still work without awarding finance certificates, all injected failures roll back, and no progress publisher can observe draft financial values.

```bash
node --experimental-strip-types --test services/financial-engine/test/finalization.test.ts services/financial-engine/test/finalization-races.test.ts
npm test --prefix services/snapshot
```

- [ ] Commit: `feat(finance): finalize verified results and parent artifacts atomically`.

**Security review gate:** verify actual revocation/erasure writers participate in the lock protocol. A test against a newly invented revocation helper while production uses another writer does not satisfy V23.

### T16 — Add controlled quantitative blocks and shared renderer

**Depends on:** T01–T04, T14. **Acceptance:** V16, V19, V20, V35, V36.

**Create:** `services/financial-core/src/presentation.ts`, `test/presentation.test.ts`; `web/src/blocks/renderers/FinancialAnswerBlock.tsx`, `FinancialAnswerBlock.test.tsx`.

**Modify:** `spec/finance_research_block_schema.json`, `web/src/blocks/types.ts`, `validate.ts`, `BlockRenderer.tsx`, generated `blockSchema.json`, block contract/render tests; Snapshot block registration.

- [ ] RED: a model string saying “highest” without a predicate reference cannot pass the financial block schema. A changed company label, percentage unit, period, or hidden denominator must change/reject the presentation binding. Unknown certificate versions do not render as verified text.
- [ ] Define `financial_answer` with typed scalar/table/series/predicate/gap presentations and explicit `financial_result`/`computation` references. Use approved templates and typed label/context references; no arbitrary numerical prose field in the certified lane.
- [ ] Make Snapshot validate the expected presentation hash and the renderer consume only committed references. Do not create fake global facts to satisfy old renderers. Display coverage and narrative/legacy status separately.
- [ ] Use canonical decimals for labels, tooltips, accessible tables, and financial sorting. Chart geometry conversion must be bounded and cannot feed calculations. A partial peer list may sort but cannot claim a verified full-cohort winner.
- [ ] GREEN: synchronize schema and run both core and web contract tests, including missing/incompatible cells, exact rounded labels, unknown clients, and accessibility text.

```bash
node --experimental-strip-types --test services/financial-core/test/presentation.test.ts
(cd web && npm run sync:schema && npm test && npm run typecheck && npm run build)
```

- [ ] Commit: `feat(web): render certified quantitative blocks without prose bypasses`.

### T17 — Expose authorized status, result inspection, and replay requests

**Depends on:** T14–T16. **Acceptance:** V20, V22, V26, V29, V30, V36, V37.

**Create:** `services/financial-engine/src/http.ts`, `src/read-model.ts`, `src/inspection.ts`, `test/http.test.ts`, `test/inspection.test.ts`; `spec/financial_answer_http_schema.json`; `services/dev-api/src/financial-wiring.ts`.

**Modify:** `services/dev-api/src/api.ts`, narrow wiring in `local-runtime.ts`, existing evidence inspection/reference contracts, and the canonical OpenAPI document located/recorded by T00.

- [ ] RED: another user's run/result, an uncommitted result, or a result with one revoked transitive source returns non-enumerating not-found. Merely opening status/inspection must not acquire data or rerun the model.
- [ ] Implement GET run status and GET committed result inspection. Return plan interpretation, coverage, source/definition/formula/precision/time lineage, and safe reason codes. No draft values in response metadata, errors, or counts.
- [ ] Implement the idempotent POST replay request contract without execution logic duplication. Recalculation remains an explicit parent feature action creating a new run. Use the existing trusted authentication mechanism; do not elevate a spoofable development header into production authority.
- [ ] Reference the financial payload schemas from the repository's canonical API specification and add route/schema alignment tests. Avoid two independently maintained OpenAPI definitions.
- [ ] GREEN: test full closure access, private cache keys, expired access, unsupported versions, request-key conflicts, and no side effects for GET. Keep runtime composition in the new bounded wiring module rather than enlarging the already large local runtime.

```bash
node --experimental-strip-types --test services/financial-engine/test/http.test.ts services/financial-engine/test/inspection.test.ts db/test/schema-openapi-alignment.test.ts
```

- [ ] Commit: `feat(api): expose authorized financial results and replay contracts`.

### T18 — Implement pinned replay and supervised restart recovery

**Depends on:** T12, T15, T17. **Acceptance:** V24–V26, V29, V30, V37.

**Create:** `services/financial-engine/src/replay.ts`, `src/version-registry.ts`, `src/recovery.ts`, `src/worker.ts`, `test/replay.test.ts`, `test/recovery.test.ts`; `services/dev-api/src/financial-worker-bootstrap.ts`.

- [ ] RED: a saved run recomputes to the same numerical result after newer evidence/definitions arrive; model/provider stubs must receive zero calls. An unavailable historical operation version returns `replay_version_unavailable`, not today's implementation.
- [ ] Use only a deployer-reviewed version registry and pinned inputs/policies. Never download historical source code or invoke arbitrary saved code. Separate saved display, verification replay, and recalculation. Later-invalidated evidence produces a warning/unavailable verification, not a fresh certificate of valid evidence.
- [ ] Add supervised bounded recovery for expired standalone finance leases. Discovery-owned runs are resumed only under the active parent worker/fence. Reuse committed units and event IDs; do not double-increment parent progress or repeat effects after commit/disconnect.
- [ ] Reauthorize source closure and erasure on each replay/read. Idempotency compares request hash/owner/parent version. Cancellation and new epochs beat stale workers.
- [ ] GREEN: process-restart simulation after each checkpoint/finalization boundary yields one artifact, no extra model/provider attempts, correct partial coverage, and safe status fallback when event detail has expired.

```bash
node --experimental-strip-types --test services/financial-engine/test/replay.test.ts services/financial-engine/test/recovery.test.ts
```

- [ ] Commit: `feat(finance): support pinned replay and fenced recovery`.

### T19 — Integrate complete financial planning and execution into Chat

**Depends on:** T11, T13, T15–T18. **Acceptance:** V01, V02, V16, V19, V27, V29, V33.

**Create:** `services/chat/src/financial-runtime.ts`, `test/financial-runtime.test.ts`, `test/financial-clarification.test.ts`.

**Modify:** `services/chat/src/local-runtime.ts`, `llm-runtime.ts`, `subjects.ts`, `subject-extraction.ts`, and coordinator request context as needed.

- [ ] RED: four-company comparison either covers the complete explicit subject set or asks for the unresolved symbol; a missing company yields a gap, not a three-company universal conclusion. A numerical verification failure cannot invoke the legacy free-text financial composer.
- [ ] Route financial requests through approved planning, authority, binding, execution, and publication preparation. Keep unsupported finance requests in the structured gap lane. Deterministic tool inputs use the same engine without mandatory model planning.
- [ ] Expose the validated interpretation and versioned clarification choices. An edited clarification creates a new validated plan; it never modifies a sealed message or promotes a guessed metric definition.
- [ ] Bypass `composeAnalystBlocksWithLlm` for certified quantitative content. Separate optional non-certified interpretation and keep it off by default for historical financial runs. Routing metadata cannot award verification.
- [ ] GREEN: actual Chat runtime tests cover plans, partial outputs, clarification, model absence/error, and source/policy preservation. Existing narrative-only chat and subject tests remain green without false finance badges.

```bash
node --experimental-strip-types --test services/chat/test/financial-runtime.test.ts services/chat/test/financial-clarification.test.ts
npm test --prefix services/chat
```

- [ ] Commit: `feat(chat): answer financial requests through the verified engine`.

### T20 — Make Chat persistence and SSE publication commit-aware

**Depends on:** T19. **Acceptance:** V22–V28, V35, V36.

**Create:** `services/chat/test/financial-publication.test.ts`, `test/financial-sse.test.ts`.

**Modify:** `services/chat/src/coordinator.ts`, `messages.ts`, `sse.ts`, `http.ts`, finance runtime integration and corresponding web stream handling.

- [ ] RED: inject a bad numerical result and observe the entire SSE stream; no answer number, tool preview, title, error detail, or accessibility-bound payload may expose it before verification. A commit-then-disconnect retry must not create a second assistant message.
- [ ] Make Chat's financial parent persistence use the same finalization client as the snapshot/certificate. Do not seal via one callback/connection and insert the message later on another.
- [ ] Stream allowlisted progress only before commit. Publish committed block events and durable message/snapshot references afterward. Existing in-memory cursor retention remains an optimization, not the finance idempotency store.
- [ ] Carry request/run/unit IDs through reconnects; deduplicate event IDs. If detailed history is unavailable, fetch committed status/message or show unavailable, never rerun hidden tool calls.
- [ ] GREEN: test failure at every transaction boundary, cross-process recovery, cancellation, malformed cursors, older clients, and normal narrative streaming compatibility.

```bash
node --experimental-strip-types --test services/chat/test/financial-publication.test.ts services/chat/test/financial-sse.test.ts
npm test --prefix services/chat
```

- [ ] Commit: `fix(chat): publish financial answer blocks only after atomic commit`.

### T21 — Integrate numerical Analyze sections and strict memo sealing

**Depends on:** T15–T18. **Acceptance:** V12, V16, V18–V20, V24, V27–V29, V35.

**Create:** `services/analyze/src/financial-section.ts`, `test/financial-section.test.ts`, `test/financial-memo-publication.test.ts`.

**Modify:** `section-producers.ts`, `section-runner.ts`, `section-seal.ts`, `seal-input-merge.ts`, `metrics-comparison-emitter.ts`, `memo-run.ts`, `template-repo.ts`, `run-metadata.ts`, and bounded dev API composition.

- [ ] RED: merging one historical section with a later-cutoff section must reject instead of taking the maximum `as_of`. Duplicate result IDs with different payloads must fail rather than deduplicate silently.
- [ ] Translate numerical sections into engine plans and retain narrative sections separately. Preserve template version, requested peers, source categories, cutoff/basis, definition policy, and coverage in run metadata.
- [ ] Extend the strict merge contract to require equal owner/cutoff/basis/normalization and compatible definitions/run provenance. Leave legacy merging available only for non-certified artifacts. Derived metric emitters require certified lineage or recomputation; old derived facts are not automatically trusted.
- [ ] Save snapshot/certificate/memo run through the same finalization transaction. A failed section can yield declared partial results but cannot leave a memo whose metadata implies complete coverage.
- [ ] GREEN: end-to-end playbook tests inspect actual persisted blocks, metadata, source permissions, rerun lineage, and numeric/narrative labels. Existing Analyze tests pass.

```bash
node --experimental-strip-types --test services/analyze/test/financial-section.test.ts services/analyze/test/financial-memo-publication.test.ts
npm test --prefix services/analyze
```

- [ ] Commit: `feat(analyze): seal verified numerical memo sections under one context`.

### T22 — Integrate frozen, restart-safe financial grid cells

**Depends on:** T15–T18. **Acceptance:** V10, V12, V16, V17, V24–V27, V29, V36.

**Create:** `services/analyst-grids/src/financial-column.ts`, `test/financial-column.test.ts`, `test/financial-grid-recovery.test.ts`.

**Modify:** `column-catalog.ts`, `fiscal-fact-column.ts`, `period-context.ts`, `cell-runner.ts`, `run-engine.ts`, `queries.ts`, `types.ts`, and grid read/HTTP payloads.

- [ ] RED: latest-fact columns honor the pinned cutoff, two instances of one column key with different parameters cannot share a result, and a grid edit during execution cannot change its saved period/cohort.
- [ ] Freeze column-instance IDs, definitions, params, order, subjects, and counts in the run. Deterministic columns construct plans without LLM calls. Preserve the current 25-row cap and show omitted count explicitly.
- [ ] Finalize each cell as a declared publication unit. Aggregate requested/verified/gap/error counts without treating only thrown errors as partial. Restart recovery reuses committed cells, avoids duplicate computations, and increments progress idempotently.
- [ ] Route every direct numerical column through the engine or an explicit unsupported outcome. Reader-question prose remains non-certified unless translated to supported financial nodes. Market-cap columns require appropriate market/share/timing proof rather than silently using the latest active fact.
- [ ] GREEN: actual grid creation/run/read tests cover partial cells, scope cap, historical selection, cancellation, recovery, and inspection access.

```bash
node --experimental-strip-types --test services/analyst-grids/test/financial-column.test.ts services/analyst-grids/test/financial-grid-recovery.test.ts
npm test --prefix services/analyst-grids
```

- [ ] Commit: `feat(grids): execute frozen financial columns with explicit coverage`.

### T23 — Replace numerical thesis evaluation with shared exact predicates

**Depends on:** T15–T18. **Acceptance:** V10, V14–V16, V24, V25, V29, V33, V34.

**Create:** `services/agents/src/financial-thesis-adapter.ts`, `test/financial-thesis.test.ts`, `test/financial-thesis-freshness.test.ts`.

**Modify:** `thesis-evaluator.ts`, `thesis-types.ts`, `thesis-repo.ts`; `services/dev-api/src/thesis-seal-input.ts`, `thesis-finding-generator.ts`, relevant agent runtime wiring.

- [ ] RED: unchanged evidence crosses the saved maximum-age boundary and becomes unresolved rather than reusing an old supported assessment. A value just beyond a decimal threshold must retain the existing exact result.
- [ ] Translate the immutable saved condition into retrieval/predicate plans with exact metric, unit, period, threshold attribution, horizon, and freshness. Do not reinterpret the saved condition or let narrative text change its comparison.
- [ ] Preserve duration-fact period-end freshness evaluated at the pinned cutoff. Map verified predicates to supported/challenged according to saved semantics; map gaps to unresolved. Numerical and narrative methods remain distinct.
- [ ] Include definition/result/evidence/cutoff/freshness context in reuse keys. Preserve meaningful-transition alert deduplication so a new serializer or engine version alone does not issue alerts. Finalize assessment and parent effects only under the expected thesis version.
- [ ] GREEN: replay, stale edit/cancellation, exact threshold, source access, freshness, and dedup tests pass along with existing agent suites.

```bash
node --experimental-strip-types --test services/agents/test/financial-thesis.test.ts services/agents/test/financial-thesis-freshness.test.ts
npm test --prefix services/agents
```

- [ ] Commit: `feat(agents): verify numerical thesis conditions with shared financial semantics`.

### T24 — Version explicit numerical Discovery criteria

**Depends on:** T01, T03–T04, T11. **Acceptance:** V01, V02, V12, V24, V33, V34.

**Create:** `services/discovery/src/financial-criteria.ts`, `test/financial-criteria.test.ts`.

**Modify:** `types.ts`, `validation.ts`, `service.ts`, approved-brief persistence/read contracts, and criterion configuration UI contracts.

- [ ] RED: analyst/scout output cannot add a financial threshold absent from the approved brief. Ambiguous legacy prose cannot become a deterministic pass criterion without an approved edit.
- [ ] Add a versioned numerical criterion union containing approved metric/operation, periods/basis, exact threshold, comparison, mandatory/optional status, and freshness. Keep owner/brief version outside model authority.
- [ ] Migrate structurally unambiguous existing numerical configuration losslessly; preserve older narrative criteria as narrative/unknown rather than guessing. A criterion clarification creates a new brief version through the current approval workflow.
- [ ] Generate financial plans deterministically from approved criterion/configuration plus candidate identity. Preserve the campaign's scoped universe, source policy, and limits. A candidate-level finance plan cannot launch a broader search.
- [ ] GREEN: creation, approval, version conflict, legacy read, invalid-unit/threshold, and model-escalation tests pass; campaign creation still does not contact providers.

```bash
node --experimental-strip-types --test services/discovery/test/financial-criteria.test.ts
npm test --prefix services/discovery
```

- [ ] Commit: `feat(discovery): version approved numerical research criteria`.

### T25 — Bind Discovery packets to verified calculated results

**Depends on:** T14, T17, T24. **Acceptance:** V18, V20–V22, V32, V33.

**Create:** `services/discovery/src/financial-packet.ts`, `test/financial-packet.test.ts`, `test/financial-assessment-validation.test.ts`.

**Modify:** `ports.ts`, `packet-repo.ts`, `assessment.ts`, `assessment-validation.ts`, `assessment-prompts.ts`, `read-model.ts`, and visibility checks.

- [ ] RED: a correctly cited source number cannot justify an incorrect derived margin. Conversely, a valid computed ratio that never appears verbatim in the document must be accepted only through a verified computation reference, not by disabling numeric-token validation globally.
- [ ] Attach committed financial result/input references to the authorized candidate packet with explicit identity, packet hash, cutoff, brief version, and certificate. Reload these records server-side; model-supplied packet values are not authoritative.
- [ ] Keep existing exact quote/citation validation and numeric-token defenses for narrative evidence. Add a distinct certified-result citation type with transitive authorization and calculation validation.
- [ ] Make deterministic numerical criterion results authoritative; analyst/skeptic interpretation may explain but cannot override them. Unknown mandatory evidence must not become a pass merely because an agent narrates support.
- [ ] GREEN: wrong packet/candidate/source/owner versions fail; correct calculated references succeed; unrelated quote attacks still fail; hidden/erased inputs hide dependent criteria safely.

```bash
node --experimental-strip-types --test services/discovery/test/financial-packet.test.ts services/discovery/test/financial-assessment-validation.test.ts
```

- [ ] Commit: `feat(discovery): validate financial result references without weakening quote checks`.

### T26 — Execute and seal Discovery finance under existing budgets and fences

**Depends on:** T15, T18, T24–T25. **Acceptance:** V16, V21, V24–V28, V32–V34.

**Create:** `services/discovery/src/financial-execution.ts`, `test/financial-execution.test.ts`, `test/financial-finalization.test.ts`.

**Modify:** `operations.ts`, `stages.ts`, `assessment.ts`, `assessment-repo.ts`, `seal.ts`, `worker-deps.ts`, relevant provider composition; `services/dev-api/src/discovery-wiring.ts`.

- [ ] RED: cancelled/edited/expired-fence campaigns cannot finalize financial candidate results. A finance retry cannot reserve an unapproved extra provider/model attempt or continue after a parent cancellation.
- [ ] Wire acquisition/planning through the existing operation runner, reservations, budgets, and deployment-owned provider composition. Local arithmetic is measured separately; it does not grant permission for extra network work.
- [ ] Reuse the active campaign transaction/fence for candidate decision, snapshot/certificate, packet/brief version checks, and parent events. Avoid a detached finance scheduler that can outlive the parent worker.
- [ ] Preserve mandatory-criterion candidate rules, deterministic ranking policy, partial/cancelled/failed semantics, and meaningful deduplication. Numerical certification is not a claim of comprehensive historical discovery or objective investment ranking.
- [ ] GREEN: actual campaign fixture executes retrieval → finance calculation → validated assessment → committed candidate read. Inject commit/disconnect and stale-fence races; assert one decision and no budget or quote-check bypass.

```bash
node --experimental-strip-types --test services/discovery/test/financial-execution.test.ts services/discovery/test/financial-finalization.test.ts
npm test --prefix services/discovery
node --experimental-strip-types --test scripts/discovery-fixture.test.ts scripts/discovery-eval.test.ts
```

- [ ] Commit: `feat(discovery): finalize numerical assessments within campaign authority`.

### T27 — Complete shared result inspection and surface verification UX

**Depends on:** T16–T17, T19–T26. **Acceptance:** V16, V19, V20, V22, V35, V36.

**Create:** `web/src/blocks/renderers/FinancialResultInspector.tsx`, `FinancialResultInspector.test.tsx`; `web/src/blocks/financial-surface-contracts.test.tsx`.

**Modify:** existing evidence inspector dispatch, surface block/result consumers, Chat stream consumer, and strict finance references in `web/src/blocks/types.ts`.

- [ ] RED: mixed model commentary and certified values cannot acquire one answer-wide verified badge. A missing peer cannot disappear from the accessible table. An old client/schema must show unsupported/legacy status, not fabricated verified text.
- [ ] Implement consistent labels: verified calculation, source-linked narrative, partial coverage, and legacy output. Surface gaps expose safe metric/period/reason context and never secret source membership.
- [ ] Expose input values, formula/definition/version, source and public-time proof, basis/units/scale, numeric policy, cutoff, coverage, and replay eligibility through the shared authorized inspector. No duplicate per-feature calculation UI logic.
- [ ] Verify keyboard navigation, loading/error states, copying canonical displayed values, large/small decimal formatting, safe source links, and chart geometry versus authoritative values. Enforced historical runs default to no model interpretation.
- [ ] GREEN: run real surface contract tests for Chat, memo, grid, thesis, and Discovery; synchronize schema and complete web quality gates.

```bash
(cd web && npm run sync:schema && npm test && npm run typecheck && npm run build && npm run lint)
```

- [ ] Commit: `feat(web): expose consistent financial verification and gap inspection`.

### T28 — Integrate erasure, permission changes, and owner-scoped caches

**Depends on:** T15, T17–T18, T19–T27. **Acceptance:** V22, V23, V30, V37.

**Create:** `services/evidence/test/financial-erasure.test.ts`; `services/financial-engine/src/cache-key.ts`, `test/financial-access.test.ts`.

**Modify:** `services/evidence/src/zero-export-erasure.ts`, relevant source-access writers, `services/tools/src/erasure-tools.ts`, DB privacy tests and parent artifact erasure handling.

- [ ] RED: erasing a user's private intent/threshold or source leaves no recoverable copy in bound inputs, derived results, caches, events, or duplicated parent blocks. Another owner cannot probe result existence by reusing a semantic hash.
- [ ] Extend the actual erasure transaction/order to all new records and derived copies, respecting FK/immutability safeguards. Use audited authorized deletion, not blanket disabling of triggers or unsafe cascades.
- [ ] Coordinate erasure/revocation with finalization's lock protocol and reauthorize on every result/replay read. Authorized retention may leave a minimal unavailable tombstone, not hidden original numeric payloads.
- [ ] Scope caches by owner, parent authority, input/definition/cutoff versions, and current access generation. Never share derived aggregates across a weaker entitlement boundary. General logs contain safe hashes/reason codes, not raw financial/private values.
- [ ] GREEN: test current views, saved display, replay, concurrent finalization, cached results, and all five parent copies after erasure/revocation. Existing privacy tests pass.

```bash
node --experimental-strip-types --test services/evidence/test/financial-erasure.test.ts services/financial-engine/test/financial-access.test.ts db/test/privacy-erasure.test.ts services/tools/test/erasure-tools.test.ts
```

- [ ] Commit: `fix(privacy): erase and reauthorize all financial result dependencies`.

### T29 — Wire readiness, staged modes, startup, and CI dependency installation

**Depends on:** T18–T28. **Acceptance:** V24, V27, V35–V38.

**Create:** `services/financial-engine/src/readiness.ts`, `test/readiness.test.ts`; `services/dev-api/src/financial-env.ts`; `scripts/financial-readiness.test.ts`.

**Modify:** `.env.dev.example`, `.github/workflows/ci.yml`, `services/dev-api/src/main.ts`, financial bootstrap/wiring modules, existing dev-start/install scripts where they enumerate packages, and canonical API alignment tests.

- [ ] RED: enabling finance does not enable Discovery; an unsupported schema/catalog/adapter/client integration prevents enforcement. A verification failure in enforce mode cannot switch to legacy numerical prose.
- [ ] Add server-owned `off`, `shadow`, `enforce` per surface/capability, persisted in each run. Shadow results stay private; off/rollback produces visibly legacy new runs without reinterpreting existing certificates. Do not accept mode from model JSON.
- [ ] Wire supervised startup/recovery only after dependency readiness, with bounded shutdown and parent-specific execution ownership. Keep deployment credentials out of plan JSON and tests.
- [ ] Add `financial-core` and `financial-engine` to the CI service matrix and every relevant per-directory dependency bootstrap loop. Cross-service imports need their dependencies installed in web/dev/DB/service jobs. Include new DB tests in actual CI, not only local commands.
- [ ] GREEN: fresh installation smoke test, schema-sync/API alignment, mode persistence, safe rollback, and disabled-Discovery tests pass. Docker-required finance integration jobs fail rather than silently reporting skipped acceptance tests as a release pass.

```bash
node --experimental-strip-types --test services/financial-engine/test/readiness.test.ts scripts/financial-readiness.test.ts db/test/schema-openapi-alignment.test.ts
```

- [ ] Commit: `chore(finance): wire staged readiness and complete CI coverage`.

### T30 — Build independent financial evaluation and all-five-surface parity gates

**Depends on:** T19–T29. **Acceptance:** all V01–V38, especially V18–V20, V31–V35.

**Create:** `scripts/verified-finance-fixtures.ts`, `scripts/verified-finance-fixture.test.ts`, `scripts/verified-finance-eval.ts`, `scripts/verified-finance-eval.test.ts`; `services/financial-engine/test/cross-surface-parity.test.ts`; `docs/engineering/verified-finance-evaluation.md`.

**Modify:** CI commands from T29 and the producer inventory from T00.

- [ ] RED: seed deliberate failures with valid source IDs but changed numeric results, units, periods, cutoff, definitions, peer counts, and word-only claims. The harness must fail when a mutant is accepted; an always-rejecting engine must also fail the valid-case suite.
- [ ] Build independently calculated golden cases using decimal/rational expectations and reviewed financial definitions. Include exact source tokens, 52/53-week calendars, restatements, public-versus-ingestion timing, date-only uncertainty, negative bases, zero denominators, precision limits, and partial cohorts.
- [ ] Route equivalent supported plans through actual Chat, Analyze, grid, thesis, and Discovery adapters—not five calls directly to the core. Compare numerical results, predicates, cutoff/basis, input lineage, and coverage; allow surface-specific IDs/layout and parent semantics to differ explicitly.
- [ ] Add held-out natural-language question-to-plan cases with human review of intended metric, companies, periods, and definitions. Arithmetic equality alone cannot prove question fidelity. Separate deterministic fixture tests from budgeted live-model evaluation; do not require provider secrets for ordinary CI.
- [ ] Re-run frozen-base migration tests, two-client authorization/fence races, commit/restart recovery, schema/version compatibility, erasure, and all reachable numerical producer paths. Update the inventory with tests and final dispositions, not optimistic completion labels.
- [ ] GREEN: produce a machine-readable report with fixture revision, engine/catalog versions, test counts, gaps, rejected mutants, unexpected skips, and observed latency/cost only when measured. No universal accuracy percentage or unmeasured speedup claim.

```bash
node --experimental-strip-types --test scripts/verified-finance-fixture.test.ts scripts/verified-finance-eval.test.ts services/financial-engine/test/cross-surface-parity.test.ts
```

- [ ] Commit: `test(finance): gate release on mutation resistance and cross-surface parity`.

### T31 — Document operations and perform the release/rollback review

**Depends on:** T00–T30 complete. **Acceptance:** final demonstration of all V01–V38.

**Create:** `docs/operations/verified-finance-runbook.md`; `docs/engineering/verified-finance-release-checklist.md`.

**Modify:** `README.md`, `CONTEXT.md`, relevant service READMEs, and producer/evaluation records with actual results.

- [ ] Document source precision/public-time coverage, supported operation/metric families, legacy limitations, model interpretation boundaries, replay modes, recovery, privacy, counters, and failure reason codes. No marketing assertion of complete financial correctness.
- [ ] Exercise deployment order: additive schema → certificate-aware readers/UI → engine writers in shadow → explicit per-surface enforcement after gates. Verify turning finance on does not turn Discovery on.
- [ ] Exercise rollback on a disposable deployment: stop new enforcement, retain certificate-aware history readers, preserve existing committed artifacts, cancel/recover in-flight work safely, and do not drop financial history. Down-migration tests are not a production rollback procedure.
- [ ] Run the complete affected service/web/DB/script suites and capture exact commands, revisions, pass/fail/skip counts, and environment. Review source coverage and held-out plan fidelity with an analyst. Fix critical findings with a failing regression test before claiming release readiness.
- [ ] Require human sign-off on definitions, migration preservation, finalization/access races, all-five parity, producer inventory, and labels/gaps. Only then authorize the particular deployment's feature-mode change; code merge alone is not production enablement.
- [ ] Commit: `docs(finance): record operational release and rollback evidence`. Follow the repo's issue/branch handoff workflow and verify pushed commits. Do not merge or deploy beyond explicit authorization.

## 4. Acceptance traceability

| Requirement | Implementing tasks | Required evidence |
|---|---|---|
| V01 | T01, T04, T11, T24 | Invalid plans fail before acquisition; authority cannot be model supplied. |
| V02 | T11, T19 | Complete subjects or explicit clarification through actual Chat path. |
| V03 | T02, T09 | Exact token → database → API round trip. |
| V04 | T05, T08–T09 | Legacy precision remains a gap until source revalidation. |
| V05 | T02, T09, T13 | Scale applied exactly once. |
| V06 | T08, T10 | Public-before-cutoff/later-ingestion eligibility with version proof. |
| V07 | T10 | Later restatement excluded from earlier cutoff. |
| V08 | T10 | Conservative date-only bounds tested intraday. |
| V09 | T08–T10 | Unknown timezone or changed bytes cannot inherit false history. |
| V10 | T10, T22–T23 | Cutoff-relative selection and freshness. |
| V11 | T03, T08, T10 | Conflicting evidence cannot be resolved by arbitrary row order. |
| V12 | T03, T10, T21 | Period/dimension/currency/basis compatibility. |
| V13 | T03, T10 | Complete additive quarter sets only. |
| V14 | T02–T03 | Explicit undefined/inapplicable denominator/base cases. |
| V15 | T02–T03, T23 | Exact predicates, not displayed rounded values. |
| V16 | T04, T19, T21–T23, T27 | Partial values survive; full-cohort conclusions do not. |
| V17 | T04, T10, T22 | Frozen scope/cap disclosures and no universe laundering. |
| V18 | T14, T30 | Wrong numerical results with valid citation IDs are rejected. |
| V19 | T03, T16, T19, T30 | Word-only quantitative claims require evaluated predicates. |
| V20 | T01, T14, T16–T17, T30 | Mutated presentation/context/result bindings rejected. |
| V21 | T04, T12–T15 | Declared dependency failure isolation, no generic catch-and-publish. |
| V22 | T08, T14–T17, T25, T28 | Entire transitive closure authorized and non-enumerating. |
| V23 | T15, T28 | Real revocation/publication lock protocol tested concurrently. |
| V24 | T12, T15, T18, T23–T26 | Parent edits, cancellation, and fences prevent stale publication. |
| V25 | T12–T13, T18, T20, T22–T26 | Restart/disconnect idempotency without duplicate effects. |
| V26 | T12, T17–T18 | Same-key/different-hash conflict. |
| V27 | T04, T13, T19, T21–T22 | Outage classification separate from missing data. |
| V28 | T07, T15, T20–T21, T26 | Snapshot/certificate/parent atomicity under fault injection. |
| V29 | T10, T18, T23, T30 | Saved output/replay stable; recalculation creates new run. |
| V30 | T17–T18, T28 | Unsupported versions or erased evidence unavailable, not substituted. |
| V31 | T30 | Actual five-adapter parity with equivalent pinned plans/evidence. |
| V32 | T25–T26 | Legitimate derived references accepted without weakening quote checks. |
| V33 | T19, T23–T26 | Interpretation cannot override numerical criteria. |
| V34 | T02, T23–T26 | Existing exact-decimal/freshness/dedup behavior preserved. |
| V35 | T16, T20, T27, T30 | No draft numerical leakage through streams, tools, errors, or labels. |
| V36 | T07, T16, T27, T29 | Legacy/unknown-version handling never awards false certification. |
| V37 | T17–T18, T28 | Erasure and owner-scoped cache/replay tests. |
| V38 | T01–T04, T09, T12–T13, T29 | Bounded input/graph/allocation/repair behavior. |

## 5. Final verification commands and reporting

The implementation must add the new tests to CI. The following is a minimum root-level final run after installing all relevant per-service dependencies. Existing CI commands remain; do not replace broader tests with only this selection.

```bash
set -euo pipefail
for service in financial-core financial-engine evidence fundamentals snapshot chat analyze analyst-grids agents discovery tools; do
  npm test --prefix "services/$service"
done

node --experimental-strip-types --test \
  db/test/schema-migrations.test.ts \
  db/test/schema-openapi-alignment.test.ts \
  db/test/privacy-erasure.test.ts \
  db/test/background-agent-scaffold.test.ts \
  db/test/financial-evidence-migration.test.ts \
  db/test/financial-ledger-migration.test.ts \
  db/test/financial-publication-migration.test.ts

node --experimental-strip-types --test \
  scripts/open-datasource-coverage.test.ts \
  scripts/discovery-fixture.test.ts \
  scripts/discovery-eval.test.ts \
  scripts/financial-readiness.test.ts \
  scripts/verified-finance-fixture.test.ts \
  scripts/verified-finance-eval.test.ts

(cd web && npm run sync:schema && npm test && npm run typecheck && npm run build && npm run lint)
git diff --check
```

Add checks for imported-service dependency bootstrapping and new package scripts. Use actual CLI output to distinguish failed, passed, and skipped tests. A Docker-dependent suite skipped locally must run in release CI. Model evaluation separately records model/channel, prompt/catalog versions, approved budget, and reviewed question set; do not imply a fixture run measures live-model quality.

## 6. Risks, review boundaries, and handoff

The largest implementation risks are precision already lost upstream, insufficient historical version proof, shared formula-definition errors, unsupported legacy derived values, hidden numerical emitters, and authorization/finalization races. Each has a dedicated task and release test. Large accounting/coverage gaps should become explicit unsupported capabilities, not an unreviewed expansion of this plan.

The document's numerical limits and new module names implement the approved design's defaults. Dependency versions are selected and locked in T01/T02/T09 after compatibility/license review; they are not asserted to be universally current here. Migration numbers must be reconciled before execution if the branch advances. Any material contract change is written into the design and reviewed before downstream tasks rely on it.

**Review ownership:** one reviewer signs off the pure financial definitions; one reviews transactions, source access, and erasure; one reviews actual five-surface behavior and labels. The same person may hold roles on a small project, but those reviews must remain explicit. Model/code-agent agreement is not independent financial verification.

**Plan validation status:** this documentation task has not implemented or run the future tests above. The plan is grounded in the inspected branch, the approved specification, source-tree/CI/package/harness reads, and official decimal.js/lossless-json documentation. Local application execution was not performed. After approval of this plan, select the execution method and work through the unchecked tasks; approval of the architecture or this document alone is not evidence that the capability works.

## References

- [Approved architecture specification](../specs/2026-09-23-verified-financial-answer-engine-design.md).
- [Inspected base tree](https://github.com/xang1234/market-agent/tree/19c84e4f21358f99384e4f5984b9a5cc07bf480a).
- [CI workflow](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/.github/workflows/ci.yml).
- [Database harness](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/db/test/docker-pg.ts).
- [Existing exact-decimal semantics](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/agents/src/exact-decimal.ts).
- [Existing SEC fact writer](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/dev-api/src/sec-fact-writer.ts).
- [Existing erasure boundary](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/evidence/src/zero-export-erasure.ts).
- [decimal.js documentation](https://github.com/MikeMcl/decimal.js) and [API](https://mikemcl.github.io/decimal.js/): independent constructors, precision/rounding, and loss from earlier JavaScript-number conversion.
- [lossless-json documentation](https://github.com/josdejong/lossless-json): lossless numeric parsing and duplicate-key behavior; application bounds, conversions, and evidence policies remain our responsibility.
