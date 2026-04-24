import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createDevApiServer } from "../src/http.ts";

async function startServer(
  t: TestContext,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const server = createDevApiServer(env);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("health endpoint reports ok plus parsed flags", async (t) => {
  const base = await startServer(t, { MA_FLAG_SHOW_DEV_BANNER: "true" });

  const response = await fetch(`${base}/healthz`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.deepEqual(body.flags, {
    placeholderApiEnabled: true,
    showDevBanner: true,
  });
});

test("placeholder route returns 503 when placeholder API is disabled", async (t) => {
  const base = await startServer(t, { MA_FLAG_PLACEHOLDER_API: "false" });

  const response = await fetch(`${base}/v1/dev/placeholders`);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.error, "placeholder api disabled");
});
