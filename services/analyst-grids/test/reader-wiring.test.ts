import test from "node:test";
import assert from "node:assert/strict";
import { createLoadDocumentText, createReaderColumnDepsFromEnv } from "../src/reader-wiring.ts";

test("createLoadDocumentText decodes stored blob bytes as utf-8", async () => {
  const bytes = new TextEncoder().encode("Item 1A. Risk Factors.");
  const store = {
    get: async (id: string) => (id === "sha256:abc" ? { raw_blob_id: id, size: bytes.byteLength, bytes } : null),
    put: async () => { throw new Error("unused"); },
    has: async () => true,
    delete: async () => false,
  };
  const load = createLoadDocumentText(store as never);
  assert.equal(await load("sha256:abc"), "Item 1A. Risk Factors.");
  assert.equal(await load("sha256:missing"), null);
});

test("createLoadDocumentText converts HTML filings to readable prose", async () => {
  const html =
    '<!DOCTYPE html><html><head><style>.x{color:red}</style><script>var a=1;</script></head>' +
    '<body><div ix:name="dei:DocumentType">8-K</div><p>Apple&nbsp;announced a <b>dividend</b> increase &amp; buyback.</p></body></html>';
  const bytes = new TextEncoder().encode(html);
  const store = {
    get: async () => ({ raw_blob_id: "sha256:h", size: bytes.byteLength, bytes }),
    put: async () => { throw new Error("unused"); },
    has: async () => true,
    delete: async () => false,
  };
  const load = createLoadDocumentText(store as never);
  const text = await load("sha256:h");
  assert.equal(text, "8-K Apple announced a dividend increase & buyback.");
});

test("returns undefined when LLM or S3 env is not configured", async () => {
  const deps = await createReaderColumnDepsFromEnv({});
  assert.equal(deps, undefined);
});
