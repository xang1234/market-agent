import type {
  EntitledFactRef,
  NotificationChannel,
  QueryExecutor,
} from "./types.ts";

export type NotificationDeliveryStatus =
  | "delivered"
  | "blocked_entitlement"
  | "throttled"
  | "batched"
  | "failed";

export type DigestCadence = "immediate" | "hourly" | "daily" | "weekly";

export type PendingAlertNotification = Readonly<{
  alert_fired_id: string;
  user_id: string;
  agent_id: string;
  finding_id: string;
  channels: readonly NotificationChannel[];
  headline: string;
  summary_blocks: readonly unknown[];
  fact_refs: readonly EntitledFactRef[];
  fired_at: string;
}>;

export type NotificationPreferenceRow = Readonly<{
  channel: NotificationChannel;
  enabled: boolean;
  digest_cadence: DigestCadence;
}>;

export type NotificationDeliveryInput = Readonly<{
  alert_fired_id?: string | null;
  user_id: string;
  agent_id?: string | null;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  payload: unknown;
  blocked_fact_ids?: readonly string[];
  provider_message_id?: string | null;
}>;

export type NotificationDeliveryRow = Readonly<{
  notification_delivery_id: string;
  alert_fired_id: string | null;
  user_id: string;
  agent_id: string | null;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  payload: unknown;
  blocked_fact_ids: readonly string[];
  provider_message_id: string | null;
  attempted_at: string;
}>;

type PendingAlertDbRow = Omit<PendingAlertNotification, "channels" | "summary_blocks" | "fact_refs" | "fired_at"> & {
  channels: unknown;
  summary_blocks: unknown;
  fact_refs: unknown;
  fired_at: Date | string;
};

type PreferenceDbRow = {
  channel: NotificationChannel;
  enabled: boolean;
  digest_cadence: DigestCadence;
};

type DeliveryDbRow = Omit<NotificationDeliveryRow, "blocked_fact_ids" | "attempted_at"> & {
  blocked_fact_ids: unknown;
  attempted_at: Date | string;
};

export class NotificationRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationRepoError";
  }
}

export async function listPendingAlertNotifications(
  db: QueryExecutor,
  options: { limit: number },
): Promise<readonly PendingAlertNotification[]> {
  assertPositiveInteger(options.limit, "limit");

  const { rows } = await db.query<PendingAlertDbRow>(
    `select af.alert_fired_id::text as alert_fired_id,
            a.user_id::text as user_id,
            af.agent_id::text as agent_id,
            af.finding_id::text as finding_id,
            af.channels,
            f.headline,
            f.summary_blocks,
            coalesce(f.summary_blocks #> '{0,fact_refs}', '[]'::jsonb) as fact_refs,
            af.fired_at
       from alerts_fired af
       join agents a on a.agent_id = af.agent_id
       join findings f on f.finding_id = af.finding_id
      where af.status = 'pending_notification'
      order by af.fired_at asc, af.alert_fired_id asc
      limit $1`,
    [options.limit],
  );

  return Object.freeze(rows.map(pendingAlertFromDb));
}

export async function getNotificationPreferences(
  db: QueryExecutor,
  input: { user_id: string; agent_id?: string | null },
): Promise<readonly NotificationPreferenceRow[]> {
  assertUuidString(input.user_id, "user_id");
  if (input.agent_id != null) assertUuidString(input.agent_id, "agent_id");

  const { rows } = await db.query<PreferenceDbRow>(
    `select channel, enabled, digest_cadence
       from notification_preferences
      where user_id = $1::uuid
        and (agent_id = $2::uuid or agent_id is null)
      order by agent_id nulls first, channel asc`,
    [input.user_id, input.agent_id ?? null],
  );

  return Object.freeze(rows.map(preferenceFromDb));
}

export async function recordNotificationDelivery(
  db: QueryExecutor,
  input: NotificationDeliveryInput,
): Promise<NotificationDeliveryRow> {
  if (input.alert_fired_id != null) assertUuidString(input.alert_fired_id, "alert_fired_id");
  assertUuidString(input.user_id, "user_id");
  if (input.agent_id != null) assertUuidString(input.agent_id, "agent_id");

  const { rows } = await db.query<DeliveryDbRow>(
    `insert into notification_deliveries
       (alert_fired_id, user_id, agent_id, channel, status, payload, blocked_fact_ids, provider_message_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7::jsonb, $8)
     returning notification_delivery_id::text as notification_delivery_id,
               alert_fired_id::text as alert_fired_id,
               user_id::text as user_id,
               agent_id::text as agent_id,
               channel,
               status,
               payload,
               blocked_fact_ids,
               provider_message_id,
               attempted_at`,
    [
      input.alert_fired_id ?? null,
      input.user_id,
      input.agent_id ?? null,
      input.channel,
      input.status,
      JSON.stringify(input.payload),
      JSON.stringify(input.blocked_fact_ids ?? []),
      input.provider_message_id ?? null,
    ],
  );

  return deliveryFromDb(rows[0]);
}

function pendingAlertFromDb(row: PendingAlertDbRow): PendingAlertNotification {
  return Object.freeze({
    alert_fired_id: row.alert_fired_id,
    user_id: row.user_id,
    agent_id: row.agent_id,
    finding_id: row.finding_id,
    channels: freezeStringArray(row.channels, "channels") as readonly NotificationChannel[],
    headline: row.headline,
    summary_blocks: freezeArray(row.summary_blocks, "summary_blocks"),
    fact_refs: freezeFactRefs(row.fact_refs),
    fired_at: row.fired_at instanceof Date ? row.fired_at.toISOString() : row.fired_at,
  });
}

function preferenceFromDb(row: PreferenceDbRow): NotificationPreferenceRow {
  return Object.freeze({
    channel: row.channel,
    enabled: row.enabled,
    digest_cadence: row.digest_cadence,
  });
}

function deliveryFromDb(row: DeliveryDbRow | undefined): NotificationDeliveryRow {
  if (!row) throw new NotificationRepoError("notification delivery insert did not return a row");
  return Object.freeze({
    notification_delivery_id: row.notification_delivery_id,
    alert_fired_id: row.alert_fired_id,
    user_id: row.user_id,
    agent_id: row.agent_id,
    channel: row.channel,
    status: row.status,
    payload: row.payload,
    blocked_fact_ids: freezeStringArray(row.blocked_fact_ids, "blocked_fact_ids"),
    provider_message_id: row.provider_message_id,
    attempted_at: row.attempted_at instanceof Date ? row.attempted_at.toISOString() : row.attempted_at,
  });
}

function freezeFactRefs(value: unknown): readonly EntitledFactRef[] {
  if (!Array.isArray(value)) throw new NotificationRepoError("fact_refs must be an array");
  return Object.freeze(
    value.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new NotificationRepoError(`fact_refs[${index}] must be an object`);
      }
      const ref = item as { fact_id?: unknown; entitlement_channels?: unknown };
      assertUuidString(ref.fact_id, `fact_refs[${index}].fact_id`);
      return Object.freeze({
        fact_id: ref.fact_id,
        entitlement_channels: freezeStringArray(ref.entitlement_channels, `fact_refs[${index}].entitlement_channels`),
      });
    }),
  );
}

function freezeArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new NotificationRepoError(`${field} must be an array`);
  return Object.freeze([...value]);
}

function freezeStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new NotificationRepoError(`${field} must be a string array`);
  }
  return Object.freeze([...value]);
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new NotificationRepoError(`${field} must be a positive integer`);
  }
}

function assertUuidString(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    throw new NotificationRepoError(`${field} must be a UUID`);
  }
}
