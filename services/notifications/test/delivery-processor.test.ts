import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredNotificationAdapters,
  createDevNoopNotificationAdapters,
  processPendingNotifications,
  type NotificationAdapter,
  type NotificationAdapterReceipt,
  type NotificationChannel,
  type NotificationPayload,
} from "../src/delivery-processor.ts";
import { runNotificationWorkerOnce } from "../src/worker.ts";

const ALERT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const FINDING_ID = "44444444-4444-4444-8444-444444444444";
const FACT_ID = "55555555-5555-4555-8555-555555555555";

test("processPendingNotifications claims pending alerts and marks delivered channel receipts", async () => {
  const sent: string[] = [];
  const db = fakeNotificationDb({
    pendingRows: [
      pendingRow({
        channels: ["email", "web_push", "sms", "mobile_push"],
        trigger_refs: [{ kind: "fact", id: FACT_ID }],
      }),
    ],
    factEntitlements: { [FACT_ID]: ["app", "email", "push"] },
  });
  const adapters = channelAdapters((channel) => {
    sent.push(channel);
    return { provider_message_id: `${channel}-receipt` };
  });

  const result = await processPendingNotifications(db, { adapters, now: () => "2026-05-07T00:00:00.000Z" });

  assert.deepEqual(sent, ["email", "web_push", "sms", "mobile_push"]);
  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0);
  assert.match(db.queries[0] ?? "", /set status = 'delivering'/);
  assert.equal(db.updates[0]?.status, "notified");
  assert.deepEqual(db.updates[0]?.metadata.channels.map((channel) => channel.channel), [
    "email",
    "web_push",
    "sms",
    "mobile_push",
  ]);
  assert.equal(db.updates[0]?.metadata.channels[0].provider_message_id, "email-receipt");
});

test("processPendingNotifications reclaims stale delivering alerts but leaves fresh claims alone", async () => {
  const db = fakeNotificationDb({ pendingRows: [] });

  const result = await processPendingNotifications(db, {
    adapters: channelAdapters(() => ({})),
    now: () => "2026-05-07T01:00:00.000Z",
    claimTimeoutMs: 300_000,
  });

  assert.equal(result.claimed, 0);
  assert.match(db.queries[0] ?? "", /status = 'delivering'/);
  assert.match(db.queries[0] ?? "", /notification_delivery->>'claimed_at'/);
  assert.deepEqual(db.queryValues[0], [100, "2026-05-07T01:00:00.000Z", "2026-05-07T00:55:00.000Z"]);
});

test("processPendingNotifications blocks outbound channels when fact entitlements are app-only", async () => {
  const sent: string[] = [];
  const db = fakeNotificationDb({
    pendingRows: [
      pendingRow({
        channels: ["email", "web_push"],
        trigger_refs: [{ kind: "fact", id: FACT_ID }],
      }),
    ],
    factEntitlements: { [FACT_ID]: ["app"] },
  });

  const result = await processPendingNotifications(db, {
    adapters: channelAdapters((channel) => {
      sent.push(channel);
      return {};
    }),
  });

  assert.deepEqual(sent, []);
  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
  assert.equal(db.updates[0]?.status, "failed");
  assert.match(db.updates[0]?.metadata.channels[0].error, /not entitled for email/);
  assert.match(db.updates[0]?.metadata.channels[1].error, /not entitled for push/);
});

test("processPendingNotifications blocks digest when referenced facts are not push entitled", async () => {
  const sent: string[] = [];
  const db = fakeNotificationDb({
    pendingRows: [
      pendingRow({
        channels: ["digest"],
        trigger_refs: [{ kind: "fact", id: FACT_ID }],
      }),
    ],
    factEntitlements: { [FACT_ID]: ["app", "email"] },
  });

  const result = await processPendingNotifications(db, {
    adapters: channelAdapters((channel) => {
      sent.push(channel);
      return {};
    }),
  });

  assert.deepEqual(sent, []);
  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
  assert.equal(db.updates[0]?.status, "failed");
  assert.equal(db.updates[0]?.metadata.channels[0].channel, "digest");
  assert.match(db.updates[0]?.metadata.channels[0].error, /not entitled for push/);
});

