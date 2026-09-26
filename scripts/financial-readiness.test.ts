// Release-readiness contracts for verified finance that live outside any one
// service: the web client must understand exactly the versions the server
// emits, and CI must install financial-core's dependencies wherever a
// service's code reaches them, and must run Docker-backed suites rather than
// skip them.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gu;

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") files.push(...await tsFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

/** financial-core source files whose import closure reaches a third-party package (ajv, decimal.js). */
async function coreFilesNeedingDependencies(): Promise<Set<string>> {
  const files = await tsFiles("services/financial-core/src");
  const imports = new Map<string, string[]>();
  for (const file of files) imports.set(file, [...(await read(file)).matchAll(IMPORT)].map((match) => match[1]!));
  const needs = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, specifiers] of imports) {
      if (needs.has(file)) continue;
      const reaches = specifiers.some((specifier) =>
        !specifier.startsWith(".") && !specifier.startsWith("node:")
          ? true
          : needs.has(join(dirname(file), specifier)));
      if (reaches) { needs.add(file); changed = true; }
    }
  }
  return needs;
}

test("every CI job whose service reaches financial-core's dependencies installs them", async () => {
  const needs = await coreFilesNeedingDependencies();
  assert.ok(needs.has("services/financial-core/src/index.ts"), "the package entry point needs its dependencies");
  const workflow = await read(".github/workflows/ci.yml");
  const services = (await readdir(join(ROOT, "services"))).filter((name) => name !== "financial-core");
  for (const service of services) {
    const files = [...await tsFiles(`services/${service}/src`), ...await tsFiles(`services/${service}/test`)];
    let reaches = false;
    for (const file of files) {
      for (const [, specifier] of (await read(file)).matchAll(IMPORT)) {
        const target = resolve(ROOT, dirname(file), specifier!).slice(ROOT.length + 1);
        // The engine's entry points import the core index.
        if (needs.has(target) || target.startsWith("services/financial-engine/src/")) reaches = true;
      }
    }
    if (!reaches) continue;
    const job = jobBlock(workflow, service);
    assert.match(job, /services\/financial-core\s+ci|working-directory: services\/financial-core\s+run: npm ci/u, `CI job ${service} must install services/financial-core dependencies`);
  }
});

test("CI runs Docker-backed suites instead of skipping them, and runs these contract tests", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /\nenv:\n(?:\s{2}.*\n)*\s{2}REQUIRE_DOCKER: '1'/u);
  assert.match(await read("db/test/docker-pg.ts"), /env\.REQUIRE_DOCKER === "1"/u);
  assert.match(jobBlock(workflow, "scripts"), /--test "scripts\/\*\.test\.ts"/u);
});

function jobBlock(workflow: string, job: string): string {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `missing CI job ${job}`);
  const next = workflow.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/u);
  return workflow.slice(start, next === -1 ? workflow.length : start + 1 + next);
}
