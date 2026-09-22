# Task 10 report — complete campaign verification and safe rollout

## Delivered

- Added a real full-path harness using `DiscoveryService`, the authenticated HTTP handler, worker, temporary PostgreSQL, assessment committer, durable quote persistence, and snapshot verifier. Only search/provider/model transports are synthetic. Every fixture declares exact permitted operation suffixes; unexpected calls fail and expected calls are checked at terminal completion.
- Added the four named fixture files. They record question/brief, search hits, canonical identity, dated primary/counter documents, financial facts and missing valuation, role responses, expected state/rank, and operation outcomes. They cover a supported issuer without a pre-run quote cache, an unrelated famous issuer excluded, counterevidence exclusion, and a completed empty result.
- Added integration evaluation for exact 64,000-character and 10,000-token boundaries, shared fallback/repair reservations, bounded malformed output, fabricated citations, source dedupe, deterministic ranks, a slow abortable transport, durable partial/resume/cancel, HTTP default-state filtering, and authenticated routes/OpenAPI inheritance.
- Fixed a handler defect found by E2E: an absent candidate `state` was passed as `null`, so an unfiltered candidate read returned 400. The handler now omits the optional filter.
- Added default-off environment settings, a dedicated worker entrypoint requiring explicit deployment composition only when enabled, dev-shell worker lifecycle/PID cleanup, a recorded-fixture CI job, and operator/context documentation.

## RED → GREEN record

1. Initial E2E RED: `ERR_MODULE_NOT_FOUND` for the absent harness. GREEN: approval-to-inspect passes through the real service, HTTP handler, worker, temporary database, and verifier.
2. First path RED: `partial` with `existing_evidence_unavailable`. GREEN: fixture evidence is seeded under the production-authorized `sec_edgar` provider.
3. Initial exact-operation RED: research suffix matching rejected a declared operation. GREEN: the first harness bound the run-specific candidate segment and asserted declared calls.
4. Snapshot RED: PostgreSQL timestamp text was not ISO-formatted for the verifier. GREEN: durable timestamps are canonicalized before verification.
5. HTTP RED: absent `state` became `null`. GREEN: optional state is omitted and a handler regression passes.
6. Fixture-outcome RED: quote-cache assertion used the wrong table name. GREEN: it uses `discovery_quote_claims`; all four fixture paths pass.
7. Dev-shell and CI tests were RED before lifecycle and the discovery job were added. GREEN: dev-shell is 11/11 and the discovery CI contract passes.

### Fix round 1: recorded-campaign fidelity

The Task 10 review correctly found that the first operation matcher still accepted another candidate ID and collapsed duplicate calls, and that the candidate-bearing fixtures entered after discovery. This round started RED with the new wrong-candidate/duplicate regression failing because the harness did not expose a concrete matcher. It then passed with a post-run fixture allowlist whose ordered multiset contains the recorded candidate ID derived from the recorded lead and the real run ID. The regression attempts both a different candidate ID and a duplicate search operation; both are rejected before any fixture response is returned.

The positive and exclusion fixtures now traverse recorded raw Brave hits, Scout, the production canonical identity provider, production evidence and financial providers, the real worker, durable quote persistence, and the snapshot verifier. The fixture loader validates the production brief parser and the production provider-facing data shapes before a response is usable. Candidates are admitted with `web` origin from the selected recorded lead; the harness verifies the identity provider attempt and no pre-run quote cache. The full path exposed a real foreign-key defect: identity lookup precedes candidate admission, so an attempt could not reference that not-yet-durable candidate. The provider now leaves that nullable foreign key empty while retaining the deterministic candidate identity in the operation key.

The actual worker/model repair path also started RED because the runner harness was not feeding malformed output through the campaign model. It is now driven by two oversized malformed Analyst responses for each selected candidate. The run terminates `partial` promptly, records exactly four Analyst attempts at numbers `[1, 2, 1, 2]`, makes five model calls including the bounded Scout call, stays below the 64-attempt cap, and never dispatches Skeptic or a hidden third repair. Rank stability now covers twelve input permutations. The three candidate-bearing fixtures contain ten unique stable recorded review inputs; the operator table identifies those same ten inputs and keeps every human field Pending.

