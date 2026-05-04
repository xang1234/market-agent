# Notification Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build notification delivery primitives for fired alerts, with entitlement-safe web push/email egress and digest batching/throttling.

**Architecture:** Add a focused `services/notifications` package. It consumes `alerts_fired`, gates outbound payloads against referenced fact `entitlement_channels`, writes deterministic delivery rows, and uses injectable channel adapters instead of real provider integrations.

**Tech Stack:** Node.js ESM with `node --experimental-strip-types`, `node:test`, `pg`-style `QueryExecutor`, SQL migrations under `db/migrations`, and schema assertions in `db/test/migrate.test.ts`.

---

## File Structure

- Create `services/notifications/package.json`: package metadata and test script.
- Create `services/notifications/src/types.ts`: shared notification channel, delivery, preference, and query executor types.
- Create `services/notifications/src/entitlement-gate.ts`: channel egress rules and fact entitlement filtering.
- Create `services/notifications/src/notification-repo.ts`: pending fired-alert lookup, preference lookup, and delivery-log persistence.
- Create `services/notifications/src/channel-dispatcher.ts`: channel adapter dispatch for immediate web push/email/mobile/SMS paths.
- Create `services/notifications/src/digest-scheduler.ts`: digest batching and per-user/channel throttling.
- Create `services/notifications/src/index.ts`: public exports.
- Create tests in `services/notifications/test/*.test.ts`.
- Create `db/migrations/0020_notification_delivery.up.sql` and `.down.sql`: user notification preferences and delivery log.
- Modify `spec/finance_research_db_schema.sql`: mirror migration 0020.
- Modify `db/test/migrate.test.ts`: expect migration 0020 and assert notification schema.

## Task 1: Package Scaffold and Entitlement Gate

**Files:**
- Create: `services/notifications/package.json`
- Create: `services/notifications/src/types.ts`
- Create: `services/notifications/src/entitlement-gate.ts`
- Create: `services/notifications/src/index.ts`
- Test: `services/notifications/test/entitlement-gate.test.ts`

- [ ] **Step 1: Write the failing entitlement gate tests**

Create `services/notifications/test/entitlement-gate.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  filterFactsForChannel,
  notificationChannelEgresses,
  NotificationEntitlementError,
} from "../src/entitlement-gate.ts";

const appOnlyFact = Object.freeze({
  fact_id: "11111111-1111-4111-8111-111111111111",
  entitlement_channels: Object.freeze(["app"]),
});

const emailFact = Object.freeze({
  fact_id: "22222222-2222-4222-8222-222222222222",
  entitlement_channels: Object.freeze(["app", "email", "push"]),
});

test("notificationChannelEgresses treats app/in_app as non-egress and email/push/sms/digest as egress", () => {
  assert.equal(notificationChannelEgresses("in_app"), false);
  assert.equal(notificationChannelEgresses("app"), false);
  assert.equal(notificationChannelEgresses("email"), true);
  assert.equal(notificationChannelEgresses("web_push"), true);
  assert.equal(notificationChannelEgresses("mobile_push"), true);
  assert.equal(notificationChannelEgresses("sms"), true);
  assert.equal(notificationChannelEgresses("digest"), true);
});

test("filterFactsForChannel blocks app-only facts from email egress", () => {
  assert.throws(
    () => filterFactsForChannel([appOnlyFact], "email"),
    (error) =>
      error instanceof NotificationEntitlementError &&
      error.blocked_fact_ids.includes(appOnlyFact.fact_id) &&
      /email/.test(error.message),
  );
});

test("filterFactsForChannel allows facts explicitly entitled for the channel", () => {
  assert.deepEqual(filterFactsForChannel([emailFact], "email"), [emailFact]);
  assert.deepEqual(filterFactsForChannel([emailFact], "web_push"), [emailFact]);
});

test("filterFactsForChannel allows app-only facts for in-app rendering", () => {
  assert.deepEqual(filterFactsForChannel([appOnlyFact], "in_app"), [appOnlyFact]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd services/notifications
npm test -- test/entitlement-gate.test.ts
```

