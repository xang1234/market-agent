import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Allowed: financial-engine -> snapshot -> financial-core and
// financial-engine -> financial-core. The reverse directions are forbidden.
const MUST_NOT_IMPORT_ENGINE = ["../../financial-core/src/", "../../snapshot/src/"];

async function sourceFiles(relativeDir: string): Promise<URL[]> {
  const dir = new URL(relativeDir, import.meta.url);
  return (await readdir(dir)).filter((name) => name.endsWith(".ts")).map((name) => new URL(name, dir));
}

test("financial-core and snapshot never import financial-engine", async () => {
  for (const dir of MUST_NOT_IMPORT_ENGINE) {
    for (const file of await sourceFiles(dir)) {
      assert.doesNotMatch(await readFile(file, "utf8"), /financial-engine/u, `${file.pathname} imports financial-engine`);
    }
  }
});

test("engine ports depend only on the core's public entry point", async () => {
  const source = await readFile(new URL("../src/ports.ts", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.deepEqual(specifiers, ["../../financial-core/src/index.ts"]);
});

test("planning modules cannot reach evidence: nothing is acquired before a plan validates", async () => {
  for (const file of ["planner.ts", "plan-authority.ts", "plan-interpretation.ts"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]!);
    assert.ok(specifiers.every((specifier) => !/evidence|bind-inputs|select-inputs|ports/u.test(specifier)), `${file}: ${specifiers.join(", ")}`);
  }
});
