import assert from "node:assert/strict";
import test from "node:test";

import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";

test("a stalled SEC request is aborted after timeoutMs", async () => {
  // Holds the event loop open as a real socket would; AbortSignal.timeout's timer does not.
  const stalled: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const socket = setTimeout(() => {}, 60_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(socket);
        reject(init.signal!.reason);
      });
    });
  const fetcher = createSecCompanyFactsHttpFetcher({ userAgent: "test test@example.test", fetchImpl: stalled, timeoutMs: 20 });
  await assert.rejects(fetcher("/api/xbrl/companyfacts/CIK0000320193.json"), { name: "TimeoutError" });
});