Expected: fails because `services/notifications/package.json` and `../src/entitlement-gate.ts` do not exist.

- [ ] **Step 3: Add the minimal package and entitlement implementation**

Create `services/notifications/package.json`:

```json
{
  "name": "notifications",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": ">=22.6.0"
  },
  "scripts": {
    "test": "node --experimental-strip-types --test \"test/**/*.test.ts\""
  }
}
```

Create `services/notifications/src/types.ts`:

```ts
export type QueryExecutor = {
  query<T = unknown>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
};

export const NOTIFICATION_CHANNELS = Object.freeze([
  "app",
  "in_app",
  "web_push",
  "mobile_push",
  "email",
  "sms",
  "digest",
] as const);

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type EntitledFactRef = Readonly<{
  fact_id: string;
  entitlement_channels: readonly string[];
}>;
```

Create `services/notifications/src/entitlement-gate.ts`:

```ts
import {
  NOTIFICATION_CHANNELS,
  type EntitledFactRef,
  type NotificationChannel,
} from "./types.ts";

const NON_EGRESS_CHANNELS = new Set<NotificationChannel>(["app", "in_app"]);
const PUSH_ENTITLEMENT_CHANNELS = new Set<NotificationChannel>(["web_push", "mobile_push"]);

export class NotificationEntitlementError extends Error {
  readonly channel: NotificationChannel;
  readonly blocked_fact_ids: readonly string[];

  constructor(channel: NotificationChannel, blockedFactIds: readonly string[]) {
    super(`notification channel ${channel} is not allowed to egress facts: ${blockedFactIds.join(", ")}`);
    this.name = "NotificationEntitlementError";
    this.channel = channel;
    this.blocked_fact_ids = Object.freeze([...blockedFactIds]);
  }
}

export function notificationChannelEgresses(channel: NotificationChannel): boolean {
  assertNotificationChannel(channel);
  return !NON_EGRESS_CHANNELS.has(channel);
}

export function filterFactsForChannel(
  facts: readonly EntitledFactRef[],
  channel: NotificationChannel,
): readonly EntitledFactRef[] {
  assertNotificationChannel(channel);
  if (!notificationChannelEgresses(channel)) return Object.freeze([...facts]);

  const blocked = facts
    .filter((fact) => !fact.entitlement_channels.includes(requiredEntitlementForChannel(channel)))
    .map((fact) => fact.fact_id);

  if (blocked.length > 0) {
    throw new NotificationEntitlementError(channel, blocked);
  }

  return Object.freeze([...facts]);
}

function requiredEntitlementForChannel(channel: NotificationChannel): string {
  if (PUSH_ENTITLEMENT_CHANNELS.has(channel)) return "push";
  return channel;
}

function assertNotificationChannel(value: unknown): asserts value is NotificationChannel {
  if (!NOTIFICATION_CHANNELS.includes(value as NotificationChannel)) {
    throw new NotificationEntitlementError("in_app", [`invalid channel: ${String(value)}`]);
  }
}
```

Create `services/notifications/src/index.ts`:

```ts
export * from "./types.ts";
export * from "./entitlement-gate.ts";
```

- [ ] **Step 4: Run the entitlement tests and verify GREEN**

Run:

```bash
cd services/notifications
npm test -- test/entitlement-gate.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add services/notifications/package.json services/notifications/src/types.ts services/notifications/src/entitlement-gate.ts services/notifications/src/index.ts services/notifications/test/entitlement-gate.test.ts
git commit -m "feat: add notification entitlement gate"
```

## Task 2: Notification Delivery Schema and Repository

**Files:**
- Create: `db/migrations/0020_notification_delivery.up.sql`
- Create: `db/migrations/0020_notification_delivery.down.sql`
- Modify: `spec/finance_research_db_schema.sql`
- Modify: `db/test/migrate.test.ts`
- Create: `services/notifications/src/notification-repo.ts`
- Test: `services/notifications/test/notification-repo.test.ts`

