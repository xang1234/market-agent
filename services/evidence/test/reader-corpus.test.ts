// The text readers read every input of a fixed corpus as test/reader-corpus
// expects (#767). A changed reading fails here until `npm run corpus:update`
// rewrites the expected file, so the PR diff shows every reading it moves.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

import { readFigure, type ReleaseMetric } from "../src/release-figures.ts";
import { extractNonGaapReconciliations, readTables } from "../src/reader/non-gaap-reconciliation-extractor.ts";
import { statedFigures } from "../../financial-core/src/figure-check.ts";

const CORPUS = join(import.meta.dirname, "reader-corpus");
const UPDATE = process.env.UPDATE_READER_CORPUS === "1";

// The lines an expected file holds, written first under UPDATE.
function expected(file: string, header: string, lines: ReadonlyArray<string>): string[] {
  const path = join(CORPUS, file);
  const crash = lines.find((line) => line.includes(" -> THROW "));
  if (UPDATE && crash) throw new Error(`A reader throws on a corpus input, and a crash is never an expected reading. Fix it first:\n${crash}`);
  if (UPDATE) writeFileSync(path, [header, ...lines].join("\n") + "\n");
  return readFileSync(path, "utf8").split("\n").filter((line) => line !== "" && !line.startsWith("#"));
}

const FIX = "If the change is intended, run `npm run corpus:update` in services/evidence and commit the expected file, so the PR diff shows each reading it moves.";

// Every phrase a model could copy from a sentence: an amount with its sign,
// dollar sign and unit, as the #733 and #750 harnesses picked them.
const PHRASE = /(?:approximately )?\(?-?\$?\s?\(?\d[\d,]*(?:\.\d+)?\)?\s?(?:%|percent|basis points|bps|trillion|billion|million|thousand|tn|bn|mn)?\)?/gi;

// Each pick of phrases from each corpus sentence on both bases, and what
// readFigure stores for it. A pick it sends to review has no line.
function releaseFigureReadings(): string[] {
  const rows = readFileSync(join(CORPUS, "release-figure-sentences.tsv"), "utf8").split("\n").filter(Boolean);
  const lines: string[] = [];
  for (const row of rows) {
    const [kind, metric, , quote] = row.split("\t") as ["guidance" | "result", ReleaseMetric, string, string];
    // "+/- 50 bps" matches as "- 50 bps"; the unsigned "50 bps" is a pick too.
    const phrases = [...new Set([...quote.matchAll(PHRASE)].flatMap((found) => [found[0].trim(), found[0].trim().replace(/^-\s*/u, "")]))];
    const picks = kind === "result"
      ? phrases.map((value) => ({ value }))
      : [
          ...phrases.flatMap((value) => [{ value }, ...phrases.map((plus_minus) => ({ value, plus_minus }))]),
          ...phrases.flatMap((low) => phrases.map((high) => ({ low, high }))),
        ];
    for (const pick of picks) {
      for (const basis of ["gaap", "non_gaap"]) {
        let reading: string;
        try {
          const read = readFigure({ kind, metric, quote }, { basis, ...pick });
          if ("review" in read) continue;
          reading = `${read.basis} ${read.low}..${read.high}`;
        } catch (error) {
          reading = `THROW ${(error as Error).message}`;
        }
        lines.push(`${quote} | ${kind} ${metric} ${basis} ${JSON.stringify(pick)} -> ${reading}`);
      }
    }
  }
  return lines.sort();
}

// Each pick whose reading moved, by direction: toward review is stricter, and
// anything else stores a figure the expected file does not.
function moves(want: ReadonlyArray<string>, got: ReadonlyArray<string>): string | null {
  const byPick = (lines: ReadonlyArray<string>) => new Map(lines.map((line) => {
    const at = line.lastIndexOf(" -> ");
    return [line.slice(0, at), line.slice(at + 4)] as const;
  }));
  const [before, after] = [byPick(want), byPick(got)];
  const groups = { stricter: [] as string[], looser: [] as string[], other: [] as string[] };
  for (const pick of new Set([...before.keys(), ...after.keys()])) {
    const [was, now] = [before.get(pick) ?? "review", after.get(pick) ?? "review"];
    if (was === now) continue;
    const line = `  ${pick}: ${was} -> ${now}`;
    (now === "review" ? groups.stricter : was === "review" ? groups.looser : groups.other).push(line);
  }
  const count = groups.stricter.length + groups.looser.length + groups.other.length;
  if (count === 0) return null;
  return [
    `release-figures.ts reads ${count} corpus picks differently from test/reader-corpus/release-figure-readings.txt.`,
    `${groups.looser.length} now store a figure the expected file sends to review (looser):`, ...groups.looser,
    `${groups.other.length} store a different basis or value:`, ...groups.other,
    `${groups.stricter.length} now go to review (stricter):`, ...groups.stricter,
    FIX,
  ].join("\n");
}

