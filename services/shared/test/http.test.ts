import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readBody, RequestBodyTooLargeError } from "../src/http.ts";

async function* chunks(...parts: Array<string | Uint8Array>): AsyncGenerator<string | Uint8Array> {
  yield* parts;
}

test("http.ts imports only Node built-ins, because no CI job installs shared's dependencies for the services that import it", async () => {
  const source = await readFile(new URL("../src/http.ts", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu)].map((match) => match[1]);

  assert.ok(specifiers.includes("node:http"));
  assert.deepEqual(specifiers.filter((specifier) => !specifier!.startsWith("node:")), []);
});

test("readBody counts UTF-8 bytes across string and Buffer chunks and throws past maxBytes", async () => {
  assert.equal(await readBody(chunks(), { maxBytes: 0 }), "");
  assert.equal(await readBody(chunks("é", Buffer.from("ab")), { maxBytes: 4 }), "éab");
  await assert.rejects(readBody(chunks("é", Buffer.from("abc")), { maxBytes: 4 }), RequestBodyTooLargeError);
});
