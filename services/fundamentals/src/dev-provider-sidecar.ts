import {
  AVAILABILITY_REASONS,
  FundamentalsDataUnavailableError,
  type AvailabilityReason,
} from "./availability.ts";

export const DEFAULT_DEV_PROVIDER_TIMEOUT_MS = 5_000;

export type DevProviderSidecarOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type SidecarEnvelope =
  | {
      status: "available";
      data?: unknown;
    }
  | {
      status: "unavailable";
      reason?: unknown;
      retryable?: unknown;
      detail?: unknown;
    };

export async function postSidecar(input: {
  baseUrl: string;
  path: string;
  body: unknown;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<SidecarEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(new URL(input.path, input.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw sidecarHttpError(input.path, response.status);
    }
    return parseSidecarEnvelope(await response.json(), input.path);
  } catch (error) {
    if (error instanceof FundamentalsDataUnavailableError) throw error;
    throw new FundamentalsDataUnavailableError(
      "provider_error",
      `dev providers sidecar request failed for ${input.path}: ${errorMessage(error)}`,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function sidecarUnavailableReason(envelope: SidecarEnvelope): AvailabilityReason {
  if (envelope.status !== "unavailable") return "provider_error";
  return isAvailabilityReason(envelope.reason) ? envelope.reason : "provider_error";
}

export function sidecarUnavailableError(
  envelope: Extract<SidecarEnvelope, { status: "unavailable" }>,
  providerLabel: string,
): FundamentalsDataUnavailableError {
  const reason = sidecarUnavailableReason(envelope);
  return new FundamentalsDataUnavailableError(
    reason,
    stringValue(envelope.detail) ?? `${providerLabel} unavailable`,
    typeof envelope.retryable === "boolean" ? envelope.retryable : reason !== "missing_coverage",
  );
}

export function providerPayloadError(
  providerLabel: string,
  detail: string,
  retryable = false,
): FundamentalsDataUnavailableError {
  return new FundamentalsDataUnavailableError(
    "provider_error",
    `${providerLabel}: malformed ${detail}`,
    retryable,
  );
}

function parseSidecarEnvelope(value: unknown, path: string): SidecarEnvelope {
  if (!isRecord(value)) {
    throw providerPayloadError("dev providers sidecar", `availability envelope for ${path}`);
  }
  const status = value.status;
  if (status === "available") {
    return { status, data: value.data };
  }
  if (status === "unavailable") {
    return {
      status,
      reason: value.reason,
      retryable: value.retryable,
      detail: value.detail,
    };
  }
  throw providerPayloadError("dev providers sidecar", `availability envelope for ${path}`);
}

function sidecarHttpError(path: string, status: number): FundamentalsDataUnavailableError {
  if (status === 429) {
    return new FundamentalsDataUnavailableError(
      "rate_limited",
      `dev providers sidecar HTTP 429 for ${path}`,
      true,
    );
  }
  return new FundamentalsDataUnavailableError(
    "provider_error",
    `dev providers sidecar HTTP ${status} for ${path}`,
    status >= 500,
  );
}

function isAvailabilityReason(value: unknown): value is AvailabilityReason {
  return typeof value === "string" && AVAILABILITY_REASONS.includes(value as AvailabilityReason);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
