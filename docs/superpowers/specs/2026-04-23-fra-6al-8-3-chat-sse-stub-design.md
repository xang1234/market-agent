# fra-6al.8.3 Chat SSE Stub Design

## Scope

Implement a minimal backend chat service that exposes the stub streaming
route required by bead `fra-6al.8.3`.

This spec covers:
- a new `services/chat/` package
- `GET /v1/chat/threads/:threadId/stream`
- SSE stub behavior and connection lifecycle
- test coverage for the stub route

This spec does not cover:
- thread creation or message mutation endpoints
- run orchestration
- persistence
- auth/session enforcement beyond preserving a place for it in the route shape
- frontend SSE consumption

## Context

The repo already has:
- a client-facing `/v1` OpenAPI contract in `spec/finance_research_openapi.yaml`
- a resolver service in `services/resolver/` using plain Node `http`
- a chat shell in `web/` that explicitly calls out future SSE transport work

What is missing is the backend surface for the chat stream route. The
parent bead `fra-6al.8` explicitly requires a stub route so frontend work
can proceed before the real thread coordinator lands in `fra-2fu.1`.

There is no general BFF package checked in yet, so this bead needs the
smallest service boundary that can grow into the future chat transport
layer without mixing unrelated concerns into the resolver package.

## Goals

- Introduce a dedicated `services/chat/` package for chat transport work.
- Serve `GET /v1/chat/threads/:threadId/stream` from that package.
- Match the OpenAPI contract shape closely enough to unblock frontend work.
- Emit deterministic stub SSE events and keep the connection open.
- Clean up heartbeat timers when the client disconnects.
- Provide automated tests that prove the route stays open and streams data.

## Non-Goals

- Multiplexing multiple event types from real run state.
- Database-backed thread lookup.
- Authorization logic.
- Retry cursors or replay semantics.
- Sharing a combined HTTP server with other `/v1` endpoints yet.

## Chosen Approach

Create a new `services/chat/` package that mirrors the existing
`services/resolver/` style:
- Node `http` server
- TypeScript-in-place with `--experimental-strip-types`
- Node test runner

The package will export `createChatServer()` plus a narrow handler for the
stub stream route.

Why this approach:
- it keeps chat transport separate from subject resolution
- it avoids over-scaffolding a full BFF package before there is enough
  concrete surface area
- it gives `fra-2fu.1` a clean package to extend rather than a temporary
  route to unwind later

## Route Contract

Route:
- `GET /v1/chat/threads/:threadId/stream`

Required inputs:
- path param `threadId`
- query param `run_id`

Stub behavior:
- if `run_id` is missing or empty, return `400` with a JSON error body
- if the route does not match exactly, return `404`
- if the method is not `GET`, return `404` for now to match the existing
  resolver service pattern

Successful SSE response:
- status `200`
- `content-type: text/event-stream`
- `cache-control: no-cache, no-transform`
- `connection: keep-alive`

This bead treats `threadId` and `run_id` as opaque identifiers. The stub
does not validate UUID shape because the immediate contract goal is to
establish transport behavior, not persistence or request authorization.

## Event Model

For a valid request, the server will:

1. immediately write a `turn.started` event
2. periodically write `heartbeat` events
3. leave the connection open until the client disconnects

Example stream:

```text
event: turn.started
data: {"thread_id":"...","run_id":"...","stub":true}

event: heartbeat
data: {"thread_id":"...","run_id":"...","stub":true}
```

The heartbeat payload intentionally repeats the thread/run identifiers so
frontend code has a stable shape to inspect while the backend is still a
stub.

## Connection Lifecycle

Implementation rules:
- write headers once, before the first event
- flush the first event immediately after headers
- start a `setInterval()` heartbeat timer only after the route is accepted
- register `req.on("close", ...)` and `res.on("close", ...)` cleanup
- clear the timer exactly once when the socket closes or errors

This keeps the stub safe against leaked timers during repeated test runs
and local frontend reconnect loops.

## Testing Strategy

Add Node integration-style tests inside `services/chat/test/` that:

1. return `400` when `run_id` is missing
2. return `404` for a non-matching route
3. set SSE headers on a valid request
4. emit an initial `turn.started` event promptly
5. keep the connection open long enough to emit at least one `heartbeat`

Tests should exercise the real server over an ephemeral local port so the
route matching, headers, and stream timing are validated together.

## Files Expected

- `services/chat/package.json`
- `services/chat/README.md`
- `services/chat/src/http.ts`
- `services/chat/test/http.test.ts`

## Acceptance Criteria

`fra-6al.8.3` is complete when:
- `services/chat/` exists as a runnable Node package
- the package exposes the stub SSE route
- valid requests receive `turn.started` and periodic `heartbeat` events
- missing `run_id` returns `400`
- automated tests cover the route behavior
- the route is ready for `fra-2fu.1` to replace the stub internals without
  moving packages
