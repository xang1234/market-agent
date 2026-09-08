# Task 1 report: thesis contracts, persistence and evaluation

## Scope completed

- Added the exact shared `ThesisCondition`, `ThesisVersion`, `ConditionAssessment`, and `ThesisAssessment` contracts and the requested domain errors.
- Added strict condition parsing for the required counts, UUIDs, trimmed text bounds, metric vocabulary, finite thresholds, and integer freshness bounds.
- Added deterministic metric assessment with exact key/unit/period matching, `value_num * scale`, inclusive threshold comparison, latest eligible fact selection, future/invalid date rejection, and reporting-period freshness for fiscal/TTM facts.
- Added narrative assessment with complete response-shape validation, supplied-citation enforcement, one row per narrative condition, model deployment identity, explicit falsifier/counterevidence/horizon guidance, and prompt-injection/numerical-claim guardrails.
- Added three-condition narrative drafting with server-generated UUIDs and no persistence side effects.
- Added transactional version saving through the existing evidence transaction helper. The agent is owner-checked and locked, its current static subject is normalized from issuer/instrument/listing to issuer under the lock, its expected version is compared, and the legacy `agents.thesis` is updated in the same transaction.
- Added owner-scoped history, current-version lookup, assessment lookup, and one-statement assessment recording that reuses the existing row for an identical version/fingerprint without opening a nested transaction.
- Added migration 0039 with agent/version and version/fingerprint uniqueness, snapshot/version cascades, agent deletion cascade through thesis versions, bounded fingerprints, JSON shape checks, and history indexes. `run_id` remains a required UUID without an FK because direct/runtime assessment callers may use run identifiers outside `agent_run_logs`, matching that table's existing unconstrained audit posture.

## TDD evidence

1. Contracts RED: `test/thesis-types.test.ts` failed with `ERR_MODULE_NOT_FOUND` for `thesis-types.ts`. GREEN: 4/4 parser tests passed.
2. Horizon-bound RED: a valid 120-character horizon failed under the initial 100-character bound. GREEN: the implementation was corrected to the required 1–120 range and 4/4 parser tests passed.
3. Evaluator RED: the combined thesis suite failed with `ERR_MODULE_NOT_FOUND` for `thesis-evaluator.ts`. GREEN: 14/14 contract/evaluator tests passed after implementation.
4. Repository RED: `node --experimental-strip-types --test test/thesis-*.test.ts` failed with `ERR_MODULE_NOT_FOUND` for `thesis-repo.ts`. GREEN: 16/16 focused tests passed with the PostgreSQL test executing under Docker.
5. Calendar-date RED: `2026-02-30T00:00:00.000Z` was accepted by JavaScript's permissive date parser. GREEN: explicit Gregorian calendar validation rejects impossible dates.
6. Narrative-policy RED: the opposing-condition test failed because the model instruction omitted falsifier/counterevidence/horizon and untrusted-data rules. GREEN: the strengthened policy passed and still produced opposite evidence-backed outcomes for opposing conditions.
7. Universe-normalization RED: the Docker repository regression failed because a valid listing-scoped single-company agent was compared directly with an issuer subject. GREEN: normalization now happens under the agent lock; the listing-to-issuer save succeeds and a foreign issuer still conflicts.

## Final verification

- `node --experimental-strip-types --test test/thesis-*.test.ts` with Docker: 16 passed, 0 failed, 0 skipped.
- `npm test` in `services/agents` with Docker after the final listing-normalization change: 82 passed, 0 failed, 0 skipped.
- Standalone TypeScript check of the new production modules and pure evaluator/parser tests: passed. The repository test transitively exposes pre-existing typing issues in `db/test/docker-pg.ts` under an ad hoc compiler invocation, so Node's repository integration run is the authoritative check for that file.
- Database migration suite was stopped once the parent confirmed it was already running the same broad gate. Before interruption, 24 migration tests passed, including forward application, recorded migration status, latest rollback, and consolidated-schema verification; 1 still-running test was cancelled by the explicit interruption. This partial run is recorded as supporting evidence, not a completed final gate.

## Concerns and handoff

- `getCurrentThesis` has no user parameter by the required interface and is intended for already-authorized/internal paths. Public history reads use `loadThesisHistory`, which checks owner scope.
- Assessment model identity is `channel:model` when the LLM router returns deployment metadata and `null` when metadata is unavailable.
- No new dependencies were added. Existing runtime, API, evidence, web, consolidated-schema, plan, and issue-tracker changes were left to their concurrent owners and are excluded from this task's commit.
