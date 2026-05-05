import type { IncomingMessage } from "node:http";

export const DEV_USER_ID_HEADER = "x-user-id";
export const TRUSTED_USER_ID_HEADER = "x-authenticated-user-id";

export type RequestAuthMode = "dev_user_header" | "trusted_proxy";

export type RequestAuthConfig = {
  mode?: RequestAuthMode;
  trustedUserIdHeader?: string;
  env?: Record<string, string | undefined>;
};

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readAuthenticatedUserId(
  req: IncomingMessage,
  config: RequestAuthConfig = {},
): string | null {
  const mode = resolveAuthMode(config);
  const header =
    mode === "trusted_proxy"
      ? normalizeHeaderName(config.trustedUserIdHeader ?? TRUSTED_USER_ID_HEADER)
      : DEV_USER_ID_HEADER;
  return readUuidHeader(req, header);
}

export function authenticatedUserRequiredMessage(
  config: RequestAuthConfig = {},
): string {
  const mode = resolveAuthMode(config);
  const header =
    mode === "trusted_proxy"
      ? normalizeHeaderName(config.trustedUserIdHeader ?? TRUSTED_USER_ID_HEADER)
      : DEV_USER_ID_HEADER;
  return `'${header}' header is required`;
}

export function resolveAuthMode(config: RequestAuthConfig = {}): RequestAuthMode {
  if (config.mode) return config.mode;
  const env = config.env ?? process.env;
  const explicit = env.MA_AUTH_MODE?.trim().toLowerCase();
  if (explicit === "trusted_proxy" || explicit === "production") return "trusted_proxy";
  if (explicit === "dev_user_header" || explicit === "dev" || explicit === "test") {
    return "dev_user_header";
  }
  return env.NODE_ENV === "production" ? "trusted_proxy" : "dev_user_header";
}

function readUuidHeader(req: IncomingMessage, header: string): string | null {
  const raw = req.headers[header];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return USER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeHeaderName(header: string): string {
  return header.trim().toLowerCase();
}
