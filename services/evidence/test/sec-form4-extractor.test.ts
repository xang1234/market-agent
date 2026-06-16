import test from "node:test";
import assert from "node:assert/strict";

import {
  parseForm4,
} from "../src/sec-form4-extractor.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function wrapInSubmission(ownershipXml: string): string {
  return `<SEC-DOCUMENT>
<DOCUMENT>
<TYPE>4
<TEXT>
<XML>
${ownershipXml}
</XML>
</TEXT>
</DOCUMENT>
</SEC-DOCUMENT>`;
}

const APPLE_OFFICER_PURCHASE = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000320193</issuerCik>
    <issuerName>Apple Inc.</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001214156</rptOwnerCik>
      <rptOwnerName>COOK TIMOTHY D</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
      <isTenPercentOwner>0</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-06-10</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>150.25</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`);

const SALE_FILING = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000789019</issuerCik>
    <issuerName>Microsoft Corp</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001730340</rptOwnerCik>
      <rptOwnerName>NADELLA SATYA</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
      <isTenPercentOwner>0</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-05-20</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>500</value></transactionShares>
        <transactionPricePerShare><value>415.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`);

const MULTI_TRANSACTION_FILING = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0001318605</issuerCik>
    <issuerName>Tesla Inc.</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001494730</rptOwnerCik>
      <rptOwnerName>MUSK ELON</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>1</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
      <isTenPercentOwner>1</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-04-01</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>2000</value></transactionShares>
        <transactionPricePerShare><value>200.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-04-02</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>3000</value></transactionShares>
        <transactionPricePerShare><value>195.50</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-04-03</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1500</value></transactionShares>
        <transactionPricePerShare><value>198.75</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`);

const GRANT_NO_PRICE = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0001652044</issuerCik>
    <issuerName>Alphabet Inc.</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001056831</rptOwnerCik>
      <rptOwnerName>PICHAI SUNDAR</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
      <isTenPercentOwner>0</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Class A Common Stock</value></securityTitle>
      <transactionDate><value>2026-03-15</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>A</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>5000</value></transactionShares>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`);

const DIRECTOR_ONLY = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000051143</issuerCik>
    <issuerName>IBM Corp</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001234567</rptOwnerCik>
      <rptOwnerName>JONES PATRICIA A</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>1</isDirector>
      <isOfficer>0</isOfficer>
      <isTenPercentOwner>0</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-02-10</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>200</value></transactionShares>
        <transactionPricePerShare><value>180.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`);

const DERIVATIVE_ONLY = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000066740</issuerCik>
    <issuerName>Amazon.com Inc.</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0000891478</rptOwnerCik>
      <rptOwnerName>JASSY ANDREW R</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector>
      <isOfficer>1</isOfficer>
      <officerTitle>President and CEO</officerTitle>
      <isTenPercentOwner>0</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <derivativeTable>
    <derivativeTransaction>
      <securityTitle><value>Stock Option (Right to Buy)</value></securityTitle>
      <transactionDate><value>2026-01-05</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>10000</value></transactionShares>
        <transactionPricePerShare><value>0.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </derivativeTransaction>
  </derivativeTable>
</ownershipDocument>`);