test("processPendingNotifications batches digest rows and throttles burst channels per user", async () => {
  const sent: Array<{ channel: string; title: string }> = [];
  const db = fakeNotificationDb({
    pendingRows: [
      pendingRow({ alert_fired_id: ALERT_ID, channels: ["digest", "email"], headline: "First finding" }),
      pendingRow({
        alert_fired_id: "66666666-6666-4666-8666-666666666666",
        channels: ["digest", "email"],
        headline: "Second finding",
      }),
    ],
  });
  const result = await processPendingNotifications(db, {
    adapters: channelAdapters((channel, payload) => {
      sent.push({ channel, title: payload.title });
      return {};
    }),
    throttle: { maxPerUserChannel: 1 },
  });

  assert.deepEqual(sent, [
    { channel: "email", title: "First finding" },
    { channel: "digest", title: "2 agent alerts" },
  ]);
  assert.equal(result.delivered, 2);
  assert.equal(result.failed, 0);
  assert.equal(db.updates.length, 2);
  assert.equal(db.updates[0].status, "notified");
  assert.equal(db.updates[1].status, "notified");
  assert.equal(db.updates[1].metadata.channels.some((channel) => channel.channel === "email" && channel.status === "throttled"), true);
});

test("processPendingNotifications throttles digest groups per user/channel", async () => {
  const sent: Array<{ channel: string; title: string }> = [];
  const db = fakeNotificationDb({
    pendingRows: [
      pendingRow({ alert_fired_id: ALERT_ID, channels: ["digest"], headline: "First finding" }),
      pendingRow({
        alert_fired_id: "66666666-6666-4666-8666-666666666666",
        agent_id: "77777777-7777-4777-8777-777777777777",
        channels: ["digest"],
        headline: "Second finding",
      }),
    ],
  });

  const result = await processPendingNotifications(db, {
    adapters: channelAdapters((channel, payload) => {
      sent.push({ channel, title: payload.title });
      return {};
    }),
    throttle: { maxPerUserChannel: 1 },
  });

  assert.deepEqual(sent, [{ channel: "digest", title: "1 agent alert" }]);
  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 1);
  assert.equal(db.updates[0].status, "notified");
  assert.equal(db.updates[1].status, "failed");
  assert.equal(db.updates[1].metadata.channels[0].status, "throttled");
});

test("processPendingNotifications respects user and per-agent channel preferences", async () => {
  const sent: string[] = [];
  const db = fakeNotificationDb({
    pendingRows: [pendingRow({ channels: ["email", "web_push", "sms", "mobile_push"] })],
  });

  const result = await processPendingNotifications(db, {
    adapters: channelAdapters((channel) => {
      sent.push(channel);
      return {};
    }),
    preferences: {
      users: { [USER_ID]: ["email", "web_push", "mobile_push"] },
      agents: { [AGENT_ID]: ["web_push", "sms"] },
    },
  });

  assert.deepEqual(sent, ["web_push"]);
  assert.equal(result.delivered, 1);
  assert.deepEqual(db.updates[0]?.metadata.channels.map((channel) => channel.channel), ["web_push"]);
});

test("processPendingNotifications treats partial channel delivery as notified", async () => {
  const db = fakeNotificationDb({
    pendingRows: [pendingRow({ channels: ["email", "sms"] })],
  });

  const result = await processPendingNotifications(db, {
    adapters: channelAdapters((channel) => {
      if (channel === "sms") throw new Error("provider unavailable");
      return { provider_message_id: `${channel}-receipt` };
    }),
  });

  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0);
  assert.equal(db.updates[0]?.status, "notified");
  assert.equal(db.updates[0]?.metadata.channels.some((channel) => channel.channel === "sms" && channel.status === "failed"), true);
});

test("dev no-op adapters expose every production notification channel", async () => {
  const adapters = createDevNoopNotificationAdapters();
  assert.deepEqual(Object.keys(adapters).sort(), ["digest", "email", "mobile_push", "sms", "web_push"]);
  assert.equal((await adapters.email.send({ title: "T", body: "B", alerts: [] })).provider, "dev-noop");
});

