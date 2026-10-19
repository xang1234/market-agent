import type { IncomingMessage, ServerResponse } from "node:http";

export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; status: number; error: string };

export function respondJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export async function readBody(
  req: AsyncIterable<Uint8Array | string>,
  { maxBytes }: { maxBytes: number },
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonBody(
  req: IncomingMessage,
  { maxBytes }: { maxBytes: number },
): Promise<JsonBodyResult> {
  const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return { kind: "error", status: 415, error: "content-type must be application/json" };
  }
  let text: string;
  try {
    text = await readBody(req, { maxBytes });
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) throw error;
    return { kind: "error", status: 413, error: `request body exceeds ${maxBytes} bytes` };
  }
  if (text === "") {
    return { kind: "error", status: 400, error: "request body is empty" };
  }
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (error) {
    return { kind: "error", status: 400, error: `invalid JSON: ${errorMessageOr(error, "parse failed")}` };
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorMessageOr(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
