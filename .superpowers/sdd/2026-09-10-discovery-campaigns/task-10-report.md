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
3. Exact-operation RED: research suffix matching rejected a declared operation. GREEN: the matcher binds the run-specific candidate segment and asserts every declared call.
4. Snapshot RED: PostgreSQL timestamp text was not ISO-formatted for the verifier. GREEN: durable timestamps are canonicalized before verification.
5. HTTP RED: absent `state` became `null`. GREEN: optional state is omitted and a handler regression passes.
6. Fixture-outcome RED: quote-cache assertion used the wrong table name. GREEN: it uses `discovery_quote_claims`; all four fixture paths pass.
7. Dev-shell and CI tests were RED before lifecycle and the discovery job were added. GREEN: dev-shell is 11/11 and the discovery CI contract passes.

## Verification

Docker-backed commands used isolated temporary PostgreSQL containers. Docker socket access was unavailable inside the filesystem sandbox but succeeded with approved test execution privilege. There was no `ENOSPC`; `/private/tmp/discovery-test-bin/docker` was absent, so no wrapper was created. No shared `stockscreenclaude-*` container or data was stopped, pruned, deleted, or changed.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test services/discovery/test/campaign-e2e.integration.test.ts` | 2 passed, 0 failed. Real PostgreSQL, HTTP, worker, and snapshot verifier. |
| `node --experimental-strip-types --test services/discovery/test/campaign-evaluation.test.ts` | 6 passed, 0 failed. |
| `node --experimental-strip-types --test services/discovery/test/http.test.ts` | 7 passed, 0 failed. |
| `node --experimental-strip-types --test services/discovery/test/worker-cli.test.ts` | 2 passed, 0 failed. |
| Focused Task 10 tests above | 17 passed, 0 failed. |
| `npm test` in `services/discovery` | Completed against real temporary PostgreSQL; the focused additions above are green. |
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
| Approved brief through inspectable shortlist | `campaign-e2e.integration.test.ts`, 2/2. |
| Strict recorded fixture operations | `e2e-harness.ts` and four named fixture JSON files. |
| Exclusion, unknown valuation, dedupe, fabricated citation, zero result, rank | E2E fixture test and `campaign-evaluation.test.ts`. |
| Partial, resume, cancellation | Real database runner harness in `campaign-evaluation.test.ts`. |
| 64k/10k, fallback/repair, malformed output, abort | Evaluation test; production defaults remain 30,000ms attempt and 2,700,000ms run. |
| Authenticated handler and contract | HTTP test covers every discovery route; OpenAPI 10/10. |
| Feature-off config, worker lifecycle, CI | `.env.dev.example`, `worker-cli.ts`, dev-shell 11/11, CI discovery job. |
| Recovery, rollback, readiness | `docs/discovery-campaigns-operations.md` and `CONTEXT.md`. |
| Human review | Ten-row operator table exists; every review cell is Pending. |

## Human release gate

This is an external human gate. No reviewer identity, candidate verdict, or 9/10 result has been invented. `DISCOVERY_ENABLED=false` remains the default and must remain disabled until the operator table records at least nine acceptable human reviews with zero fabricated exposure claims.

## Self-review

Checked the Task 10 brief and design sections 13–14 against the final diff:

- Full-path provider/model calls cross the same attempt runner and model/provider boundaries as production; fixtures reject undeclared calls.
- The harness uses durable quote claims and the real snapshot verifier, not an in-memory substitute.
- Documentation distinguishes API persistence from executable worker readiness, keeps secrets out of examples, describes unknown outcomes, and states limits in the required units.
- The release document preserves the pending human gate and makes no investment-performance claim.

No source code, fixture, CI environment, snapshot, or documentation value contains a provider/model secret.
