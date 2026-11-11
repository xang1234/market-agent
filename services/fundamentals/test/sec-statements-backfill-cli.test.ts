// --annual-history-years writes ten years of facts no product path reads, so
// the CLI takes it only against a database on this machine (#610).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("../src/sec-statements-backfill-cli.ts", import.meta.url));

function run(databaseUrl: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl, SEC_EDGAR_USER_AGENT: "backfill-cli-test", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, stderr: result.stderr };
}

test("--annual-history-years refuses a database that is not on this machine", () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    ["postgresql://u:p@db.invalid:5432/market_agent", {}, "db.invalid"],
    ["postgresql://u:p@192.0.2.1:5432/market_agent", {}, "192.0.2.1"],
    // pg takes a ?host= over the URL's host.
    ["postgresql://u:p@localhost:5432/market_agent?host=prod.example.com", {}, "prod.example.com"],
    // pg falls back to PGHOST when the URL names no host.
    ["postgresql://u:p@/market_agent", { PGHOST: "db.invalid" }, "db.invalid"],
  ];
  for (const [url, env, host] of cases) {
    const { status, stderr } = run(url, ["--annual-history-years", "11"], env);
    assert.equal(status, 1, url);
    assert.ok(stderr.includes(`--annual-history-years is for a dev DB only: DATABASE_URL must point at this machine, not ${host}`), stderr);
    assert.doesNotMatch(stderr, /u:p@/u);
  }
});

test("--annual-history-years passes the guard for a database on this machine", () => {
  // Nothing listens on port 1, so the run stops at its first query, past the guard and before any SEC request.
  for (const url of [
    "postgresql://u:p@127.0.0.1:1/market_agent",
    "postgresql://u:p@localhost:1/market_agent",
    "postgresql://u:p@LOCALHOST:1/market_agent",
    "postgresql://u:p@/market_agent?host=::1&port=1",
  ]) {
    const { status, stderr } = run(url, ["--annual-history-years", "11"]);
    assert.equal(status, 1, url);
    assert.doesNotMatch(stderr, /dev DB only/u);
    assert.match(stderr, /ECONNREFUSED/u);
  }
  // A unix socket is on this machine; nothing listens at this path.
  for (const url of ["postgresql://u:p@/market_agent?host=/nonexistent-socket-dir", "postgresql://u:p@/market_agent"]) {
    const { status, stderr } = run(url, ["--annual-history-years", "11"], url.includes("?") ? {} : { PGHOST: "/nonexistent-socket-dir" });
    assert.equal(status, 1, url);
    assert.doesNotMatch(stderr, /dev DB only/u);
    assert.match(stderr, /ENOENT/u);
  }
});

test("--annual-history-years refuses a DATABASE_URL it cannot read without printing it", () => {
  const { status, stderr } = run("postgresql://u:hunter2@[bad/market_agent", ["--annual-history-years", "11"]);
  assert.equal(status, 1);
  assert.match(stderr, /--annual-history-years is for a dev DB only: DATABASE_URL must point at this machine, not an unreadable URL/u);
  assert.doesNotMatch(stderr, /hunter2/u);
});
