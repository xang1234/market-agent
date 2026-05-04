import test from "node:test";
import assert from "node:assert/strict";
import { dispatchNotificationDigest } from "../src/digest-scheduler.ts";
import type {
  NotificationPreferenceRow,
  PendingAlertNotification,
} from "../src/notification-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FINDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FACT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function alert(index: number, overrides: Partial<PendingAlertNotification> = {}): PendingAlertNotification {
  return Object.freeze({
    alert_fired_id: `${index}`.padStart(8, "0") + "-cccc-4ccc-8ccc-cccccccccccc",
    user_id: USER_ID,
    agent_id: AGENT_ID,
    finding_id: FINDING_ID,
    channels: Object.freeze(["digest"]),
    headline: `Finding ${index}`,
    summary_blocks: Object.freeze([]),
    fact_refs: Object.freeze([
      Object.freeze({
        fact_id: FACT_ID,
        entitlement_channels: Object.freeze(["app", "digest", "sms"]),
      }),
    ]),
    fired_at: "2026-05-04T00:00:00.000Z",
    ...overrides,
  });
}

function preference(channel: NotificationPreferenceRow["channel"], enabled = true): NotificationPreferenceRow {
  return Object.freeze({ channel, enabled, digest_cadence: "hourly" });
}

function fakeDb() {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const db: QueryExecutor = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      return {
        rows: [
          {
            notification_delivery_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
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

test("dispatchNotificationDigest batches multiple findings into one digest adapter call", async () => {
  const { db, queries } = fakeDb();
  const calls: unknown[] = [];

  const result = await dispatchNotificationDigest(
    db,
    [alert(1), alert(2), alert(3)],
    [preference("digest")],
    async (payload) => {
      calls.push(payload);
      return { provider_message_id: "digest-1" };
    },
    { channel: "digest", maxPerUserChannel: 10 },
  );

  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { items: unknown[] }).items.length, 3);
  assert.equal(result.filter((row) => row.status === "batched").length, 3);
  assert.equal(queries.length, 3);
});

test("dispatchNotificationDigest throttles alerts beyond the per-user channel cap", async () => {
  const { db } = fakeDb();
  const calls: unknown[] = [];

  const result = await dispatchNotificationDigest(
    db,
    [alert(1), alert(2), alert(3)],
    [preference("digest")],
    async (payload) => {
      calls.push(payload);
      return { provider_message_id: "digest-1" };
    },
    { channel: "digest", maxPerUserChannel: 1 },
  );

  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { items: unknown[] }).items.length, 1);
  assert.equal(result.filter((row) => row.status === "batched").length, 1);
  assert.equal(result.filter((row) => row.status === "throttled").length, 2);
});

test("dispatchNotificationDigest skips sms unless the user explicitly enables sms", async () => {
  const { db, queries } = fakeDb();
  const calls: unknown[] = [];

  const result = await dispatchNotificationDigest(
    db,
    [alert(1, { channels: Object.freeze(["sms"]) })],
    [],
    async (payload) => {
      calls.push(payload);
      return { provider_message_id: "sms-digest-1" };
    },
    { channel: "sms", maxPerUserChannel: 10 },
  );

  assert.equal(calls.length, 0);
  assert.equal(result[0].status, "skipped_preference");
  assert.equal(queries.length, 0);
});
