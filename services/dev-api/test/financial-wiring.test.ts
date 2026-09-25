import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { FinancialPool } from "../../financial-engine/src/http.ts";
import { createFinancialDevApiAdapter, developmentHeaderAuthenticator } from "../src/financial-wiring.ts";

function fakePool(queries: string[]): FinancialPool {
  const query = async (text: string) => {
    queries.push(text);
    return { rows: [] };
  };
  return { query, connect: async () => ({ query, release() {} }) } as unknown as FinancialPool;
}

async function serve(queries: string[]) {
  const adapter = createFinancialDevApiAdapter({ db: fakePool(queries), authenticate: developmentHeaderAuthenticator });
  const server = createServer((req, res) => {
    void adapter.handle(req, res).then((handled) => {
      if (!handled) { res.statusCode = 418; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("financial routes require an identity before touching the database", async () => {
  const queries: string[] = [];
  const { base, close } = await serve(queries);
  try {
    const anonymous: Array<Record<string, string>> = [{}, { "x-user-id": "" }, { "x-user-id": "alice" }, { "x-user-id": "1' or '1'='1" }];
    for (const headers of anonymous) {
      const response = await fetch(`${base}/v1/financial/runs/${randomUUID()}`, { headers });
      assert.equal(response.status, 401, JSON.stringify(headers));
      assert.deepEqual(await response.json(), { error: "authentication is required", code: "unauthenticated" });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.deepEqual(queries, []);

    const owned = await fetch(`${base}/v1/financial/runs/${randomUUID()}`, { headers: { "x-user-id": randomUUID() } });
    assert.equal(owned.status, 404, "an authenticated caller reaches the owner-scoped handler");
    assert.ok(queries.length > 0);

    assert.equal((await fetch(`${base}/v1/discovery/campaigns`)).status, 418, "other routes pass through");
  } finally {
    await close();
  }
});
