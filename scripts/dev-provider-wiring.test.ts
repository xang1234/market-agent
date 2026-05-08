import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const NORMAL_DEV_ENTRYPOINTS = [
  "services/market/src/dev.ts",
  "services/fundamentals/src/dev.ts",
  "services/screener/src/dev.ts",
] as const;

test("normal dev entrypoints do not import fixture data modules", async () => {
  for (const relativePath of NORMAL_DEV_ENTRYPOINTS) {
    const source = await readFile(resolve(ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["']\.\/dev-[^"']*fixtures(?:\.ts)?["']/,
      `${relativePath} must not import dev fixture data in normal dev wiring`,
    );
    assert.doesNotMatch(
      source,
      /from\s+["']\.\/dev-candidates(?:\.ts)?["']/,
      `${relativePath} must not import hardcoded screener candidates in normal dev wiring`,
    );
  }
});
