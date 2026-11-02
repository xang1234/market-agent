import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const ALLOWED_CHECKOUTS = new Set([
  "services/shared/src/pool-client.ts",
  "services/financial-engine/src/transaction.ts",
  "services/chat/src/local-runtime.ts",
]);

test("pool clients are checked out only through withPoolClient, which hears the client's error event (#449)", async () => {
  const offenders: string[] = [];
  for (const service of await readdir(join(ROOT, "services"))) {
    const src = join(ROOT, "services", service, "src");
    const files = await readdir(src, { recursive: true }).catch(() => []);
    for (const file of files) {
      const path = `services/${service}/src/${file}`;
      if (!path.endsWith(".ts") || path.endsWith(".test.ts") || ALLOWED_CHECKOUTS.has(path)) continue;
      const lines = (await readFile(join(ROOT, path), "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (/\.connect\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${path}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], "use withPoolClient from services/shared/src/pool-client.ts");
});
