# Partition Strategy: `facts` and `tool_call_logs`

Tracking bead: `fra-6al.7.4`.

## Scope

Two relational tables grow unboundedly and need a partitioning plan before P1
services start writing real volume:

- `facts` — the evidence-plane truth table; every displayed value joins here.
- `tool_call_logs` — every tool invocation recorded by the orchestrator.

Every other table in the schema pack is either bounded (reference / registry),
cascade-deleted with its parent (documents, claims), or trivially small
(`users`, `portfolios`). Those are out of scope.

## Decisions

### Partition scheme

**PostgreSQL native range partitioning by month** for both tables.
Monthly granularity balances:

- Pruning benefit on typical window queries (last 7/30/90 days).
- Catalog cost (Postgres plans per partition; thousands of partitions hurts
  plan time).
- Operational overhead (creating, attaching, and archiving partitions).

Declarative partitioning (`PARTITION BY RANGE (...)`) is preferred over
`pg_partman` for P0.5 — one less dependency and Postgres 15 native features
cover monthly windows adequately. Revisit `pg_partman` if automated partition
creation becomes a burden.

### Partition keys

| Table             | Partition key | Why                                                                                  |
| ----------------- | ------------- | ------------------------------------------------------------------------------------ |
| `facts`           | `as_of`       | Aligns with invariant **I5** (answers pinned to a moment). Always set, non-null.     |
| `tool_call_logs`  | `created_at`  | Only timestamp on the row; all retention and debugging queries filter on it.         |

Rejected alternatives for `facts`:

- `observed_at` — valid candidate, but diverges from `as_of` for estimates and
  restatements. Pruning would track ingestion cadence rather than the value
  that consumers pin against, which is the wrong axis for reads.
- `period_end` — nullable for `period_kind in ('point', 'range')`; invalid as
  a partition key.
- `created_at` / `updated_at` — ingestion metadata, not truth-plane semantics;
  restatements would land in new partitions regardless of the `as_of` they
  represent.

### Primary-key structural change

Native partitioning requires the partition column to be part of every unique
constraint. That forces:

```sql
-- Current (schema pack):
fact_id uuid primary key default gen_random_uuid()

-- Partitioned:
fact_id uuid not null default gen_random_uuid(),
...
primary key (fact_id, as_of)
```

Same for `tool_call_logs`: `primary key (tool_call_id, created_at)`.

This is a breaking DDL change, which is why partitioning is deferred from the
initial schema apply (`fra-6al.7.1`) and will land as a dedicated migration
bead downstream of `fra-6al.7`.

### Self-referential FKs on `facts`

`facts.supersedes` and `facts.superseded_by` reference `facts(fact_id)`.
Postgres only supports FKs into partitioned tables if the referenced columns
include the partition key. The decision: **widen both columns to a composite
`(fact_id, as_of)` reference**. Supersession chains are touched infrequently
and the FK matters most during restatement audits, so the write-time cost of
carrying the extra column is acceptable.

Rejected alternatives:

- Dropping the FK and relying on application-level integrity (the stance for
  `subject_kind + subject_id`) — restatement chains are higher-stakes than
  polymorphic subject refs; silent orphans would corrupt the audit trail.
- Trigger-based integrity checks — expensive at write time on the hot path.

### Retention policy

| Table             | Hot (online)     | Warm (detach, archive to object store) | Local DROP            |
| ----------------- | ---------------- | -------------------------------------- | --------------------- |
| `facts`           | 24 months        | 24–120 months                          | only after archive    |
| `tool_call_logs`  | 90 days          | 90–180 days                            | > 180 days, no archive|

`facts` is evidence: the *data* is never lost. Old partitions are **detached**
and exported to object storage, with a manifest row kept in `ingestion_batches`
(to be added) so restatements can be rehydrated; the local partition may then
be dropped once the archive is durable. `tool_call_logs` is orchestration
telemetry — rolling DROP without archive is fine once the warm window expires.

### Cross-partition query patterns

Good (pruned): include the partition key in the `WHERE` clause.

```sql
-- facts: point-in-time lookup
select * from facts
where subject_kind = 'issuer'
  and subject_id = $1
  and metric_id = $2
  and as_of >= $3 and as_of < $4
order by as_of desc
limit 1;

-- tool_call_logs: recent activity for a thread
select * from tool_call_logs
where thread_id = $1
  and created_at >= now() - interval '7 days'
order by created_at desc
limit 50;
```

Bad (no pruning; scans every partition):

```sql
-- Missing as_of predicate — planner must scan every month.
select * from facts where subject_id = $1 and metric_id = $2;
```

Service-layer rule: every `facts` read that isn't a rehydrate-everything
admin query **must** carry an `as_of` range. The read-model layer in P1.2
owns enforcing this — either explicit windows or a default bounded window,
for example `as_of >= now() - interval '24 months' and as_of < now()`.

### Partition creation cadence

- Create partitions **1 month ahead** via a scheduled job (initially a cron,
  eventually the observability worker in `fra-6al.8`).
- Include a `default` partition as an **insurance catch-all** that alerts on
  any row — rows landing in `default` indicate a missed provision and must be
  moved out.

### Index strategy per partition

Keep the schema-pack indexes as declared — Postgres propagates them to every
current and future partition. One case to revisit: `facts_asof_idx (as_of desc)`
is partially redundant under partitioning because the partition key itself
scopes `as_of` ranges. Keep for now; drop if write amplification becomes
measurable.

## Verification

- Example DDL: `db/docs/examples/partition-facts.sql`,
  `db/docs/examples/partition-tool-call-logs.sql`.
- Each example creates the parent table, three monthly partitions, and a
  default partition; inserts probe rows; and demonstrates `EXPLAIN` output
  confirming pruning on a well-formed query. Run against a dev Postgres 15
  instance.

## Open items (not blocking this bead)

- Ingestion batch manifest table for detached-partition archival.
- `pg_partman` evaluation once partition count grows past ~60 per table.
- Formalize the supersession composite-FK design during the partitioning
  migration bead.
