import assert from "node:assert/strict";
import test from "node:test";

import type { HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import { structuredRefsFromHandoff } from "../src/local-runtime-structured.ts";

const ISSUER_ID = "b12a08d7-8ae4-4acf-bfac-8090845938c6";
const LISTING_ID = "07367650-14d7-4fbe-8668-4dc283e5fc13";
const INSTRUMENT_ID = "9764935b-0eb9-4e3b-83d6-67716750e4de";

test("structuredRefsFromHandoff reads issuer + listing from a listing-resolved handoff", () => {
  const refs = structuredRefsFromHandoff(handoffWithListing());

  assert.deepEqual(refs.issuer, { kind: "issuer", id: ISSUER_ID });
  assert.equal(refs.listings.length, 1);
  assert.deepEqual(refs.listings[0].ref, { kind: "listing", id: LISTING_ID });
  assert.equal(refs.listings[0].ticker, "AAOI");
});

test("structuredRefsFromHandoff derives the issuer for an issuer-only handoff with active_listings", () => {
  const refs = structuredRefsFromHandoff(handoffIssuerOnly());

  assert.deepEqual(refs.issuer, { kind: "issuer", id: ISSUER_ID });
  // active_listings feed the quote lookup when there is no single primary listing.
  assert.equal(refs.listings.length, 1);
  assert.equal(refs.listings[0].ticker, "AAOI");
});

test("structuredRefsFromHandoff yields no listings when the subject has none", () => {
  const refs = structuredRefsFromHandoff(handoffIssuerNoListings());

  assert.deepEqual(refs.issuer, { kind: "issuer", id: ISSUER_ID });
  assert.equal(refs.listings.length, 0);
});

function baseHandoff(): HydratedSubjectHandoff {
  return {
    subject_ref: { kind: "listing", id: LISTING_ID },
    identity_level: "listing",
    display_label: "Applied Optoelectronics, Inc.",
    display_labels: { primary: "Applied Optoelectronics, Inc.", ticker: "AAOI", mic: "XNAS" },
    normalized_input: "aaoi",
    resolution_path: "direct_ref",
    confidence: 0.97,
    context: {},
  };
}

function listingContext() {
  return {
    subject_ref: { kind: "listing" as const, id: LISTING_ID },
    instrument_ref: { kind: "instrument" as const, id: INSTRUMENT_ID },
    issuer_ref: { kind: "issuer" as const, id: ISSUER_ID },
    mic: "XNAS",
    ticker: "AAOI",
    trading_currency: "USD",
    timezone: "America/New_York",
  };
}

function handoffWithListing(): HydratedSubjectHandoff {
  return { ...baseHandoff(), context: { listing: listingContext() } };
}

function handoffIssuerOnly(): HydratedSubjectHandoff {
  return {
    ...baseHandoff(),
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    identity_level: "issuer",
    context: {
      issuer: { subject_ref: { kind: "issuer", id: ISSUER_ID }, legal_name: "Applied Optoelectronics, Inc." },
      active_listings: [listingContext()],
    },
  };
}

function handoffIssuerNoListings(): HydratedSubjectHandoff {
  return {
    ...baseHandoff(),
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    identity_level: "issuer",
    context: {
      issuer: { subject_ref: { kind: "issuer", id: ISSUER_ID }, legal_name: "Applied Optoelectronics, Inc." },
    },
  };
}

// ── factRecencyFrom ───────────────────────────────────────────────────────────
