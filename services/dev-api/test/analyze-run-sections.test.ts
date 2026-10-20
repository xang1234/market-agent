import test from "node:test";
import assert from "node:assert/strict";

import { primaryIssuerRef } from "../src/local-runtime.ts";

test("primaryIssuerRef returns the issuer ref when the run has an issuer subject", () => {
  assert.deepEqual(
    primaryIssuerRef([
      { kind: "listing", id: "11111111-1111-4111-a111-111111111111" },
      { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" },
    ]),
    { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" },
  );
});

test("primaryIssuerRef returns null when no subject resolves to an issuer", () => {
  assert.equal(
    primaryIssuerRef([{ kind: "listing", id: "11111111-1111-4111-a111-111111111111" }]),
    null,
  );
  assert.equal(primaryIssuerRef([]), null);
});
