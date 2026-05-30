import test from "node:test";
import assert from "node:assert/strict";

import {
  documentTextFromBytes,
  issuerIrTextFromBytes,
} from "../src/issuer-ir-extraction.ts";

test("issuer IR text extraction decodes text presentations and reports unsupported binary explicitly", () => {
  const textBytes = new TextEncoder().encode("<html><body>Management raised guidance.</body></html>");
  assert.equal(documentTextFromBytes(textBytes), "Management raised guidance.");
  assert.deepEqual(
    issuerIrTextFromBytes({ bytes: textBytes, contentType: "text/html" }),
    { status: "available", text: "Management raised guidance." },
  );

  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00]);
  assert.deepEqual(
    issuerIrTextFromBytes({ bytes: pdfBytes, contentType: "application/pdf" }),
    { status: "unsupported_binary", reason: "pdf" },
  );
});
