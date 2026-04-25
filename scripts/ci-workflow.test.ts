import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const CI_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "ci.yml");

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
