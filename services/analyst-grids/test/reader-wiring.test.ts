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

test("returns undefined when LLM or S3 env is not configured", async () => {
  const deps = await createReaderColumnDepsFromEnv({});
  assert.equal(deps, undefined);
});
