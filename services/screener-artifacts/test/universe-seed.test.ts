import test from "node:test";
import assert from "node:assert/strict";
import {
  exchangeToMic,
  discoveredListingFromUniverse,
  domicileFromCountry,
} from "../src/universe-seed.ts";
import type { UniverseEntry } from "../src/types.ts";

const AGILENT: UniverseEntry = {
  symbol: "a",
  name: "Agilent Technologies Inc",
  exchange: "XNYS",
  currency: "usd",
  timezone: "America/New_York",
  sector: "Healthcare",
  industry: "Diagnostics & Research",
  market: "US",
  is_active: true,
};

test("exchangeToMic passes through MICs and maps known labels", () => {
  assert.equal(exchangeToMic("XNYS"), "XNYS");
  assert.equal(exchangeToMic("xnas"), "XNAS");
  assert.equal(exchangeToMic("NASDAQ"), "XNAS");
  assert.equal(exchangeToMic("AMEX"), "XASE");
  assert.equal(exchangeToMic("ARCX"), "ARCX");
});

test("exchangeToMic returns undefined for unmappable or empty values", () => {
  assert.equal(exchangeToMic("TOTALLY_UNKNOWN"), undefined);
  assert.equal(exchangeToMic(""), undefined);
  assert.equal(exchangeToMic(null), undefined);
  assert.equal(exchangeToMic(undefined), undefined);
});

test("discoveredListingFromUniverse normalizes a valid entry", () => {
  const listing = discoveredListingFromUniverse(AGILENT, { domicile: "US" });
  assert.deepEqual(listing, {
    ticker: "A",
    legal_name: "Agilent Technologies Inc",
    market: "stocks",
    active: true,
    mic: "XNYS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    domicile: "US",
  });
});

test("discoveredListingFromUniverse omits domicile when not supplied", () => {
  const listing = discoveredListingFromUniverse(AGILENT);
  assert.equal(listing?.domicile, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(listing, "domicile"), false);
});

test("discoveredListingFromUniverse returns null for inactive or unmappable entries", () => {
  assert.equal(discoveredListingFromUniverse({ ...AGILENT, is_active: false }), null);
  assert.equal(discoveredListingFromUniverse({ ...AGILENT, name: null }), null);
  assert.equal(discoveredListingFromUniverse({ ...AGILENT, exchange: "MYSTERY" }), null);
  assert.equal(discoveredListingFromUniverse({ ...AGILENT, currency: "  " }), null);
});

test("domicileFromCountry maps US spellings and passes through codes", () => {
  assert.equal(domicileFromCountry("USA"), "US");
  assert.equal(domicileFromCountry("United States"), "US");
  assert.equal(domicileFromCountry("ca"), "CA");
  assert.equal(domicileFromCountry(null), undefined);
  assert.equal(domicileFromCountry("   "), undefined);
});
