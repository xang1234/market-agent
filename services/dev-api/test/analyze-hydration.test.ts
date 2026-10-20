import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import { SecEdgarFetchError } from "../../fundamentals/src/sec-edgar.ts";
import { hydrateAnalyzeIssuers } from "../src/local-runtime.ts";

const ISSUER = "33333333-3333-4333-8333-333333333333";
const unavailable = async () => {
  throw new SecEdgarFetchError(503, "sec_edgar: HTTP 503");
};

test("a failed SEC fetch is logged and leaves the memo to the engine's gap", async () => {
  const db = { query: async () => ({ rows: [{ issuer_id: ISSUER, cik: "320193" }] }) } as unknown as Pool;
  const warnings: unknown[][] = [];
  await hydrateAnalyzeIssuers(db, unavailable, [ISSUER], { warn: (...args: unknown[]) => warnings.push(args) });
  assert.deepEqual(warnings.at(-1), ["analyze SEC hydration failed; the engine reports the gap", { issuer_id: ISSUER, reason: "provider_error" }]);
});

test("a database failure while hydrating is not swallowed", async () => {
  const db = { query: async () => { throw new Error("connection refused"); } } as unknown as Pool;
  await assert.rejects(hydrateAnalyzeIssuers(db, unavailable, [ISSUER], { warn() {} }), /connection refused/u);
});
