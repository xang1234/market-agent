import test from "node:test";
import assert from "node:assert/strict";
import {
  assertIssuerProfileContract,
  issuerProfile,
  type IssuerProfile,
  type IssuerProfileExchange,
  type IssuerProfileInput,
} from "../src/profile.ts";
import type { IssuerSubjectRef, ListingSubjectRef } from "../src/subject-ref.ts";

const APPLE_ISSUER: IssuerSubjectRef = {
  kind: "issuer",
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1",
};

const APPLE_XNAS: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

const APPLE_XFRA: ListingSubjectRef = {
  kind: "listing",
  id: "12121212-1212-4212-a212-121212121212",
};

const FIXTURE_SOURCE_ID = "00000000-0000-4000-a000-000000000002";

function appleExchange(overrides: Partial<IssuerProfileExchange> = {}): IssuerProfileExchange {
  return {
    listing: APPLE_XNAS,
    mic: "XNAS",
    ticker: "AAPL",
    trading_currency: "USD",
    timezone: "America/New_York",
    ...overrides,
  };
}

function validInput(overrides: Partial<IssuerProfileInput> = {}): IssuerProfileInput {
  return {
    subject: APPLE_ISSUER,
    legal_name: "Apple Inc.",
    former_names: [],
    cik: "0000320193",
    lei: "HWUPKR0MPOU8FGXBT394",
    domicile: "US",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchanges: [appleExchange()],
    as_of: "2026-04-26T00:00:00.000Z",
    source_id: FIXTURE_SOURCE_ID,
    ...overrides,
  };
}

test("issuerProfile builds a frozen envelope and freezes nested arrays/objects", () => {
  const p = issuerProfile(validInput());

  assert.equal(Object.isFrozen(p), true);
  assert.equal(Object.isFrozen(p.exchanges), true);
  assert.equal(Object.isFrozen(p.exchanges[0]), true);
  assert.equal(Object.isFrozen(p.exchanges[0].listing), true);
  assert.equal(Object.isFrozen(p.former_names), true);
  assert.equal(Object.isFrozen(p.subject), true);
});

test("issuerProfile clones inputs so post-construction mutation can't bleed in", () => {
  const exchanges: IssuerProfileExchange[] = [appleExchange()];
  const input = validInput({ exchanges, former_names: ["Apple Computer, Inc."] });
  const p = issuerProfile(input);

  assert.notEqual(p.exchanges, input.exchanges, "exchanges array is cloned");
  assert.notEqual(p.former_names, input.former_names, "former_names array is cloned");
  assert.notEqual(p.subject, input.subject, "subject ref is cloned");

  // Mutating the input arrays must not affect the frozen envelope.
  exchanges.push(appleExchange({ listing: APPLE_XFRA, mic: "XFRA", ticker: "APC", trading_currency: "EUR" }));
  assert.equal(p.exchanges.length, 1, "envelope's exchanges count is stable after input mutation");
});

test("issuerProfile preserves all the symbol-detail fields the contract names", () => {
  const p = issuerProfile(validInput());
  assert.equal(p.subject.id, APPLE_ISSUER.id);
  assert.equal(p.legal_name, "Apple Inc.");
  assert.equal(p.cik, "0000320193");
  assert.equal(p.lei, "HWUPKR0MPOU8FGXBT394");
  assert.equal(p.domicile, "US");
  assert.equal(p.sector, "Technology");
  assert.equal(p.industry, "Consumer Electronics");
  assert.equal(p.as_of, "2026-04-26T00:00:00.000Z");
  assert.equal(p.source_id, FIXTURE_SOURCE_ID);
  assert.equal(p.exchanges[0].mic, "XNAS");
  assert.equal(p.exchanges[0].ticker, "AAPL");
});

test("issuerProfile defaults former_names and exchanges to empty arrays when omitted", () => {
  const p = issuerProfile({
    subject: APPLE_ISSUER,
    legal_name: "Apple Inc.",
    as_of: "2026-04-26T00:00:00.000Z",
    source_id: FIXTURE_SOURCE_ID,
  });
  assert.deepEqual([...p.former_names], []);
  assert.deepEqual([...p.exchanges], []);
});