test("configured webhook adapters send provider-shaped payloads for every production channel", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const adapters = createConfiguredNotificationAdapters({
    NOTIFICATIONS_EMAIL_WEBHOOK_URL: "https://notify.example/email",
    NOTIFICATIONS_WEB_PUSH_WEBHOOK_URL: "https://notify.example/web-push",
    NOTIFICATIONS_SMS_WEBHOOK_URL: "https://notify.example/sms",
    NOTIFICATIONS_MOBILE_PUSH_WEBHOOK_URL: "https://notify.example/mobile-push",
    NOTIFICATIONS_DIGEST_WEBHOOK_URL: "https://notify.example/digest",
  }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ message_id: `provider-${calls.length}` }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  });

  const payload: NotificationPayload = { title: "T", body: "B", alerts: [] };
  const receipts = await Promise.all([
    adapters.email.send(payload),
    adapters.web_push.send(payload),
    adapters.sms.send(payload),
    adapters.mobile_push.send(payload),
    adapters.digest.send(payload),
  ]);

  assert.deepEqual(calls.map((call) => call.url), [
    "https://notify.example/email",
    "https://notify.example/web-push",
    "https://notify.example/sms",
    "https://notify.example/mobile-push",
    "https://notify.example/digest",
  ]);
  assert.deepEqual(calls.map((call) => call.body.channel), ["email", "web_push", "sms", "mobile_push", "digest"]);
  assert.deepEqual(receipts.map((receipt) => receipt.provider_message_id), [
    "provider-1",
    "provider-2",
    "provider-3",
    "provider-4",
    "provider-5",
  ]);
});

test("runNotificationWorkerOnce processes pending alerts through configured adapters", async () => {
  const sent: string[] = [];
  const db = fakeNotificationDb({ pendingRows: [pendingRow({ channels: ["email"] })] });

  const result = await runNotificationWorkerOnce({
    db,
    adapters: channelAdapters((channel) => {
      sent.push(channel);
      return { provider: "test-provider", provider_message_id: "receipt-1" };
    }),
    now: () => "2026-05-07T00:00:00.000Z",
  });

  assert.deepEqual(sent, ["email"]);
  assert.equal(result.delivered, 1);
  assert.equal(db.updates[0]?.status, "notified");
  assert.equal(db.updates[0]?.metadata.channels[0].provider_message_id, "receipt-1");
});

type FakeDbOptions = {
  pendingRows: ReadonlyArray<Record<string, unknown>>;
  factEntitlements?: Record<string, ReadonlyArray<string>>;
};

function fakeNotificationDb(options: FakeDbOptions) {
  const updates: Array<{ alert_fired_id: string; status: string; metadata: { channels: Array<{ channel: string; status: string; error?: string; provider_message_id?: string }> } }> = [];
  const queries: string[] = [];
  const queryValues: unknown[][] = [];
  return {
    updates,
    queries,
    queryValues,
    async query(text: string, values?: unknown[]) {
      queries.push(text);
      queryValues.push(values ?? []);
      if (/from alerts_fired/i.test(text)) {
        return { rows: options.pendingRows };
      }
      if (/from facts/i.test(text)) {
        const ids = values?.[0] as string[];
        return {
          rows: ids.map((fact_id) => ({
            fact_id,
            entitlement_channels: options.factEntitlements?.[fact_id] ?? ["app", "email", "push"],
          })),
        };
      }
      if (/update alerts_fired/i.test(text)) {
        updates.push({
          alert_fired_id: String(values?.[0]),
          status: String(values?.[1]),
          metadata: JSON.parse(String(values?.[2])),
        });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function pendingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    alert_fired_id: ALERT_ID,
    agent_id: AGENT_ID,
    user_id: USER_ID,
    rule_id: "margin-risk",
    finding_id: FINDING_ID,
    channels: ["email"],
    trigger_refs: [],
    fired_at: "2026-05-07T00:00:00.000Z",
    finding: {
      finding_id: FINDING_ID,
      headline: overrides.headline ?? "Margin risk widened",
      severity: "high",
      summary_blocks: [],
    },
    ...overrides,
  };
}

function channelAdapters(
  send: (
    channel: NotificationChannel,
    payload: NotificationPayload,
  ) => Promise<NotificationAdapterReceipt> | NotificationAdapterReceipt,
): Record<NotificationChannel, NotificationAdapter> {
  return {
    email: { send: (payload) => send("email", payload) },
    web_push: { send: (payload) => send("web_push", payload) },
    sms: { send: (payload) => send("sms", payload) },
    mobile_push: { send: (payload) => send("mobile_push", payload) },
    digest: { send: (payload) => send("digest", payload) },
  };
}
