import test from "node:test";
import assert from "node:assert/strict";

import { stripUuencodedBodies } from "../src/sec-submission-strip.ts";
import { releaseExhibits } from "../src/sec-earnings-release-extraction.ts";
import { releaseReconciliations } from "../src/sec-non-gaap-reconciliations.ts";
import { classify8kHeader } from "../src/sec-8k-item-taxonomy.ts";
import { EX99_RELEASE_HTML, EXAMPLE_FILED_ON } from "./fixtures/sec-8k-release.ts";
import { JPEG_BYTES, uuencode } from "./fixtures/uuencode.ts";

const encoder = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const UUENCODED = uuencode("logo.jpg", JPEG_BYTES);
const HEADER = "<SEC-DOCUMENT>0009999999-25-000042.txt : 20251119\n<SEC-HEADER>0009999999-25-000042.hdr.sgml : 20251119\nITEM INFORMATION:\t\tResults of Operations and Financial Condition\n</SEC-HEADER>";

function document(type: string, sequence: number, filename: string, body: string): string {
  return `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>${sequence}\n<FILENAME>${filename}\n<DESCRIPTION>${type}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>`;
}

function submission(binary: { graphic: string; zip: string; pdf: string }): string {
  return [
    HEADER,
    document("8-K", 1, "d1.htm", "<html><body>Item 2.02 Results of Operations and Financial Condition.</body></html>"),
    document("GRAPHIC", 2, "logo.jpg", binary.graphic),
    document("EX-99.1", 3, "ex99.htm", EX99_RELEASE_HTML),
    document("PDF", 4, "ex99.pdf", binary.pdf),
    document("EX-101.SCH", 5, "x.xsd", "<xs:schema>GAAP net income</xs:schema>"),
    document("ZIP", 6, "xbrl.zip", binary.zip),
    "</SEC-DOCUMENT>\n",
  ].join("\n");
}

const ORIGINAL = submission({ graphic: UUENCODED, zip: UUENCODED.replace("logo.jpg", "xbrl.zip"), pdf: `<PDF>\n${UUENCODED.replace("logo.jpg", "ex99.pdf")}\n</PDF>` });

test("a submission keeps every byte but its uuencoded bodies, and each document's envelope", () => {
  const stripped = stripUuencodedBodies(encoder.encode(ORIGINAL));
  assert.ok(stripped);
  // Every document keeps its type, sequence and filename, with an empty body.
  assert.equal(decode(stripped), submission({ graphic: "", zip: "", pdf: "" }).replace(/<TEXT>\n\n<\/TEXT>/g, "<TEXT>\n</TEXT>"));
  assert.ok(decode(stripped).startsWith(HEADER));
});

test("the 8-K readers read the same from the stripped submission", () => {
  const stripped = decode(stripUuencodedBodies(encoder.encode(ORIGINAL))!);
  assert.deepEqual(classify8kHeader(stripped), classify8kHeader(ORIGINAL));
  assert.deepEqual(releaseExhibits(stripped), releaseExhibits(ORIGINAL));
  assert.deepEqual(releaseReconciliations(stripped, EXAMPLE_FILED_ON), releaseReconciliations(ORIGINAL, EXAMPLE_FILED_ON));
  assert.ok(releaseReconciliations(ORIGINAL, EXAMPLE_FILED_ON).reconciliations.length > 0);
});

test("bytes with nothing to remove, or that are no submission, are not rewritten", () => {
  const plain = submission({ graphic: "<html>a picture</html>", zip: "PK", pdf: "%PDF-1.4" });
  assert.equal(stripUuencodedBodies(encoder.encode(plain)), null);
  assert.equal(stripUuencodedBodies(encoder.encode(`<html><body><TEXT>\n${UUENCODED}\n</TEXT></body></html>`)), null);
  assert.equal(stripUuencodedBodies(stripUuencodedBodies(encoder.encode(ORIGINAL))!), null);
});

test("a body that never closes is left whole", () => {
  const truncated = ORIGINAL.slice(0, ORIGINAL.indexOf("end\n</TEXT>"));
  assert.equal(stripUuencodedBodies(encoder.encode(truncated)), null);
});

test("a body is removed only when it is real uuencode filling a document's whole <TEXT>", () => {
  const graphic = document("GRAPHIC", 2, "logo.jpg", UUENCODED);
  const [, firstLine] = UUENCODED.split("\n");
  const kept = [
    document("EX-99.1", 3, "report.txt", "begin 644 report.txt\nRevenue grew 12% in the quarter.\nend"),
    document("EX-99.2", 4, "outlook.txt", "begin 2025 guidance: revenue of $4 billion.\nMore to come."),
    document("EX-99.3", 5, "ex99.htm", `<html><body><pre>\n<TEXT>\n${UUENCODED}\n</TEXT>\n</pre></body></html>`),
    document("GRAPHIC", 6, "long.jpg", UUENCODED.replace(firstLine!, `${firstLine}AA`)),
    document("GRAPHIC", 7, "noend.jpg", UUENCODED.replace("\nend", "")),
    document("GRAPHIC", 8, "trailer.jpg", `${UUENCODED}\nA caption.`),
  ];
  const original = [HEADER, graphic, ...kept, "</SEC-DOCUMENT>\n"].join("\n");
  const stripped = stripUuencodedBodies(encoder.encode(original));
  assert.ok(stripped);
  assert.equal(decode(stripped), [HEADER, document("GRAPHIC", 2, "logo.jpg", "").replace("<TEXT>\n\n</TEXT>", "<TEXT>\n</TEXT>"), ...kept, "</SEC-DOCUMENT>\n"].join("\n"));
  assert.equal(stripUuencodedBodies(encoder.encode([HEADER, ...kept, "</SEC-DOCUMENT>\n"].join("\n"))), null);
});

test("text that only looks like uuencode, or a body with a stray line, is kept", () => {
  const [begin, first, ...rest] = UUENCODED.split("\n");
  const lookalikes = [
    "begin 644 notice.txt\nTHE BOARD DECLARED A DIVIDEND OF $0.25 PER SHARE.\nPAYABLE MARCH 1, 2026.\n\nend",
    "begin 644 notice.htm\n<P>NOTICE TO HOLDERS</P>\n\nend",
    "begin 644 call.txt\nMANAGEMENT WILL HOST A CALL AT 5 PM.\n\nend",
    "begin 644 list.txt\nLIST OF SUBSIDIARIES AND JURISDICTIONS OF INCORPORATION\nACME HOLDINGS (DELAWARE)\n\nend",
    [begin, first, "\r", ...rest].join("\n"),
    [begin, first, "", ...rest].join("\n"),
    [begin, `${first}`.replace(/^M/, "L"), ...rest].join("\n"),
  ];
  const kept = lookalikes.map((body, i) => document("EX-99.1", i + 2, `x${i}.txt`, body));
  const original = [HEADER, ...kept, "</SEC-DOCUMENT>\n"].join("\n");
  assert.equal(stripUuencodedBodies(encoder.encode(original)), null);
});