test("issuerProfile rejects a non-issuer subject ref", () => {
  assert.throws(
    () =>
      issuerProfile(
        validInput({ subject: { kind: "listing", id: APPLE_ISSUER.id } as unknown as IssuerSubjectRef }),
      ),
    /issuer SubjectRef/,
  );
});

test("issuerProfile rejects a malformed UUID for the subject id", () => {
  assert.throws(
    () =>
      issuerProfile(
        validInput({ subject: { kind: "issuer", id: "not-a-uuid" } as unknown as IssuerSubjectRef }),
      ),
    /UUID/,
  );
});

test("issuerProfile rejects an exchange whose listing isn't a listing-kind ref", () => {
  const badExchange: IssuerProfileExchange = appleExchange({
    listing: { kind: "issuer", id: APPLE_ISSUER.id } as unknown as ListingSubjectRef,
  });
  assert.throws(() => issuerProfile(validInput({ exchanges: [badExchange] })), /listing SubjectRef/);
});

test("issuerProfile rejects an exchange with a non-3-letter trading currency", () => {
  const badExchange = appleExchange({ trading_currency: "USDX" });
  assert.throws(() => issuerProfile(validInput({ exchanges: [badExchange] })), /trading_currency/);
});

test("issuerProfile rejects an exchange list with duplicate listing ids", () => {
  const dup = [appleExchange(), appleExchange()];
  assert.throws(() => issuerProfile(validInput({ exchanges: dup })), /duplicate listing id/);
});

test("issuerProfile rejects a former_names entry that isn't a non-empty string", () => {
  assert.throws(
    () =>
      issuerProfile(
        validInput({ former_names: [""] as unknown as ReadonlyArray<string> }),
      ),
    /former_names/,
  );
  assert.throws(
    () =>
      issuerProfile(
        validInput({ former_names: [42] as unknown as ReadonlyArray<string> }),
      ),
    /former_names/,
  );
});

test("issuerProfile rejects an as_of without explicit Z or offset", () => {
  assert.throws(
    () => issuerProfile(validInput({ as_of: "2026-04-26T00:00:00.000" })),
    /as_of/,
  );
});

test("issuerProfile rejects a non-UUID source_id", () => {
  assert.throws(
    () => issuerProfile(validInput({ source_id: "not-a-uuid" })),
    /source_id/,
  );
});

test("assertIssuerProfileContract round-trips a smart-constructor output", () => {
  const p = issuerProfile(validInput());
  assert.doesNotThrow(() => assertIssuerProfileContract(p));
});

test("assertIssuerProfileContract rejects a hand-crafted profile missing required fields", () => {
  const broken: Partial<IssuerProfile> = {
    subject: APPLE_ISSUER,
    // missing legal_name, exchanges, etc.
    as_of: "2026-04-26T00:00:00.000Z",
    source_id: FIXTURE_SOURCE_ID,
  };
  assert.throws(() => assertIssuerProfileContract(broken), /legal_name|former_names|exchanges/);
});

test("assertIssuerProfileContract rejects null", () => {
  assert.throws(() => assertIssuerProfileContract(null), /must be an object/);
});

test("issuerProfile accepts an issuer with no listed exchanges (private/pre-IPO)", () => {
  const p = issuerProfile(validInput({ exchanges: [] }));
  assert.equal(p.exchanges.length, 0);
});

test("issuerProfile retains multiple distinct exchanges in input order", () => {
  const exchanges = [
    appleExchange(),
    appleExchange({
      listing: APPLE_XFRA,
      mic: "XFRA",
      ticker: "APC",
      trading_currency: "EUR",
      timezone: "Europe/Berlin",
    }),
  ];
  const p = issuerProfile(validInput({ exchanges }));
  assert.equal(p.exchanges.length, 2);
  assert.equal(p.exchanges[0].mic, "XNAS");
  assert.equal(p.exchanges[1].mic, "XFRA");
});
