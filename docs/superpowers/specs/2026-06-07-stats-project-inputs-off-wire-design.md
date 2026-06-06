# Project key-stat `inputs[]` off the `/v1/fundamentals/stats` wire

**Bead:** fra-7n92
**Date:** 2026-06-07

## Problem

`GET /v1/fundamentals/stats` returns `KeyStatsEnvelope` with `stats[].inputs[]`, whose
elements carry:

- `metric_id: UUID` — internal metric-registry id
- `source_id: UUID` — internal fundamentals-plumbing id (which provider backed the line)
- `fact_id?: UUID` — evidence-plane id (present when the statement was loaded from facts;
  required on `market_fact` price inputs)

These are internal/evidence-plane identifiers shipped on a **public** HTTP surface.

### Who actually consumes `inputs[]`

- **Web** (`web/src/symbol/stats.ts`) — the only wire consumer. It types
  `inputs: ReadonlyArray<unknown>`, performs no runtime validation, and never reads the
  array (`OverviewSection.tsx` renders only `value_num` + `warnings`).
- **peer-metrics** (`services/fundamentals/src/peer-metrics.ts`) — reads `inputs[]` heavily
  (`fact_id`, `source_id`, `metric_key`, `role`) to materialize derived peer facts. But it
  consumes the **in-process** `KeyStatsEnvelope` via `StatsRepository.find()` →
  `buildKeyStats`, **not** over HTTP (`fetchOne` at peer-metrics.ts:106-118).
- There is **no public `/v1/facts/{id}` endpoint**; the evidence inspector
  (`services/evidence/src/inspector.ts`) is internal and snapshot/permission-scoped. So a
  `fact_id` on the stats wire is not resolvable by any external client today.

So the endpoint ships internal + evidence-plane ids on a public response that **no wire
consumer reads**.

## Decision

Project `inputs[]` out of the **HTTP response** entirely, at the serialization boundary.
Keep the in-process `KeyStatsEnvelope.inputs` intact (peer-metrics depends on it).

Rationale: the only wire consumer ignores `inputs`; the in-process consumer is unaffected
by a wire projection; and `fact_id` on the wire is currently unresolvable anyway. Shipping
it is pure leakage with zero consumer benefit. If wire-level provenance is ever needed, it
should be introduced deliberately (a clean public lineage shape, or the evidence inspector
path) rather than leaking the internal model.

Rejected alternatives: **keep only `fact_id`** (still unused dead weight with no public
resolver) and **keep as-is** (accepts the leak for no benefit).

## Design

### 1. Public wire DTO at the boundary (`services/fundamentals/src/http.ts`)

`key-stats.ts` stays the pure, provenance-rich model. The *public* shape is defined where
the wire is owned:

```ts
export type PublicKeyStat = Omit<KeyStat, "inputs">;
export type PublicKeyStatsEnvelope = Omit<KeyStatsEnvelope, "stats"> & {
  stats: ReadonlyArray<PublicKeyStat>;
};
export type GetStatsResponse = { stats: PublicKeyStatsEnvelope }; // was { stats: KeyStatsEnvelope }

function toPublicStatsEnvelope(envelope: KeyStatsEnvelope): PublicKeyStatsEnvelope {
  return { ...envelope, stats: envelope.stats.map(({ inputs, ...stat }) => stat) };
}
```

At the `get_stats` case (http.ts:139):

```ts
const response: GetStatsResponse = { stats: toPublicStatsEnvelope(outcome.data) };
```

### 2. In-process model untouched

`buildKeyStats`, `KeyStatsEnvelope`, `KeyStat`, `StatsRepository`, and all `*InputRef`
types keep `inputs`. `peer-metrics` continues to read it via the in-process repository.
Only HTTP serialization drops it.

### 3. Web type honesty (`web/src/symbol/stats.ts`)

Remove `inputs: ReadonlyArray<unknown>` from web's `KeyStat` type (line 43); it is no
longer on the wire. Verified: web has exactly one reference to it (the type declaration)
and zero reads, and web is CI-typechecked, so the trim is safe.

## Testing

- **`services/fundamentals/test/stats.http.test.ts`** — the test "exposes per-input
  source_id on every stat input (provenance)" (lines 135-157) asserts `inputs[]` on the
  wire. Flip it to pin the new contract: each stat exposes its headline fields
  (`stat_key`, `value_num`, `computation`, `warnings`) and **`inputs` is absent** from the
  wire response (`assert.equal((stat as { inputs?: unknown }).inputs, undefined)`).
- **`services/fundamentals/test/key-stats.test.ts`** — unchanged; still covers `inputs` on
  the in-process `buildKeyStats` output.
- **peer-metrics tests** — unchanged and must stay green (in-process consumer untouched).
- **web** — `npm run typecheck` + `npm test` green after the type trim.

## Out of scope

- Adding a public fact-lookup / provenance endpoint (the deliberate future path if a wire
  client ever needs lineage).
- Any change to `buildKeyStats` logic, the DB, or peer-metrics.
- The `/v1/fundamentals/statements` response (its `StatementLine.fact_id` is typed but not
  populated on the wire; not part of this bead).
