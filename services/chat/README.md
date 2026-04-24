# Chat Service

Tracking bead: `fra-6al.8.3` (Bootstrap SSE route stub for chat streaming).

This package owns the stub chat streaming transport until the real thread
coordinator lands in `fra-2fu.1`.

## Current scope

- `GET /v1/chat/threads/:threadId/stream`
- validates `run_id`
- emits `turn.started`
- emits periodic `heartbeat` events

## Tests

```bash
cd services/chat
npm test
npm run dev
```
