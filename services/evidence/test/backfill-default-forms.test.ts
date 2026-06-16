import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKFILL_DEFAULT_FORMS } from "../src/sec-filings-backfill.ts";

// Guards the Form 4/13F regression: per-issuer backfill must default to the
// periodic/event evidence forms, not the full SEC_FORM_CODES universe, so
// high-frequency ownership filings don't consume the maxFilings slots.
test("per-issuer backfill default includes the evidence forms", () => {
  for (const form of ["10-K", "10-Q", "8-K"] as const) {
    assert.ok(BACKFILL_DEFAULT_FORMS.includes(form), `expected default to include ${form}`);
  }
});

test("per-issuer backfill default excludes high-frequency ownership forms", () => {
  assert.ok(!BACKFILL_DEFAULT_FORMS.includes("4"), "Form 4 must not be a backfill default");
  assert.ok(!BACKFILL_DEFAULT_FORMS.includes("13F-HR"), "13F-HR must not be a backfill default");
});
