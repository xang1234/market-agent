// services/evidence/test/sec-daily-index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMasterIndex, deriveAccession } from "../src/sec-daily-index.ts";

const SAMPLE = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    June 12, 2026
Comment:               office hours

CIK|Company Name|Form Type|Date Filed|File Name
--------------------------------------------------------------------------------
320193|Apple Inc.|4|2026-06-12|edgar/data/320193/0000320193-26-000050.txt
789019|MICROSOFT CORP|8-K|2026-06-12|edgar/data/789019/0000789019-26-000015.txt
1067983|BERKSHIRE HATHAWAY INC|13F-HR|2026-06-12|edgar/data/1067983/0000950123-26-000789.txt
320193|Apple Inc.|10-Q|2026-06-12|edgar/data/320193/0000320193-26-000051.txt
`;

test("parseMasterIndex returns one entry per data row with derived accession", () => {
  const entries = parseMasterIndex(SAMPLE);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], {
    cik: 320193,
    company: "Apple Inc.",
    form: "4",
    filedDate: "2026-06-12",
    fileName: "edgar/data/320193/0000320193-26-000050.txt",
    accession: "0000320193-26-000050",
  });
});

test("parseMasterIndex skips the header, comment, and dashed separator lines", () => {
  const entries = parseMasterIndex(SAMPLE);
  assert.ok(!entries.some((e) => e.form === "Form Type"));
  assert.ok(entries.every((e) => Number.isInteger(e.cik)));
});

test("deriveAccession extracts the accession from a full-submission path", () => {
  assert.equal(
    deriveAccession("edgar/data/789019/0000789019-26-000015.txt"),
    "0000789019-26-000015",
  );
});

test("parseMasterIndex tolerates a trailing blank line and CRLF", () => {
  const entries = parseMasterIndex(SAMPLE.replace(/\n/g, "\r\n"));
  assert.equal(entries.length, 4);
});
