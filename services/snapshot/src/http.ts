import { createServer, type Server } from "node:http";

import {
  normalizeSnapshotTransformRequest,
  snapshotTransformBoundaryResponse,
  type SnapshotTransformManifest,
  type SnapshotTransformRequest,
} from "./snapshot-transform.ts";
import type { JsonObject } from "./manifest-staging.ts";
import { errorMessageOr, isRecord, readJsonBody, respondJson } from "../../shared/src/http.ts";

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
        respondJson(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req, { maxBytes: MAX_TRANSFORM_BODY_BYTES });
      if (body.kind === "error") {
        respondJson(res, body.status, { error: body.error });
        return;
      }
      if (!isRecord(body.value) || !isRecord(body.value.transform)) {
        respondJson(res, 400, { error: "'transform' is required and must be an object" });
        return;
      }
      let transformRequest: SnapshotTransformRequest;
      try {
        transformRequest = normalizeSnapshotTransformRequest(
          body.value.transform as SnapshotTransformRequest,
        );
      } catch (err) {
        respondJson(res, 400, { error: errorMessageOr(err, "invalid snapshot transform") });
        return;
      }

      const manifest = await deps.loadManifest(route.snapshot_id);
      if (manifest === null) {
        respondJson(res, 404, { error: "snapshot not found" });
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
        respondJson(res, 500, { error: "invalid sealed snapshot manifest" });
        return;
      }

      if (!boundary.allowed) {
        respondJson(res, boundary.status, boundary.body);
        return;
      }

      const transformed = await deps.executeTransform({
        snapshot_id: route.snapshot_id,
        manifest,
        request: transformRequest,
      });
      respondJson(res, 200, transformed);
    } catch (error) {
      logger.error("snapshot transform request failed", error);
      if (!res.headersSent) respondJson(res, 500, { error: "internal snapshot error" });
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

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}
