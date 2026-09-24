import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { withTransaction } from "../../evidence/src/transaction.ts";
import { DiscoveryError } from "./types.ts";

export type Clock = () => Date;

export async function transaction<T>(db: QueryExecutor, action: (tx: QueryExecutor) => Promise<T>): Promise<T> {
  return withTransaction(db, async ({ db: tx }) => action(tx));
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DiscoveryError("validation", `${label} must be a UUID`);
  }
  return value;
}

export function requireText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max) {
    throw new DiscoveryError("validation", `${label} must be trimmed and between ${min} and ${max} characters`);
  }
  return value;
}

export function requireLimit(value: number, fallback: number): number {
  const limit = value === undefined ? fallback : value;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DiscoveryError("validation", "limit must be an integer between 1 and 100");
  return limit;
}

export function isoDate(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} contains an invalid timestamp`);
  return date.toISOString();
}

export function jsonValue<T>(value: unknown, label: string): T {
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { throw new Error(`${label} contains invalid JSON`); }
}

export function json(value: unknown): string { return JSON.stringify(value); }

type Cursor = { created_at: string; id: string };
export function decodeCursor(value: string | null): Cursor | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.created_at !== "string" || !Number.isFinite(Date.parse(parsed.created_at)) || typeof parsed.id !== "string") throw new Error();
    requireUuid(parsed.id, "cursor.id");
    return { created_at: new Date(parsed.created_at).toISOString(), id: parsed.id };
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError("validation", "cursor is invalid");
  }
}

export function encodeCursor(row: { created_at: Date | string; id: string }): string {
  const created_at = isoDate(row.created_at, "created_at");
  if (created_at === null) throw new Error("cursor timestamp is missing");
  return Buffer.from(JSON.stringify({ created_at, id: row.id })).toString("base64url");
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "23505" && (error as { constraint?: unknown }).constraint === constraint;
}
