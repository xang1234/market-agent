import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("http.ts imports only Node built-ins, because no CI job installs shared's dependencies for the services that import it", async () => {
  const source = await readFile(new URL("../src/http.ts", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu)].map((match) => match[1]);

  assert.deepEqual(specifiers, ["node:http"]);
});
