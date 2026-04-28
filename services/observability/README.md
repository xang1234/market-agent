# Observability

Tracking bead: `fra-6al.8.2` (P0.6 skeleton — write helpers for the four
observability log tables).

This package exposes minimal insert primitives for the log tables defined
by the normative schema pack:

- `writeToolCallLog` → `tool_call_logs`
- `writeCitationLog` → `citation_logs` (requires an existing `snapshot_id`)
- `writeCitationLogsForBlocks` → extracts block refs and writes one citation row
  per `(block_id, ref_kind, ref_id)`
- `writeVerifierFailLog` → `verifier_fail_logs`
- `writeEvalRunResult` → `eval_run_results`
- `startAgentRunLog` / `completeAgentRunLog` → `agent_run_logs` (operational
  audit per agent run; one row spans the run and is closed with a terminal
  status, outputs summary, and server-computed `duration_ms`)

Each helper accepts a `QueryExecutor` (a `pg.Client` or `pg.Pool` works
unchanged) and returns the generated primary key plus `created_at`.

## Scope (P0 skeleton)

- Provide the insert primitives so any backend service can log without
  duplicating SQL.
- Preserve jsonb column semantics by validating JSON-compatible payloads
  before binding them to `$N::jsonb` parameters.

## Explicitly out of scope

- **Block emission orchestration** — callers still decide when a snapshot is
  sealed and when emitted blocks are durable. The `agent_run_log` writer ships
  here under `fra-hyz.1.1`; orchestration code that calls
  `start`/`completeAgentRunLog` around a run lives in the agent runtime, not in
  this package.
- **Eval runner + golden set execution** — covered by PX.1 children
  (`fra-2yd`, `fra-gfq`).
- **Status / reason-code taxonomies** — callers choose the vocabulary
  today; PX.1 formalizes it.

## Usage

```ts
import {
  runLoggedToolCall,
  writeCitationLogsForBlocks,
  writeToolCallLog,
} from "observability";

await writeToolCallLog(db, {
  tool_name: "resolver.resolveByTicker",
  args: { text: "AAPL" },
  result: { subject_ref: "listing:XNAS:AAPL" },
  status: "ok",
  duration_ms: 42,
});

const quote = await runLoggedToolCall(db, {
  tool_name: "market.quote",
  args: { symbol: "AAPL" },
  invoke: ({ symbol }) => fetchQuote(symbol),
});

await writeCitationLogsForBlocks(db, emittedBlocks);
```

`args`, `result`, `result_json`, and `details` accept JSON-compatible values only.
Optional `details` are normalized so `undefined` and `null` both store as
SQL `NULL`, while nested `null` values inside an object/array remain valid
JSON.

`tool_call_logs.args` stores a stable `sha256:` digest instead of raw arguments;
`result_hash` is computed from `result` when callers do not pass an explicit
hash. This keeps operational logs useful for correlation without retaining raw
tool payloads.

`writeCitationLogsForBlocks` walks nested section children, rich-text ref
segments, metric rows, revenue bars, segment donuts, and block-level
`fact_refs`/`claim_refs`/`event_refs`. Duplicate refs inside one block are
deduplicated before insert.

## Tests

```bash
cd services/observability
npm test
```

Tests spin up a real Postgres 15 container via the shared `db/test/docker-pg.ts`
harness and are skipped automatically if Docker is unavailable.
