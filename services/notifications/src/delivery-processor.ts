export const NOTIFICATION_CHANNELS = [
  "email",
  "web_push",
  "sms",
  "mobile_push",
  "digest",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPayload = {
  title: string;
  body: string;
  alerts: ReadonlyArray<{
    alert_fired_id: string;
    agent_id: string;
    finding_id: string;
    headline: string;
    severity: string;
  }>;
};

export type NotificationAdapterReceipt = {
  provider?: string;
  provider_message_id?: string;
  metadata?: JsonValue;
};

export type NotificationAdapter = {
  send(payload: NotificationPayload): Promise<NotificationAdapterReceipt> | NotificationAdapterReceipt;
};

export type NotificationAdapters = Partial<Record<NotificationChannel, NotificationAdapter>>;

export type NotificationEnv = Partial<Record<string, string | undefined>>;

export type ProcessPendingNotificationsInput = {
  adapters: NotificationAdapters;
  claimTimeoutMs?: number;
  limit?: number;
  now?: () => string;
  preferences?: {
    users?: Record<string, ReadonlyArray<string>>;
    agents?: Record<string, ReadonlyArray<string>>;
  };
  throttle?: {
    maxPerUserChannel?: number;
  };
};

export type ProcessPendingNotificationsResult = {
  claimed: number;
  delivered: number;
  failed: number;
  channel_receipts: ReadonlyArray<DeliveryChannelReceipt>;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export type NotificationQueryExecutor = QueryExecutor;

type AlertNotificationRow = {
  alert_fired_id: string;
  agent_id: string;
  user_id: string;
  rule_id: string;
  finding_id: string;
  channels: unknown;
  trigger_refs: unknown;
  fired_at: string | Date;
  finding: unknown;
};

type AlertForDelivery = {
  alert_fired_id: string;
  agent_id: string;
  user_id: string;
  rule_id: string;
  finding_id: string;
  channels: ReadonlyArray<NotificationChannel>;
  trigger_refs: ReadonlyArray<JsonValue>;
  fired_at: string;
  headline: string;
  severity: string;
  fact_refs: ReadonlyArray<string>;
};

type FactEntitlementRow = {
  fact_id: string;
  entitlement_channels: unknown;
};

export type DeliveryChannelReceipt = {
  channel: NotificationChannel;
  status: "delivered" | "failed" | "blocked" | "throttled";
  provider?: string;
  provider_message_id?: string;
  error?: string;
};

type DeliveryMetadata = {
  delivered_at: string;
  channels: DeliveryChannelReceipt[];
};

export async function processPendingNotifications(
  db: QueryExecutor,
  input: ProcessPendingNotificationsInput,
): Promise<ProcessPendingNotificationsResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const claimedAt = now();
  const claimExpiresBefore = new Date(
    Date.parse(claimedAt) - (input.claimTimeoutMs ?? 15 * 60_000),
  ).toISOString();
  const alerts = await claimPendingAlerts(db, input.limit ?? 100, claimedAt, claimExpiresBefore);
  const entitlements = await loadFactEntitlements(db, alerts.flatMap((alert) => alert.fact_refs));
  const sentByUserChannel = new Map<string, number>();
  const alertMetadataById = new Map<string, DeliveryMetadata>();
  const allReceipts: DeliveryChannelReceipt[] = [];
  let delivered = 0;
  let failed = 0;

  const digestGroups = new Map<string, AlertForDelivery[]>();

  for (const alert of alerts) {
    const metadata: DeliveryMetadata = { delivered_at: now(), channels: [] };
    const channels = allowedByPreferences(alert, input.preferences);
    const immediateChannels = channels.filter((channel) => channel !== "digest");
    if (channels.includes("digest")) {
      const key = `${alert.user_id}:${alert.agent_id}`;
      digestGroups.set(key, [...(digestGroups.get(key) ?? []), alert]);
    }

    for (const channel of immediateChannels) {
      const receipt = await deliverOne(input.adapters, channel, alertPayload(alert), {
        alert,
        entitlements,
        sentByUserChannel,
        maxPerUserChannel: input.throttle?.maxPerUserChannel,
      });
      metadata.channels.push(receipt);
      allReceipts.push(receipt);
    }

    const terminalStatus = terminalStatusFor(metadata.channels, channels.includes("digest"));
    if (terminalStatus) {
      await updateAlertDelivery(db, alert.alert_fired_id, terminalStatus, metadata);
      if (terminalStatus === "notified") delivered += 1;
      else failed += 1;
    } else {
      alertMetadataById.set(alert.alert_fired_id, metadata);
    }
  }

  for (const groupAlerts of digestGroups.values()) {
    const receipt = await deliverDigest(input.adapters, groupAlerts, entitlements, {
      sentByUserChannel,
      maxPerUserChannel: input.throttle?.maxPerUserChannel,
    });
    allReceipts.push(receipt);
    for (const alert of groupAlerts) {
      const metadata = alertMetadataById.get(alert.alert_fired_id) ?? { delivered_at: now(), channels: [] };
      metadata.channels.push(receipt);
      const status = terminalStatusFor(metadata.channels, false) ?? "failed";
      await updateAlertDelivery(db, alert.alert_fired_id, status, metadata);
      if (status === "notified") delivered += 1;
      else failed += 1;
      alertMetadataById.delete(alert.alert_fired_id);
    }
  }

  return Object.freeze({
    claimed: alerts.length,
    delivered,
    failed,
    channel_receipts: Object.freeze(allReceipts),
  });
}

export function createDevNoopNotificationAdapters(): Record<NotificationChannel, NotificationAdapter> {
  const adapter: NotificationAdapter = {
    send: () => ({ provider: "dev-noop" }),
  };
  return {
    email: adapter,
    web_push: adapter,
    sms: adapter,
    mobile_push: adapter,
    digest: adapter,
  };
}

export function createConfiguredNotificationAdapters(
  env: NotificationEnv,
  fetchImpl: typeof fetch = fetch,
): Record<NotificationChannel, NotificationAdapter> {
  if (env.NOTIFICATIONS_ADAPTER_MODE === "dev-noop") {
    return createDevNoopNotificationAdapters();
  }
  return {
    email: webhookAdapter("email", requireEnvUrl(env, "NOTIFICATIONS_EMAIL_WEBHOOK_URL"), fetchImpl),
    web_push: webhookAdapter("web_push", requireEnvUrl(env, "NOTIFICATIONS_WEB_PUSH_WEBHOOK_URL"), fetchImpl),
    sms: webhookAdapter("sms", requireEnvUrl(env, "NOTIFICATIONS_SMS_WEBHOOK_URL"), fetchImpl),
    mobile_push: webhookAdapter("mobile_push", requireEnvUrl(env, "NOTIFICATIONS_MOBILE_PUSH_WEBHOOK_URL"), fetchImpl),
    digest: webhookAdapter("digest", requireEnvUrl(env, "NOTIFICATIONS_DIGEST_WEBHOOK_URL"), fetchImpl),
  };
}

function webhookAdapter(
  channel: NotificationChannel,
  url: string,
  fetchImpl: typeof fetch,
): NotificationAdapter {
  return {
    async send(payload) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, ...payload }),
      });
      const body = await readProviderResponse(response);
      if (!response.ok) {
        throw new Error(`${channel} provider returned HTTP ${response.status}${body.error ? `: ${body.error}` : ""}`);
      }
      return {
        provider: body.provider ?? "webhook",
        provider_message_id: body.provider_message_id ?? body.message_id ?? body.id,
        metadata: body.metadata,
      };
    },
  };
}

