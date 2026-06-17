import test from "node:test";
import assert from "node:assert/strict";
import { mapCusipViaOpenFigi } from "../src/openfigi-cusip.ts";

const ENABLED = { enabled: true, baseUrl: "https://openfigi.test", apiKey: null };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// One OpenFIGI mapping "job" wrapping its data rows.
function mapping(rows: Array<Record<string, unknown>>): unknown {
  return [{ data: rows }];
}

const APPLE_ROW = {
  ticker: "aapl",
  name: "APPLE INC",
  micCode: "XNAS",
  marketSector: "Equity",
  securityType: "Common Stock",
  compositeFIGI: "BBG000B9XRY4",
  isin: "US0378331005",
};

test("mapCusipViaOpenFigi returns a unique equity match (ticker/mic/name/figi/isin)", async () => {
  const match = await mapCusipViaOpenFigi(ENABLED, "037833100", async () => jsonResponse(mapping([APPLE_ROW])));
  assert.deepEqual(match, {
    ticker: "AAPL",
    legalName: "APPLE INC",
    assetType: "common_stock",
    isin: "US0378331005",
    figiComposite: "BBG000B9XRY4",
  });
});

test("mapCusipViaOpenFigi propagates transport failures (does not swallow them as unmapped)", async () => {
  await assert.rejects(
    () =>
      mapCusipViaOpenFigi(ENABLED, "037833100", async () => {
        throw new Error("network down");
      }),
    /network down/,
    "a network/outage error must surface so a batch run can retry, not look 'unmapped'",
  );
});

test("mapCusipViaOpenFigi returns null for a non-equity security", async () => {
  const bond = { ...APPLE_ROW, marketSector: "Corp", securityType: "GLOBAL", compositeFIGI: "BBG00BONDXXX" };
  assert.equal(await mapCusipViaOpenFigi(ENABLED, "037833100", async () => jsonResponse(mapping([bond]))), null);
});

test("mapCusipViaOpenFigi returns null when the mapping is ambiguous (>1 distinct FIGI)", async () => {
  const other = { ...APPLE_ROW, compositeFIGI: "BBG000DIFFERENT" };
  assert.equal(await mapCusipViaOpenFigi(ENABLED, "037833100", async () => jsonResponse(mapping([APPLE_ROW, other]))), null);
});

test("mapCusipViaOpenFigi short-circuits when disabled or the CUSIP is malformed", async () => {
  let called = false;
  const spy = async () => {
    called = true;
    return jsonResponse(mapping([APPLE_ROW]));
  };
  assert.equal(await mapCusipViaOpenFigi({ ...ENABLED, enabled: false }, "037833100", spy), null);
  assert.equal(await mapCusipViaOpenFigi(ENABLED, "12345", spy), null, "non-9-char CUSIP");
  assert.equal(called, false, "no HTTP call when disabled or malformed");
});

test("mapCusipViaOpenFigi returns null on an OpenFIGI error/no-data job", async () => {
  assert.equal(await mapCusipViaOpenFigi(ENABLED, "037833100", async () => jsonResponse([{ error: "No identifier found." }])), null);
});
