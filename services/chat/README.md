# Chat Service

This package owns the chat streaming transport, the per-thread turn
coordinator, and the thread-list CRUD surface used by the chat workspace.

The default hosting choice is Node plus Postgres with Durable-Object-compatible
coordination semantics. See `docs/adr/0004-session-coordinator-hosting.md` for
the accepted equivalence contract and the triggers for adding a Cloudflare
Durable Object adapter.

## Current scope

- `GET /v1/chat/threads/:threadId/stream`
- validates `run_id`
- emits sequenced coordinator SSE events with `id`, `seq`, and `turn_id`
- resumes after `Last-Event-ID` by replaying only events with a higher sequence
- emits periodic `heartbeat` control events
- serializes turn execution per `thread_id`
- with a database, persists assistant messages only after snapshot sealing
  succeeds (see Persistence Hook)
- in local durable mode, reloads `LLM_SETTINGS_ENV_FILE` for each LLM-backed
  chat/title call and routes through the shared `services/llm` pi adapter when
  `LITELLM_MODEL` has an enabled deployment
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
- `GET    /v1/chat/threads/{threadId}/messages` — the thread's messages in
  creation order, the caller's turns on the thread that this process still
  retains, and the oldest of them still in flight:
  `{ "messages": ChatReadMessage[], "active_run": { "run_id", "turn_id" } | null, "runs": RunStatus[] }`.
  Each `runs` entry is `{ "run_id", "turn_id", "status" }`, oldest first, with
  `status` `in_flight` (queued or running), `completed` (with the saved
  answer's `message_id` when the turn.completed named one, or when
  `messages` hold the turn's saved answer) or `failed`
  (turn.error, or no terminal event). A run that ended more than
  `completedTurnRetentionMs` ago (5 minutes by default) is not listed.
  A turn counts while it is queued or running, until it emits `turn.completed`
  or `turn.error`. A turn whose saved answer is in `messages` is never
  reported, though it has not yet emitted `turn.completed`. One that ended during the read is reported
  only when `messages` lack its answer, so the client attaches and the replay
  shows the outcome. Turns live in this process's memory (see Resume
  Retention), so a restart reports none. Attach with
  `GET /v1/chat/threads/{threadId}/stream?run_id=…&turn_id=…&attach=1`: the
  route finds the turn by its ids and the caller, never starts one, and
  answers `404 turn not found` when this process doesn't have it.

Cross-user access always returns 404 (never 403) so existence of another
user's thread is not leaked. Wire the DB by passing `threadsDb` to
`createChatServer`, or set `CHAT_DATABASE_URL` (or `DATABASE_URL`) when
running `npm run dev` — without a connection the CRUD routes are not
mounted and other handlers (e.g., the SSE stream) are unaffected.

## Persistence Hook

With `CHAT_DATABASE_URL` or `DATABASE_URL` set, the server takes its hooks from
`src/local-runtime.ts`: `persistAssistantMessage`, the analyst runtime and its
financial lane, the subject pre-resolver and prior-subject loader, and the
thread title generator. Without a database it takes none of them, and a turn
ends with
`turn.error { error_code: "analyst_tool_runtime_not_configured" }`.

`persistAssistantMessage(input)` saves the message under `input.message_id`,
the turn's one answer id, so a messages read can tell the turn is answered
before its stream ends. It resolves only after a snapshot has sealed
and the chat message row has been committed, and it resolves to that message
as the thread's messages GET returns it (`ChatReadMessage` in
`src/messages.ts`: the row plus its `block_proofs`). `turn.completed` carries
that value as `message`. The message must be the assistant message saved in
`input.threadId`; any other thread or role fails the turn with
`turn.error { error_code: "ChatPersistenceContractError" }`. When the row
committed but could not be read back, the hook throws `ChatMessageUnreadError`
(from `src/messages.ts`) with the committed ids. The turn then completes with
`message_id` and no `message`, and the client offers "Reload thread".

## Subject Pre-Resolution Hook

`preResolveSubject({ text, choice? })` returns the `ChatSubjectPreResolution`
shape used by the chat service. The local runtime calls
`preResolveChatSubjectWithResolver(db, request)` from
`services/chat/src/subjects.ts`, which maps resolver statuses such as
`needs_choice` into chat statuses such as `needs_clarification`. A caller of
`createChatServer` may also pass `renderSubjectClarification(input)` to
customize the assistant clarification
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
