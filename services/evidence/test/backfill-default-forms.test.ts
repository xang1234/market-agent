import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKFILL_DEFAULT_FORMS } from "../src/sec-filings-backfill.ts";

// Guards the typed-event-form regression: per-issuer backfill must default to the
// periodic narrative-evidence forms, not the full SEC_FORM_CODES universe, so the
// forms with dedicated event handlers aren't ingested here as plain documents.
test("per-issuer backfill default includes the periodic evidence forms", () => {
  for (const form of ["10-K", "10-Q", "20-F", "6-K", "40-F"] as const) {
    assert.ok(BACKFILL_DEFAULT_FORMS.includes(form), `expected default to include ${form}`);
  }
});

test("per-issuer backfill default excludes forms with dedicated event handlers", () => {
  // These have atomic typed-event handlers (+ their own backfills); ingesting
  // them here as plain documents would drop their events/claims.
  for (const form of ["4", "8-K", "8-K/A", "13F-HR"] as const) {
    assert.ok(!BACKFILL_DEFAULT_FORMS.includes(form), `${form} must not be a backfill default`);
  }
});
