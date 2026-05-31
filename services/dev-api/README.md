# Dev API

Tracking beads: `fra-6al.8.4`, `fra-6al.8.5`.

This package provides the local BFF routes used by the dev shell, including
Analyze/Agents adapters and local-only LLM settings endpoints.

## LLM Settings

`/v1/dev/llm-settings` is enabled only when `MA_FLAG_LLM_SETTINGS=true` and
the request is local. It reads/writes `LLM_SETTINGS_ENV_FILE` atomically,
returns secrets masked, preserves masked keys on save, tests the configured
router with a minimal "Reply OK" prompt, and discovers OpenAI-compatible
models from `{baseUrl}/models`.

## Commands

```bash
cd services/dev-api
npm test
npm run dev
```
