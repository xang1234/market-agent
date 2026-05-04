import test from "node:test";
import assert from "node:assert/strict";
import { dispatchAlertNotification } from "../src/channel-dispatcher.ts";
import type {
  NotificationDeliveryRow,
  NotificationPreferenceRow,
  PendingAlertNotification,
} from "../src/notification-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALERT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FINDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FACT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DELIVERY_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function alert(overrides: Partial<PendingAlertNotification> = {}): PendingAlertNotification {
  return Object.freeze({
    alert_fired_id: ALERT_ID,
    user_id: USER_ID,
    agent_id: AGENT_ID,
    finding_id: FINDING_ID,
    channels: Object.freeze(["email"]),
    headline: "Margin pressure rose",
    summary_blocks: Object.freeze([]),
    fact_refs: Object.freeze([
      Object.freeze({
        fact_id: FACT_ID,
        entitlement_channels: Object.freeze(["app", "email", "push"]),
      }),
    ]),
    fired_at: "2026-05-04T00:00:00.000Z",
    ...overrides,
  });
}

function preference(channel: NotificationPreferenceRow["channel"], enabled = true): NotificationPreferenceRow {
  return Object.freeze({ channel, enabled, digest_cadence: "immediate" });
}

function fakeDb() {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const db: QueryExecutor = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (/update alerts_fired/i.test(text)) {
        return { rows: [] as T[] };
      }
      return {
        rows: [
          {
            notification_delivery_id: DELIVERY_ID,
            alert_fired_id: values[0],
            user_id: values[1],
            agent_id: values[2],
            channel: values[3],
            status: values[4],
            payload: values[5] ? JSON.parse(String(values[5])) : {},
            blocked_fact_ids: values[6] ? JSON.parse(String(values[6])) : [],
            provider_message_id: values[7] ?? null,
            attempted_at: "2026-05-04T00:00:00.000Z",
          },
        ] as T[],
      };
    },
  };
  return { db, queries };
}

test("dispatchAlertNotification records blocked_entitlement and skips email adapter for app-only facts", async () => {
  const { db, queries } = fakeDb();
  const calls: unknown[] = [];

  const result = await dispatchAlertNotification(
    db,
    alert({
      fact_refs: Object.freeze([
        Object.freeze({
          fact_id: FACT_ID,
          entitlement_channels: Object.freeze(["app"]),
        }),
      ]),
    }),
    [preference("email")],
    {
      email: async (payload) => {
        calls.push(payload);
        return { provider_message_id: "email-1" };
      },
    },
  );

  assert.equal(calls.length, 0);
  assert.equal(result[0].status, "blocked_entitlement");
  assert.equal((result[0] as NotificationDeliveryRow).blocked_fact_ids[0], FACT_ID);
  assert.match(queries[0].text, /insert into notification_deliveries/i);
  assert.match(queries.at(-1)?.text ?? "", /update alerts_fired/i);
  assert.deepEqual(queries.at(-1)?.values, ["failed", ALERT_ID]);
});

test("dispatchAlertNotification delivers push-entitled facts to web push adapter", async () => {
  const { db, queries } = fakeDb();
  const calls: unknown[] = [];

  const result = await dispatchAlertNotification(
    db,
    alert({ channels: Object.freeze(["web_push"]) }),
    [preference("web_push")],
    {
      web_push: async (payload) => {
        calls.push(payload);
        return { provider_message_id: "push-1" };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(result[0].status, "delivered");
  assert.equal((result[0] as NotificationDeliveryRow).provider_message_id, "push-1");
  assert.deepEqual(queries.at(-1)?.values, ["notified", ALERT_ID]);
});

test("dispatchAlertNotification returns skipped_preference for disabled sms without provider call", async () => {
  const { db, queries } = fakeDb();
  const calls: unknown[] = [];

  const result = await dispatchAlertNotification(
    db,
    alert({ channels: Object.freeze(["sms"]) }),
    [preference("sms", false)],
    {
      sms: async (payload) => {
        calls.push(payload);
        return { provider_message_id: "sms-1" };
      },
    },
  );

  assert.equal(calls.length, 0);
  assert.equal(result[0].status, "skipped_preference");
  assert.equal(queries.length, 0);
});

test("dispatchAlertNotification records failed delivery when an adapter throws and continues later channels", async () => {
  const { db, queries } = fakeDb();
  const webPushCalls: unknown[] = [];

  const result = await dispatchAlertNotification(
    db,
    alert({ channels: Object.freeze(["email", "web_push"]) }),
    [preference("email"), preference("web_push")],
    {
      email: async () => {
        throw new Error("provider timeout");
      },
      web_push: async (payload) => {
        webPushCalls.push(payload);
        return { provider_message_id: "push-1" };
      },
    },
  );

  assert.equal(webPushCalls.length, 1);
  assert.deepEqual(
    result.map((row) => row.status),
    ["failed", "delivered"],
  );
  assert.match(JSON.stringify((result[0] as NotificationDeliveryRow).payload), /provider timeout/);
  assert.deepEqual(queries.at(-1)?.values, ["failed", ALERT_ID]);
});
