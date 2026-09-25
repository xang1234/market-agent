// Deterministic identifiers and content hashes for chat turns, messages, and
// blocks, so a retried turn addresses the same rows.

import { createHash } from "node:crypto";

export function contentHashForText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
