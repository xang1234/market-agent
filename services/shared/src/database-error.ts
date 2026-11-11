// Every SQLSTATE class has a digit (08, 22, 40, 57, HV00x, P0, XX), so a
// five-letter errno such as EPERM or EBADF does not pass for one.
const SQLSTATE = /^(?=.*[0-9])[0-9A-Z]{5}$/u;

const CONNECTION_ERRNOS = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]);

// pg's client raises these with no code (pg/lib/client.js).
const PG_CONNECTION_MESSAGES = new Set([
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Query read timeout",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
]);

/** Postgres/driver failures: a SQLSTATE, a connection errno, or pg's code-less connection errors. */
export function isDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return SQLSTATE.test(code) || CONNECTION_ERRNOS.has(code);
  return PG_CONNECTION_MESSAGES.has(error.message);
}
