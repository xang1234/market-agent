/** Postgres/driver failures carry a SQLSTATE code or a connection error code. */
export function isDatabaseError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return /^[0-9A-Z]{5}$/u.test(code) || code.startsWith("ECONN") || code === "ETIMEDOUT";
}