- [ ] **Step 1: Write failing schema assertions**

In `db/test/migrate.test.ts`, add:

```ts
const notificationDeliveryMigrationPath = join(dbRoot, "migrations", "0020_notification_delivery.up.sql");

test("notification delivery schema records preferences and delivery attempts", () => {
  const forwardMigration = readFileSync(notificationDeliveryMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const sql of [forwardMigration, schema]) {
    assert.match(sql, /create table notification_preferences/i);
    assert.match(sql, /user_id uuid not null references users\(user_id\)/i);
    assert.match(sql, /agent_id uuid references agents\(agent_id\)/i);
    assert.match(sql, /channel text not null/i);
    assert.match(sql, /digest_cadence text not null default 'immediate'/i);
    assert.match(sql, /create table notification_deliveries/i);
    assert.match(sql, /alert_fired_id uuid references alerts_fired\(alert_fired_id\)/i);
    assert.match(sql, /status text not null/i);
    assert.match(sql, /blocked_fact_ids jsonb not null default '\[\]'::jsonb/i);
    assert.match(sql, /create index notification_deliveries_user_channel_idx/i);
  }
});
```

Update migration count assertions from `19` to `20` and add `"0020:notification_delivery"` after `"0019:alerts_fired"`.

- [ ] **Step 2: Run schema test and verify RED**

Run:

```bash
cd db
PATH=/usr/bin:/bin /usr/local/bin/node --experimental-strip-types --test test/migrate.test.ts --test-name-pattern "notification delivery schema"
```

Expected: fails because migration 0020 does not exist.

- [ ] **Step 3: Add migration and schema mirror**

Create `db/migrations/0020_notification_delivery.up.sql`:

```sql
create table notification_preferences (
  notification_preference_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  agent_id uuid references agents(agent_id) on delete cascade,
  channel text not null,
  enabled boolean not null default true,
  digest_cadence text not null default 'immediate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, agent_id, channel),
  constraint notification_preferences_channel_chk check (channel in ('in_app', 'web_push', 'mobile_push', 'email', 'sms', 'digest')),
  constraint notification_preferences_digest_cadence_chk check (digest_cadence in ('immediate', 'hourly', 'daily', 'weekly'))
);
create index notification_preferences_user_channel_idx
  on notification_preferences(user_id, channel);

create table notification_deliveries (
  notification_delivery_id uuid primary key default gen_random_uuid(),
  alert_fired_id uuid references alerts_fired(alert_fired_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  agent_id uuid references agents(agent_id) on delete cascade,
  channel text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  blocked_fact_ids jsonb not null default '[]'::jsonb,
  provider_message_id text,
  attempted_at timestamptz not null default now(),
  constraint notification_deliveries_channel_chk check (channel in ('in_app', 'web_push', 'mobile_push', 'email', 'sms', 'digest')),
  constraint notification_deliveries_status_chk check (status in ('delivered', 'blocked_entitlement', 'throttled', 'batched', 'failed')),
  constraint notification_deliveries_blocked_fact_ids_array_chk check (jsonb_typeof(blocked_fact_ids) = 'array')
);
create index notification_deliveries_user_channel_idx
  on notification_deliveries(user_id, channel, attempted_at desc);
create index notification_deliveries_alert_fired_idx
  on notification_deliveries(alert_fired_id);
```

Create `db/migrations/0020_notification_delivery.down.sql`:

```sql
drop table if exists notification_deliveries;
drop table if exists notification_preferences;
```

Mirror both tables and indexes in `spec/finance_research_db_schema.sql` after `alerts_fired`.

- [ ] **Step 4: Run schema test and verify GREEN**

Run:

```bash
cd db
PATH=/usr/bin:/bin /usr/local/bin/node --experimental-strip-types --test test/migrate.test.ts --test-name-pattern "notification delivery schema"
PATH=/usr/bin:/bin /usr/local/bin/node --experimental-strip-types --test test/migration-registry.test.ts
```

