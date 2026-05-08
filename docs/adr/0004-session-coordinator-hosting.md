# ADR 0004: Session Coordinator Hosting

## Status

Accepted.

## Context

`stock-agent-v2.md` originally described the Session Coordinator as a Durable
Object per chat thread, long-running Analyze run, or agent run. The current
implementation runs Node HTTP services backed by Postgres, with an in-process
chat coordinator and durable database rows for chat messages, agent runs,
findings, activity, snapshots, and eval artifacts.

The product still needs Durable-Object-style behavior:

- serialized per-thread chat turns;
- SSE reconnect and replay after transient disconnects;
- long-running Analyze and Agent run coordination;
- idempotent handling for queued or repeated work;
- a durable source of truth outside process memory.

## Decision

Keep Node plus Postgres as the default local and near-term product stack. Treat
Durable Objects as an optional deployment adapter, not a current requirement.

The equivalence contract is:

- Chat turn execution is serialized by `services/chat/src/coordinator.ts` per
  thread, with tests covering same-thread queuing, turn identity, history
  retention, and subscriber isolation.
- SSE resume is handled by sequenced coordinator events and `Last-Event-ID`;
  durable chat messages remain in Postgres, while bounded coordinator history
  covers short reconnect windows.
- Analyze runs and Agent runs persist run state and outputs in Postgres through
  the dev-api durable adapters and agents repositories, so process restarts do
  not own the result of record.
- Agent queue claiming uses database state and idempotent run/finding/activity
  writes instead of assuming FIFO queue delivery.
- Any future Cloudflare Durable Object adapter must preserve these semantics
  rather than introduce a second product contract.

## When To Adopt Durable Objects

Add a Cloudflare-shaped adapter when the deployed runtime needs edge-colocated
session coordination, multi-region low-latency SSE fanout, or process-memory
turn history becomes too fragile for reconnect windows.

The adapter must prove:

- one active coordinator instance per thread/run identity;
- no duplicate execution on reconnect or retry;
- ordered event emission per turn;
- durable handoff of completed messages, snapshots, run activity, and findings
  into Postgres or the chosen evidence store;
- compatibility with existing `/v1/chat/threads/{threadId}/stream` and durable
  message history contracts.

## Consequences

This documents the architecture divergence from the Cloudflare-first diagram.
The codebase remains simpler for local development and CI, while preserving a
clear compatibility target if a Durable Object deployment path becomes useful.
