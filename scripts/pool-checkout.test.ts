import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const ALLOWED_CHECKOUTS = new Map([
  ["services/shared/src/pool-client.ts", 1],
  ["services/financial-engine/src/transaction.ts", 1],
  ["services/chat/src/local-runtime.ts", 1],
]);

test("pool clients are checked out only through withPoolClient, which hears the client's error event (#449)", async () => {
  const offenders: string[] = [];
  for (const service of await readdir(join(ROOT, "services"))) {
    const src = join(ROOT, "services", service, "src");
    const files = await readdir(src, { recursive: true }).catch(() => []);
    for (const file of files) {
      const path = `services/${service}/src/${file}`;
      if (!path.endsWith(".ts") || path.endsWith(".test.ts")) continue;
      const lines = (await readFile(join(ROOT, path), "utf8")).split("\n");
      const checkouts = lines.flatMap((line, index) =>
        /\.connect\(/.test(line) && !/^\s*(\/\/|\*)/.test(line) ? [`${path}:${index + 1}`] : [],
      );
      if (checkouts.length > (ALLOWED_CHECKOUTS.get(path) ?? 0)) offenders.push(...checkouts);
    }
  }
  assert.deepEqual(offenders, [], "use withPoolClient from services/shared/src/pool-client.ts");
});
