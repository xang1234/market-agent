import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { signTrustedUserId } from "../../shared/src/request-auth.ts";
import { createHomeServer } from "../src/http.ts";
import type { HomeQuoteProvider, HomeSavedScreensProvider } from "../src/secondary-types.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function fakeDb(): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(_text: string, _values?: unknown[]) {
      return {
        rows: [] as R[],
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
      };
    },
  };
}

function emptyQuoteProvider(): HomeQuoteProvider {
  return async () => [];
}

const emptySavedScreens: HomeSavedScreensProvider = async () => [];

async function startServer(options: Parameters<typeof createHomeServer>[2] = {}) {
  const server = createHomeServer(fakeDb(), {
    quoteProvider: emptyQuoteProvider(),
    listSavedScreens: emptySavedScreens,
    pulseSubjects: [],
  }, options);
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

test("an unrecognized MA_AUTH_MODE fails when the home server is built", () => {
  assert.throws(
    () => createHomeServer(fakeDb(), { quoteProvider: emptyQuoteProvider(), listSavedScreens: emptySavedScreens, pulseSubjects: [] }, {
      auth: { env: { MA_AUTH_MODE: "prod" } },
    }),
    /unrecognized MA_AUTH_MODE 'prod'/,
  );
});

test("GET /v1/home/summary requires the x-user-id header", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/summary`);
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("GET /v1/home/summary rejects malformed x-user-id", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/summary`, {
      headers: { "x-user-id": "not-a-uuid" },
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("GET /v1/home/summary rejects a user id that is not a v4 UUID", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/summary`, {
      headers: { "x-user-id": "0195b46a-8e80-7000-8000-000000000001" },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "'x-user-id' header is required" });
  } finally {
    await close();
  }
});

test("GET /v1/home/summary in trusted_proxy mode accepts only a signed user id", async () => {
  const { port, close } = await startServer({
    auth: { env: { MA_AUTH_MODE: "trusted_proxy", MA_AUTH_PROXY_SECRET: "proxy-secret" } },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/summary`, {
      headers: { "x-user-id": USER_ID, "x-authenticated-user-id": USER_ID },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      error: "'x-authenticated-user-id and x-authenticated-user-signature' headers are required",
    });

    const signed = await fetch(`http://127.0.0.1:${port}/v1/home/summary`, {
      headers: {
        "x-authenticated-user-id": USER_ID,
        "x-authenticated-user-signature": signTrustedUserId(USER_ID, "proxy-secret"),
      },
    });
    assert.equal(signed.status, 200);
  } finally {
    await close();
  }
});

test("GET /v1/home/summary returns the summary envelope on the happy path", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/summary`, {
      headers: { "x-user-id": USER_ID },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(typeof body.generated_at === "string");
    assert.ok(typeof body.findings === "object");
    assert.ok(typeof body.market_pulse === "object");
    assert.ok(typeof body.watchlist_movers === "object");
    assert.ok(typeof body.agent_summaries === "object");
    assert.ok(typeof body.saved_screens === "object");
  } finally {
    await close();
  }
});

test("unknown routes return 404 even when the x-user-id header is missing", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/something-else`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test("/healthz does not require x-user-id", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/healthz`);
    assert.equal(res.status, 200);
  } finally {
    await close();
  }
});

test("GET /v1/home/summary maps section throws to 500", async () => {
  const throwingDb: QueryExecutor = {
    async query() {
      throw new Error("boom");
    },
  };
  const server = createHomeServer(throwingDb, {
    quoteProvider: emptyQuoteProvider(),
    listSavedScreens: emptySavedScreens,
    pulseSubjects: [],
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/home/summary`, {
      headers: { "x-user-id": USER_ID },
    });
    assert.equal(res.status, 500);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
