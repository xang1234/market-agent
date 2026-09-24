export type ProviderRequestErrorCode =
  | "missing_configuration"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "invalid_response";

export class ProviderRequestError extends Error {
  readonly code: ProviderRequestErrorCode;

  constructor(code: ProviderRequestErrorCode, message: string) {
    super(message);
    this.name = "ProviderRequestError";
    this.code = code;
  }
}
