# Multi-LLM provider layer with UI-driven per-user keys

Status: Proposal
Branch: `claude/plan-llm-provider-ui-5KtIz`

## Context

Today `market-agent` has no concrete LLM provider integration. Two abstract
function-type seams exist — `HeadlineModel` (`services/summary/src/headline-generator.ts:6`)
and `ThreadTitleModel` (`services/summary/src/title-generator.ts:6`) — both shaped
as `(input) => Promise<string>`. The chat coordinator's analyst path
(`services/chat/src/coordinator.ts:1033`) is stubbed; it returns hard-coded text
instead of calling a model. The web app has no Settings page; auth is a mock
context keyed by `x-user-id`.

This plan introduces:

1. A provider abstraction in a new `services/llm` package.
2. Per-user encrypted API-key storage in Postgres.
3. BFF routes for credential CRUD and a connectivity test.
4. A Settings page in the web app where users pick a provider, model, base URL,
   reasoning effort, and key per role (Summary / Analyst / Reader).
5. Wiring of the three model seams (Summary/title, Analyst, Reader) to the new
   provider layer.

Design choices were validated against `HKUDS/Vibe-Trading`, which uses a single
OpenAI-compatible adapter, a JSON provider catalog, and a Settings UI that
writes back to `.env`. We adopt the adapter + catalog + UI patterns, and
replace `.env`-as-store with per-user encrypted DB rows.

## Guiding constraints

- Re-use the existing `HeadlineModel` / `ThreadTitleModel` function-type seams.
- All per-user state is keyed by UUID `user_id` in Postgres.
- API keys never leave the server. UI sends them once on set/rotate; they are
  never re-read by the UI.
- `userId` already flows through `ChatTurnInput`
  (`services/chat/src/coordinator.ts:29`) — that is the anchor for "which
  credentials does this turn use."

## 1. New service: `services/llm`

A shared library, no standalone HTTP server. Collapse to a single provider
class — every supported provider is OpenAI-compatible at the wire level.

- `provider.ts` — `OpenAiCompatibleProvider` class taking
  `{ baseUrl, apiKey?, model, reasoningEffort? }`. Implements:
  - `chat(input) => AsyncIterable<Delta>` (streaming)
  - `complete(input) => Promise<Completion>`
  - Capability flags from the catalog (`supportsTools`, `supportsJsonMode`,
    `supportsStreaming`).
  - `reasoningEffort` passed via `extra_body` only when present and the
    catalog allows it for that provider.
- `providers/catalog.json` — declarative provider registry, shipped with the
  package:
  ```json
  [
    {
      "id": "openai",
      "label": "OpenAI",
      "defaultBaseUrl": "https://api.openai.com/v1",
      "defaultModel": "gpt-4o-mini",
      "suggestedModels": ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "o4-mini"],
      "requiresKey": true,
      "supportsReasoningEffort": true,
      "supportsTools": true
    },
    {
      "id": "openai_compatible",
      "label": "OpenAI-compatible",
      "defaultBaseUrl": null,
      "defaultModel": null,
      "suggestedModels": [],
      "requiresKey": false,
      "supportsReasoningEffort": false,
      "supportsTools": true
    }
  ]
  ```
  Adding DeepSeek / Groq / Gemini later is a JSON edit, not new code.
- `credentials/store.ts` — Postgres CRUD for `user_llm_credentials` (see §2).
  Returns plaintext key only from `getActiveCredential`; never echoes it through
  list/get endpoints.
- `credentials/crypto.ts` — AES-256-GCM. Master key from
  `LLM_MASTER_ENCRYPTION_KEY` (32-byte base64). Per-row random IV; ciphertext +
  IV + auth tag stored as `bytea`. No plaintext fallback.
- `roles.ts` — `LlmRole = "summary" | "analyst" | "reader"`.
- `errors.ts` — `LlmCredentialMissingError`, `LlmAuthError`,
  `LlmRateLimitError`, `LlmTransportError`.

