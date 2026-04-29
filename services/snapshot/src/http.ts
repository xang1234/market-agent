import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  normalizeSnapshotTransformRequest,
  snapshotTransformBoundaryResponse,
  type SnapshotTransformManifest,
  type SnapshotTransformRequest,
} from "./snapshot-transform.ts";
import type { JsonObject } from "./manifest-staging.ts";

export type SnapshotTransformHttpResponse = JsonObject;

export type SnapshotTransformExecutionInput = {
  snapshot_id: string;
  manifest: SnapshotTransformManifest;
  request: SnapshotTransformRequest;
};

export type SnapshotServerDeps = {
  loadManifest(snapshotId: string): Promise<SnapshotTransformManifest | null>;
  executeTransform(input: SnapshotTransformExecutionInput): Promise<SnapshotTransformHttpResponse>;
  logger?: Pick<Console, "error">;
};

const MAX_TRANSFORM_BODY_BYTES = 64 * 1024;

export function createSnapshotServer(deps: SnapshotServerDeps): Server {
  const logger = deps.logger ?? console;

  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (route === null) {
        respond(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req, MAX_TRANSFORM_BODY_BYTES);
      if (body.kind === "error") {
        respond(res, body.status, { error: body.error });
        return;
      }
      if (!isRecord(body.value) || !isRecord(body.value.transform)) {
        respond(res, 400, { error: "'transform' is required and must be an object" });
        return;
      }
      let transformRequest: SnapshotTransformRequest;
      try {
        transformRequest = normalizeSnapshotTransformRequest(
          body.value.transform as SnapshotTransformRequest,
        );
      } catch (err) {
        respond(res, 400, { error: errorMessage(err, "invalid snapshot transform") });
        return;
      }

      const manifest = await deps.loadManifest(route.snapshot_id);
      if (manifest === null) {
        respond(res, 404, { error: "snapshot not found" });
        return;
      }

      let boundary;
      try {
        boundary = snapshotTransformBoundaryResponse({
          manifest,
          request: transformRequest,
        });
      } catch (err) {
        logger.error("invalid sealed snapshot manifest", err);
        respond(res, 500, { error: "invalid sealed snapshot manifest" });
        return;
      }

      if (!boundary.allowed) {
        respond(res, boundary.status, boundary.body);
        return;
      }

      const transformed = await deps.executeTransform({
        snapshot_id: route.snapshot_id,
        manifest,
        request: transformRequest,
      });
      respond(res, 200, transformed);
    } catch (error) {
      logger.error("snapshot transform request failed", error);
      if (!res.headersSent) respond(res, 500, { error: "internal snapshot error" });
    }
  });
}

type Route = {
  snapshot_id: string;
};

function matchRoute(method: string, rawUrl: string): Route | null {
  if (method !== "POST") return null;

  const url = new URL(rawUrl, "http://localhost");
  const match = url.pathname.match(/^\/v1\/snapshots\/([^/]+)\/transform$/);
  if (match === null) return null;

  let snapshot_id: string;
  try {
    snapshot_id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!isUuid(snapshot_id)) return null;
  return { snapshot_id };
}

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; status: number; error: string };

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return { kind: "error", status: 415, error: "content-type must be application/json" };
  }

  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      return { kind: "error", status: 413, error: `request body exceeds ${maxBytes} bytes` };
    }
    chunks.push(buf);
  }

  if (total === 0) {
    return { kind: "error", status: 400, error: "request body is empty" };
  }

  const text = Buffer.concat(chunks, total).toString("utf8");
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (err) {
    return { kind: "error", status: 400, error: `invalid JSON: ${errorMessage(err, "parse failed")}` };
  }
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}
