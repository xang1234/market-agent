import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import { createDevApiServer, type DevApiServerOptions } from "../src/http.ts";
import { createDevCommodityDecisionAdapters } from "../src/commodities-fixtures.ts";

async function startServer(t: TestContext, options: DevApiServerOptions = {}): Promise<string> {
  const server = createDevApiServer(process.env, options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("dev API exposes balance, impact, and daily-call commodities endpoints through commodity decision adapters", async (t) => {
  const base = await startServer(t);

  for (const path of [
    "/v1/balances/snapshot",
    "/v1/balances/changes",
    "/v1/impact/events",
    "/v1/impact/drivers",
    "/v1/impact/graph",
    "/v1/briefs/daily",
  ]) {
    const response = await fetch(`${base}${path}`, {
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    });
    assert.equal(response.status, 200, `${path} should be wired`);
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  }
});

test("dev API commodities endpoints delegate to configured commodity decision adapters", async (t) => {
  const defaults = createDevCommodityDecisionAdapters();
  let snapshotCalls = 0;
  const base = await startServer(t, {
    commodityDecisionAdapters: {
      ...defaults,
      balances: {
        ...defaults.balances,
        snapshot() {
          snapshotCalls += 1;
          return defaults.balances.snapshot();
        },
      },
    },
  });

  const response = await fetch(`${base}/v1/balances/snapshot`, {
    headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
  });

  assert.equal(response.status, 200);
  assert.equal(snapshotCalls, 1);
});