async function readProviderResponse(response: Response): Promise<{
  provider?: string;
  provider_message_id?: string;
  message_id?: string;
  id?: string;
  error?: string;
  metadata?: JsonValue;
}> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  const value = await response.json() as Record<string, unknown>;
  return {
    provider: typeof value.provider === "string" ? value.provider : undefined,
    provider_message_id: typeof value.provider_message_id === "string" ? value.provider_message_id : undefined,
    message_id: typeof value.message_id === "string" ? value.message_id : undefined,
    id: typeof value.id === "string" ? value.id : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
    metadata: isJsonValue(value.metadata) ? value.metadata : undefined,
  };
}

function requireEnvUrl(env: NotificationEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required unless NOTIFICATIONS_ADAPTER_MODE=dev-noop`);
  return value;
}

async function claimPendingAlerts(
  db: QueryExecutor,
  limit: number,
  claimedAt: string,
  claimExpiresBefore: string,
): Promise<AlertForDelivery[]> {
  const { rows } = await db.query<AlertNotificationRow>(
    `with pending as (
       select af.alert_fired_id
         from alerts_fired af
        where af.status = 'pending_notification'
           or (
             af.status = 'delivering'
             and nullif(af.notification_delivery->>'claimed_at', '')::timestamptz < $3::timestamptz
           )
        order by af.fired_at asc
        limit $1
        for update skip locked
     )
     update alerts_fired af
        set status = 'delivering',
            notification_delivery = jsonb_set(
              notification_delivery,
              '{claimed_at}',
              to_jsonb($2::text),
              true
            )
       from pending, agents a, findings f
      where af.alert_fired_id = pending.alert_fired_id
        and a.agent_id = af.agent_id
        and f.finding_id = af.finding_id
      returning
       af.alert_fired_id::text as alert_fired_id,
       af.agent_id::text as agent_id,
       a.user_id::text as user_id,
       af.rule_id,
       af.finding_id::text as finding_id,
       af.channels,
       af.trigger_refs,
       af.fired_at::text as fired_at,
       jsonb_build_object(
         'finding_id', f.finding_id::text,
         'headline', f.headline,
         'severity', f.severity,
         'summary_blocks', f.summary_blocks
       ) as finding`,
    [limit, claimedAt, claimExpiresBefore],
  );
  return rows.map(rowFromDb);
}

async function loadFactEntitlements(
  db: QueryExecutor,
  factRefs: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  const uniqueRefs = [...new Set(factRefs)].sort();
  if (uniqueRefs.length === 0) return new Map();
  const { rows } = await db.query<FactEntitlementRow>(
    `select fact_id::text as fact_id, entitlement_channels
       from facts
      where fact_id = any($1::uuid[])`,
    [uniqueRefs],
  );
  return new Map(rows.map((row) => [row.fact_id, stringArray(row.entitlement_channels, "entitlement_channels")]));
}

async function deliverOne(
  adapters: NotificationAdapters,
  channel: NotificationChannel,
  payload: NotificationPayload,
  context: {
    alert: AlertForDelivery;
    entitlements: ReadonlyMap<string, ReadonlyArray<string>>;
    sentByUserChannel: Map<string, number>;
    maxPerUserChannel?: number;
  },
): Promise<DeliveryChannelReceipt> {
  const blocked = blockedFactReceipt(channel, context.alert.fact_refs, context.entitlements);
  if (blocked) return blocked;

  const throttleKey = `${context.alert.user_id}:${channel}`;
  const sent = context.sentByUserChannel.get(throttleKey) ?? 0;
  if (context.maxPerUserChannel !== undefined && sent >= context.maxPerUserChannel) {
    return { channel, status: "throttled", error: "per-user/channel throttle exceeded" };
  }

  const adapter = adapters[channel];
  if (!adapter) {
    return { channel, status: "failed", error: `notification adapter for ${channel} is not configured` };
  }

  try {
    const receipt = await adapter.send(payload);
    context.sentByUserChannel.set(throttleKey, sent + 1);
    return {
      channel,
      status: "delivered",
      provider: receipt.provider,
      provider_message_id: receipt.provider_message_id,
    };
  } catch (error) {
    return { channel, status: "failed", error: errorMessage(error) };
  }
}

async function deliverDigest(
  adapters: NotificationAdapters,
  alerts: ReadonlyArray<AlertForDelivery>,
  entitlements: ReadonlyMap<string, ReadonlyArray<string>>,
  context: {
    sentByUserChannel: Map<string, number>;
    maxPerUserChannel?: number;
  },
): Promise<DeliveryChannelReceipt> {
  const blocked = blockedFactReceipt("digest", alerts.flatMap((alert) => alert.fact_refs), entitlements);
  if (blocked) return blocked;

  const userId = alerts[0]?.user_id;
  const throttleKey = userId ? `${userId}:digest` : null;
  if (throttleKey) {
    const sent = context.sentByUserChannel.get(throttleKey) ?? 0;
    if (context.maxPerUserChannel !== undefined && sent >= context.maxPerUserChannel) {
      return { channel: "digest", status: "throttled", error: "per-user/channel throttle exceeded" };
    }
  }

  const adapter = adapters.digest;
  if (!adapter) {
    return { channel: "digest", status: "failed", error: "notification adapter for digest is not configured" };
  }
  try {
    const receipt = await adapter.send({
      title: `${alerts.length} agent alert${alerts.length === 1 ? "" : "s"}`,
      body: alerts.map((alert) => alert.headline).join("\n"),
      alerts: alerts.map(alertPayloadItem),
    });
    if (throttleKey) context.sentByUserChannel.set(throttleKey, (context.sentByUserChannel.get(throttleKey) ?? 0) + 1);
    return {
      channel: "digest",
      status: "delivered",
      provider: receipt.provider,
      provider_message_id: receipt.provider_message_id,
    };
  } catch (error) {
    return { channel: "digest", status: "failed", error: errorMessage(error) };
  }
}

function blockedFactReceipt(
  channel: NotificationChannel,
  factRefs: ReadonlyArray<string>,
  entitlements: ReadonlyMap<string, ReadonlyArray<string>>,
): DeliveryChannelReceipt | null {
  const egress = egressChannelFor(channel);
  for (const factId of factRefs) {
    const allowed = entitlements.get(factId) ?? ["app"];
    if (!allowed.includes(egress)) {
      return { channel, status: "blocked", error: `fact ${factId} is not entitled for ${egress}` };
    }
  }
  return null;
}

function allowedByPreferences(
  alert: AlertForDelivery,
  preferences: ProcessPendingNotificationsInput["preferences"],
): ReadonlyArray<NotificationChannel> {
  let channels = alert.channels;
  const userChannels = preferences?.users?.[alert.user_id];
  if (userChannels) {
    const allowed = new Set(userChannels);
    channels = channels.filter((channel) => allowed.has(channel));
  }
  const agentChannels = preferences?.agents?.[alert.agent_id];
  if (agentChannels) {
    const allowed = new Set(agentChannels);
    channels = channels.filter((channel) => allowed.has(channel));
  }
  return channels;
}

function terminalStatusFor(
  receipts: ReadonlyArray<DeliveryChannelReceipt>,
  pendingDigest: boolean,
): "notified" | "failed" | null {
  if (pendingDigest) return null;
  return receipts.length > 0 && receipts.every((receipt) => receipt.status === "delivered") ? "notified" : "failed";
}

async function updateAlertDelivery(
  db: QueryExecutor,
  alertFiredId: string,
  status: "notified" | "failed",
  metadata: DeliveryMetadata,
): Promise<void> {
  await db.query(
    `update alerts_fired
        set status = $2,
            notification_delivery = $3::jsonb,
            delivery_attempts = delivery_attempts + 1,
            last_delivery_error = $4,
            last_delivery_at = $5::timestamptz
      where alert_fired_id = $1::uuid
        and status = 'delivering'`,
    [
      alertFiredId,
      status,
      JSON.stringify(metadata),
      status === "failed"
        ? metadata.channels.find((receipt) => receipt.error)?.error ?? "notification delivery failed"
        : null,
      metadata.delivered_at,
    ],
  );
}

function rowFromDb(row: AlertNotificationRow): AlertForDelivery {
  const finding = objectValue(row.finding, "finding");
  const triggerRefs = jsonArray(row.trigger_refs, "trigger_refs");
  const summaryBlocks = jsonArray(finding.summary_blocks ?? [], "summary_blocks");
  return Object.freeze({
    alert_fired_id: row.alert_fired_id,
    agent_id: row.agent_id,
    user_id: row.user_id,
    rule_id: row.rule_id,
    finding_id: row.finding_id,
    channels: notificationChannels(row.channels),
    trigger_refs: triggerRefs,
    fired_at: row.fired_at instanceof Date ? row.fired_at.toISOString() : row.fired_at,
    headline: stringValue(finding.headline, "finding.headline"),
    severity: stringValue(finding.severity, "finding.severity"),
    fact_refs: Object.freeze([...factRefsFromJson(triggerRefs), ...factRefsFromJson(summaryBlocks)]),
  });
}

function alertPayload(alert: AlertForDelivery): NotificationPayload {
  return {
    title: alert.headline,
    body: `${alert.severity.toUpperCase()}: ${alert.headline}`,
    alerts: [alertPayloadItem(alert)],
  };
}

function alertPayloadItem(alert: AlertForDelivery): NotificationPayload["alerts"][number] {
  return {
    alert_fired_id: alert.alert_fired_id,
    agent_id: alert.agent_id,
    finding_id: alert.finding_id,
    headline: alert.headline,
    severity: alert.severity,
  };
}

function egressChannelFor(channel: NotificationChannel): "app" | "email" | "push" {
  if (channel === "email") return "email";
  return channel === "digest" ? "push" : "push";
}

function notificationChannels(value: unknown): ReadonlyArray<NotificationChannel> {
  const values = stringArray(value, "channels");
  const channels: NotificationChannel[] = [];
  for (const channel of values) {
    if (!isNotificationChannel(channel)) {
      throw new Error(`unsupported notification channel ${channel}`);
    }
    if (!channels.includes(channel)) channels.push(channel);
  }
  return Object.freeze(channels);
}

function isNotificationChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

function factRefsFromJson(value: JsonValue): string[] {
  const refs: string[] = [];
  visitJson(value, (node) => {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const kind = "kind" in node ? node.kind : undefined;
      const id = "id" in node ? node.id : "fact_id" in node ? node.fact_id : undefined;
      if ((kind === "fact" || "fact_id" in node) && typeof id === "string" && isUuid(id)) refs.push(id);
    }
  });
  return [...new Set(refs)].sort();
}

function visitJson(value: JsonValue, visitor: (value: JsonValue) => void): void {
  visitor(value);
  if (Array.isArray(value)) {
    for (const child of value) visitJson(child, visitor);
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) visitJson(child, visitor);
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value).every(isJsonValue);
}

function stringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return Object.freeze([...value]);
}

function jsonArray(value: unknown, label: string): ReadonlyArray<JsonValue> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return Object.freeze(value as JsonValue[]);
}

function objectValue(value: unknown, label: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
