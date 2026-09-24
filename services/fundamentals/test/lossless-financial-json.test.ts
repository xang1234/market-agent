import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedInteger,
  FinancialJsonError,
  isSourceNumber,
  parseFinancialJson,
  SourceNumber,
} from "../src/lossless-financial-json.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { extractStatementWithTokens, fetchCompanyFacts, type SecConceptValue } from "../src/sec-edgar.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function companyFactsText(revenueToken: string, netIncomeToken = "0.1000000000000000000001", epsToken = "1.234567890123456789e+6"): string {
  const value = (token: string, extra = "") =>
    `{"start":"2023-01-01","end":"2023-12-31","val":${token},"accn":"0000320193-24-000006","fy":2023,"fp":"FY","form":"10-K","filed":"2024-01-10"${extra}}`;
  return `{"cik":320193,"entityName":"Example Corp","facts":{"us-gaap":{
    "Revenues":{"label":"Revenues","description":"","units":{"USD":[${value(revenueToken)}]}},
    "NetIncomeLoss":{"label":"Net income","description":"","units":{"USD":[${value(netIncomeToken)}]}},
    "EarningsPerShareDiluted":{"label":"EPS","description":"","units":{"USD/shares":[${value(epsToken)}]}}
  }}}`;
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof FinancialJsonError, String(error));
    return error.code;
  }
  assert.fail("expected a FinancialJsonError");
}

test("numeric tokens survive parsing exactly as source text", () => {
  const parsed = parseFinancialJson(`{"a":9007199254740993,"b":0.1000000000000000000001,"c":1.234567890123456789e+6,"d":[-0,1E-3]}`) as Record<string, unknown>;
  assert.ok(isSourceNumber(parsed.a));
  assert.deepEqual(
    [parsed.a, parsed.b, parsed.c].map((value) => (value as SourceNumber).token),
    ["9007199254740993", "0.1000000000000000000001", "1.234567890123456789e+6"],
  );
  assert.deepEqual((parsed.d as SourceNumber[]).map((value) => value.token), ["-0", "1E-3"]);
});

test("conflicting duplicate keys, malformed JSON, oversized bodies, and tokens beyond limits fail deterministically", () => {
  assert.equal(errorCode(() => parseFinancialJson(`{"val":1,"val":2}`)), "duplicate_key");
  assert.equal(errorCode(() => parseFinancialJson(`{"val":1,`)), "malformed_json");
  assert.equal(errorCode(() => parseFinancialJson(`{"val":1}`, { maxBytes: 4 })), "response_too_large");
  assert.equal(errorCode(() => parseFinancialJson(`{"val":${"9".repeat(257)}}`)), "numeric_limit_exceeded");
  assert.equal(errorCode(() => parseFinancialJson(`{"val":1e1001}`)), "numeric_limit_exceeded");
});

test("identifiers and years become bounded integers only after validation", () => {
  assert.equal(boundedInteger(new SourceNumber("2023"), "fy", { min: 1900, max: 2200 }), 2023);
  assert.equal(boundedInteger(320193, "cik", { min: 1, max: 9_999_999_999 }), 320193);
  assert.throws(() => boundedInteger(new SourceNumber("2023.5"), "fy", { min: 1900, max: 2200 }), /integer/);
  assert.throws(() => boundedInteger(new SourceNumber("9007199254740993"), "cik", { min: 1, max: 9_999_999_999 }), /range/);
  assert.throws(() => boundedInteger("2023", "fy", { min: 1900, max: 2200 }), /integer/);
});

