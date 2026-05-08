import { fileURLToPath } from "node:url";

import {
  createConfiguredNotificationAdapters,
  processPendingNotifications,
  type NotificationAdapters,
  type NotificationQueryExecutor,
  type ProcessPendingNotificationsResult,
} from "./delivery-processor.ts";

export type NotificationWorkerInput = {
  db: NotificationQueryExecutor;
  adapters: NotificationAdapters;
  claimTimeoutMs?: number;
  limit?: number;
  now?: () => string;
};

export async function runNotificationWorkerOnce(
  input: NotificationWorkerInput,
): Promise<ProcessPendingNotificationsResult> {
  return processPendingNotifications(input.db, {
    adapters: input.adapters,
    claimTimeoutMs: input.claimTimeoutMs,
    limit: input.limit,
    now: input.now,
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.NOTIFICATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL or NOTIFICATIONS_DATABASE_URL is required");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await runNotificationWorkerOnce({
      db: pool,
      adapters: createConfiguredNotificationAdapters(process.env),
      limit: integerEnv("NOTIFICATIONS_WORKER_LIMIT") ?? 100,
      claimTimeoutMs: integerEnv("NOTIFICATIONS_CLAIM_TIMEOUT_MS") ?? 15 * 60_000,
    });
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

function integerEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  return parsed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
