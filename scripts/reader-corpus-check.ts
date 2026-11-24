// A change to a text reader also changes its corpus expectations (#767), so
// review sees every reading it moves. CI passes the merge's base commit; locally
// `node --experimental-strip-types scripts/reader-corpus-check.ts origin/main`.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Each regex reader and the corpus files whose change shows its review the
// readings it moves: the expected file its test in
// services/evidence/test/reader-corpus.test.ts compares with, then its inputs.
// A path ending in "/" stands for every file under it.
export const READER_CORPUS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "services/evidence/src/release-figures.ts": [
    "services/evidence/test/reader-corpus/release-figure-readings.txt",
    "services/evidence/test/reader-corpus/release-figure-sentences.tsv",
  ],
  "services/evidence/src/reader/non-gaap-reconciliation-extractor.ts": [
    "services/evidence/test/reader-corpus/non-gaap-readings.txt",
    "services/evidence/test/reader-corpus/releases/",
    "services/evidence/test/fixtures/sec-10k/",
  ],
};

// Why the changed files fail the check, one line per reader changed without any of its corpus files.
export function missingExpectations(changed: ReadonlyArray<string>): string[] {
  const touches = (path: string) => changed.some((file) => (path.endsWith("/") ? file.startsWith(path) : file === path));
  return Object.entries(READER_CORPUS)
    .filter(([reader, corpus]) => changed.includes(reader) && !corpus.some(touches))
    .map(([reader, [expected, ...inputs]]) =>
      `${reader} changed but its corpus did not. If a reading moved, run \`npm run corpus:update\` in services/evidence and commit ${expected}. ` +
      `If no reading moved, add corpus inputs that exercise the changed code (${inputs.join(", ")}), then run corpus:update, ` +
      `so review sees what the change reads (CLAUDE.md, "Known bug classes here": prose read by regex or keyword rules).`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const base = process.argv[2];
  if (!base) throw new Error("usage: reader-corpus-check.ts <base ref>");
  const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = missingExpectations(changed);
  for (const problem of problems) console.error(problem);
  process.exitCode = problems.length > 0 ? 1 : 0;
}