test("the SEC fetch boundary parses losslessly before any JSON number conversion", async () => {
  let accept = "";
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async (_url, init) => {
      accept = String((init?.headers as Record<string, string>).accept);
      return new Response(companyFactsText("383285000000.123456789012345678"), { status: 200 });
    },
  });
  const facts = await fetchCompanyFacts(fetcher, 320193);
  assert.equal(accept, "application/json");
  const revenue = facts.facts["us-gaap"]!.Revenues!.units.USD![0] as SecConceptValue;
  assert.equal(revenue.val_token, "383285000000.123456789012345678");
  assert.equal(typeof revenue.val, "number", "legacy consumers keep a JS number");
  assert.equal(revenue.fy, 2023);
  assert.equal(facts.cik, 320193);

  const { statement, tokens } = extractStatementWithTokens({
    subject: { kind: "issuer", id: ISSUER_ID },
    facts,
    family: "income",
    fiscal_year: 2023,
    fiscal_period: "FY",
    source_id: SOURCE_ID,
    as_of: "2024-02-01T00:00:00.000Z",
  });
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 383285000000.1235);
  assert.deepEqual(
    Object.fromEntries([...tokens].map(([key, token]) => [key, token.token])),
    { revenue: "383285000000.123456789012345678", net_income: "0.1000000000000000000001", eps_diluted: "1.234567890123456789e+6" },
  );
  assert.deepEqual(
    { concept: tokens.get("revenue")!.concept, unit: tokens.get("revenue")!.unit, accn: tokens.get("revenue")!.accn },
    { concept: "Revenues", unit: "USD", accn: "0000320193-24-000006" },
  );
});

test("fixtures with plain JSON numbers carry no source token", async () => {
  const facts = await fetchCompanyFacts(async () => JSON.parse(companyFactsText("1000")), 320193);
  const { tokens } = extractStatementWithTokens({
    subject: { kind: "issuer", id: ISSUER_ID },
    facts,
    family: "income",
    fiscal_year: 2023,
    fiscal_period: "FY",
    source_id: SOURCE_ID,
    as_of: "2024-02-01T00:00:00.000Z",
  });
  assert.equal(tokens.size, 0);
});

test("a derived fourth quarter never inherits the annual source token", async () => {
  const quarter = (fp: string, start: string, end: string, token: string) =>
    `{"start":"${start}","end":"${end}","val":${token},"accn":"q-${fp}","fy":2023,"fp":"${fp}","form":"10-Q","filed":"2023-11-01"}`;
  const text = `{"cik":1,"entityName":"Q4 Corp","facts":{"us-gaap":{"Revenues":{"label":"","description":"","units":{"USD":[
    {"start":"2023-01-01","end":"2023-12-31","val":1000,"accn":"annual","fy":2023,"fp":"FY","form":"10-K","filed":"2024-02-01"},
    ${quarter("Q1", "2023-01-01", "2023-03-31", "200")},
    ${quarter("Q2", "2023-04-01", "2023-06-30", "250")},
    ${quarter("Q3", "2023-07-01", "2023-09-30", "300")}]}}}}}`;
  const facts = await fetchCompanyFacts(async () => parseFinancialJson(text), 1);
  const { statement, tokens } = extractStatementWithTokens({
    subject: { kind: "issuer", id: ISSUER_ID },
    facts,
    family: "income",
    fiscal_year: 2023,
    fiscal_period: "Q4",
    source_id: SOURCE_ID,
    as_of: "2024-02-01T00:00:00.000Z",
  });
  assert.equal(statement.lines.find((line) => line.metric_key === "revenue")?.value_num, 250);
  assert.equal(tokens.has("revenue"), false);
});

test("only the schema's numeric fields accept source numbers; anything else is rejected, not rounded", async () => {
  const withValueExtra = companyFactsText("1").replace('"fp":"FY"', '"fp":"FY","restated_val":12345678901234567890');
  await assert.rejects(() => fetchCompanyFacts(async () => parseFinancialJson(withValueExtra), 320193), /companyfacts value\.restated_val: unexpected numeric field/);
  const withTopLevelExtra = companyFactsText("1").replace('"entityName"', '"schemaVersion":2,"entityName"');
  await assert.rejects(() => fetchCompanyFacts(async () => parseFinancialJson(withTopLevelExtra), 320193), /companyfacts\.schemaVersion: unexpected numeric field/);
  const withConceptExtra = companyFactsText("1").replace('"label":"Revenues"', '"label":"Revenues","decimals":-6');
  await assert.rejects(() => fetchCompanyFacts(async () => parseFinancialJson(withConceptExtra), 320193), /companyfacts concept\.decimals: unexpected numeric field/);
});
