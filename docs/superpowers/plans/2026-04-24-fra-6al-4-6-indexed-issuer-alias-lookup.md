# fra-6al.4.6 Indexed Issuer Alias Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace resolver name/alias full scans with a first-class indexed `issuer_aliases.normalized_name` lookup surface.

**Architecture:** Add `issuer_aliases` to the schema pack and a tracked `0002_issuer_aliases` migration, then update resolver lookup to read alias rows by normalized key. Keep existing resolver semantics: legal names resolve issuer-only, former-name aliases expand to active listings.

**Tech Stack:** PostgreSQL 15 SQL migrations, TypeScript Node test runner, `pg`, existing Docker-backed DB test harness.

---

## File Structure

- Create `db/migrations/0002_issuer_aliases.up.sql`: create `issuer_aliases`, indexes, and backfill from existing `issuers`.
- Create `db/migrations/0002_issuer_aliases.down.sql`: drop `issuer_aliases`.
- Modify `spec/finance_research_db_schema.sql`: add `issuer_aliases` to the normative schema pack.
- Modify `services/resolver/src/lookup.ts`: export the name normalizer and query `issuer_aliases` by `normalized_name`.
- Modify `services/resolver/test/lookup.test.ts`: insert alias rows in tests and assert the old CTE is gone.
- Modify `services/resolver/test/http.test.ts`: update stubs to match the indexed lookup query.
- Modify `db/test/migrate.test.ts`: assert migration-created table/index and backfill behavior.

## Task 1: Red Tests for Indexed Lookup

- [x] **Step 1: Add resolver stub test**

Add a test in `services/resolver/test/lookup.test.ts` with a stub DB that throws if the query contains `with issuer_names` and returns a legal-name row only when the query references `issuer_aliases` and receives the normalized input.

- [x] **Step 2: Add migration/index test**

Add a DB migration test proving `issuer_aliases` exists after `migrate up`, `issuer_aliases_normalized_name_idx` exists, and backfill inserts legal/former rows from existing issuers.

- [x] **Step 3: Run red tests**

Run:

```bash
npm test -- test/lookup.test.ts
npm test -- test/migrate.test.ts
```

Expected failures: resolver still uses `issuer_names`; migration/table/index do not exist.

## Task 2: Schema and Migration

- [x] **Step 1: Add migration pair**

Create `0002_issuer_aliases.up.sql` with the table, indexes, and backfill. Create `0002_issuer_aliases.down.sql` dropping the table.

- [x] **Step 2: Update schema pack**

Add the same `issuer_aliases` table and indexes after `issuers` in `spec/finance_research_db_schema.sql`.

- [x] **Step 3: Run DB tests**

Run:

```bash
npm test -- test/migrate.test.ts
```

Expected: migration tests pass.

## Task 3: Resolver Query Update

- [x] **Step 1: Export normalizer**

Export `normalizeNameForLookup` from `services/resolver/src/lookup.ts` for deterministic test/write-path alias rows.

- [x] **Step 2: Replace CTE query**

Change `resolveByNameCandidate` to select from `issuer_aliases ia join issuers iss` where `ia.normalized_name = $1`, ordered by `match_reason` and `legal_name`.

- [x] **Step 3: Update tests to seed aliases**

Where resolver integration tests insert or update issuer names, insert matching rows into `issuer_aliases` using `normalizeNameForLookup`.

- [x] **Step 4: Run resolver tests**

Run:

```bash
npm test
```

from `services/resolver`. Expected: all resolver tests pass.

## Task 4: Close and Ship

- [x] **Step 1: Run final gates**

Run:

```bash
npm test
```

from both `db` and `services/resolver`.

- [x] **Step 2: Close bead**

Run:

```bash
bd close fra-6al.4.6 --reason "Implemented indexed issuer alias lookup surface with issuer_aliases schema/migration, normalized alias backfill, and resolver lookup by indexed normalized_name. Verified with DB and resolver tests."
bd sync
```

- [ ] **Step 3: Commit and push**

Stage only intended files and commit:

```bash
git commit -m "feat(resolver): add indexed issuer alias lookup"
git push
```
