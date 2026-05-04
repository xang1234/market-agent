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

  const requiredEntitlement = requiredEntitlementForChannel(channel);
  const blocked = facts
    .filter((fact) => !fact.entitlement_channels.includes(requiredEntitlement))
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
