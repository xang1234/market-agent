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
const issuerOnly = { query: async (text: string) => ({ rows: text.includes("from issuers") ? [{ issuer_id: ISSUER, cik: "320193" }] : [] }) } as unknown as Pool;

test("a failed SEC fetch is logged and leaves the memo to the engine's gap", async () => {
  const warnings: unknown[][] = [];
  await hydrateAnalyzeIssuers(issuerOnly, unavailable, new Map([[ISSUER, new Map([["revenue", 1]])]]), { warn: (...args: unknown[]) => warnings.push(args) });
  assert.deepEqual(warnings.at(-1), [
    "analyze SEC hydration failed; the engine reports the gap",
    { issuer_id: ISSUER, reason: "provider_error", error: "sec_edgar: HTTP 503" },
  ]);
});

test("a database failure while hydrating is logged and leaves the memo to the engine's gap", async () => {
  const revenue = { start: "2024-01-01", end: "2024-12-31", val: 391, accn: "0000320193-25-000006", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" };
  const fetcher = secCompanyFetcher(() => ({ cik: 320193, entityName: "Example Corp", facts: { "us-gaap": { Revenues: { label: "", description: "", units: { USD: [revenue] } } } } }));
  const failingStore = {
    query: async (text: string) => {
      if (text.includes("from issuers")) return { rows: [{ issuer_id: ISSUER, cik: "320193" }] };
      if (text.includes("current_fact_precision_attestations a")) return { rows: [] };
      throw new Error("deadlock detected");
    },
  } as unknown as Pool;
  const warnings: unknown[][] = [];
  await hydrateAnalyzeIssuers(failingStore, fetcher, new Map([[ISSUER, new Map([["revenue", 1]])]]), { warn: (...args: unknown[]) => warnings.push(args) });
  assert.deepEqual(warnings.at(-1), [
    "analyze SEC hydration failed; the engine reports the gap",
    { issuer_id: ISSUER, reason: "store_failed", error: "deadlock detected" },
  ]);
});

test("hydration past its budget is logged and the memo goes on", async () => {
  const hung = () => new Promise<never>(() => {});
  const warnings: unknown[][] = [];
  const started = Date.now();
  await hydrateAnalyzeIssuers(issuerOnly, hung, new Map([[ISSUER, new Map([["revenue", 1]])]]), { warn: (...args: unknown[]) => warnings.push(args) }, 50);
  assert.ok(Date.now() - started < 5_000);
  assert.deepEqual(warnings.at(-1), ["analyze SEC hydration ran past its budget; the memo uses the facts stored so far", { budget_ms: 50 }]);
});

test("the frozen golden issuers are never repaired from live SEC", async () => {
  const touched: string[] = [];
  const db = { query: async (text: string) => { touched.push(text); return { rows: [] }; } } as unknown as Pool;
  const fetcher = async (path: string) => { touched.push(path); throw new Error("no fetch expected"); };
  await hydrateAnalyzeIssuers(db, fetcher, new Map(Object.values(GOLDEN_ISSUER_IDS).map((id) => [id, new Map([["revenue", 2]])])), { warn() {} });
  assert.deepEqual(touched, []);
});
