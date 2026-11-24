// A change to a text reader also changes its corpus expectations (#767), so
// review sees every reading it moves. CI passes the merge's base commit; locally
// `node --experimental-strip-types scripts/reader-corpus-check.ts origin/main`.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Each regex reader and the expected file its corpus test in
// services/evidence/test/reader-corpus.test.ts compares with.
export const READER_EXPECTATIONS: Readonly<Record<string, string>> = {
  "services/evidence/src/release-figures.ts": "services/evidence/test/reader-corpus/release-figure-readings.txt",
  "services/evidence/src/reader/non-gaap-reconciliation-extractor.ts": "services/evidence/test/reader-corpus/non-gaap-readings.txt",
};

// Why the changed files fail the check, one line per reader changed without its expectations.
export function missingExpectations(changed: ReadonlyArray<string>): string[] {
  return Object.entries(READER_EXPECTATIONS)
    .filter(([reader, expected]) => changed.includes(reader) && !changed.includes(expected))
    .map(([reader, expected]) =>
      `${reader} changed but ${expected} did not. Run \`npm run corpus:update\` in services/evidence and commit the expected file, ` +
      `so the PR diff shows every reading the change moves (CLAUDE.md, "Known bug classes here": prose read by regex or keyword rules).`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const base = process.argv[2];
  if (!base) throw new Error("usage: reader-corpus-check.ts <base ref>");
  const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = missingExpectations(changed);
  for (const problem of problems) console.error(problem);
  process.exitCode = problems.length > 0 ? 1 : 0;
}
