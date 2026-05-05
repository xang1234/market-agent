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
  env?: Record<string, string | undefined>;
};

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return signature && verifyTrustedUserIdSignature(userId, signature, secret) ? userId : null;
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

export function signTrustedUserId(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
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

function verifyTrustedUserIdSignature(userId: string, signature: string, secret: string): boolean {
  const expected = signTrustedUserId(userId, secret);
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeHeaderName(header: string): string {
  return header.trim().toLowerCase();
}
