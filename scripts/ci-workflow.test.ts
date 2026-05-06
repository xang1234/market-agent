import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const CI_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const DB_HARNESS_SERVICE_DIRS = [
  "services/analyze",
  "services/chat",
  "services/portfolio",
  "services/themes",
];

test("ci workflow includes services/dev-api coverage", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");

  assert.match(workflow, /\bdev-api\b/);
  assert.match(workflow, /working-directory:\s*services\/dev-api/);
  assert.match(workflow, /cache-dependency-path:\s*services\/dev-api\/package-lock\.json/);
  assert.match(workflow, /run:\s*npm test/);
});

test("ci workflow includes services/watchlists coverage", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");

  assert.match(workflow, /\bwatchlists\b/);
  assert.match(workflow, /working-directory:\s*services\/watchlists/);
  assert.match(workflow, /cache-dependency-path:\s*services\/watchlists\/package-lock\.json/);
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
  const candidates = [
    "db",
    "web",
    ...(await servicePackageDirs()).map((service) => `services/${service}`),
  ];
  const tested: string[] = [];
  for (const packageDir of candidates) {
    const packageJson = JSON.parse(
      await readFile(join(REPO_ROOT, packageDir, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    if (packageJson.scripts?.test) tested.push(packageDir);
  }
  return tested.sort();
}

async function servicePackageDirs(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, "services"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
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