### Fix round 2: ten executable human-review candidates

The first re-review correctly found that seven round-1 review rows were metadata only: the worker had executed one candidate in each positive fixture. This round began RED with the new `assertRecordedAssessmentsExecuted` integration assertion absent. The candidate fixtures now contain exactly three grid, three industrial-automation, and four supply-disruption candidates. Each candidate has its own fixture candidate ID, selected recorded search hit, canonical identity, primary and counter source/document/excerpt pair, financial response, role outputs, terminal state/rank, assessment ID, and candidate-specific operation templates.

Scout selects every recorded lead, the production identity/evidence/financial providers resolve and acquire every candidate, and the real worker assesses all ten. The integration harness proves each run-derived candidate has `web` provenance, a metered identity attempt, persisted assessment, and sealed snapshot containing that candidate's own primary and counter source references. The pending operator table is parsed as part of fixture loading: every row must match one actual candidate assessment ID, stable fixture candidate ID, and its two sources. There is no standalone `recorded_assessments` metadata list.

## Verification

Docker-backed commands used isolated temporary PostgreSQL containers. Docker socket access was unavailable inside the filesystem sandbox but succeeded with approved test execution privilege. There was no `ENOSPC`; `/private/tmp/discovery-test-bin/docker` was absent, so no wrapper was created. No shared `stockscreenclaude-*` container or data was stopped, pruned, deleted, or changed.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test services/discovery/test/campaign-e2e.integration.test.ts` | 4 passed, 0 failed. Includes the parsed Pending operator table, ten actual 3+3+4 candidates, wrong-candidate/duplicate operation rejections, real PostgreSQL, HTTP, worker, persisted assessments, and source-backed snapshot verification. |
| `node --experimental-strip-types --test services/discovery/test/campaign-evaluation.test.ts` | 7 passed, 0 failed. Includes actual malformed-output worker repair and twelve rank permutations. |
| `node --experimental-strip-types --test services/discovery/test/identity-provider.test.ts` | 3 passed, 0 failed. |
| `node --experimental-strip-types --test services/discovery/test/http.test.ts` | 7 passed, 0 failed. |
| `node --experimental-strip-types --test services/discovery/test/worker-cli.test.ts` | 2 passed, 0 failed. |
| Focused fix-round campaign/evaluation tests | 11 passed, 0 failed. |
| Focused round-2 E2E/evaluation/identity tests | 14 passed, 0 failed. |
| `node --experimental-strip-types --test --test-concurrency=1 test/**/*.test.ts` in `services/discovery` | 167 passed, 0 failed, 0 cancelled (363.1s), using owned temporary PostgreSQL. This is the latest authoritative full Discovery gate. |
| `npm test` in `services/llm`; `npm run typecheck` | 27 passed, 0 failed; typecheck exit 0. |
| `npm test` in `services/agents` | 85 passed, 0 failed, 3 skipped. |
| `npm test` in `services/snapshot` | 110 passed, 0 failed. |
| `npm test` in `services/evidence`, `services/resolver`, `services/dev-api`, and `services/analyze` | Commands completed successfully for affected evidence/reference/API/Analyze handoff gates. |
| `node --experimental-strip-types --test scripts/openapi-contract.test.ts` | 10 passed, 0 failed. |
| `node --experimental-strip-types --test scripts/dev-shell.test.ts` | 11 passed, 0 failed. |
| `npm run typecheck`, `npm run build`, `npm run lint` in `web` | Exit 0. Build retains Vite's existing large-chunk advisory. |
| `node --experimental-strip-types --test scripts/ci-workflow.test.ts` | 9 passed, 0 failed. |
| `npm test` in `services/analyst-grids` | 103 passed, 0 failed. |
| `npm test` in `db` | 57 passed, 0 failed, 0 skipped (312.5s). |

The first unbounded parallel invocation of the Discovery file glob completed with 151 passes and 16 cancellations after its database integration files each reached their 120-second deadline. There were no assertion failures; the cancelled files were the E2E, evaluation, lifecycle, recovery, repository, runner, and visibility PostgreSQL tests. Each passed in the serial full gate above, including every changed test. This was temporary-PostgreSQL contention between parallel test files, not a branch regression; the serial command is the release evidence.

### Release-gate maintenance ruling

The initial database run exposed two stale test setups that were byte-identical
at base `766f46c`: fixed rollback counts no longer reached the intended
pre-discovery/pre-0042 schema after migrations 0043 and 0044 were added. Per
the release-gate ruling, Task 10 repairs the tests without changing migration
SQL. The tests now roll back to explicit kept schema versions (39 for the
pre-discovery check and 41 for the pre-0042 fixture), and the legacy fixture
uses a valid current limits snapshot so the migration behavior—not a later
runtime validator—is tested. Focused migration checks pass and the full DB
suite is 57/57. Cost: the release-maintenance diff includes a narrow schema-test
helper and fixture update; future migrations no longer silently invalidate the
same assertions.

The same gate found that baseline CI omitted `services/analyst-grids` despite
its test script. Task 10 adds its standard db-backed CI job. Cost: CI now runs
that existing integration suite, increasing CI duration while making the
inventory contract complete.

## Acceptance map

| Requirement | Evidence |
| --- | --- |
| Approved brief through inspectable shortlist | `campaign-e2e.integration.test.ts`, 4/4, from raw recorded search through Scout, identity, evidence, worker, inspect, and snapshot verification. |
| Strict recorded fixture operations | `e2e-harness.ts` and four named fixture JSON files: concrete post-run candidate IDs, ordered multiset/count assertion, and direct wrong-candidate/duplicate regressions. |
| Exclusion, unknown valuation, dedupe, fabricated citation, zero result, rank | E2E fixture test and `campaign-evaluation.test.ts`. |
| Partial, resume, cancellation | Real database runner harness in `campaign-evaluation.test.ts`. |
| 64k/10k, fallback/repair, malformed output, abort | Evaluation test; production defaults remain 30,000ms attempt and 2,700,000ms run. |
| Authenticated handler and contract | HTTP test covers every discovery route; OpenAPI 10/10. |
| Feature-off config, worker lifecycle, CI | `.env.dev.example`, `worker-cli.ts`, dev-shell 11/11, CI discovery job. |
| Recovery, rollback, readiness | `docs/discovery-campaigns-operations.md` and `CONTEXT.md`. |
| Human review | The parsed ten-row operator table maps one-to-one to the ten actual 3+3+4 fixture candidates and each candidate's own sealed assessment/source pair; every review cell is Pending. |

## Human release gate

This is an external human gate. No reviewer identity, candidate verdict, or 9/10 result has been invented. `DISCOVERY_ENABLED=false` remains the default and must remain disabled until the operator table records at least nine acceptable human reviews with zero fabricated exposure claims.

## Self-review

Checked the Task 10 brief and design sections 13–14 against the final diff:

- Full-path provider/model calls cross the same attempt runner and model/provider boundaries as production; fixtures reject undeclared calls, a different candidate ID, and over-counted calls.
- Positive fixtures have nonempty recorded provider payloads and do not use `loadExisting`; the test asserts `web` lead origin, a real identity attempt, no pre-run quote cache, and durable evidence/snapshot sealing.
- Each of the ten operator rows names an actual candidate that Scout selects and the worker assesses. The E2E assertion verifies the distinct identity, persisted decision, sealed snapshot, and candidate-owned primary/counter sources for every row.
- The harness uses durable quote claims and the real snapshot verifier, not an in-memory substitute.
- Documentation distinguishes API persistence from executable worker readiness, keeps secrets out of examples, describes unknown outcomes, and states limits in the required units.
- The release document preserves the pending human gate and makes no investment-performance claim.

No source code, fixture, CI environment, snapshot, or documentation value contains a provider/model secret.