test("release-figures.ts reads every corpus pick as the expected file says", () => {
  const got = releaseFigureReadings();
  const want = expected(
    "release-figure-readings.txt",
    "# Each pick of phrases from release-figure-sentences.tsv that readFigure stores, on the basis it was tagged. Every pick not listed goes to review.",
    got,
  );
  const moved = moves(want, got);
  assert.ok(moved === null, moved ?? "");
  assert.ok(!want.some((line) => line.includes(" -> THROW ")), "release-figure-readings.txt records a crash as an expected reading");
});

// The 10-K fixtures and the AMD and NVIDIA release exhibits (#749), each table
// as readTables reads it and each reconciliation the extractor finds.
function nonGaapReadings(): string[] {
  const tenKs = join(import.meta.dirname, "fixtures", "sec-10k");
  const releases = join(CORPUS, "releases");
  const files = [
    ...readdirSync(tenKs).filter((name) => name.endsWith(".htm")).map((name) => join(tenKs, name)),
    ...readdirSync(releases).filter((name) => name.endsWith(".htm")).map((name) => join(releases, name)),
  ];
  const pad = (n: number) => String(n).padStart(3, "0");
  const lines: string[] = [];
  for (const file of files) {
    const name = basename(file, ".htm");
    const html = readFileSync(file, "utf8");
    for (const [t, table] of readTables(html).entries()) {
      lines.push(`${name} table ${pad(t)} scale ${table.scale ?? "none"} periods ${JSON.stringify(table.periods)}`);
      for (const [r, row] of table.rows.entries()) {
        const values = row.values.map(([slot, value]) => `${slot}=${value.value_num} ${value.unit}${value.currency ? ` ${value.currency}` : ""} ${value.decimals}dp`);
        lines.push([`${name} table ${pad(t)} row ${pad(r)} ${JSON.stringify(row.label)}`, ...values].join(" "));
      }
    }
    const { items } = extractNonGaapReconciliations({ html, source_id: "", as_of: "" });
    for (const [i, { source_id: _source, as_of: _asOf, ...item }] of items.entries()) lines.push(`${name} item ${pad(i)} ${JSON.stringify(item)}`);
  }
  return lines.sort();
}

test("the non-GAAP reconciliation reader reads every corpus table as the expected file says", () => {
  const got = nonGaapReadings();
  const want = expected(
    "non-gaap-readings.txt",
    "# Each table readTables reads in the 10-K fixtures and release exhibits, its rows, and each reconciliation extractNonGaapReconciliations finds.",
    got,
  );
  const [had, has] = [new Set(want), new Set(got)];
  const gone = want.filter((line) => !has.has(line)).map((line) => `- ${line}`);
  const added = got.filter((line) => !had.has(line)).map((line) => `+ ${line}`);
  assert.ok(gone.length + added.length === 0, [
    `non-gaap-reconciliation-extractor.ts reads the corpus differently from test/reader-corpus/non-gaap-readings.txt (- expected, + now):`,
    ...gone, ...added, FIX,
  ].join("\n"));
});

// The figures each corpus sentence states, as chat's packet and the seal number a claim's
// figures (C2.1 is the first): statedFigures, from financial-core's figure check (#800).
test("statedFigures reads every corpus sentence as the expected file says", () => {
  const rows = readFileSync(join(CORPUS, "release-figure-sentences.tsv"), "utf8").split("\n").filter(Boolean);
  const got = [...new Set(rows.map((row) => row.split("\t")[3]!))]
    .map((quote) => `${quote} -> ${statedFigures(quote).map((figure) => figure.text).join(" | ")}`)
    .sort();
  const want = expected("stated-figure-readings.txt", "# Each sentence of release-figure-sentences.tsv and the figures statedFigures numbers in it, in order.", got);
  const [had, has] = [new Set(want), new Set(got)];
  const moved = [...want.filter((line) => !has.has(line)).map((line) => `- ${line}`), ...got.filter((line) => !had.has(line)).map((line) => `+ ${line}`)];
  assert.ok(moved.length === 0, ["statedFigures reads the corpus differently from test/reader-corpus/stated-figure-readings.txt (- expected, + now):", ...moved, FIX].join("\n"));
});
