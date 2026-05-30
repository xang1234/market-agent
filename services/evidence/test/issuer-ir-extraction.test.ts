import test from "node:test";
import assert from "node:assert/strict";

import {
  documentTextFromBytes,
} from "../src/issuer-ir-extraction.ts";

test("documentTextFromBytes decodes text IR assets but skips presentation binary payloads", () => {
  const textBytes = new TextEncoder().encode("<html><body>Management raised guidance.</body></html>");
  assert.equal(documentTextFromBytes(textBytes, "press_release"), "Management raised guidance.");

  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00]);
  assert.equal(documentTextFromBytes(pdfBytes, "presentation"), "");
});
