import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const CI_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const MIN_NODE_VERSION = "22.19.0";
const DB_HARNESS_SERVICE_DIRS = [
  "services/analyze",
  "services/chat",
  "services/dev-api",
  "services/evidence",
  "services/observability",
  "services/portfolio",
  "services/resolver",
  "services/screener-artifacts",
  "services/themes",
  "services/watchlists",
];

test("ci workflow pins the Node version required by pi-ai", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");

  assert.match(workflow, new RegExp(`NODE_VERSION:\\s*'${MIN_NODE_VERSION}'`));
});

test("all Node packages declare the pi-ai Node baseline", async () => {
  const packageDirs = await nodePackageDirs();

  for (const packageDir of packageDirs) {
    const packageJson = await readPackageJson(packageDir);
    assert.equal(packageJson.engines?.node, `>=${MIN_NODE_VERSION}`, `${packageDir} should require Node >=${MIN_NODE_VERSION}`);
  }
});

test("services/llm owns the pi-ai dependency and import smoke", async () => {
  const packageJson = await readPackageJson("services/llm");

  assert.equal(packageJson.name, "llm");
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-ai"], "0.78.0");
  assert.equal(packageJson.scripts?.test, 'node --experimental-strip-types --test "test/**/*.test.ts"');
  assert.equal(packageJson.scripts?.typecheck, "tsc --noEmit");

  const smokeTest = await readFile(join(REPO_ROOT, "services", "llm", "test", "pi-ai-import.test.ts"), "utf8");
  assert.match(smokeTest, /@earendil-works\/pi-ai/);
});

test("ci workflow includes services/dev-api coverage", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");
  const section = jobSection(workflow, "services/dev-api");

  assert.match(workflow, /\bdev-api\b/);
  assert.match(workflow, /working-directory:\s*services\/dev-api/);
  assert.match(section, /services\/dev-api\/package-lock\.json/);
  assert.match(section, /run:\s*npm test/);
});

test("ci workflow includes services/watchlists coverage", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");
  const section = jobSection(workflow, "services/watchlists");

  assert.match(workflow, /\bwatchlists\b/);
  assert.match(workflow, /working-directory:\s*services\/watchlists/);
  assert.match(section, /services\/watchlists\/package-lock\.json/);
});

test("ci workflow includes services/market coverage", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");

  assert.match(workflow, /\bmarket\b/);
  assert.match(workflow, /working-directory:\s*services\/market/);
  assert.match(workflow, /cache-dependency-path:\s*services\/market\/package-lock\.json/);
});

test("ci workflow covers every package with a test script", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");
  const packageDirs = await testedPackageDirs();

  assert.deepEqual(
    packageDirs.filter((packageDir) => !workflow.includes(`working-directory: ${packageDir}`)),
    [],
  );
});

test("ci workflow installs db deps for services that import the shared db test harness", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");

  for (const serviceDir of DB_HARNESS_SERVICE_DIRS) {
    const section = jobSection(workflow, serviceDir);
    assert.match(section, /db\/package-lock\.json/, `${serviceDir} should cache db deps`);
    assert.match(section, /working-directory:\s*db\s*\n\s*run:\s*npm ci/, `${serviceDir} should install db deps`);
  }
});

async function testedPackageDirs(): Promise<string[]> {
  const candidates = await nodePackageDirs();
  const tested: string[] = [];
  for (const packageDir of candidates) {
    const packageJson = await readPackageJson(packageDir);
    if (packageJson.scripts?.test) tested.push(packageDir);
  }
  return tested.sort();
}

async function nodePackageDirs(): Promise<string[]> {
  return [
    "db",
    "web",
    ...(await servicePackageDirs()).map((service) => `services/${service}`),
  ].sort();
}

async function servicePackageDirs(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, "services"), { withFileTypes: true });
  const serviceDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = join(REPO_ROOT, "services", entry.name, "package.json");
    try {
      await readFile(packageJsonPath, "utf8");
      serviceDirs.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return serviceDirs.sort();
}

async function readPackageJson(packageDir: string): Promise<{
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  engines?: { node?: string };
}> {
  return JSON.parse(await readFile(join(REPO_ROOT, packageDir, "package.json"), "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    engines?: { node?: string };
  };
}

function jobSection(workflow: string, packageDir: string): string {
  const jobName = packageDir.slice(packageDir.lastIndexOf("/") + 1);
  const jobStart = workflow.indexOf(`\n  ${jobName}:`);
  assert.notEqual(jobStart, -1, `missing CI job for ${packageDir}`);

  const marker = `working-directory: ${packageDir}`;
  const markerIndex = workflow.indexOf(marker, jobStart);
  assert.notEqual(markerIndex, -1, `missing CI job for ${packageDir}`);

  const nextJob = workflow.slice(jobStart + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const after = nextJob === -1 ? workflow.length : jobStart + 1 + nextJob;
  return workflow.slice(jobStart, after);
}
