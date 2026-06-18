import test from "node:test";
import assert from "node:assert/strict";
import { parse13fInfoTable } from "../src/sec-13f-extractor.ts";

// Modeled on a real Berkshire 13F-HR (acc 0001193125-26-226661): two <XML> docs —
// the cover (periodOfReport MM-DD-YYYY) and the informationTable. ALLY appears
// twice (filers split a position across managers) — the extractor returns each
// row; the handler aggregates.
const SUBMISSION = `<SEC-DOCUMENT>
<DOCUMENT><TYPE>13F-HR<TEXT><XML>
<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler">
  <headerData><periodOfReport>03-31-2026</periodOfReport></headerData>
</edgarSubmission>
</XML></TEXT></DOCUMENT>
<DOCUMENT><TYPE>INFORMATION TABLE<TEXT><XML>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <cusip>037833100</cusip>
    <value>174300000000</value>
    <shrsOrPrnAmt><sshPrnamt>915560382</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>
  <infoTable>
    <nameOfIssuer>ALLY FINL INC</nameOfIssuer>
    <cusip>02005n100</cusip>
    <value>498992850</value>
    <shrsOrPrnAmt><sshPrnamt>12719675</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>
  <infoTable>
    <nameOfIssuer>ALLY FINL INC</nameOfIssuer>
    <cusip>02005N100</cusip>
    <value>109996016</value>
    <shrsOrPrnAmt><sshPrnamt>2803875</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>
</informationTable>
</XML></TEXT></DOCUMENT>
</SEC-DOCUMENT>`;

test("parse13fInfoTable extracts period (MM-DD-YYYY → ISO) and every holding row", () => {
  const filing = parse13fInfoTable(SUBMISSION);
  assert.equal(filing.periodOfReport, "2026-03-31");
  assert.equal(filing.holdings.length, 3, "each infoTable row returned (handler aggregates)");

  const aapl = filing.holdings[0]!;
  assert.equal(aapl.nameOfIssuer, "APPLE INC");
  assert.equal(aapl.cusip, "037833100");
  assert.equal(aapl.valueRaw, 174_300_000_000);
  assert.equal(aapl.shares, 915_560_382);
  assert.equal(aapl.sshPrnamtType, "SH");

  // CUSIP uppercased regardless of source casing.
  assert.equal(filing.holdings[1]!.cusip, "02005N100");
  assert.equal(filing.holdings[2]!.cusip, "02005N100");
});

test("parse13fInfoTable tolerates namespace-prefixed tags", () => {
  const prefixed = `<XML><ns1:edgarSubmission><ns1:periodOfReport>12-31-2025</ns1:periodOfReport></ns1:edgarSubmission></XML>
<XML><ns1:informationTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>COCA COLA CO</ns1:nameOfIssuer>
    <ns1:cusip>191216100</ns1:cusip>
    <ns1:value>28000000000</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>400000000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
  </ns1:infoTable>
</ns1:informationTable></XML>`;
  const filing = parse13fInfoTable(prefixed);
  assert.equal(filing.periodOfReport, "2025-12-31");
  assert.equal(filing.holdings.length, 1);
  assert.equal(filing.holdings[0]!.cusip, "191216100");
  assert.equal(filing.holdings[0]!.shares, 400_000_000);
});

test("parse13fInfoTable throws on a non-numeric value (no NaN propagation)", () => {
  const bad = SUBMISSION.replace("174300000000", "n/a");
  assert.throws(() => parse13fInfoTable(bad), /value/i);
});

test("parse13fInfoTable throws when the cover has no periodOfReport", () => {
  assert.throws(() => parse13fInfoTable("<XML><informationTable></informationTable></XML>"), /periodOfReport/);
});

test("parse13fInfoTable captures putCall so option rows can be excluded downstream", () => {
  const withOption = `<XML><edgarSubmission><periodOfReport>03-31-2026</periodOfReport></edgarSubmission></XML>
<XML><informationTable>
  <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>1000</value>
    <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>500</value>
    <shrsOrPrnAmt><sshPrnamt>5</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><putCall>Call</putCall></infoTable>
</informationTable></XML>`;
  const filing = parse13fInfoTable(withOption);
  assert.equal(filing.holdings[0]!.putCall, null, "direct holding has no putCall");
  assert.equal(filing.holdings[1]!.putCall, "Call", "option row's putCall is captured");
});

test("parse13fInfoTable rejects a shape-valid but non-calendar period", () => {
  const bad = `<XML><periodOfReport>13-99-2026</periodOfReport></XML><XML><informationTable></informationTable></XML>`;
  assert.throws(() => parse13fInfoTable(bad), /periodOfReport/);
});

test("parse13fInfoTable reports amendmentType null on an original 13F-HR (no amendmentInfo)", () => {
  assert.equal(parse13fInfoTable(SUBMISSION).amendmentType, null);
});

test("parse13fInfoTable extracts amendmentType from a 13F-HR/A cover, uppercased + trimmed", () => {
  const restate = SUBMISSION.replace(
    "<periodOfReport>03-31-2026</periodOfReport>",
    "<periodOfReport>03-31-2026</periodOfReport><amendmentInfo><amendmentType>  restatement  </amendmentType></amendmentInfo>",
  );
  assert.equal(parse13fInfoTable(restate).amendmentType, "RESTATEMENT", "case + whitespace normalized so the handler can branch reliably");

  const supplement = SUBMISSION.replace(
    "<periodOfReport>03-31-2026</periodOfReport>",
    "<periodOfReport>03-31-2026</periodOfReport><amendmentInfo><amendmentType>NEW HOLDINGS</amendmentType></amendmentInfo>",
  );
  assert.equal(parse13fInfoTable(supplement).amendmentType, "NEW HOLDINGS");
});
