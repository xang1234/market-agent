# Shared Service Utilities

## Trusted-proxy auth signatures

`signTrustedUserId(userId, secret)` emits a timestamp-bound `v1:<issued_at_ms>:<hmac>`
token for the `x-authenticated-user-signature` header. Services in
`trusted_proxy` mode reject tokens older than the configured
`trustedProxyMaxAgeMs` window, and reject tampered timestamps because the
timestamp is part of the HMAC payload.

Legacy user-id-only HMACs are rejected by default. During a controlled proxy
rollout, callers can set `trustedProxyAllowLegacySignatures: true` in
`RequestAuthConfig` while updating proxy/test helpers to the v1 token format.
