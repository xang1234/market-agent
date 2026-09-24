# Verified Financial-Answer Engine

## Architecture design

| Field | Value |
|---|---|
| Date | 2026-09-23 |
| Status | Written specification for review; architecture direction approved in conversation. |
| Repository | `xang1234/market-agent` |
| Base branch | `feat/discovery-campaigns` |
| Inspected base commit | `19c84e4f21358f99384e4f5984b9a5cc07bf480a` |
| Change scope | Architecture documentation only. No product implementation, migrations, or feature enablement. |

**Navigation:** [Decisions](#1-purpose-and-approved-decisions) · [Architecture](#4-architecture-and-dependency-rules) · [Contracts](#5-contracts-and-invariants) · [Historical evidence](#6-temporal-correctness) · [Arithmetic](#7-numerical-and-financial-semantics) · [Persistence](#9-persistence-design) · [Publication](#10-execution-and-publication) · [Integrations](#12-integration-with-all-five-surfaces) · [Acceptance](#16-acceptance-and-release-gates)

## 1. Purpose and approved decisions

Add a shared verified financial-answer capability to market-agent. Models propose bounded financial plans; authorized adapters bind eligible evidence; deterministic operations compute results; the existing snapshot publication boundary independently checks those inputs, calculations, and output bindings before publication.

The user approved these requirements:

| Decision | Required behavior |
|---|---|
| Comprehensive, phased integration | Include Chat, Analyze, analyst grids, numerical thesis checks, and Discovery numerical assessments. All five are completion scope. |
| Partial results | Return independently verified outputs with explicit gaps. Withhold dependent calculations and conclusions. No silent estimates or model-generated numerical fallback. |
| Public-information historical boundary | Historical research uses source versions demonstrably public by the requested cutoff, even if this installation ingested them later. |
| Saved-run replay | Preserve original inputs, definitions, numerical policies, plans, and results. Replay is separate from recalculating historical research with a more complete archive. |
| Existing application | Extend the repository and preserve canonical identities, Evidence/Fundamentals ownership, snapshots, permissions, and existing workflows. |
| Shared architecture | Introduce pure `services/financial-core/` and orchestration `services/financial-engine/`, not a separately deployed calculation service. |
| Publication enforcement | No quantitative result is published as verified before validation and sealing. The server, not the model or caller, determines verification state. |

**Bounded guarantee:** a verified result agrees with its authorized, pinned evidence, selected definitions, historical eligibility policy, and deterministic execution rules. Verification does not establish that an issuer's disclosure is truthful, that every nuance of the user's question was interpreted correctly, or that an investment opinion is correct.

**Success:** equivalent validated plans using the same evidence and definition versions produce the same numerical results across the five surfaces. Every published quantitative assertion is inspectable. Missing evidence cannot silently change a denominator, cohort, period, or conclusion.

## 2. Scope and non-goals

The initial calculation catalog supports reported metric retrieval, compatible-period changes, approved margins and ratios, valid trailing-period aggregation, numerical thresholds, and explicit-peer comparisons. Capability is defined by metric, period, source, precision, and financial semantics, not by an unsupported promise of universal company coverage.

Initial release evaluation uses US issuer financials already served by the repository. Market-based outputs migrate only when the adapter establishes price timing, share/instrument basis, currency, adjustment policy, precision, and historical source-version eligibility. Until then, strict requests receive explicit unsupported dependencies; they do not fall back to legacy arithmetic.

This work does not add workbook export, a filing viewer, a new crawler platform, arbitrary financial-document extraction, methodology-memory editing, change-impact monitoring, brokerage execution, forecasting, or a general-purpose spreadsheet language. Targeted ingestion changes needed to retain numeric tokens, source versions, dimensions, and publication evidence are in scope because the verification guarantee depends on them.

The evidence inspector gains calculation lineage and source/timing details. It may reuse existing locators and original-source links; precise visual highlighting is not part of this design.

Private-source facts cannot enter the public-information mode. A user threshold is allowed as attributed configuration, not as reported evidence. A hypothetical assumption can be echoed with attribution but cannot silently fill a missing reported input or receive a reported-fact badge.

## 3. Baseline and motivating gaps

The following observations are based on static source review at the pinned commit, not execution of the application. Immutable repository links are collected in Appendix A.

| Existing location | Baseline observation | Consequence |
|---|---|---|
| `services/chat/src/llm-runtime.ts` | The model returns plain text that replaces a rich-text block. | Certified quantitative output must bypass unrestricted prose rewriting. |
| `services/chat/src/coordinator.ts` and Chat README | Per-thread coordination and bounded in-memory resume history exist; durable cross-process idempotency is not supplied by that history. | Persist finance runs and committed publication pointers independently of SSE memory. |
| `services/fundamentals/src/issuer-fundamentals-reader.ts` | The reader selects currently active reported facts and converts numerics to JavaScript `number`. | Add strict decimal-string and historical-selection contracts without silently redefining legacy readers. |
| `services/fundamentals/src/sec-edgar.ts` | Financial source values use `number`; the inspected extraction function is income-statement oriented. | Preserve precision before JSON conversion and do not assume other statement families or custom-tag coverage. |
| Canonical database schema | Facts already carry scale, units, reporting/observation timestamps, supersession, and source identity; `computations` already exists. | Extend existing lineage rather than create competing financial truth tables. |
| `services/snapshot/src/snapshot-verifier.ts` | Verifier facts contain reference and metadata fields, but not numeric values or calculation operands. | Reload trustworthy values and independently recompute before certifying publication. |
| `services/analyze/src/seal-input-merge.ts` | Existing merge behavior combines references and can choose the maximum `as_of`. | Strict financial contexts must agree; historical cutoffs cannot silently advance during merging. |
| `services/analyst-grids/src/run-engine.ts` | Bounded grid execution and per-cell results already exist. | Preserve the scope cap, freeze inputs, and distinguish execution success from financial coverage. |
| `services/agents/src/exact-decimal.ts` and thesis evaluator | Exact decimal multiplication/comparison, threshold validation, and explicit unresolved evidence already exist. | Reuse and extend those protections; do not regress them to rounded division or floating-point thresholds. |
| Discovery ports, assessment validation, and sealing | Candidate packets, quote checks, provider-operation budgets, fenced runs, and shared snapshot sealing already exist. | Integrate numerical certification inside those boundaries, not alongside a parallel campaign or sealer. |

Before enabling each surface, inventory every reachable numerical producer, including prose summaries, chart labels, derived metric emitters, and tool-result payloads. A reachable numerical producer cannot silently remain legacy under an answer-wide verification label.

## 4. Architecture and dependency rules

```text
Existing request or approved background workflow
    -> resolve complete intent and canonical subject set
    -> propose typed financial plan
    -> validate structure, semantics, scope, and limits
    -> acquire evidence only through permitted parent policies
    -> bind authorized, time-eligible, immutable inputs
    -> execute deterministic operation graph
    -> prepare results, assertions, and explicit gaps
    -> existing snapshot finalization transaction
         reload trusted input/definition/result records
         check permissions and parent version/lease
         recompute and verify quantitative publication
         commit snapshot + certificate + parent artifact
    -> publish committed answer or apply committed numerical decision
```

| Component | Responsibility | Forbidden behavior |
|---|---|---|
| `financial-core` | Versioned schemas/types, operation definitions, decimal arithmetic, dimensions/period checks, canonical hashing, predicates, pure verification, controlled presentation templates. | No database, providers, models, wall-clock lookup, mutable global arithmetic settings, or feature-service imports. |
| `financial-engine` | Planning orchestration, evidence binding, execution, coverage, durable run records, idempotency, and preparation for sealing. | No raw-document parsing, arbitrary execution, new permission system, or silent provider fallback. |
| Evidence/Fundamentals/Market adapters | Exact financial inputs, source/version identity, public-time proof, dimensions, financial semantics, and current source access. | No model-supplied authoritative values or bypass of promotion/storage rules. |
| Snapshot financial verifier | Reload authoritative records inside the publication transaction and invoke the pure core verifier. | No dependency on engine orchestration; no trust in caller-supplied numeric arrays or verified flags. |
| Surface adapters | Translate existing requests/configurations into the same financial contract; bind committed results to parent artifacts. | No independent ratio arithmetic, historical-selection semantics, or verification badges. |
| Shared renderer/inspector | Render committed values and assertions, disclose gaps, expose calculation/evidence lineage. | No client-side authoritative recalculation or verification based only on JSON metadata. |

Allowed dependencies are `financial-engine -> snapshot -> financial-core` and `financial-engine -> financial-core`. The reverse directions are forbidden. Dependency injection supplies evidence and database adapters; the core does not import a feature's internal runtime.

Use the current Node/TypeScript module conventions, JSON Schema/Ajv approach, model router, PostgreSQL, storage, tool policies, and transaction abstractions. No new agent framework, graph database, independent finance deployment, or external queue is required.

Alternatives considered: separate checkers per feature would duplicate semantics; a standalone calculation service adds deployment/network complexity prematurely; a post-processing model critic cannot enforce numerical correctness. The shared core plus server-enforced publication boundary is the selected approach.

## 5. Contracts and invariants

Publish versioned JSON Schemas and matching TypeScript types. The following specifies required fields and behavior; it is not implementation code.

### 5.1 Financial plan

`FinancialPlanV1` contains a schema version, immutable plan ID, semantic hash, originating intent/configuration reference, planner/model/prompt or deterministic-adapter version, and a human-readable interpretation generated from the validated structure.

It also contains:

- The complete canonical subject set and frozen peer membership, with requested/resolved/omitted counts.
- `knowledge_cutoff`, cutoff timezone, `time_mode = public_information`, reporting basis, period policy, freshness policy, and source-policy version.
- Exact metric/operation definition versions and a bounded acyclic graph of uniquely identified operations.
- Typed operation parameters, requested outputs, explicit dependency edges, and predeclared publication units.
- Attributed user/configuration thresholds, approved catalog constants, execution limits, and presentation-template version.

**Authority is outside model-owned JSON.** The server supplies owner, egress channel, parent object/version, allowed sources, feature policy, approval state, and any lease/fencing token. Models cannot grant access, raise budgets, enable capabilities, choose another owner, or mark results verified.

The model may propose recognized metric keys, but the server resolves immutable approved definitions. It cannot select arbitrary fact IDs as authoritative inputs. Trusted surface selections are still reauthorized. Arbitrary SQL, JavaScript, formula source code, dynamic imports, and unrestricted expressions are rejected.

Validation rejects cycles, unknown fields/operations, unresolved identities, undeclared subjects, invalid units, unbounded universe scans, excessive fan-out, and invalid parameters before acquisition. A plan cannot ignore a company merely because the legacy chat convenience path found another company first.

Planning returns `ready`, `needs_clarification`, or `unsupported`. Allow at most one schema-repair call within the parent's model budget. Material ambiguity, such as an unspecified custom EBITDA definition, asks the interactive user; background workflows become unresolved/blocked until approved configuration resolves it. A clarification never changes a saved thesis or campaign brief without its existing versioned approval path.

### 5.2 Bound input

`BoundFinancialInputV1` records input-slot identity; fact ID; canonical subject and immutable metric definition; source/document/version hashes and available locator; raw numeric-token proof; decimal value and scale; exact native value; unit/currency; instant or duration semantics; exact period dates; fiscal labels/calendar version; dimensional scope; reporting/adjustment/share basis; publication attestation; observation time; precision status; and promotion/eligibility policy.

Once bound, the payload is immutable. Its hash excludes mutable current permissions, but finalization and reads recheck permissions. Required missing precision, publication, or dimensional evidence produces a gap rather than an implicitly acceptable null.

Legacy derived facts are not trusted because they have a source ID or displayable status. They need complete certified calculation lineage or must be recomputed from eligible original inputs.

### 5.3 Result, assertion, and coverage

Each requested output gets a stable result/node ID, typed payload, dependency references, hash, and disposition:

`verified`, `missing`, `unsupported`, `not_applicable`, `undefined`, `incompatible`, `blocked_dependency`, or `execution_error`.

A verified value refers to its bound input or computation. A verified assertion refers to an evaluated predicate and declared population. An unsuccessful output has a reason code and safe explanation, not zero, NaN, empty string, or a fabricated fact.

Draft results have internal state `computed`; only successful finalization assigns public verification. A caller cannot award that disposition. Finalized gap payloads are also immutable and bound to their publication.

Answer coverage is `complete`, `partial`, or `none`, measured against requested outputs. Execution status is separate: a valid execution may complete with coverage gaps. A requested numerical answer with zero verified outputs must not be presented as verified success. Conversely, a fully evaluated screen with genuinely no matches can be a complete empty result.

### 5.4 Publication certificate and hashing

`FinancialPublicationV1` binds snapshot ID, parent artifact identity/version, financial run/unit IDs, result IDs, plan/input/definition hashes, transitive computation closure, coverage, numeric policy, renderer version, and certificate digest. Only the successful server sealing transaction creates it.

Canonical hashing uses versioned deterministic JSON serialization: sorted object keys, ordered arrays where order is meaningful, canonical decimal strings, explicit null semantics, and no non-finite numbers. Random persistence IDs are excluded from semantic plan hashes but retained in record-binding hashes. Do not conflate a request's semantic equivalence with its owner-scoped storage identity.

Hashes detect inconsistent internal bindings; they are not third-party attestations or protection against a malicious database administrator. Existing artifacts without financial certificates remain source-linked legacy artifacts and are never retroactively relabeled.

### 5.5 Non-negotiable invariants

No model-generated number becomes reported evidence. No source-link-only certificate is treated as arithmetic verification. No financial precision is lost through JavaScript `Number`. No future source version enters a historical result. No missing value silently changes a population or denominator. No unsealed financial answer reaches the user. No replay bypasses current permissions. No surface implements a second financial semantics system.

## 6. Temporal correctness

### 6.1 Prove availability of the particular source version

Introduce source-version-bound publication attestations with lower/upper bounds, precision (`instant`, `date`, or `observed_public`), source timezone, proof reference/hash, provider mapping version, and attestation time. Eligibility requires the conservative upper bound to be no later than the requested cutoff.

Date-only publication metadata spans the declared source-local day. An intraday cutoff cannot assume midnight availability. Unknown source timezone or unsupported timing provenance produces `publication_time_unknown`; the user's display timezone cannot manufacture a source publication time. A date-only user query resolves to end of day in the explicit query timezone and displays that interpretation.

A controlled public fetch proves those exact bytes were available no later than the observation, not earlier. An accession-bound archived filing may use a reviewed provider-specific publication mapping. Receipt/acceptance timestamps are not automatically dissemination timestamps. Today's aggregated Company Facts response does not prove every embedded value was public at a historical cutoff.

The proof identifies exact source content and fact context. An old page URL with a later-added number is not historically eligible merely because the page originally existed. Corrected attestations are new versions, not silent rewrites.

For strict financial artifacts, snapshot/block `as_of` represents the knowledge cutoff. Snapshot creation and execution timestamps remain separate. Existing fact timestamps keep their source semantics; adapters must map them explicitly, not rewrite them to pass a check. A section using later evidence cannot join a certified historical snapshot. Future-cutoff forecasting is unsupported in v1.

### 6.2 Selection algorithm

For every declared input slot:

1. Resolve exact subject, metric definition, period, basis, dimensions, and allowed source classes from the validated plan.
2. Read currently authorized candidates. Apply source deletion, invalidation, promotion, channel, and owner rules before returning metadata. Initial fundamental inputs require authoritative/corroborated reported values, or reviewed promoted extractions with exact source-token proof. Estimated values are excluded.
3. Require public availability at the cutoff, exact numeric transport, and compatible units, period, scope, adjustment/share basis, and definitions. Evaluate freshness relative to the cutoff, not execution time.
4. Evaluate economic supersession among versions public at that cutoff. A currently superseded original can be the correct historical input. An invalidated extraction error does not become trustworthy by moving the cutoff backward.
5. Apply the explicit basis policy: `as_reported` selects the original eligible disclosure for the exact period; `as_restated` selects the latest compatible disclosed revision public by the cutoff. Never silently mix the two.
6. Equivalent duplicate evidence may use a stable tie-break. Conflicting values not resolved by an approved financial/source rule become `conflicting_evidence`; UUID ordering cannot choose financial truth.
7. Persist bindings, proof references, selection policy, binding time, and an authorized candidate-set digest. Preserve unresolved input slots. Truncation must become a scope/coverage limitation, never evidence of completeness.

Finalization rechecks the pinned inputs; it does not substitute candidates that arrived mid-run. A certificate describes available repository coverage at binding, not a guarantee that every historically public source in the world has been ingested.

### 6.3 Periods, restatements, and cohorts

Period identity includes start/end, instant/duration, fiscal labels/calendar version, and dimensional scope. A year label alone is insufficient. “Latest” resolves at the requested cutoff.

V1 supports exact fiscal/annual periods and valid trailing aggregation, not silent calendarization, interpolation, or prorating. Issuer-specific fiscal periods can be displayed with explicit labels; they do not automatically support a synchronized peer ranking. Year-to-date subtraction is permitted only through an approved reconciliation operation with matching basis and scope. Diluted EPS and weighted-average shares are not additive flow values.

Distinguish later economic disclosures from corrected extraction/normalization metadata. Ambiguous legacy supersession history is a gap until reconciled. A retrospective research run can benefit from corrected extraction of an old disclosure, but saved-run replay cannot silently change its original inputs.

Freeze peer membership before computation. Historical analysis of a user-selected present-day peer list is allowed if labeled as such; it is not historical universe reconstruction. Universe-wide historical claims require membership/security-history coverage, including relevant omissions. Discovery's current candidate collection does not acquire a point-in-time-market-discovery guarantee through numerical certification.

### 6.4 Replay versus recalculation

`display_saved` loads the sealed artifact without evidence reselection or model calls. `verify_replay` recomputes from pinned inputs and definition/operation versions supported by the deployed trusted version registry. It never downloads and executes arbitrary historical code. Missing support returns `replay_version_unavailable`.

`recalculate` creates a new run/snapshot and may use newly ingested evidence that was public before the same cutoff. It never mutates the prior answer.

Both respect current permissions, deletion, erasure, and known invalidation. Authorized old output may preserve its original value with a later-invalidated warning; it cannot be described as freshly reverified valid evidence. Reproducibility is not a right to expose revoked data.

Historical certification applies to selected evidence and deterministic results. It does not imply a language model has forgotten knowledge learned after the cutoff.

## 7. Numerical and financial semantics

### 7.1 Precision starts at ingestion

Use canonical decimal strings across APIs, storage adapters, binding, and result serialization. Preserve original numeric tokens and scale independently. Query PostgreSQL numerics as text in strict adapters; do not globally replace the numeric parser and break legacy consumers.

Use `lossless-json` for external financial JSON whose normal parsing would lose numeric tokens. Convert years/counts/identifiers to bounded integers only after validation. Financial amounts cannot pass through `Number`. Reject duplicate-key ambiguity, malformed tokens, and excessive response sizes. Raw proof material follows existing source licensing and storage policy.

Legacy facts receive `source_token_preserved`, `revalidated_against_source`, or `legacy_unverified` precision classification. Converting an already rounded number back to a decimal string does not recover source fidelity. Revalidate using retained or authorized source bytes; otherwise expose a precision gap. Corrections create new fact/version relationships rather than changing values cited by old snapshots.

Scale applies exactly once. Native value and display scaling are separate. Currency, shares, currency per share, dimensionless ratios, percentage points, and basis points are distinct representations with explicit conversion rules. Currency conversion requires a registered operation and dated FX evidence; silent currency conversion is outside v1.

### 7.2 Arithmetic policy

Move/reuse the existing exact-decimal comparison and multiplication semantics in the shared core, retaining compatibility tests and legacy threshold-write restrictions. Add bounded exact addition/subtraction for finite decimals. Keep `BigInt` internal; JSON carries strings.

Use a private `Decimal.clone` from `decimal.js` for division and derived-value formatting, initially with 50 significant digits and half-even rounding. This is a versioned design default, not a universal financial standard. Repeating divisions are explicitly rounded representations, not mathematically exact decimals. Do not mutate global constructor configuration.

Predicates must not use display-rounded values. Reported thresholds use exact decimals. Supported ratio/growth predicates compare exact signed cross-products of eligible operands, including denominator sign checks. Registered chained operations must preserve sufficient exact expression lineage for comparisons; when a required predicate cannot be established within supported bounds, return `precision_indeterminate` rather than compare approximations.

Normalize zero consistently while retaining original source token/precision metadata. Record operation order and rounding policy. The inspector exposes enough precision to explain a predicate even when two displayed values round identically.

Versioned resource limits: source numeric tokens at most 256 characters, absolute exponent at most 1,000, and exact intermediate coefficients at most 4,096 digits. Existing stricter public threshold validation remains until explicitly versioned. Check bounds before expansion/allocation. Excesses return `numeric_limit_exceeded`, not an unbounded computation.

### 7.3 Initial operation catalog

| Operation | Rule and constraints |
|---|---|
| `reported_metric` | Retrieve an eligible exact subject/metric/period/basis input without model arithmetic. |
| `absolute_change` | Current minus prior, with compatible dimensions, scope, and period/basis policy. |
| `percent_change_positive_base` | `(current - prior) / prior`, requiring a positive prior value. Zero/negative bases produce explicit gaps; absolute changes may remain valid. |
| `gross_margin`, `operating_margin`, `net_margin` | Approved numerator divided by positive revenue with identical reporting period, scope, and basis. No invented missing numerators. |
| `ratio` | Only approved metric pairs, with explicit denominator constraints, dimensions, timing, and interpretation. Not arbitrary division. |
| `trailing_sum` | Complete consecutive non-overlapping fiscal-quarter sets for approved additive flow metrics. No summing margins, point-in-time balances, or EPS. |
| `threshold` | Exact supported predicate against an attributed saved threshold in compatible units, with explicit freshness/horizon. |
| `peer_compare` | Compare a frozen cohort on compatible definitions and periods. Ties explicit; full-cohort maximum/universal assertions require complete relevant coverage. |

Market inputs also require listing identity, price timestamp/delay class, trading currency, and adjustment policy. Market capitalization and valuation ratios need explicit share/instrument scope and stock/flow timing. A current provider snapshot cannot establish historical coverage.

Guidance, consensus estimates, scenarios, and model estimates are not reported historical facts. Any future estimate-aware operation needs a separate typed definition and visible basis, not an implicit fallback.

## 8. Partial results and failure isolation

Declare publication units before execution: a Chat/Analyze numerical section, grid cell, numerical thesis condition, or Discovery candidate's numerical assessment. Each unit has a dependency closure. Shared input failure blocks every dependent unit.

| Condition | Required treatment |
|---|---|
| Missing/stale data, uncertain public timing, unsupported precision | Explicit gap; independent verified units can survive. |
| Zero denominator or inapplicable formula | `undefined` or `not_applicable`, not zero or Infinity. |
| Incompatible units, definitions, periods, or currencies | Withhold affected comparisons; no silent normalization. |
| Provider timeout or database failure | `execution_error`, separately classified from absent evidence. |
| Unsupported calculation | Explicit unsupported output, no model-written substitute. |
| Invalid plan, ownership/scope escalation, common-manifest tampering | Run-fatal; no new publication from that run. |
| Isolated corrupt source in a declared independent unit | Reject that unit and dependents; independently verify unaffected closures before publication. Never catch arbitrary verifier exceptions as missing data. |

Coverage uses requested output counts. A partial peer group cannot support a full-group superlative or “all” statement. Available-row sorting is allowed with an incomplete-coverage label; it is not a universal financial conclusion. An available-case aggregate must be explicitly requested and label its restricted population.

A failure cannot be “repaired” by deleting offending references from a common invalid certificate. Previously committed independent units remain historical artifacts, subject to current invalidation/access warnings; uncommitted dependent units remain blocked.

## 9. Persistence design

Use additive migrations and update the canonical schema pack. Allocate migration numbers from the actual branch tip during implementation. Existing facts, computations, and snapshots remain the evidence/lineage foundation.

| Record | Responsibility |
|---|---|
| `financial_definition_versions` | Immutable approved metric/operation JSON, hashes, and catalog versions tied to existing metric IDs. No executable user rules. |
| `source_publication_attestations` | Exact source-version/hash, time bounds, precision/timezone, proof reference, mapping version, supersession. |
| `fact_precision_attestations` | Fact/source binding, token/scale proof, precision classification; append-only revalidation history. |
| `fact_financial_contexts` | Required dimensions, instant/duration, adjustment/share basis, calendar version, source context; reuse existing fields where sufficient. |
| `financial_plans` | Owner/origin, validated immutable plan, semantic/binding hashes, definitions, interpretation, planner provenance. |
| `financial_runs` | Owner/parent/version, request key/hash, plan, execution/coverage state, binding time, lease epoch/expiry, policies, cancellation, replay parent. |
| `financial_run_units` | Predeclared unit identity, dependencies, state, coverage, and final snapshot/certificate pointer; immutable closure once bound. |
| `financial_run_inputs` | Run/input-slot key, fact/context/attestation references, canonical bound payload/hash, selection policy and candidate-set digest. |
| Existing `computations` | Extend with financial run/node identity, formula/definition/code/numeric policy versions, input closure and output hash; preserve legacy rows. |
| `financial_results` | Stable requested-output disposition, typed value/predicate/gap payload, dependencies, computation reference, hash, finalization state. |
| `snapshot_financial_runs` | Existing snapshot-to-run/unit certificates, result/presentation hashes and verification versions. |
| `financial_run_events` | Bounded durable progress/terminal publication pointers; no raw provider values or unrestricted model text. |

Derived results must not become fabricated globally authoritative facts merely to fit an old `value_ref`. Direct values reference bound facts; derived values reference computations/results. Extend the wire reference union explicitly.

Use existing `user_id` ownership semantics. Idempotency is unique by owner, parent kind/ID, and request key. Same key with a different request hash or parent version is a conflict. Inputs are unique per run/slot; computations per run/node; results per run/output slot; units per run/unit; certificates per snapshot/run/unit. Model-supplied IDs cannot cross these scopes.

Insert computation and result bindings coherently; the verifier checks bidirectional and transitive references. Separate mutable run/unit lifecycle from immutable payloads. Sealed plans, inputs, results, and computations cannot change in place. Erasure uses an explicit authorized path, not an accidental cascade or blanket immutability exemption.

Backfill only when proof exists. No universal migration marks old numerics/publication timestamps verified. Ambiguous historical correction metadata remains a gap. Legacy readers keep functioning outside enforcement, but cannot mint new financial certificates.

## 10. Execution and publication

### 10.1 Durable lifecycle

Run execution states are `pending`, `running`, `ready_to_seal`, `completed`, `failed`, or `cancelled`; coverage is orthogonal. Each predeclared unit tracks its own pending/computed/sealed/rejected disposition. Final run coverage summarizes requested outputs across all units, not merely successful cells. Clarification is a planning outcome, not a failed computation.

Persist the validated plan/run before execution. Evidence acquisition uses existing parent authorization/budgets. Bind inputs through a consistent read, persist that binding, and reuse it after retries. Refresh creates a new run. Execute outside long transactions; persist idempotent draft checkpoints that are not publicly readable as verified results.

Starting limits are 25 subjects, 20 periods per subject, 512 operations, 2,000 requested outputs, 10,000 input candidates, and four concurrent evidence tasks. Lower parent limits win. Scope reduction must be explicit when a limit is exceeded. These are versioned design defaults to benchmark, not performance claims. Model/provider budgets remain parent-owned.

### 10.2 Finalization transaction

Use a pinned PostgreSQL client. No model or provider calls occur during finalization. For each unit, within one transaction:

1. Lock run/unit state and validate owner, cancellation, feature policy, parent version, and lease epoch/fence.
2. Reload authoritative input, source, definition, proposed computation, and result records. Caller arrays are not trusted verification inputs.
3. Recheck current source access, deletion/invalidation, exact hashes, scope, temporal eligibility, units, periods, and transitive dependency closure.
4. Recompute approved operations/predicates through `financial-core`; compare canonical outputs and hashes. Do not simply trust an earlier `verification.ok` flag.
5. Validate every quantitative presentation binding and coverage assertion, plus existing source/tool-call disclosures and write approvals.
6. Insert the existing snapshot, certificate, parent artifact/result references, and durable publication event; commit before emitting answer blocks or applying numerical parent decisions.

Existing preparatory verification outside a transaction is insufficient for the financial guarantee. The finance verifier runs inside the pinned parent/finalization transaction. Sealing on one connection followed by parent insertion on another cannot certify atomic publication.

Strict Analyze merging requires identical owner, cutoff, reporting basis, normalization, and compatible definition/provenance context. Duplicate IDs with conflicting payloads fail. Taking the maximum cutoff is not permitted on this path.

Permissions and publication need an explicit serialization protocol: lock stable access/source coordination rows in canonical order, and make revocation/erasure take compatible locks. A revocation completed before finalization wins; one after commit hides later reads. Recheck on retrieval. Merely using repeatable-read isolation does not solve a check-then-publish permission race. Parent configuration edits and cancellation likewise participate in the appropriate locks/fences.

### 10.3 Recovery, idempotency, and side effects

The run ledger is authoritative across restarts. Chat/Analyze/grid hosts may kick local execution, but expired finance leases must be recoverable by a supervised bounded worker. Discovery remains the parent scheduler and controls/fences child execution; no independent scheduler can continue a cancelled campaign.

A disconnect after commit returns the already committed artifact on retry rather than repeating model/provider work. Stale worker epochs cannot finalize. Durable event IDs permit client deduplication; expired detailed event history triggers a status fetch, not a hidden rerun.

The finance engine does not place trades or send alerts. Thesis/Discovery parent effects consume committed decisions through existing approval/idempotency mechanisms. Exactly-once external provider execution is not promised; parent attempt reservations and unknown-outcome handling remain required.

## 11. Presentation and evidence inspection

### 11.1 Closed quantitative grammar

Add versioned `financial_answer` blocks to the existing block schema/registry and schema-sync process. They carry certified result references and restricted layout metadata, with scalar, metric table, series, predicate statement, and gap presentations. Add explicit `financial_result` and `computation` reference kinds.

Render numerical language from registered templates and typed subject/metric/period/value references. “Increased,” “doubled,” “highest,” and “all exceeded” require evaluated predicates even when no digits appear. Missing proof cannot be repaired by a numeric-token scan or another model's opinion.

The verifier reconstructs permitted presentation bindings and hashes them. Model strings cannot change a unit, period, company label, comparison population, or conclusion while retaining the same certified value reference. User quotes/configuration are explicitly attributed and do not become computed assertions.

In v1 the primary financial-answer lane uses controlled grammar only. Optional model interpretation is separately labeled and non-certified, disabled by default for historical financial runs. It cannot fulfill a missing output, determine a numerical criterion, or act as fallback for verification failure. Narrative-only research remains available but cannot acquire certification through a router flag.

### 11.2 Publication and UI behavior

Progress events may stream before sealing; unsealed numerical values may not. Apply the rule to raw tool payloads, previews, titles, error messages, accessibility labels, and partial render buffers, not just the final answer block. Animation after commit is allowed.

Show “Verified calculation,” “Source-linked narrative,” “Partial coverage,” and “Legacy output” distinctly. Never apply an answer-wide verified badge to mixed certified and model-interpreted content. Unknown financial schema versions show a compatibility notice rather than a misleading fallback renderer.

The result inspector shows formula and definition versions, input values/identities, scale/units, period/basis, public-time evidence, original-source links/locators, precision/rounding, cutoff, coverage, and replay eligibility. Every request rechecks parent visibility and all transitive source access.

Chart geometry may use bounded numeric approximations after safe conversion, but tooltips, accessible tables, ordering predicates, and API output use canonical decimal values. Geometry never feeds back into authoritative calculations. Missing rows remain explicit in sort/filter displays.

## 12. Integration with all five surfaces

### 12.1 Chat

Integrate through `services/chat/src/local-runtime.ts`, `llm-runtime.ts`, `coordinator.ts`, message persistence, and SSE consumers. Resolve every requested subject; a first-match convenience path cannot silently convert a peer question to a single-company answer.

Financial requests produce explicit plan interpretations and controlled result blocks. Bypass unrestricted rich-text replacement for the certified lane. Carry plan/run/result references through tool logs, sealing, durable message persistence, reconnects, and replay. Unsupported calculations remain gaps, not synthetic numerical answers.

Clarifications create a revised validated plan. They do not alter prior sealed answers. Deterministic inputs coming from other surfaces can call the same engine without a model.

### 12.2 Analyze

Adapt section producers/runners and local runtime wiring. Numerical sections execute shared plans/subgraphs; narrative sections retain their separate status. Persist finance references and coverage in memo run metadata and snapshot certificates.

Finalize memo references and snapshots atomically. Strict merges enforce the common financial context. Free-text discussion cannot override a certified table or imply the whole memo is verified. Existing emitters using legacy derived facts migrate to certified lineage or return unsupported dependencies.

### 12.3 Analyst grids

Adapt column catalog, fiscal-fact/period-context selection, cell runner, run engine, and progress queries. Deterministic financial columns construct plans directly and select periods at the pinned cutoff.

Freeze subject membership, column-instance IDs, definitions, parameters, and order for each run. A repeated column key cannot cause two distinct columns to share the wrong result. Preserve the row cap and disclose omissions. Per-cell finalization is allowed; aggregate coverage counts gaps separately from execution errors. Recovery reuses committed cells and cannot double-increment progress.

Reader-question columns remain source-linked narrative unless a quantitative request is translated into supported finance nodes. Certification does not spread from a neighboring deterministic cell. Every financial column in an enforced grid uses the engine or returns an explicit unsupported result.

### 12.4 Numerical thesis checks

Translate saved numerical conditions into exact retrieval and predicate plans. Preserve thesis ownership, immutable versions, units, periods, thresholds, horizons, and stale-version prevention. Retain existing exact-decimal threshold behavior.

Map true/false to supported/challenged according to the saved condition; map missing/incompatible evidence to unresolved. Existing duration-fact freshness based on period end remains unless explicitly versioned. Historical freshness uses the cutoff. Numerical and narrative assessment methods remain visibly distinct.

Reuse keys include evidence, definition, result, cutoff/freshness context, and thesis version. An unchanged packet crossing its freshness boundary must not reuse an old supported assessment. Serialization/version changes alone must not create duplicate alerts: parent alert logic consumes meaningful committed condition transitions.

### 12.5 Discovery numerical assessments

Extend candidate evidence packets with financial input/result references, preserving packet identity/hash, owner, approved brief, budgets, and fencing. Numerical criteria require an explicit structure in an approved brief/configuration; the model cannot add a new threshold without approval. Ambiguous legacy prose remains unknown until a brief edit resolves it.

Deterministic outcomes are authoritative for numerical criteria. Analyst/skeptic narrative cannot vote them into a different pass/fail status. Retain quote and numeric-token checks for narrative evidence; computation references permit legitimate derived values not printed verbatim in a source without weakening unrelated quote checks.

All evidence/model work uses the existing budgeted operation runner. Pure computation does not authorize extra provider attempts. Use the parent fenced transaction for snapshot/certificate/candidate decision publication. Missing mandatory criteria follow existing candidate eligibility rules and cannot improve ranking by disappearing. Numerical certification does not promise complete historical market discovery or validate an investment ranking as objective truth.

## 13. API and tool contracts

Existing feature endpoints remain the entry points. Add narrow status/result/replay endpoints within the existing API host:

| Endpoint | Contract |
|---|---|
| `GET /v1/financial-runs/{runId}` | Authorized state, interpretation, coverage, and committed result references. No draft numerical payloads. |
| `GET /v1/financial-runs/{runId}/results/{resultId}` | Authorized committed result and transitive inspector lineage; non-enumerating not-found for inaccessible IDs. |
| `POST /v1/financial-runs/{runId}/replay` | Owner-authorized idempotent `verify_replay`; no evidence acquisition/model calls; unsupported historical versions explicit. |

Recalculation is an explicit new-run action through the originating feature's existing approval policy, not a side effect of GET or opening an inspector. State-changing actions use the repository's established authentication/CSRF conventions; a development identity header is not a production trust mechanism.

Internal entry points are plan validation, input binding, bound-plan execution, and publication preparation. Finalization remains owned by the snapshot/parent transaction. TypeScript brands aid callers but do not replace validation at serialized boundaries.

Tool entries declare supported operations, capabilities, and limits. Logs bind actual evidence reads to plan/run/result hashes. Do not invent a provider call to legitimize a local calculation. General telemetry receives sanitized IDs/hashes/reason codes, not private values or raw documents.

## 14. Security and privacy

Authorize the entire transitive input closure at binding, publication, retrieval, and replay. Seeing one operand does not authorize seeing an aggregate. V1 does not weaken source entitlements for derived results. Owner-scoped caches must not leak results, existence, membership counts, or source metadata across tenants.

Documents and models are untrusted. They cannot modify definitions, permissions, approval flags, execution limits, or code. Raw documents stay behind Evidence/Fundamentals. Sanitize external source links and reject executable content in any formula-like field.

Erasure must cover user intent/thresholds, bound input copies, derived results, caches, event payloads, and parent artifact duplicates through the existing authorized erasure workflow. Immutable history is not justification for retaining deleted private inputs. Where allowed, a minimal tombstone may explain replay unavailability without preserving a recoverable result.

The verifier and executor share approved formula code and can share a semantic bug. Independent recomputation prevents tampered inputs/results, not every shared definition error. Reviewed golden financial cases, independent arithmetic oracles, mutation tests, and explicit operation-version review address that residual risk.

## 15. Rollout, compatibility, and delivery sequence

Use server-owned per-surface/per-capability modes: `off`, `shadow`, and `enforce`. Off preserves visibly legacy behavior. Shadow privately evaluates the new path without changing the answer. Enforce permits only certified quantitative output and explicit gaps; failure does not silently switch that request to legacy numerical prose.

Persist selected mode in the run. Rollback can stop new enforcement but cannot reinterpret existing artifacts. Deploy additive schema and certificate-aware readers/UI before finance writers. Do not automatically run destructive rollback migrations. The finance flag does not enable disabled Discovery campaigns.

Readiness requires schema/operation versions, evidence adapters, permissions, and parent-artifact integration. No surface reaches enforcement until its numerical producer inventory is covered. Match existing code/configuration policies rather than introducing a second source of runtime authority.

| Delivery wave | Exit condition |
|---|---|
| Contracts and exact inputs | Catalog, schemas, arithmetic, precision/public-time contracts, independent numerical tests. |
| Temporal execution and publication | Durable ledger, versioned bindings/results, transactional verification, permission/replay controls, gap semantics. |
| Chat and Analyze | Actual user requests complete the verified path; streaming and prose cannot bypass it. |
| Grids | Certified cells or explicit gaps, frozen definitions, coverage accounting, restart-safe execution. |
| Thesis and Discovery | Shared numerical predicates preserve parent approvals, fencing, freshness, packets, and deduplication. |
| Cross-surface release | Regression/evaluation evidence, documentation, observability, failure recovery, and rollback exercise. |

These waves are architectural sequencing, not the detailed implementation plan. The next artifact decomposes them into exact test-first tasks and commands after review of this written specification. Shipping Chat alone is not completion of the approved comprehensive scope.

## 16. Acceptance and release gates

Every scenario requires deterministic tests; publication, access, concurrency, and persistence cases additionally require real PostgreSQL integration. UI cases require renderer/transport tests. These are required outcomes, not claimed test results.

| ID | Scenario | Required outcome |
|---|---|---|
| V01 | Invalid operation/graph/subject, unknown fields, budget escalation | Reject before acquisition. |
| V02 | Multi-company question with ambiguity | Resolve the complete set or clarify; never silently choose one company. |
| V03 | Large decimal/integer tokens, exponent notation, scaling | Preserve source value through parsing, DB, binding, and API output. |
| V04 | Legacy rounded value without proof | Precision gap until source revalidation. |
| V05 | Nontrivial value and scale | Apply scale once and expose agreeing lineage. |
| V06 | Public Jan 10, ingested Feb 1, cutoff Jan 15 | Eligible only with source-version-bound timing proof. |
| V07 | Restatement after cutoff | Original eligible value retained; later revision excluded. |
| V08 | Date-only publication and intraday cutoff | Conservative bound; no midnight assumption. |
| V09 | Unknown source timezone or later-changed URL | Historical gap without adequate version/timing proof. |
| V10 | Old cutoff, much later execution | Freshness evaluated at cutoff. |
| V11 | Conflicting evidence/correction history | Explicit conflict; ID ordering cannot choose truth. |
| V12 | Fiscal, unit, currency, dimensional, or basis mismatch | Withhold affected calculation with specific reason. |
| V13 | Missing/overlapping quarters or non-additive metric | No invalid trailing sum or summed EPS/margin. |
| V14 | Zero/negative growth base, zero denominator | Correct gap, no Infinity or fabricated zero. |
| V15 | Threshold near display-rounding boundary | Exact supported predicate; display rounding does not decide. |
| V16 | One missing peer | Independent values survive; full-cohort superlative withheld. |
| V17 | Scope/query/grid cap | Disclose restricted population; no uncapped-universe claim. |
| V18 | Wrong numerical result with valid citation IDs | Reject recomputation mismatch before publication. |
| V19 | Unsupported “doubled,” “highest,” or “all” | Cannot enter certified grammar without evaluated predicate. |
| V20 | Modified unit/label/result ID/cutoff/presentation | Reject binding mismatch. |
| V21 | Shared versus isolated integrity failure | Correct dependency blast radius; no generic catch-and-continue. |
| V22 | Unauthorized/deleted transitive input | No disclosure; non-enumerating response and cache/replay checks. |
| V23 | Revocation concurrent with publication | Required serialization and read hiding. |
| V24 | Parent edit/cancellation or stale worker epoch | No stale certificate or parent side effects. |
| V25 | Commit then disconnect/restart | Same committed artifact, no duplicate effects. |
| V26 | Same request key, different hash | Conflict rather than accidental reuse. |
| V27 | Provider/DB outage | Execution error, not absent evidence or successful empty answer. |
| V28 | Failure at snapshot/parent transaction steps | No publicly visible partial certificate/parent artifact. |
| V29 | Later data/model/definition changes | Saved output stable; recalculation creates a new run. |
| V30 | Unsupported replay version/erased source | Explicit unavailable; no new evidence/code substitution. |
| V31 | Equivalent plan/evidence across all five surfaces | Equal values, predicates, cutoff rules, and coverage. |
| V32 | Legitimate computed Discovery number absent verbatim in source | Valid only through computation binding; narrative checks retained. |
| V33 | Model interpretation conflicts with numerical condition | Deterministic numerical outcome unchanged. |
| V34 | Existing exact-decimal/freshness/dedup behavior | Preserved or explicitly versioned and reviewed. |
| V35 | Draft values in tools/titles/errors/a11y/stream buffers | No pre-finalization financial answer leakage. |
| V36 | Legacy snapshot or older client | Legacy label or compatibility notice, never false verification. |
| V37 | Erasure and cross-owner cache probing | No retained private results or unauthorized existence leaks. |
| V38 | Extreme tokens, duplicate keys, oversized graphs | Bounded failures before excessive allocation/retry. |

Maintain held-out human-reviewed question-to-plan cases for request fidelity and financial meaning. A correct calculation over the wrong metric is still a wrong answer. Each operation needs approved normal/boundary/incompatible cases; each enforced surface needs real end-to-end scenarios.

Release requires zero accepted known-bad publications in the mandatory mutation suite, exact agreement on the approved deterministic corpus under the declared numeric policy, passing transaction/security/replay tests, reviewed plan-fidelity results, disclosed precision/public-time coverage, and human review of gap/verification labeling. Do not report a universal accuracy percentage or speedup without measurements.

Observe clarification/unsupported rates, requested versus verified outputs, precision/public-time gaps, rejection reasons, end-to-end/sealing latency, source/model cost, replay success, and recovery counts. Verification rejection counts alone are not accuracy estimates. Avoid sensitive high-cardinality financial data in telemetry.

## 17. Repository change boundaries

| Boundary | Existing or proposed locations |
|---|---|
| Pure semantics | New `services/financial-core/`; reuse/migrate `services/agents/src/exact-decimal.ts`; new finance schemas under `spec/`. |
| Orchestration | New `services/financial-engine/` with ledger, evidence adapters, bounded recovery, and tests. |
| Evidence inputs | `services/evidence/src/fact-repo.ts`; fundamentals reader, SEC adapter, normalization and source/promotion/invalidation boundaries. |
| Schema | `db/migrations/` and `spec/finance_research_db_schema.sql`. |
| Publication | Snapshot verifier/sealer, manifest staging, seal-input helpers, finance record loader/certificate binding. |
| Chat | Local/LLM runtime, coordinator, message persistence, SSE/HTTP adapters. |
| Analyze | Section producers/runner, seal merging, derived metric emitters, template persistence, dev API runtime wiring. |
| Grids | Column catalog, fiscal-fact/period context, cell/run engine, types and progress queries. |
| Thesis checks | Thesis evaluator/types/repository and parent finding/alert publication. |
| Discovery | Ports/types, assessment/validation, packet/repository/provider wiring, sealing and read models. |
| Web/API contracts | Existing block schema/registry/renderers, evidence inspector/reference types, surface views, API schema. |
| Operations | Existing CI, readiness/startup, tool registry, erasure flows, observability and README/CONTEXT during implementation. |

The implementation plan must inspect the actual branch tip and resolve exact files/tests before editing. Preserve focused module boundaries; avoid unrelated package-manager, UI, deployment, or global-auth rewrites. Migration numbering and dependency lockfile pins are implementation details, not pre-reserved identifiers in this document.

## 18. Risks and handoff

Residual risks are incomplete archives, unavailable source precision, request interpretation, company-specific definitions, shared formula bugs, incomplete producer migration, and permission/publication races. The architecture makes these visible and testable rather than claiming citations or decimal arithmetic eliminate them.

Do not reopen the approved comprehensive scope, partial-results behavior, public-information cutoff, or saved-run distinction without new evidence requiring a change. Technical limits and numeric defaults here are design proposals, not commitments to buy data or add infrastructure.

The next deliverable is a detailed implementation plan with dependency-ordered, test-first tasks, exact files and commands, migration/rollback steps, and release gates. No product implementation should begin from this specification alone. This document does not enable the engine or Discovery.

**Validation status:** this is a source-grounded architectural specification. No application tests, migrations, model evaluations, or performance benchmarks were run as part of writing it. Acceptance outcomes above are requirements to demonstrate during implementation.

## Appendix A. Sources and dependency choices

Baseline links are pinned to the inspected commit, distinguishing existing behavior from the proposed design:

- [Domain context](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/CONTEXT.md) and [database schema](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/spec/finance_research_db_schema.sql).
- [Chat prose composer](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/chat/src/llm-runtime.ts), [coordinator](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/chat/src/coordinator.ts), and [Chat README](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/chat/README.md).
- [Fundamentals reader](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/fundamentals/src/issuer-fundamentals-reader.ts) and [SEC adapter](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/fundamentals/src/sec-edgar.ts).
- [Snapshot verifier](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/snapshot/src/snapshot-verifier.ts) and [sealer](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/snapshot/src/snapshot-sealer.ts).
- [Analyze seal merge](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/analyze/src/seal-input-merge.ts) and [grid run engine](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/analyst-grids/src/run-engine.ts).
- [Exact-decimal helper](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/agents/src/exact-decimal.ts) and [thesis evaluator](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/agents/src/thesis-evaluator.ts).
- [Discovery ports](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/discovery/src/ports.ts), [assessment validation](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/discovery/src/assessment-validation.ts), and [sealing](https://github.com/xang1234/market-agent/blob/19c84e4f21358f99384e4f5984b9a5cc07bf480a/services/discovery/src/seal.ts).

Open-source choices, documentation reviewed 2026-09-23:

| Component | Use | Boundary |
|---|---|---|
| Existing JSON Schema/Ajv stack | Versioned structural validation. | Shape validation does not establish financial meaning. |
| [decimal.js](https://github.com/MikeMcl/decimal.js) | MIT-licensed decimal division/formatting with explicit independent precision configuration. | Cannot recover digits lost before construction; configured division is rounded. |
| [lossless-json](https://github.com/josdejong/lossless-json) | Preserve numeric information during external JSON parsing. | Requires integration with input limits, duplicate-key policy, source storage, and typed conversions. |
| Existing exact-decimal helper | Compatibility foundation for finite-decimal predicates and arithmetic. | Generalization must preserve existing write validation and tested semantics. |

Pin dependency versions and record license/security checks in implementation lockfiles before deployment. No library supplies the application's financial definitions, temporal proof, permissions, or end-to-end publication guarantee by itself.
