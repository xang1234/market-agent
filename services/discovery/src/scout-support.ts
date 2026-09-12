import { createHash } from "node:crypto";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { DiscoveryError, type Coverage, type Id } from "./types.ts";

export function addGap(coverage: Coverage, code: string, candidate_id: Id | null, detail: string): void {
  coverage.gaps.push({ code, candidate_id, detail: detail.slice(0, 300) });
}

export function requestHash(value: unknown): string {
  return hashJsonValue(value as never);
}

export function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

export function budgetStopped(error: unknown): boolean {
  return error instanceof DiscoveryError && error.code === "budget_exhausted";
}

export function stageControlError(error: unknown): boolean {
  return error instanceof DiscoveryError && error.code !== "budget_exhausted";
}

export function compareFirstSeen(left: [number, number], right: [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

export function union<T>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])];
}