Expected: notification schema test passes; migration registry includes 0020.

- [ ] **Step 5: Write failing repository tests**

Create `services/notifications/test/notification-repo.test.ts` with a fake DB that verifies:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  listPendingAlertNotifications,
  recordNotificationDelivery,
  getNotificationPreferences,
} from "../src/notification-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALERT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
      finding_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      channels: ["email"],
      headline: "Margin pressure rose",
      summary_blocks: [],
      fact_refs: [{ fact_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", entitlement_channels: ["app", "email"] }],
      fired_at: "2026-05-04T00:00:00.000Z",
    },
  ]);

  const rows = await listPendingAlertNotifications(db, { limit: 10 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, USER_ID);
  assert.equal(rows[0].channels[0], "email");
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
  assert.match(queries[0].text, /notification_preferences/i);
  assert.deepEqual(queries[0].values, [USER_ID, AGENT_ID]);
});

test("recordNotificationDelivery inserts delivery status and blocked facts", async () => {
  const { db, queries } = fakeDb([
    {
      notification_delivery_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      alert_fired_id: ALERT_ID,
      user_id: USER_ID,
      agent_id: AGENT_ID,
      channel: "email",
      status: "blocked_entitlement",
      payload: {},
      blocked_fact_ids: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
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
    blocked_fact_ids: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
  });

  assert.equal(row.status, "blocked_entitlement");
  assert.match(queries[0].text, /insert into notification_deliveries/i);
  assert.equal(queries[0].values[4], "blocked_entitlement");
});
```

- [ ] **Step 6: Run repository test and verify RED**

Run:

```bash
cd services/notifications
npm test -- test/notification-repo.test.ts
```

Expected: fails because `notification-repo.ts` does not exist.

- [ ] **Step 7: Implement repository**

Add `PendingAlertNotification`, `NotificationPreferenceRow`, `NotificationDeliveryInput`, `NotificationDeliveryRow`, `listPendingAlertNotifications`, `getNotificationPreferences`, and `recordNotificationDelivery` in `services/notifications/src/notification-repo.ts`.

The pending query must select from `alerts_fired`, join `agents` and `findings`, filter `alerts_fired.status = 'pending_notification'`, and accept a positive integer `limit`.

- [ ] **Step 8: Run repository and schema tests**

Run:

```bash
cd services/notifications && npm test -- test/notification-repo.test.ts
cd ../../db && PATH=/usr/bin:/bin /usr/local/bin/node --experimental-strip-types --test test/migrate.test.ts --test-name-pattern "notification delivery schema"
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/0020_notification_delivery.up.sql db/migrations/0020_notification_delivery.down.sql spec/finance_research_db_schema.sql db/test/migrate.test.ts services/notifications/src/notification-repo.ts services/notifications/test/notification-repo.test.ts
git commit -m "feat: add notification delivery repository"
```

## Task 3: Channel Dispatcher

**Files:**
- Create: `services/notifications/src/channel-dispatcher.ts`
- Test: `services/notifications/test/channel-dispatcher.test.ts`
- Modify: `services/notifications/src/index.ts`

- [ ] **Step 1: Write failing dispatcher tests**

Create tests that assert:
- email delivery with an app-only fact records `blocked_entitlement` and does not call the adapter.
- web push delivery with push-entitled facts calls the adapter once and records `delivered`.
- disabled SMS preference records no provider call and returns `skipped_preference`.

- [ ] **Step 2: Run dispatcher test and verify RED**

Run:

```bash
cd services/notifications
npm test -- test/channel-dispatcher.test.ts
```

Expected: fails because `channel-dispatcher.ts` does not exist.

- [ ] **Step 3: Implement dispatcher**

Implement `dispatchAlertNotification(db, alert, preferences, adapters)`:
- Expand alert channels.
- Skip disabled preferences.
- Run `filterFactsForChannel`.
- Record `blocked_entitlement` rows with blocked fact ids on entitlement failure.
- Call the matching adapter for allowed egress channels.
- Record `delivered` with adapter provider id.

- [ ] **Step 4: Run dispatcher test and verify GREEN**

Run:

```bash
cd services/notifications
npm test -- test/channel-dispatcher.test.ts
```

Expected: dispatcher tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/notifications/src/channel-dispatcher.ts services/notifications/src/index.ts services/notifications/test/channel-dispatcher.test.ts
git commit -m "feat: dispatch entitlement-safe notifications"
```

## Task 4: Digest Batching and Throttling

**Files:**
- Create: `services/notifications/src/digest-scheduler.ts`
- Test: `services/notifications/test/digest-scheduler.test.ts`
- Modify: `services/notifications/src/index.ts`

- [ ] **Step 1: Write failing digest tests**

Create tests that assert:
- three alerts for the same user/channel produce one digest adapter call.
- per-user/channel throttling records `throttled` for alerts beyond the cap.
- SMS is skipped unless the preference is explicitly enabled.

- [ ] **Step 2: Run digest test and verify RED**

Run:

```bash
cd services/notifications
npm test -- test/digest-scheduler.test.ts
```

Expected: fails because `digest-scheduler.ts` does not exist.

- [ ] **Step 3: Implement digest scheduler**

Implement `dispatchNotificationDigest(db, alerts, preferences, adapter, options)`:
- Group by `user_id` and target channel.
- Apply `maxPerUserChannel` per run.
- Batch allowed alerts into one payload.
- Record `batched` for included alerts and `throttled` for over-cap alerts.
- Keep SMS opt-in by requiring an enabled `sms` preference.

- [ ] **Step 4: Run digest test and verify GREEN**

Run:

```bash
cd services/notifications
npm test -- test/digest-scheduler.test.ts
```

Expected: digest tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/notifications/src/digest-scheduler.ts services/notifications/src/index.ts services/notifications/test/digest-scheduler.test.ts
git commit -m "feat: batch notification digests"
```

## Task 5: Bead Closure and Final Verification

**Files:**
- Modify: `.beads/issues.jsonl`

- [ ] **Step 1: Run focused notification tests**

```bash
cd services/notifications
npm test
```

Expected: all notification tests pass.

- [ ] **Step 2: Run dependent package tests**

```bash
cd services/agents
npm test
cd ../tools
npm test
```

Expected: agents and tools suites pass; Docker-backed integration tests may skip if Docker cannot start Postgres.

- [ ] **Step 3: Run DB schema tests**

```bash
cd db
PATH=/usr/bin:/bin /usr/local/bin/node --experimental-strip-types --test test/migrate.test.ts --test-name-pattern "notification delivery schema|migrate up applies pending migrations|migration status reports applied migrations"
PATH=/usr/bin:/bin /usr/local/bin/node --experimental-strip-types --test test/migration-registry.test.ts
```

Expected: schema and registry tests pass; Docker migration tests may skip only when Docker is unavailable.

- [ ] **Step 4: Close beads**

```bash
bd close fra-ci6 --reason "Implemented web push/email notification entitlement gating"
bd close fra-fs5 --reason "Implemented digest batching and per-user/channel throttling"
bd close fra-7w3.5 --reason "Implemented notification channels and digest delivery primitives"
```

- [ ] **Step 5: Final quality and push**

```bash
git diff --check
git status --short
git pull --rebase
bd sync
git push
git status --short --branch
```

Expected: diff check clean, branch pushed, status up to date. If `bd sync` is unavailable in this environment, record the exact error and continue with push.

## Self-Review

- Spec coverage: `fra-ci6` is covered by Tasks 1 and 3; `fra-fs5` is covered by Task 4; schema durability and bead closure are covered by Tasks 2 and 5.
- Placeholder scan: no `TBD`, `TODO`, or intentionally vague implementation-only steps remain.
- Type consistency: channel names, delivery statuses, and preference cadence values match across migration, repository, dispatcher, and digest tasks.
