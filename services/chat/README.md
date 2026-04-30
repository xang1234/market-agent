# Chat Service

This package owns the chat streaming transport, the per-thread turn
coordinator, and the thread-list CRUD surface used by the chat workspace.

## Current scope

- `GET /v1/chat/threads/:threadId/stream`
- validates `run_id`
- emits sequenced coordinator SSE events with `id`, `seq`, and `turn_id`
- resumes after `Last-Event-ID` by replaying only events with a higher sequence
- emits periodic `heartbeat` control events
- serializes turn execution per `thread_id`
- can load a `persistAssistantMessage` hook from `CHAT_PERSISTENCE_MODULE`
  so assistant messages are persisted only after snapshot sealing succeeds
- can pre-resolve `subject` query text through a `preResolveSubject` hook before
  producing a response; ambiguous resolver envelopes surface as clarification
  turns instead of silently selecting a subject
- thread CRUD per OpenAPI: list/create/title-update/archive (see below)

## Thread CRUD

Endpoints (all require an `x-user-id` UUID header; threads are user-scoped):

- `GET    /v1/chat/threads` — caller's threads ordered by `updated_at desc`.
  Active only by default; pass `?include_archived=true` to include archived
  threads in the response.
- `POST   /v1/chat/threads` — create a thread. Optional body:
  `{ "title"?: string, "primary_subject_ref"?: { "kind": SubjectKind, "id": uuid } }`.
- `PATCH  /v1/chat/threads/{threadId}` — update the thread title. Body:
  `{ "title": string | null }`. Pass `null` (or whitespace) to clear.
- `DELETE /v1/chat/threads/{threadId}` — soft-delete (archive). Stamps
  `archived_at = now()` on first call; idempotent on repeat (the original
  archive timestamp is preserved). The thread row stays in the table for
  conversation history; the `chat_messages` foreign key is unaffected.

Cross-user access always returns 404 (never 403) so existence of another
user's thread is not leaked. Wire the DB by passing `threadsDb` to
`createChatServer`, or set `CHAT_DATABASE_URL` (or `DATABASE_URL`) when
running `npm run dev` — without a connection the CRUD routes are not
mounted and other handlers (e.g., the SSE stream) are unaffected.

## Persistence Hook

`CHAT_PERSISTENCE_MODULE` may be a package specifier, absolute path, file URL,
or path relative to the process working directory. The module must export
`persistAssistantMessage(input)`, which returns `{ snapshot_id, message_id }`
only after a snapshot has sealed and the chat message row has been committed.
When the variable is omitted, the dev server keeps the stub-only stream path.

## Subject Pre-Resolution Hook

`CHAT_SUBJECT_RESOLVER_MODULE` may be a package specifier, absolute path, file
URL, or path relative to the process working directory. The module must export
`preResolveSubject({ text, choice? })`, returning the `ChatSubjectPreResolution`
shape used by the chat service. Modules that call the lower-level resolver can
use `preResolveChatSubjectWithResolver(db, request)` from
`services/chat/src/subjects.ts` to map resolver statuses such as `needs_choice`
into chat statuses such as `needs_clarification`. The module may also export
`renderSubjectClarification(input)` to customize the assistant clarification
blocks and content hash used when the chat pre-resolution returns
`needs_clarification` or `not_found`. When a stream request
includes `?subject=GOOG` and chat pre-resolution returns `needs_clarification`,
the chat service emits a clarification message with the candidate list in the
`resolve_subjects` tool payload rather than hydrating a subject implicitly.

## Resume Retention

SSE resume history is in-memory and intentionally bounded. By default,
completed turn event history is retained for 5 minutes and capped at 1000
completed turns. When a completed turn is evicted, the coordinator keeps a
tombstone for 1 hour, capped at 10000 tombstones, so a later stream request
for the same turn returns an unavailable cursor response instead of rerunning
tool calls or snapshot sealing. This is not a durable idempotency store;
cross-process or post-expiry replay requires a future database-backed run
ledger.

## SSE reconnect with `Last-Event-ID`

A client can reconnect to a stream by setting the `Last-Event-ID` header to
the highest sequence number it has already processed. The server replays only
events whose sequence is strictly greater. The contract held in
`test/sse-resume.test.ts` is:

- A mid-stream client disconnect does **not** abort the turn — the runner
  continues executing and emissions accumulate in coordinator history while
  no client is subscribed.
- A reconnect with `Last-Event-ID: N` immediately replays every event that
  landed in history with `seq > N`, then continues live as the runner
  produces more.
- Resume across a wall-clock gap works as long as the turn is still
  retained per the bounds above; once evicted, the request returns a 4xx
  with an `unavailable` cursor message rather than silently rerunning the
  turn.

Malformed and out-of-range `Last-Event-ID` values are rejected per the
contract in `test/http.test.ts` ("rejects malformed Last-Event-ID values"
and "rejects Last-Event-ID beyond available coordinator history").

## Tests

```bash
cd services/chat
npm test
npm run dev
```

Integration tests for the thread CRUD repository spin up an ephemeral
Postgres via the shared `bootstrapDatabase` harness and are skipped when
Docker is unavailable.
