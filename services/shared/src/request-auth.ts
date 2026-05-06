import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const DEV_USER_ID_HEADER = "x-user-id";
export const TRUSTED_USER_ID_HEADER = "x-authenticated-user-id";
export const TRUSTED_USER_SIGNATURE_HEADER = "x-authenticated-user-signature";

export type RequestAuthMode = "dev_user_header" | "trusted_proxy";

export type RequestAuthConfig = {
  mode?: RequestAuthMode;
  trustedUserIdHeader?: string;
  trustedUserSignatureHeader?: string;
  trustedProxySecret?: string;
  trustedProxyMaxAgeMs?: number;
  trustedProxyClock?: () => Date;
  // Rollout-only compatibility for pre-fra-en8 signatures, which were
  // HMAC(user_id) with no freshness data. Keep false in production once
  // every proxy caller has moved to signTrustedUserId() v1 tokens.
  trustedProxyAllowLegacySignatures?: boolean;
  env?: Record<string, string | undefined>;
};

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUSTED_PROXY_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const TRUSTED_PROXY_SIGNATURE_FUTURE_SKEW_MS = 60 * 1000;

export function readAuthenticatedUserId(
  req: IncomingMessage,
  config: RequestAuthConfig = {},
): string | null {
  const mode = resolveAuthMode(config);
  if (mode !== "trusted_proxy") {
    return readUuidHeader(req, DEV_USER_ID_HEADER);
  }

  const userIdHeader = normalizeHeaderName(config.trustedUserIdHeader ?? TRUSTED_USER_ID_HEADER);
  const signatureHeader = normalizeHeaderName(
    config.trustedUserSignatureHeader ?? TRUSTED_USER_SIGNATURE_HEADER,
  );
  const userId = readUuidHeader(req, userIdHeader);
  if (userId === null) return null;

  const secret = readTrustedProxySecret(config);
  if (secret === null) return null;

  const signature = readStringHeader(req, signatureHeader);
  return signature && verifyTrustedUserIdSignature(userId, signature, secret, config) ? userId : null;
}

export function authenticatedUserRequiredMessage(
  config: RequestAuthConfig = {},
): string {
  const mode = resolveAuthMode(config);
  const header =
    mode === "trusted_proxy"
      ? `${normalizeHeaderName(config.trustedUserIdHeader ?? TRUSTED_USER_ID_HEADER)} and ${normalizeHeaderName(config.trustedUserSignatureHeader ?? TRUSTED_USER_SIGNATURE_HEADER)}`
      : DEV_USER_ID_HEADER;
  return mode === "trusted_proxy"
    ? `'${header}' headers are required`
    : `'${header}' header is required`;
}

export type SignTrustedUserIdOptions = {
  issuedAt?: Date;
  legacy?: boolean;
};

export function signTrustedUserId(
  userId: string,
  secret: string,
  options: SignTrustedUserIdOptions = {},
): string {
  if (options.legacy === true) return hmacHex(secret, userId);
  const issuedAt = options.issuedAt ?? new Date();
  const issuedAtMs = issuedAt.getTime();
  if (!Number.isFinite(issuedAtMs)) {
    throw new Error("signTrustedUserId.issuedAt: must be a valid Date");
  }
  const timestamp = String(Math.trunc(issuedAtMs));
  return `v1:${timestamp}:${trustedProxySignatureDigest(userId, secret, timestamp)}`;
}

export function resolveAuthMode(config: RequestAuthConfig = {}): RequestAuthMode {
  if (config.mode) return config.mode;
  const env = config.env ?? process.env;
  const explicit = env.MA_AUTH_MODE?.trim().toLowerCase();
  if (explicit !== undefined && explicit !== "") {
    if (explicit === "trusted_proxy" || explicit === "production") return "trusted_proxy";
    if (explicit === "dev_user_header" || explicit === "dev" || explicit === "test") {
      return "dev_user_header";
    }
    throw new Error(
      `unrecognized MA_AUTH_MODE '${env.MA_AUTH_MODE}'; expected trusted_proxy, production, dev_user_header, dev, or test`,
    );
  }
  return env.NODE_ENV === "production" ? "trusted_proxy" : "dev_user_header";
}

function readUuidHeader(req: IncomingMessage, header: string): string | null {
  const value = readStringHeader(req, header);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return USER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function readStringHeader(req: IncomingMessage, header: string): string | null {
  const raw = req.headers[header];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readTrustedProxySecret(config: RequestAuthConfig): string | null {
  const secret = config.trustedProxySecret ?? (config.env ?? process.env).MA_AUTH_PROXY_SECRET;
  if (typeof secret !== "string") return null;
  const trimmed = secret.trim();
  return trimmed === "" ? null : trimmed;
}

function verifyTrustedUserIdSignature(
  userId: string,
  signature: string,
  secret: string,
  config: RequestAuthConfig,
): boolean {
  if (/^[0-9a-f]{64}$/i.test(signature)) {
    return config.trustedProxyAllowLegacySignatures === true &&
      constantTimeHexEqual(signature, hmacHex(secret, userId));
  }

  const match = signature.match(/^v1:(\d{13,}):([0-9a-f]{64})$/i);
  if (!match) return false;

  const timestamp = match[1]!;
  const actualDigest = match[2]!;
  const issuedAtMs = Number(timestamp);
  if (!Number.isSafeInteger(issuedAtMs)) return false;

  const nowMs = (config.trustedProxyClock ?? (() => new Date()))().getTime();
  if (!Number.isFinite(nowMs)) return false;
  const maxAgeMs = config.trustedProxyMaxAgeMs ?? TRUSTED_PROXY_SIGNATURE_MAX_AGE_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  if (issuedAtMs > nowMs + TRUSTED_PROXY_SIGNATURE_FUTURE_SKEW_MS) return false;
  if (nowMs - issuedAtMs > maxAgeMs) return false;

  return constantTimeHexEqual(
    actualDigest,
    trustedProxySignatureDigest(userId, secret, timestamp),
  );
}

function trustedProxySignatureDigest(userId: string, secret: string, timestamp: string): string {
  return hmacHex(secret, `${userId}:${timestamp}`);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function constantTimeHexEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actual)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeHeaderName(header: string): string {
  return header.trim().toLowerCase();
}
