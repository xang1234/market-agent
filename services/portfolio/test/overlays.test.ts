import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOverlayInputsRequest,
  OVERLAY_INPUTS_MAX_SUBJECTS,
} from "../src/overlays.ts";

const VALID_ID = "11111111-1111-4111-a111-111111111111";

test("assertOverlayInputsRequest: accepts a single instrument ref", () => {
  assert.doesNotThrow(() =>
    assertOverlayInputsRequest({
      subject_refs: [{ kind: "instrument", id: VALID_ID }],
    }),
  );
});

test("assertOverlayInputsRequest: accepts mixed instrument and listing refs", () => {
  assert.doesNotThrow(() =>
    assertOverlayInputsRequest({
      subject_refs: [
        { kind: "instrument", id: VALID_ID },
        { kind: "listing", id: VALID_ID },
      ],
    }),
  );
});

test("assertOverlayInputsRequest: rejects empty array", () => {
  assert.throws(
    () => assertOverlayInputsRequest({ subject_refs: [] }),
    /must not be empty/,
  );
});

test("assertOverlayInputsRequest: rejects missing subject_refs", () => {
  assert.throws(
    () => assertOverlayInputsRequest({}),
    /must be an array/,
  );
});

test("assertOverlayInputsRequest: rejects non-array subject_refs", () => {
  assert.throws(
    () => assertOverlayInputsRequest({ subject_refs: "instrument" }),
    /must be an array/,
  );
});

test("assertOverlayInputsRequest: rejects subject_kinds outside the holding allowlist", () => {
  for (const kind of ["theme", "screen", "macro_topic", "portfolio", "issuer"]) {
    assert.throws(
      () =>
        assertOverlayInputsRequest({
          subject_refs: [{ kind, id: VALID_ID }],
        }),
      /subject_refs\[0\]\.kind/,
      `expected ${kind} rejected`,
    );
  }
});

test("assertOverlayInputsRequest: rejects raw ticker as id", () => {
  assert.throws(
    () =>
      assertOverlayInputsRequest({
        subject_refs: [{ kind: "listing", id: "AAPL" }],
      }),
    /subject_refs\[0\]\.id/,
  );
});

test(`assertOverlayInputsRequest: rejects more than ${OVERLAY_INPUTS_MAX_SUBJECTS} subjects`, () => {
  const refs = Array.from({ length: OVERLAY_INPUTS_MAX_SUBJECTS + 1 }, () => ({
    kind: "instrument" as const,
    id: VALID_ID,
  }));
  assert.throws(
    () => assertOverlayInputsRequest({ subject_refs: refs }),
    new RegExp(`must be <= ${OVERLAY_INPUTS_MAX_SUBJECTS}`),
  );
});

test(`assertOverlayInputsRequest: accepts exactly ${OVERLAY_INPUTS_MAX_SUBJECTS} subjects`, () => {
  const refs = Array.from({ length: OVERLAY_INPUTS_MAX_SUBJECTS }, () => ({
    kind: "instrument" as const,
    id: VALID_ID,
  }));
  assert.doesNotThrow(() =>
    assertOverlayInputsRequest({ subject_refs: refs }),
  );
});

test("assertOverlayInputsRequest: rejects non-object body", () => {
  assert.throws(() => assertOverlayInputsRequest(null), /must be an object/);
  assert.throws(() => assertOverlayInputsRequest("nope"), /must be an object/);
});
