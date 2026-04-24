# fra-6al.4.6 Indexed Issuer Alias Lookup Design

## Context

`resolveByNameCandidate` currently builds a computed `issuer_names` CTE from `issuers.legal_name` and `issuers.former_names`, fetches every row, then normalizes and filters in Node. That was acceptable for the first resolver stub, but it does not meet the production lookup contract: exact issuer name and alias lookup should read through an indexed normalized key instead of scanning all issuers.

## Decision

Add a first-class `issuer_aliases` table that stores normalized legal names and aliases for issuer lookup. The resolver will query `issuer_aliases.normalized_name = $1`, join to `issuers`, and keep the existing candidate semantics from `fra-6al.4.5`.

This is an indexed lookup surface, not a full alias-governance system. Alias rows are deterministic projections of issuer data for now:

- one legal-name alias row per issuer
- one former-name alias row per `issuers.former_names` entry

## Schema

Add `issuer_aliases` to both:

- `spec/finance_research_db_schema.sql`
- a new tracked migration pair under `db/migrations/`

Table shape:

```sql
create table issuer_aliases (
  issuer_alias_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  raw_name text not null,
  normalized_name text not null,
  match_reason text not null check (match_reason in ('legal_name', 'former_name')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issuer_aliases_normalized_name_idx on issuer_aliases(normalized_name);
create unique index issuer_aliases_unique_idx
  on issuer_aliases(issuer_id, match_reason, raw_name);
```

The migration also backfills rows from existing `issuers` data:

- `issuers.legal_name` becomes `match_reason = 'legal_name'`
- each text value in `issuers.former_names` becomes `match_reason = 'former_name'`

## Normalization

Use the same semantic normalizer as the resolver:

1. trim
2. lowercase
3. replace non-letter/non-number/non-space characters with spaces
4. collapse whitespace
5. trim

Postgres regex cannot exactly mirror JavaScript `\p{L}\p{N}` across every locale. For this bead, the SQL backfill should be a deterministic ASCII-safe approximation and the resolver/tests should populate `normalized_name` through the exported TypeScript normalizer where exact Unicode behavior matters. This preserves the indexed lookup contract while leaving full write-path alias maintenance for later ingestion code.

## Resolver Flow

`resolveByNameCandidate` will:

1. normalize the input in TypeScript
2. query `issuer_aliases` by `normalized_name = $1`
3. join to `issuers` for display name
4. build issuer candidates from alias rows
5. expand `former_name` alias rows to active listing candidates using the existing active-window predicate
6. dedupe and rank candidates exactly as `fra-6al.4.5` does

The old computed `issuer_names` CTE and broad row fetch should be removed from the resolver query path.

## Tests

Add tests that prove:

- `resolveByNameCandidate` reads from `issuer_aliases` and no longer uses the `issuer_names` CTE.
- A migration-applied database contains `issuer_aliases` and an index on `normalized_name`.
- Migration backfill populates legal-name and former-name rows from existing issuers.
- Resolver legal-name and former-name behavior remains intact when aliases are present.
- The existing alias listing expansion tests continue to pass.

## Out of Scope

- Automatic triggers to keep `issuer_aliases` synchronized after every issuer write.
- Per-alias target-kind rules beyond the existing `legal_name` and `former_name` split.
- Replacing `issuers.former_names`; it remains the source field until a later ingestion/alias-governance bead.
- Full Unicode-equivalent SQL normalization. The resolver-side normalizer remains authoritative for application writes and tests.
