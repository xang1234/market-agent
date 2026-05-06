import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { signTrustedUserId } from "../../shared/src/request-auth.ts";
import { createWatchlistsServer } from "../src/http.ts";
import type { QueryExecutor } from "../src/queries.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const TRUSTED_PROXY_SECRET = "watchlists-auth-test-secret";
const TRUSTED_PROXY_NOW = new Date("2026-05-06T00:00:00.000Z");

async function startServer(t: TestContext): Promise<string> {
  const db: QueryExecutor = {
    async query() {
      throw new Error("auth-rejected requests must not query the database");
    },
  };
  const server = createWatchlistsServer(db, {
    auth: {
      mode: "trusted_proxy",
      trustedProxySecret: TRUSTED_PROXY_SECRET,
      trustedProxyClock: () => TRUSTED_PROXY_NOW,
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("trusted-proxy auth rejects expired and tampered watchlist signatures before DB access", async (t) => {
  const base = await startServer(t);
  const fresh = signTrustedUserId(USER_ID, TRUSTED_PROXY_SECRET, { issuedAt: TRUSTED_PROXY_NOW });
  const tamperedTimestamp = fresh.replace(":1778025600000:", ":1778022000000:");
  const expired = signTrustedUserId(USER_ID, TRUSTED_PROXY_SECRET, {
    issuedAt: new Date("2026-05-05T23:54:00.000Z"),
  });

  for (const signature of [tamperedTimestamp, expired]) {
    const response = await fetch(`${base}/v1/watchlists/default/members`, {
      headers: {
        "x-authenticated-user-id": USER_ID,
        "x-authenticated-user-signature": signature,
      },
    });
    assert.equal(response.status, 401);
  }
});
