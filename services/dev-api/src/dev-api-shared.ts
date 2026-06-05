// Cross-cutting primitives shared by the dev-api HTTP server (http.ts) and the
// per-domain adapter modules (analyze-adapter.ts, ...). This is a leaf module:
// it depends on nothing else in dev-api, so the adapter modules and http.ts can
// both depend on it without forming an import cycle. DevApiHttpError lives here
// (not in http.ts) so its single class definition is shared — the server's
// `instanceof DevApiHttpError` catch stays correct across modules.

import { isUuid } from "../../shared/src/subject-ref.ts";

export class DevApiHttpError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "DevApiHttpError";
    this.status = status;
    this.details = details;
  }
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRequiredUuidValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new DevApiHttpError(400, `${label} must be a UUID`);
  }
  return value;
}

export function stableUuid(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const suffix = hash.toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}
