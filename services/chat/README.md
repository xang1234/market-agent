# Chat Service

Tracking beads: `fra-u9l`, `fra-cty`, `fra-eom`, `fra-d7t`, `fra-siv`.

This package owns the chat streaming transport and the in-process turn
coordinator used by the current stub turn runner.

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

## Tests

```bash
cd services/chat
npm test
npm run dev
```
