import type { LlmRole } from "./roles.ts";

export type LlmErrorCode =
  | "llm_credential_missing"
  | "llm_auth_failed"
  | "llm_rate_limited"
  | "llm_transport_error"
  | "llm_bad_response"
  | "llm_master_key_missing";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;
  readonly providerId?: string;
  readonly role?: LlmRole;
  readonly cause?: unknown;

  constructor(
    code: LlmErrorCode,
    message: string,
    options: { status?: number; providerId?: string; role?: LlmRole; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerId !== undefined) this.providerId = options.providerId;
    if (options.role !== undefined) this.role = options.role;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export class LlmCredentialMissingError extends LlmError {
  constructor(role: LlmRole) {
    super("llm_credential_missing", `no llm credential configured for role '${role}'`, { role });
    this.name = "LlmCredentialMissingError";
  }
}

export class LlmMasterKeyMissingError extends LlmError {
  constructor() {
    super(
      "llm_master_key_missing",
      "LLM_MASTER_ENCRYPTION_KEY is required to read or write llm credentials",
    );
    this.name = "LlmMasterKeyMissingError";
  }
}

export class LlmAuthError extends LlmError {
  constructor(message: string, options: { status: number; providerId?: string; cause?: unknown }) {
    super("llm_auth_failed", message, options);
    this.name = "LlmAuthError";
  }
}

export class LlmRateLimitError extends LlmError {
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { status: number; providerId?: string; retryAfterMs?: number; cause?: unknown },
  ) {
    super("llm_rate_limited", message, options);
    this.name = "LlmRateLimitError";
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

export class LlmTransportError extends LlmError {
  constructor(message: string, options: { providerId?: string; cause?: unknown } = {}) {
    super("llm_transport_error", message, options);
    this.name = "LlmTransportError";
  }
}

export class LlmBadResponseError extends LlmError {
  constructor(message: string, options: { providerId?: string; cause?: unknown } = {}) {
    super("llm_bad_response", message, options);
    this.name = "LlmBadResponseError";
  }
}
