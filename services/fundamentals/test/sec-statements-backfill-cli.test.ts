// --annual-history-years writes ten years of facts no product path reads, so
// the CLI takes it only against a database on this machine (#610).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("../src/sec-statements-backfill-cli.ts", import.meta.url));

function run(databaseUrl: string, args: string[]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl, SEC_EDGAR_USER_AGENT: "backfill-cli-test" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, stderr: result.stderr };
}

test("--annual-history-years refuses a database that is not on this machine", () => {
  for (const url of ["postgresql://u:p@db.invalid:5432/market_agent", "postgresql://u:p@192.0.2.1:5432/market_agent"]) {
    const { status, stderr } = run(url, ["--annual-history-years", "11"]);
    assert.equal(status, 1);
    assert.match(stderr, /--annual-history-years is for a dev DB only: DATABASE_URL must point at localhost or 127\.0\.0\.1, not (db\.invalid|192\.0\.2\.1)/u);
  }
});

test("--annual-history-years passes the guard for a database on this machine", () => {
  // Nothing listens on port 1, so the run stops at its first query, past the guard and before any SEC request.
  for (const host of ["127.0.0.1", "localhost"]) {
    const { status, stderr } = run(`postgresql://u:p@${host}:1/market_agent`, ["--annual-history-years", "11"]);
    assert.equal(status, 1);
    assert.doesNotMatch(stderr, /dev DB only/u);
    assert.match(stderr, /ECONNREFUSED/u);
  }
});
