import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import {
  createSnapshotServer,
  type SnapshotServerDeps,
  type SnapshotTransformHttpResponse,
} from "../src/http.ts";
import type {
  SnapshotTransformManifest,
  SnapshotTransformRequest,
} from "../src/snapshot-transform.ts";

const snapshotId = "00000000-0000-4000-8000-000000000010";
const listingId = "00000000-0000-4000-8000-000000000001";
const subject_refs = Object.freeze([
  Object.freeze({ kind: "listing" as const, id: listingId }),
]);
const allowedRange = Object.freeze({
  start: "2026-04-01T00:00:00.000Z",
  end: "2026-04-29T00:00:00.000Z",
});

async function startServer(t: TestContext, deps: SnapshotServerDeps): Promise<string> {
  const server = createSnapshotServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("POST /v1/snapshots/:id/transform returns refresh_required.peer_set without executing transforms", async (t) => {
  let executed = false;
  const base = await startServer(t, {
    loadManifest: async (id) => (id === snapshotId ? sealedManifest() : null),
    executeTransform: async () => {
      executed = true;
      return { series: [] };
    },
  });

  const res = await postTransform(base, snapshotId, {
    kind: "series",
    subject_refs: [{ kind: "listing", id: "00000000-0000-4000-8000-000000000002" }],
    range: allowedRange,
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
  });

  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    error: "refresh_required",
    refresh_required: { reason: "peer_set" },
  });
  assert.equal(executed, false);
});

test("POST /v1/snapshots/:id/transform maps every refresh boundary reason without executing transforms", async (t) => {
  const futureRange = {
    start: "2026-04-01T00:00:00.000Z",
    end: "2026-04-30T00:00:00.000Z",
  };
  const cases = [
    ["basis", { basis: "unadjusted" }],
    ["normalization", { normalization: "pct_return" }],
    ["freshness", { range: futureRange }],
    [
      "transform",
      {
        range: {
          start: "2026-04-02T00:00:00.000Z",
          end: "2026-04-29T00:00:00.000Z",
        },
      },
    ],
  ] as const;

  for (const [reason, overrides] of cases) {
    let executed = false;
    const base = await startServer(t, {
      loadManifest: async (id) =>
        id === snapshotId
          ? sealedManifest({
              allowed_transforms: { series: [{ range: futureRange, interval: "1d" }] },
            })
          : null,
      executeTransform: async () => {
        executed = true;
        return { series: [] };
      },
    });

    const res = await postTransform(base, snapshotId, validTransform(overrides));

    assert.equal(res.status, 409, `${reason} should be rejected`);
    assert.deepEqual(await res.json(), {
      error: "refresh_required",
      refresh_required: { reason },
    });
    assert.equal(executed, false, `${reason} should not execute`);
  }
});

test("POST /v1/snapshots/:id/transform delegates legal transforms to the executor", async (t) => {
  let executedWithSnapshotId: string | null = null;
  const base = await startServer(t, {
    loadManifest: async (id) => (id === snapshotId ? sealedManifest() : null),
    executeTransform: async ({ snapshot_id }) => {
      executedWithSnapshotId = snapshot_id;
      return { series: [{ x: "2026-04-29T00:00:00.000Z", y: 1 }] };
    },
  });

  const res = await postTransform(base, snapshotId, {
    kind: "series",
    subject_refs,
    range: allowedRange,
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as SnapshotTransformHttpResponse;
  assert.deepEqual(body, {
    series: [{ x: "2026-04-29T00:00:00.000Z", y: 1 }],
  });
  assert.equal(executedWithSnapshotId, snapshotId);
});

test("POST /v1/snapshots/:id/transform passes a canonical whitelisted request to the executor", async (t) => {
  let executedRequest: SnapshotTransformRequest | null = null;
  const base = await startServer(t, {
    loadManifest: async (id) => (id === snapshotId ? sealedManifest() : null),
    executeTransform: async ({ request }) => {
      executedRequest = request;
      return { series: [] };
    },
  });

  const res = await postTransform(base, snapshotId, {
    kind: "series",
    subject_refs,
    range: {
      start: "2026-04-01T08:00:00+08:00",
      end: "2026-04-29T08:00:00+08:00",
    },
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
    ignored: "not part of the checked contract",
  });

  assert.equal(res.status, 200);
  assert.deepEqual(executedRequest, {
    kind: "series",
    subject_refs,
    range: {
      start: "2026-04-01T00:00:00.000000000Z",
      end: "2026-04-29T00:00:00.000000000Z",
    },
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
  });
});

test("POST /v1/snapshots/:id/transform reports invalid persisted manifests as server errors", async (t) => {
  let executed = false;
  const base = await startServer(t, {
    loadManifest: async (id) =>
      id === snapshotId ? sealedManifest({ allowed_transforms: null }) : null,
    executeTransform: async () => {
      executed = true;
      return { series: [] };
    },
    logger: { error: () => undefined },
  });

  const res = await postTransform(base, snapshotId, validTransform());

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "invalid sealed snapshot manifest" });
  assert.equal(executed, false);
});

async function postTransform(
  base: string,
  id: string,
  transform: unknown,
): Promise<Response> {
  return fetch(`${base}/v1/snapshots/${id}/transform`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transform }),
  });
}

function validTransform(
  overrides: Partial<SnapshotTransformRequest> = {},
): SnapshotTransformRequest {
  return {
    kind: "series",
    subject_refs,
    range: allowedRange,
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
    ...overrides,
  };
}

function sealedManifest(
  overrides: Partial<SnapshotTransformManifest> = {},
): SnapshotTransformManifest {
  return Object.freeze({
    subject_refs,
    as_of: "2026-04-29T00:00:00.000Z",
    basis: "split_adjusted",
    normalization: "raw",
    allowed_transforms: Object.freeze({
      series: Object.freeze([
        Object.freeze({
          range: allowedRange,
          interval: "1d",
        }),
      ]),
    }),
    ...overrides,
  });
}
