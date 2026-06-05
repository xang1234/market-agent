import test from "node:test";
import assert from "node:assert/strict";

import { createCurrentPriceSource } from "../src/current-price-source.ts";

const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const QUOTE = { listing: LISTING, price: 214.5, currency: "USD", as_of: "2026-06-04T19:55:00.000Z", delay_class: "eod", source_id: "00000000-0000-4000-a000-0000000000aa" };

function profiles(exchange: unknown) {
  return { async find() { return exchange === null ? null : { exchanges: [{ listing: LISTING }] }; } } as never;
}

test("createCurrentPriceSource resolves issuer -> primary listing -> latest quote", async () => {
  const cache = { async findLatestQuote() { return { quote: QUOTE }; } } as never;
  const source = createCurrentPriceSource(profiles({}), cache);
  const quote = await source.findByIssuer("22222222-2222-4222-a222-222222222222");
  assert.equal(quote?.price, 214.5);
});

test("createCurrentPriceSource returns null when there is no listing or no quote", async () => {
  const noQuote = { async findLatestQuote() { return null; } } as never;
  assert.equal(await createCurrentPriceSource(profiles({}), noQuote).findByIssuer("x"), null);
  const anyCache = { async findLatestQuote() { return { quote: QUOTE }; } } as never;
  assert.equal(await createCurrentPriceSource(profiles(null), anyCache).findByIssuer("x"), null);
});
