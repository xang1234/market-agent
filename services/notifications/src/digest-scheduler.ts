import {
  filterFactsForChannel,
  NotificationEntitlementError,
} from "./entitlement-gate.ts";
import {
  recordNotificationDelivery,
  updateAlertNotificationStatus,
  type DigestCadence,
  type NotificationDeliveryRow,
  type NotificationPreferenceRow,
  type PendingAlertNotification,
} from "./notification-repo.ts";
import type {
  NotificationChannel,
  QueryExecutor,
} from "./types.ts";

export type DigestPayload = Readonly<{
  user_id: string;
  channel: NotificationChannel;
  items: readonly DigestPayloadItem[];
}>;

export type DigestPayloadItem = Readonly<{
  alert_fired_id: string;
  finding_id: string;
  headline: string;
  fact_ids: readonly string[];
  fired_at: string;
}>;

export type DigestAdapterResult = Readonly<{
  provider_message_id?: string | null;
}>;

export type DigestAdapter = (payload: DigestPayload) => Promise<DigestAdapterResult>;

export type DigestOptions = Readonly<{
  channel: NotificationChannel;
  maxPerUserChannel: number;
  dueCadences: readonly DigestCadence[];
}>;

export type SkippedDigestPreferenceResult = Readonly<{
  channel: NotificationChannel;
  status: "skipped_preference";
}>;

export type DispatchNotificationDigestResult = NotificationDeliveryRow | SkippedDigestPreferenceResult;

export async function dispatchNotificationDigest(
  db: QueryExecutor,
  alerts: readonly PendingAlertNotification[],
  preferences: readonly NotificationPreferenceRow[],
  adapter: DigestAdapter,
  options: DigestOptions,
): Promise<readonly DispatchNotificationDigestResult[]> {
  assertPositiveInteger(options.maxPerUserChannel, "maxPerUserChannel");

  const preference = [...preferences].reverse().find((row) => row.channel === options.channel);
  if (
    preference?.enabled === false ||
    (preference !== undefined && !options.dueCadences.includes(preference.digest_cadence)) ||
    (options.channel === "sms" && preference?.enabled !== true)
  ) {
    return Object.freeze(alerts.map(() => Object.freeze({ channel: options.channel, status: "skipped_preference" })));
  }

  const eligible = alerts.filter((alert) => alert.channels.includes(options.channel));
  const results: DispatchNotificationDigestResult[] = [];

  for (const group of groupByUser(eligible)) {
    const allowed: PendingAlertNotification[] = [];
    for (const alert of group) {
      try {
        filterFactsForChannel(alert.fact_refs, options.channel);
        allowed.push(alert);
      } catch (error) {
        if (!(error instanceof NotificationEntitlementError)) throw error;
        results.push(
          await recordNotificationDelivery(db, {
            alert_fired_id: alert.alert_fired_id,
            user_id: alert.user_id,
            agent_id: alert.agent_id,
            channel: options.channel,
            status: "blocked_entitlement",
            payload: digestPayloadUnchecked([alert], options.channel),
            blocked_fact_ids: error.blocked_fact_ids,
          }),
        );
        await updateAlertNotificationStatus(db, { alert_fired_id: alert.alert_fired_id, status: "failed" });
      }
    }

    const included = allowed.slice(0, options.maxPerUserChannel);
    const throttled = allowed.slice(options.maxPerUserChannel);

    if (included.length > 0) {
      const payload = digestPayload(included, options.channel);
      let providerResult: DigestAdapterResult;
      try {
        providerResult = await adapter(payload);
      } catch (error) {
        for (const alert of included) {
          results.push(
            await recordNotificationDelivery(db, {
              alert_fired_id: alert.alert_fired_id,
              user_id: alert.user_id,
              agent_id: alert.agent_id,
              channel: options.channel,
              status: "failed",
              payload: failurePayload([alert], options.channel, error),
            }),
          );
          await updateAlertNotificationStatus(db, { alert_fired_id: alert.alert_fired_id, status: "failed" });
        }
        continue;
      }

      for (const alert of included) {
        results.push(
          await recordNotificationDelivery(db, {
            alert_fired_id: alert.alert_fired_id,
            user_id: alert.user_id,
            agent_id: alert.agent_id,
            channel: options.channel,
            status: "batched",
            payload,
            provider_message_id: providerResult.provider_message_id ?? null,
          }),
        );
        await updateAlertNotificationStatus(db, { alert_fired_id: alert.alert_fired_id, status: "notified" });
      }
    }

    for (const alert of throttled) {
      results.push(
        await recordNotificationDelivery(db, {
          alert_fired_id: alert.alert_fired_id,
          user_id: alert.user_id,
          agent_id: alert.agent_id,
          channel: options.channel,
          status: "throttled",
          payload: digestPayload([alert], options.channel),
        }),
      );
    }
  }

  return Object.freeze(results);
}

function failurePayload(
  alerts: readonly PendingAlertNotification[],
  channel: NotificationChannel,
  error: unknown,
): DigestPayload & { error: string } {
  return Object.freeze({
    ...digestPayloadUnchecked(alerts, channel),
    error: error instanceof Error ? error.message : String(error),
  });
}

function groupByUser(alerts: readonly PendingAlertNotification[]): readonly PendingAlertNotification[][] {
  const groups = new Map<string, PendingAlertNotification[]>();
  for (const alert of alerts) {
    const group = groups.get(alert.user_id) ?? [];
    group.push(alert);
    groups.set(alert.user_id, group);
  }
  return Object.freeze([...groups.values()]);
}

function digestPayload(alerts: readonly PendingAlertNotification[], channel: NotificationChannel): DigestPayload {
  const [first] = alerts;
  if (!first) throw new Error("digest payload requires at least one alert");

  return Object.freeze({
    user_id: first.user_id,
    channel,
    items: Object.freeze(
      alerts.map((alert) => {
        const facts = filterFactsForChannel(alert.fact_refs, channel);
        return Object.freeze({
          alert_fired_id: alert.alert_fired_id,
          finding_id: alert.finding_id,
          headline: alert.headline,
          fact_ids: Object.freeze(facts.map((fact) => fact.fact_id)),
          fired_at: alert.fired_at,
        });
      }),
    ),
  });
}

function digestPayloadUnchecked(alerts: readonly PendingAlertNotification[], channel: NotificationChannel): DigestPayload {
  const [first] = alerts;
  if (!first) throw new Error("digest payload requires at least one alert");

  return Object.freeze({
    user_id: first.user_id,
    channel,
    items: Object.freeze(
      alerts.map((alert) =>
        Object.freeze({
          alert_fired_id: alert.alert_fired_id,
          finding_id: alert.finding_id,
          headline: alert.headline,
          fact_ids: Object.freeze(alert.fact_refs.map((fact) => fact.fact_id)),
          fired_at: alert.fired_at,
        }),
      ),
    ),
  });
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}