`package.json` deps: `openai`, `pg`.

## 2. Database migration `0028_user_llm_credentials`

One row per `(user_id, role)` — the active credential for that role. History
and audit are deferred.

```sql
create table user_llm_credentials (
  user_id           uuid not null references users(user_id) on delete cascade,
  role              text not null check (role in ('summary','analyst','reader')),
  provider_id       text not null,                             -- validated against catalog at app layer
  model             text not null,
  base_url          text,                                       -- nullable; defaulted from catalog if blank
  reasoning_effort  text check (reasoning_effort in ('off','low','medium','high','max')),
  key_ciphertext    bytea,                                      -- nullable: ollama needs no key
  key_iv            bytea,
  key_auth_tag      bytea,
  key_fingerprint   text,                                       -- last 4 of plaintext, for UI display
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, role)
);
```

## 3. BFF routes (added to `services/dev-api/src/http.ts`)

All auth via the existing `x-user-id` header pattern. Plaintext key travels
inbound only; never echoed.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET`    | `/v1/llm/providers`                | —                                                                       | Static catalog from `catalog.json` |
| `GET`    | `/v1/llm/credentials`              | —                                                                       | `[{ role, providerId, model, baseUrl?, reasoningEffort?, keyFingerprint, updatedAt }]` |
| `PUT`    | `/v1/llm/credentials/:role`        | `{ providerId, model, baseUrl?, reasoningEffort?, apiKey? }`            | Saved row (no plaintext) |
| `DELETE` | `/v1/llm/credentials/:role`        | —                                                                       | `204` |
| `POST`   | `/v1/llm/credentials/:role/test`   | —                                                                       | `{ ok: true, latencyMs, modelEcho? }` or `{ ok: false, error }` |

`PUT` semantics:

- Empty `apiKey` = keep existing key.
- Empty `baseUrl` = fall back to the catalog default for that provider.

Routes return `503` when `LLM_MASTER_ENCRYPTION_KEY` is unset.

## 4. Wire the three seams

- **Summary/title** — `services/summary/src/openai-model.ts` exports
  `createOpenAiThreadTitleModel({ getCredential })` and
  `createOpenAiHeadlineModel(...)`, both shaped to the existing
  `ThreadTitleModel` / `HeadlineModel` types. `services/chat/src/dev.ts` loads
  these by default when `LLM_MASTER_ENCRYPTION_KEY` is set. The existing
  `CHAT_THREAD_TITLE_MODEL_MODULE` env-var path keeps working for tests.
- **Analyst** — replace the stubbed `createRegistryBackedAnalystToolRuntime`
  with `createLlmAnalystToolRuntime({ getCredential, registry, blockSchema })`.
  Resolves the analyst credential for `context.userId`, runs the tool-calling
  loop with tools from the existing `ToolRegistry`, constrains the final answer
  to `spec/finance_research_block_schema.json` via JSON-mode structured
  outputs, streams `block.delta` events through the existing `emit()`. Missing
  credential emits `turn.error { error_code: "llm_credential_missing" }`; the
  UI deep-links to `/settings`.
- **Reader** — `services/evidence/src/reader/llm-reader.ts`, behind
  `MA_FLAG_LLM_READER=true`. Takes a normalized document chunk, returns the
  existing claim / mention / event shapes. Flagged because evidence has
  fixture-only paths today we don't want to break.

Each call site asks `services/llm` for a configured provider via
`getCredential({ userId, role })`. The model layer never reads env vars
directly.

## 5. UI: new Settings page

Form shape mirrors Vibe-Trading's `Settings.tsx`, adapted for per-role and
multi-user.

- New route `/settings` in `web/src/App.tsx`, protected scope.
- `web/src/pages/SettingsPage.tsx` with a tabbed layout; first tab "Models".
- `web/src/settings/`:
  - `useLlmCatalog.ts` — fetches `/v1/llm/providers` once, caches in module
    scope.
  - `useLlmCredentials.ts` — fetches `/v1/llm/credentials`, exposes
    `save(role, payload)`, `remove(role)`, `test(role)`.
  - `LlmRoleCard.tsx` — one card per role (Summary / Analyst / Reader),
    containing:
    - Provider dropdown (from catalog).
    - Model text input + "Reset to provider default" button.
    - Base URL (disabled when catalog says provider has a fixed
      `defaultBaseUrl` and no override is in effect).
    - API key password input, masked `••••1234` once saved, "Clear key"
      checkbox to wipe.
    - Reasoning effort dropdown (`off / low / medium / high / max`), hidden
      when `catalog.supportsReasoningEffort === false`.
    - Test button → calls `/v1/llm/credentials/:role/test`.
    - Save / Remove.
  - `LlmStatusBanner.tsx` — shown above the chat composer when analyst
    credentials are missing; links to `/settings`.
- Add a "Settings" entry to `web/src/shell/TopBar.tsx` next to
  `SessionControl`.
- Save semantics mirror the BFF: empty key field on submit = "don't change
  key"; the input clears after save and the masked fingerprint refreshes.

## 6. Telemetry and failure modes

- Use `run_activities` for provider call observability — stage `investigating`,
  payload includes `provider_id`, `model`, and token counts. None of this
  leaks into model output.
- Failure mapping in `services/llm/errors.ts`. Each maps to a distinct
  `turn.error.error_code` so the UI can react (credential errors deep-link to
  `/settings`).
- Test button does a 1-token chat completion; the result is not stored.

## 7. Tests

- `services/llm/test/crypto.test.ts` — round-trip encrypt/decrypt, tampered
  ciphertext rejected, missing master key throws.
- `services/llm/test/store.test.ts` — upsert/get/delete; plaintext never
  returned by list/get.
- `services/llm/test/openai-provider.test.ts` — mock `fetch`; request shape,
  streaming parsing, error mapping, `reasoning_effort` only sent when catalog
  allows.
- `services/llm/test/catalog.test.ts` — catalog JSON validates; every
  `providerId` referenced elsewhere exists.
- `services/dev-api/test/llm-credentials.http.test.ts` — header auth, `PUT`
  empty-key semantics, `GET` never echoes plaintext, `DELETE` returns 204.
- `services/chat/test/analyst-llm.integration.test.ts` — coordinator end-to-end
  against a fake provider scripting tool calls + `Block[]` final response.
- `web/src/settings/LlmRoleCard.test.tsx` — masked field behavior,
  reasoning-effort field visibility tied to provider catalog, "don't change
  key on empty submit".

## 8. Rollout

1. `services/llm` package + migration `0028`. No behavior change.
2. BFF routes + Settings UI. Users can save keys, but nothing consumes them.
3. Flip Summary/title to the new provider. Default-on when
   `LLM_MASTER_ENCRYPTION_KEY` is set; `CHAT_THREAD_TITLE_MODEL_MODULE` still
   honored.
4. Analyst runtime. Per-user opt-in until tool-call correctness is verified.
5. Reader behind `MA_FLAG_LLM_READER`.

One PR per step keeps review tractable.

## 9. Out of scope (follow-ups to file)

- Anthropic / Google native providers (interface fits them; one file each
  when needed).
- Per-thread model override.
- Cost tracking, budgets, rate limits, audit log, key rotation history.
- MCP-style external tool servers.
- Migrating `syntheticAnalystTurnRunner` — keep for offline dev.

## 10. New environment variables

Add to `.env.dev.example`:

```
# 32-byte base64. Required to enable per-user LLM credential storage. Without
# it the BFF returns 503 from /v1/llm/credentials and the Settings tab shows a
# server-config notice.
LLM_MASTER_ENCRYPTION_KEY=
```

No provider keys live in env. `OPENAI_API_KEY` is intentionally not
introduced.