// Uses "true"/"false" strings for boolean fields (variant form)
const BOOLEAN_TRUE_FALSE_VARIANT = wrapInSubmission(`<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerCik>0000804212</issuerCik>
    <issuerName>Berkshire Hathaway</issuerName>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0000315090</rptOwnerCik>
      <rptOwnerName>BUFFETT WARREN E</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>true</isDirector>
      <isOfficer>true</isOfficer>
      <officerTitle>Chairman and CEO</officerTitle>
      <isTenPercentOwner>true</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Class A Common Stock</value></securityTitle>
      <transactionDate><value>2026-01-15</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>10</value></transactionShares>
        <transactionPricePerShare><value>600000.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("parseForm4: purchase (P/A) by an officer with price → correct all fields", () => {
  const filing = parseForm4(APPLE_OFFICER_PURCHASE);

  assert.equal(filing.issuerCik, 320193);
  assert.equal(filing.reportingOwner.name, "COOK TIMOTHY D");
  assert.equal(filing.reportingOwner.cik, "0001214156");
  assert.equal(filing.reportingOwner.isOfficer, true);
  assert.equal(filing.reportingOwner.isDirector, false);
  assert.equal(filing.reportingOwner.isTenPercentOwner, false);
  assert.equal(filing.reportingOwner.officerTitle, "Chief Executive Officer");

  assert.equal(filing.transactions.length, 1);
  const tx = filing.transactions[0];
  assert.equal(tx.transactionDate, "2026-06-10");
  assert.equal(tx.code, "P");
  assert.equal(tx.acquiredDisposed, "A");
  assert.equal(tx.shares, 1000);
  assert.equal(tx.pricePerShare, 150.25);
  assert.equal(tx.value, 1000 * 150.25);
});

test("parseForm4: sale (S/D) → acquiredDisposed is D, value computed correctly", () => {
  const filing = parseForm4(SALE_FILING);

  assert.equal(filing.issuerCik, 789019);

  assert.equal(filing.transactions.length, 1);
  const tx = filing.transactions[0];
  assert.equal(tx.transactionDate, "2026-05-20");
  assert.equal(tx.code, "S");
  assert.equal(tx.acquiredDisposed, "D");
  assert.equal(tx.shares, 500);
  assert.equal(tx.pricePerShare, 415.00);
  assert.equal(tx.value, 500 * 415.00);
});

test("parseForm4: multi-transaction filing → all 3 transactions parsed in order", () => {
  const filing = parseForm4(MULTI_TRANSACTION_FILING);

  assert.equal(filing.issuerCik, 1318605);
  assert.equal(filing.transactions.length, 3);

  const [t1, t2, t3] = filing.transactions;

  assert.equal(t1.transactionDate, "2026-04-01");
  assert.equal(t1.code, "S");
  assert.equal(t1.acquiredDisposed, "D");
  assert.equal(t1.shares, 2000);
  assert.equal(t1.pricePerShare, 200.00);
  assert.equal(t1.value, 2000 * 200.00);

  assert.equal(t2.transactionDate, "2026-04-02");
  assert.equal(t2.code, "P");
  assert.equal(t2.acquiredDisposed, "A");
  assert.equal(t2.shares, 3000);
  assert.equal(t2.pricePerShare, 195.50);
  assert.equal(t2.value, 3000 * 195.50);

  assert.equal(t3.transactionDate, "2026-04-03");
  assert.equal(t3.code, "S");
  assert.equal(t3.acquiredDisposed, "D");
  assert.equal(t3.shares, 1500);
  assert.equal(t3.pricePerShare, 198.75);
  assert.equal(t3.value, 1500 * 198.75);
});

test("parseForm4: grant with no transactionPricePerShare → pricePerShare and value are null", () => {
  const filing = parseForm4(GRANT_NO_PRICE);

  assert.equal(filing.transactions.length, 1);
  const tx = filing.transactions[0];
  assert.equal(tx.code, "A");
  assert.equal(tx.acquiredDisposed, "A");
  assert.equal(tx.shares, 5000);
  assert.equal(tx.pricePerShare, null);
  assert.equal(tx.value, null);
});

test("parseForm4: director (isDirector=1, isOfficer=0) → booleans correct, officerTitle null", () => {
  const filing = parseForm4(DIRECTOR_ONLY);

  assert.equal(filing.issuerCik, 51143);
  assert.equal(filing.reportingOwner.isDirector, true);
  assert.equal(filing.reportingOwner.isOfficer, false);
  assert.equal(filing.reportingOwner.isTenPercentOwner, false);
  assert.equal(filing.reportingOwner.officerTitle, null);

  assert.equal(filing.transactions.length, 1);
});

test("parseForm4: derivative-only filing (no nonDerivativeTable) → transactions is []", () => {
  const filing = parseForm4(DERIVATIVE_ONLY);

  assert.equal(filing.issuerCik, 66740);
  assert.equal(filing.reportingOwner.name, "JASSY ANDREW R");
  assert.deepEqual(filing.transactions, []);
});

test("parseForm4: boolean fields as 'true'/'false' strings → parsed as true", () => {
  const filing = parseForm4(BOOLEAN_TRUE_FALSE_VARIANT);

  assert.equal(filing.reportingOwner.isDirector, true);
  assert.equal(filing.reportingOwner.isOfficer, true);
  assert.equal(filing.reportingOwner.isTenPercentOwner, true);
  assert.equal(filing.reportingOwner.officerTitle, "Chairman and CEO");

  assert.equal(filing.transactions.length, 1);
  const tx = filing.transactions[0];
  assert.equal(tx.pricePerShare, 600000.00);
  assert.equal(tx.value, 10 * 600000.00);
});

test("parseForm4: malformed input with no <XML> tag → throws a clear error", () => {
  const garbage = "This is not a Form 4 submission at all.";
  assert.throws(
    () => parseForm4(garbage),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("XML") || err.message.includes("ownershipDocument"),
        `Expected error about missing XML block, got: ${err.message}`,
      );
      return true;
    },
  );
});
