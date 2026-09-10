# Task 1 report: versioned campaigns and transactional storage

## Contract decisions

- `DiscoveryRepository.reserveAttempt` now requires `request_hash`. The storage contract requires canonical request-identity validation, but the original signature did not carry that value. Reuse with a changed hash returns `request_conflict`.
- Brief metric shape validation delegates to the existing `parseThesisConditions`. `saveBrief` verifies every metric key against the canonical `metrics` registry; it does not invent a static metric whitelist.

## TDD evidence

### RED

`node --experimental-strip-types --test services/discovery/test/validation.test.ts`

Failed as expected before implementation with `ERR_MODULE_NOT_FOUND` for `services/discovery/src/validation.ts`.

`node --experimental-strip-types --test services/discovery/test/repository.integration.test.ts`

Failed as expected before repository implementation with `ERR_MODULE_NOT_FOUND` for `services/discovery/src/repository.ts`.

### GREEN / final verification

`node --experimental-strip-types --test services/discovery/test/validation.test.ts services/discovery/test/repository.integration.test.ts db/test/discovery-schema.test.ts db/test/migration-registry.test.ts`

Passed: 18 tests, 0 failures, 0 skips, exit 0. The suite used the real Docker/PostgreSQL harness and verified the fresh consolidated schema plus the migration/rollback path.

Covered behavior includes brief/model boundaries, unknown fields and invalid scope, version/approval concurrency, idempotent and concurrent starts, ownership, the 100-candidate cap, resolved-issuer merge, registry-backed metrics, lease epochs, attempt request hashes/cache behavior, monotonic events, migration registration, and discovery-only rollback.

## Changed files

- `services/discovery/`: browser-safe domain types, ports, validation, policies, focused repositories, transaction/lease helpers, package manifest, fixtures, and PostgreSQL integration tests.
- `db/migrations/0040_discovery_campaigns.up.sql` and `.down.sql`: six discovery-owned tables, composite ownership foreign keys, immutable approved briefs, JSON checks, and required unique/partial indexes.
- `spec/finance_research_db_schema.sql`: schema mirror.
- `db/test/discovery-schema.test.ts`: fresh and migration-path schema checks.

## Self-review

- Worker writes lock the owner user row before the run, then verify owner/epoch/expiry; candidate admission, reservation, event allocation, checkpoints, and finalization use that fence.
- Start locks user then campaign, validates the exact current version/hash, and checks request-key reuse before approval. External/provider calls remain outside database transactions.
- Approved-brief immutability applies to direct updates but permits campaign cascade deletion.
- PostgreSQL `bigint` values are normalized before reaching lease/event DTOs.

## Concerns

None blocking. Task 7 will need to expose metric options through its API/UI work; Task 1 only validates metric keys against the existing registry as agreed.
