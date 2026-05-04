import test from "node:test";
import assert from "node:assert/strict";
import {
  getNotificationPreferences,
  listPendingAlertNotifications,
  recordNotificationDelivery,
} from "../src/notification-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALERT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FINDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FACT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DELIVERY_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function fakeDb(rows: unknown[] = []) {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const db: QueryExecutor = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      return { rows: rows as T[] };
    },
  };
  return { db, queries };
}

test("listPendingAlertNotifications joins fired alerts to agents and findings", async () => {
  const { db, queries } = fakeDb([
    {
      alert_fired_id: ALERT_ID,
      user_id: USER_ID,
      agent_id: AGENT_ID,
      finding_id: FINDING_ID,
      channels: ["email"],
      headline: "Margin pressure rose",
      summary_blocks: [],
      fact_refs: [{ fact_id: FACT_ID, entitlement_channels: ["app", "email"] }],
      fired_at: "2026-05-04T00:00:00.000Z",
    },
  ]);

  const rows = await listPendingAlertNotifications(db, { limit: 10 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER_ID);
  assert.equal(rows[0].channels[0], "email");
  assert.equal(rows[0].fact_refs[0].fact_id, FACT_ID);
  assert.match(queries[0].text, /from alerts_fired/i);
  assert.match(queries[0].text, /join agents/i);
  assert.match(queries[0].text, /join findings/i);
  assert.deepEqual(queries[0].values, [10]);
});

test("getNotificationPreferences returns frozen rows scoped to user and agent", async () => {
  const { db, queries } = fakeDb([
    { channel: "email", enabled: true, digest_cadence: "immediate" },
    { channel: "sms", enabled: false, digest_cadence: "immediate" },
  ]);

  const rows = await getNotificationPreferences(db, { user_id: USER_ID, agent_id: AGENT_ID });

  assert.equal(rows.length, 2);
  assert.equal(rows[1].enabled, false);
  assert.throws(() => (rows as { pop(): unknown }).pop(), /Cannot/);
  assert.match(queries[0].text, /notification_preferences/i);
  assert.deepEqual(queries[0].values, [USER_ID, AGENT_ID]);
});

test("recordNotificationDelivery inserts delivery status and blocked facts", async () => {
  const { db, queries } = fakeDb([
    {
      notification_delivery_id: DELIVERY_ID,
      alert_fired_id: ALERT_ID,
      user_id: USER_ID,
      agent_id: AGENT_ID,
      channel: "email",
      status: "blocked_entitlement",
      payload: {},
      blocked_fact_ids: [FACT_ID],
      attempted_at: "2026-05-04T00:00:00.000Z",
    },
  ]);

  const row = await recordNotificationDelivery(db, {
    alert_fired_id: ALERT_ID,
    user_id: USER_ID,
    agent_id: AGENT_ID,
    channel: "email",
    status: "blocked_entitlement",
    payload: {},
    blocked_fact_ids: [FACT_ID],
  });

  assert.equal(row.status, "blocked_entitlement");
  assert.deepEqual(row.blocked_fact_ids, [FACT_ID]);
  assert.match(queries[0].text, /insert into notification_deliveries/i);
  assert.equal(queries[0].values[4], "blocked_entitlement");
});
