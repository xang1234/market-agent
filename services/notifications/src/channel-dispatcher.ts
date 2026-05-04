import {
  filterFactsForChannel,
  NotificationEntitlementError,
} from "./entitlement-gate.ts";
import {
  recordNotificationDelivery,
  updateAlertNotificationStatus,
  type NotificationDeliveryRow,
  type NotificationPreferenceRow,
  type PendingAlertNotification,
} from "./notification-repo.ts";
import type {
  NotificationChannel,
  QueryExecutor,
} from "./types.ts";

export type NotificationPayload = Readonly<{
  alert_fired_id: string;
  finding_id: string;
  headline: string;
  summary_blocks: readonly unknown[];
  fact_ids: readonly string[];
  fired_at: string;
}>;

export type NotificationAdapterResult = Readonly<{
  provider_message_id?: string | null;
}>;

export type NotificationChannelAdapter = (payload: NotificationPayload) => Promise<NotificationAdapterResult>;

export type NotificationChannelAdapters = Partial<Record<NotificationChannel, NotificationChannelAdapter>>;

export type SkippedPreferenceResult = Readonly<{
  channel: NotificationChannel;
  status: "skipped_preference";
}>;

export type DispatchAlertNotificationResult = NotificationDeliveryRow | SkippedPreferenceResult;

export async function dispatchAlertNotification(
  db: QueryExecutor,
  alert: PendingAlertNotification,
  preferences: readonly NotificationPreferenceRow[],
  adapters: NotificationChannelAdapters,
): Promise<readonly DispatchAlertNotificationResult[]> {
  const results: DispatchAlertNotificationResult[] = [];
  const preferencesByChannel = new Map(preferences.map((preference) => [preference.channel, preference]));

  for (const channel of alert.channels) {
    const preference = preferencesByChannel.get(channel);
    if (preference?.enabled === false || (channel === "sms" && preference?.enabled !== true)) {
      results.push(Object.freeze({ channel, status: "skipped_preference" }));
      continue;
    }

    try {
      const entitledFacts = filterFactsForChannel(alert.fact_refs, channel);
      const adapter = adapters[channel];
      if (!adapter) {
        results.push(
          await recordNotificationDelivery(db, {
            alert_fired_id: alert.alert_fired_id,
            user_id: alert.user_id,
            agent_id: alert.agent_id,
            channel,
            status: "failed",
            payload: deliveryPayload(alert, entitledFacts.map((fact) => fact.fact_id)),
          }),
        );
        continue;
      }

      let providerResult: NotificationAdapterResult;
      try {
        providerResult = await adapter(deliveryPayload(alert, entitledFacts.map((fact) => fact.fact_id)));
      } catch (error) {
        results.push(
          await recordNotificationDelivery(db, {
            alert_fired_id: alert.alert_fired_id,
            user_id: alert.user_id,
            agent_id: alert.agent_id,
            channel,
            status: "failed",
            payload: failurePayload(alert, error),
          }),
        );
        continue;
      }
      results.push(
        await recordNotificationDelivery(db, {
          alert_fired_id: alert.alert_fired_id,
          user_id: alert.user_id,
          agent_id: alert.agent_id,
          channel,
          status: "delivered",
          payload: deliveryPayload(alert, entitledFacts.map((fact) => fact.fact_id)),
          provider_message_id: providerResult.provider_message_id ?? null,
        }),
      );
    } catch (error) {
      if (!(error instanceof NotificationEntitlementError)) throw error;
      results.push(
        await recordNotificationDelivery(db, {
          alert_fired_id: alert.alert_fired_id,
          user_id: alert.user_id,
          agent_id: alert.agent_id,
          channel,
          status: "blocked_entitlement",
          payload: deliveryPayload(alert, []),
          blocked_fact_ids: error.blocked_fact_ids,
        }),
      );
    }
  }

  if (results.some((result) => result.status === "failed" || result.status === "blocked_entitlement")) {
    await updateAlertNotificationStatus(db, { alert_fired_id: alert.alert_fired_id, status: "failed" });
  } else if (results.some((result) => result.status === "delivered")) {
    await updateAlertNotificationStatus(db, { alert_fired_id: alert.alert_fired_id, status: "notified" });
  }

  return Object.freeze(results);
}

function deliveryPayload(alert: PendingAlertNotification, factIds: readonly string[]): NotificationPayload {
  return Object.freeze({
    alert_fired_id: alert.alert_fired_id,
    finding_id: alert.finding_id,
    headline: alert.headline,
    summary_blocks: alert.summary_blocks,
    fact_ids: Object.freeze([...factIds]),
    fired_at: alert.fired_at,
  });
}

function failurePayload(alert: PendingAlertNotification, error: unknown): NotificationPayload & { error: string } {
  return Object.freeze({
    ...deliveryPayload(alert, []),
    error: error instanceof Error ? error.message : String(error),
  });
}
