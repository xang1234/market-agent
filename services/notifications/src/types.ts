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
