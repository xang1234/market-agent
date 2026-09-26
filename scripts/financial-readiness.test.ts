// Release readiness for verified finance across packages: the web client must
// understand exactly the versions the server emits. CI coverage for finance
// lives with the other CI contracts in ci-workflow.test.ts.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const read = (path: string) => readFile(join(ROOT, path), "utf8");

async function constant(path: string, name: string): Promise<string> {
  const match = new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`, "u").exec(await read(path));
  assert.ok(match, `${path} exports ${name}`);
  return match[1]!;
}

test("the web client understands exactly the presentation and inspection versions the server emits", async () => {
  assert.equal(
    await constant("web/src/blocks/types.ts", "SUPPORTED_FINANCIAL_PRESENTATION_VERSION"),
    await constant("services/financial-core/src/presentation.ts", "FINANCIAL_PRESENTATION_VERSION"),
  );
  assert.equal(
    await constant("web/src/blocks/financialInspection.ts", "SUPPORTED_INSPECTION_SCHEMA_VERSION"),
    await constant("services/financial-engine/src/inspection.ts", "INSPECTION_SCHEMA_VERSION"),
  );
});
