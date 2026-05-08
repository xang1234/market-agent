# Notifications

The notifications package owns delivery of fired agent alerts from
`alerts_fired` to the configured outbound channels: `email`, `web_push`,
`sms`, `mobile_push`, and `digest`.

## Worker

Run one delivery pass with:

```bash
DATABASE_URL=... npm run worker
```

The worker claims `pending_notification` rows, reclaims stale `delivering`
rows after `NOTIFICATIONS_CLAIM_TIMEOUT_MS`, checks fact entitlement egress,
applies user/agent channel filtering when supplied by callers, delivers through
channel adapters, and updates each alert to `notified` or `failed` with receipt
metadata.

## Channel Configuration

Production channel wiring uses webhook adapters. Set every channel endpoint, or
run with `NOTIFICATIONS_ADAPTER_MODE=dev-noop` for local development.

```bash
NOTIFICATIONS_EMAIL_WEBHOOK_URL=https://provider.example/email
NOTIFICATIONS_WEB_PUSH_WEBHOOK_URL=https://provider.example/web-push
NOTIFICATIONS_SMS_WEBHOOK_URL=https://provider.example/sms
NOTIFICATIONS_MOBILE_PUSH_WEBHOOK_URL=https://provider.example/mobile-push
NOTIFICATIONS_DIGEST_WEBHOOK_URL=https://provider.example/digest
```

Each webhook receives:

```json
{
  "channel": "email",
  "title": "Alert title",
  "body": "Alert body",
  "alerts": []
}
```

Providers should return JSON with any of `provider`, `provider_message_id`,
`message_id`, `id`, and `metadata`. Non-2xx responses mark the channel failed.

## Local Development

`createDevNoopNotificationAdapters()` exposes all production channels and
returns successful no-op receipts. This keeps local alert flows runnable without
external email, push, or SMS credentials.
