import test from "node:test";
import assert from "node:assert/strict";

import { extractXbrlExtensionSegments } from "../src/reader/xbrl-segment-extractor.ts";

const SAMPLE_SOURCE_UUID = "11111111-1111-4111-a111-111111111111";

const AAPL_INLINE_XBRL = `
<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
      xmlns:xbrli="http://www.xbrl.org/2003/instance"
      xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
      xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
      xmlns:us-gaap="http://fasb.org/us-gaap/2024"
      xmlns:srt="http://fasb.org/srt/2024"
      xmlns:aapl="http://www.apple.com/20240928">
  <xbrli:context id="C_AAPL_IPHONE_2024">
    <xbrli:entity>
      <xbrli:identifier scheme="https://www.sec.gov/CIK">0000320193</xbrli:identifier>
      <xbrli:segment>
        <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">aapl:IPhoneMember</xbrldi:explicitMember>
      </xbrli:segment>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:startDate>2023-10-01</xbrli:startDate>
      <xbrli:endDate>2024-09-28</xbrli:endDate>
    </xbrli:period>
  </xbrli:context>
  <xbrli:context id="C_AAPL_SERVICES_2024">
    <xbrli:entity>
      <xbrli:identifier scheme="https://www.sec.gov/CIK">0000320193</xbrli:identifier>
      <xbrli:segment>
        <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">aapl:ServicesMember</xbrldi:explicitMember>
      </xbrli:segment>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:startDate>2023-10-01</xbrli:startDate>
      <xbrli:endDate>2024-09-28</xbrli:endDate>
    </xbrli:period>
  </xbrli:context>
  <xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>

  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
                  contextRef="C_AAPL_IPHONE_2024"
                  unitRef="usd"
                  scale="6"
                  decimals="-6">201,183</ix:nonFraction>
  <ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
                  contextRef="C_AAPL_SERVICES_2024"
                  unitRef="usd"
                  scale="6"
                  decimals="-6">96,169</ix:nonFraction>
  <ix:nonFraction name="aapl:ServicesGrossMargin"
                  contextRef="C_AAPL_SERVICES_2024"
                  unitRef="usd"
                  scale="6"
                  decimals="-6">70,000</ix:nonFraction>
</html>`;

test("extractXbrlExtensionSegments extracts AAPL segment facts with axis and definition pinning", () => {
  const result = extractXbrlExtensionSegments({
    xbrl: AAPL_INLINE_XBRL,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
    definition_as_of: "2024-11-01",
  });

  const segmentFacts = result.items.filter((item) => item.item_type === "xbrl_segment_fact");
  assert.equal(segmentFacts.length, 3);

  const iphone = segmentFacts.find((item) => item.member.name === "aapl:IPhoneMember");
  assert.ok(iphone);
  assert.equal(iphone.axis.name, "srt:ProductOrServiceAxis");
  assert.equal(iphone.axis.kind, "business");
  assert.equal(iphone.member.label, "iPhone");
  assert.equal(iphone.definition_as_of, "2024-11-01");
  assert.equal(iphone.period_start, "2023-10-01");
  assert.equal(iphone.period_end, "2024-09-28");
  assert.equal(iphone.metric_key, "revenue");
  assert.equal(iphone.value_num, 201_183_000_000);
  assert.equal(iphone.currency, "USD");

  const definitions = result.items.filter((item) => item.item_type === "xbrl_segment_definition");
  assert.deepEqual(
    definitions.map((item) => [item.axis.name, item.segment_id, item.segment_name, item.definition_as_of]).sort(),
    [
      ["srt:ProductOrServiceAxis", "aapl:IPhoneMember", "iPhone", "2024-11-01"],
      ["srt:ProductOrServiceAxis", "aapl:ServicesMember", "Services", "2024-11-01"],
    ],
  );
});

test("extractXbrlExtensionSegments returns issuer extension facts separately from standard GAAP facts", () => {
  const result = extractXbrlExtensionSegments({
    xbrl: AAPL_INLINE_XBRL,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
    definition_as_of: "2024-11-01",
  });

  const extensionFacts = result.items.filter((item) => item.item_type === "xbrl_extension_fact");
  assert.equal(extensionFacts.length, 1);
  assert.equal(extensionFacts[0]!.concept.name, "aapl:ServicesGrossMargin");
  assert.equal(extensionFacts[0]!.context_ref, "C_AAPL_SERVICES_2024");
  assert.equal(extensionFacts[0]!.member?.name, "aapl:ServicesMember");
  assert.equal(extensionFacts[0]!.value_num, 70_000_000_000);
  assert.equal(extensionFacts[0]!.source_id, SAMPLE_SOURCE_UUID);
});

test("extractXbrlExtensionSegments honors Inline XBRL sign attributes", () => {
  const result = extractXbrlExtensionSegments({
    xbrl: `
      <html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
            xmlns:xbrli="http://www.xbrl.org/2003/instance"
            xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
            xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
            xmlns:us-gaap="http://fasb.org/us-gaap/2024"
            xmlns:srt="http://fasb.org/srt/2024"
            xmlns:aapl="http://www.apple.com/20240928">
        <xbrli:context id="C_AAPL_SERVICES_2024">
          <xbrli:entity>
            <xbrli:segment>
              <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">aapl:ServicesMember</xbrldi:explicitMember>
            </xbrli:segment>
          </xbrli:entity>
          <xbrli:period>
            <xbrli:startDate>2023-10-01</xbrli:startDate>
            <xbrli:endDate>2024-09-28</xbrli:endDate>
          </xbrli:period>
        </xbrli:context>
        <xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
        <ix:nonFraction name="us-gaap:OperatingIncomeLoss"
                        contextRef="C_AAPL_SERVICES_2024"
                        unitRef="usd"
                        scale="6"
                        sign="-">1,234</ix:nonFraction>
      </html>`,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
    definition_as_of: "2024-11-01",
  });

  const operatingLoss = result.items.find(
    (item) => item.item_type === "xbrl_segment_fact" && item.concept.local_name === "OperatingIncomeLoss",
  );
  assert.ok(operatingLoss);
  assert.equal(operatingLoss.value_num, -1_234_000_000);
});

test("extractXbrlExtensionSegments ignores non-numeric or unitless facts", () => {
  const result = extractXbrlExtensionSegments({
    xbrl: `
      <html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
            xmlns:xbrli="http://www.xbrl.org/2003/instance"
            xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
            xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
            xmlns:us-gaap="http://fasb.org/us-gaap/2024"
            xmlns:aapl="http://www.apple.com/20240928">
        <xbrli:context id="C_AAPL_SERVICES_2024">
          <xbrli:entity>
            <xbrli:segment>
              <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">aapl:ServicesMember</xbrldi:explicitMember>
            </xbrli:segment>
          </xbrli:entity>
          <xbrli:period><xbrli:instant>2024-09-28</xbrli:instant></xbrli:period>
        </xbrli:context>
        <xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
        <ix:nonNumeric name="aapl:FiscalYearLabel" contextRef="C_AAPL_SERVICES_2024">2024</ix:nonNumeric>
        <ix:nonFraction name="aapl:UnitlessMetric" contextRef="C_AAPL_SERVICES_2024">123</ix:nonFraction>
        <ix:nonFraction name="aapl:MissingUnitMetric" contextRef="C_AAPL_SERVICES_2024" unitRef="missing">456</ix:nonFraction>
      </html>`,
    source_id: SAMPLE_SOURCE_UUID,
    as_of: "2026-05-06T00:00:00.000Z",
    definition_as_of: "2024-11-01",
  });

  assert.deepEqual(result.items, []);
});
