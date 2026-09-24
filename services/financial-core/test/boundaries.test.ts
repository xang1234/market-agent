import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const SRC = new URL("../src/", import.meta.url);

// financial-core is pure: no database, provider, model, network, wall-clock,
// global arithmetic configuration, or feature-service imports.
const ALLOWED_IMPORTS = [
  /^\.\/[a-z-]+\.ts$/u,
  /^\.\.\/\.\.\/\.\.\/spec\/financial_[a-z_]+\.json$/u,
  /^ajv(\/dist\/2020\.js)?$/u,
  /^decimal\.js$/u,
  /^node:crypto$/u,
];
const FORBIDDEN_PATTERNS = [
  /\bDate\.now\s*\(/u,
  /\bnew Date\(\s*\)/u,
  /\bperformance\.now\s*\(/u,
  /\bMath\.random\s*\(/u,
  /\bDecimal\.set\s*\(/u,
  /\bprocess\.env\b/u,
  /\bfetch\s*\(/u,
];

test("financial-core imports only pure modules", async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(new URL(file, SRC), "utf8");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+["']([^"']+)["']/gmu)].map((match) => match[1]!);
    for (const specifier of specifiers) {
      assert.ok(
        ALLOWED_IMPORTS.some((pattern) => pattern.test(specifier)),
        `${file} imports forbidden module ${specifier}`,
      );
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} uses forbidden ${pattern}`);
    }
  }
});
