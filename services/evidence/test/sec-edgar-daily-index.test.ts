import { test } from "node:test";
import assert from "node:assert/strict";
import { SecEdgarClient, dailyIndexUrl } from "../src/sec-edgar.ts";

test("dailyIndexUrl builds the master index path for the right quarter", () => {
  assert.equal(
    dailyIndexUrl(new Date("2026-06-12T00:00:00Z")),
    "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260612.idx",
  );
  assert.equal(
    dailyIndexUrl(new Date("2026-01-05T00:00:00Z")),
    "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR1/master.20260105.idx",
  );
});

test("fetchDailyIndex fetches and parses the master index", async () => {
  const body = `CIK|Company Name|Form Type|Date Filed|File Name
--------------------------------------------------------------------------------
320193|Apple Inc.|4|2026-06-12|edgar/data/320193/0000320193-26-000050.txt
`;
  let calledUrl = "";
  const fakeFetch = async (url: string) => {
    calledUrl = url;
    return new Response(body, { status: 200 });
  };
  const client = new SecEdgarClient({ userAgent: "Test/0.1 (t@example.com)", fetch: fakeFetch });
  const entries = await client.fetchDailyIndex(new Date("2026-06-12T00:00:00Z"));
  assert.equal(calledUrl, "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260612.idx");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accession, "0000320193-26-000050");
});
