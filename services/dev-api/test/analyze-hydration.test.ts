import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import { SecEdgarFetchError } from "../../fundamentals/src/sec-edgar.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { hydrateAnalyzeIssuers } from "../src/local-runtime.ts";

const ISSUER = "33333333-3333-4333-8333-333333333333";
const unavailable = async () => {
  throw new SecEdgarFetchError(503, "sec_edgar: HTTP 503");
};

test("a failed SEC fetch is logged and leaves the memo to the engine's gap", async () => {
  const db = { query: async () => ({ rows: [{ issuer_id: ISSUER, cik: "320193" }] }) } as unknown as Pool;
  const warnings: unknown[][] = [];
  await hydrateAnalyzeIssuers(db, unavailable, new Map([[ISSUER, 1]]), { warn: (...args: unknown[]) => warnings.push(args) });
  assert.deepEqual(warnings.at(-1), [
    "analyze SEC hydration failed; the engine reports the gap",
    { issuer_id: ISSUER, reason: "provider_error", error: "sec_edgar: HTTP 503" },
  ]);
});

test("a database failure reading the issuer is not swallowed", async () => {
  const db = { query: async () => { throw new Error("connection refused"); } } as unknown as Pool;
  await assert.rejects(hydrateAnalyzeIssuers(db, unavailable, new Map([[ISSUER, 1]]), { warn() {} }), /connection refused/u);
});

test("a database failure while storing fetched SEC facts is not swallowed", async () => {
  const db = {
    query: async (text: string) => {
      if (text.includes("from issuers")) return { rows: [{ issuer_id: ISSUER, cik: "320193" }] };
      throw new Error("deadlock detected");
    },
  } as unknown as Pool;
  const revenue = { start: "2024-01-01", end: "2024-12-31", val: 391, accn: "0000320193-25-000006", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" };
  const fetcher = secCompanyFetcher(() => ({ cik: 320193, entityName: "Example Corp", facts: { "us-gaap": { Revenues: { label: "", description: "", units: { USD: [revenue] } } } } }));
  await assert.rejects(hydrateAnalyzeIssuers(db, fetcher, new Map([[ISSUER, 1]]), { warn() {} }), /deadlock detected/u);
});

test("the frozen golden issuers are never repaired from live SEC", async () => {
  const touched: string[] = [];
  const db = { query: async (text: string) => { touched.push(text); return { rows: [] }; } } as unknown as Pool;
  const fetcher = async (path: string) => { touched.push(path); throw new Error("no fetch expected"); };
  await hydrateAnalyzeIssuers(db, fetcher, new Map(Object.values(GOLDEN_ISSUER_IDS).map((id) => [id, 2])), { warn() {} });
  assert.deepEqual(touched, []);
});
