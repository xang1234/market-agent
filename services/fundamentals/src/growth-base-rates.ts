// The base rates a Call's required growth is set against: how often a
// company's five-year growth reached a given rate, among windows that began at
// a similar size. It reads SEC's bulk companyfacts.zip from a local copy and
// writes services/financial-core/data/growth-base-rates/<sha256>.json, named by
// the sha256 of its text, and points CURRENT at it. Offline and dev
// only: it makes no network request, writes nothing to a database, and nothing
// it writes is certified. The figures are a frequency of reported history, not
// a probability.
//
// A window is one filer's fiscal year t, with t + 5 no later than LAST_START +
// 5, so every window's end year is old enough to have been filed by the
// archive's date. Each year's figure is the one its own 10-K reports: the
// earliest-filed 10-K stating that annual period (350 to 380 days, dated by the
// period, never by the `fy` label, which some filers mislabel: #617). Its year
// is the year the period ends in, a week early, as fcf-backtest.ts counts it.
//
// - Free cash flow is operating cash flow less capex, with the engine's concept
//   choices: NetCashProvidedByUsedInOperatingActivities, else the
//   continuing-operations line (#743); PaymentsToAcquirePropertyPlantAndEquipment,
//   else PaymentsToAcquireProductiveAssets (#731). A window whose two ends use
//   different concepts is incompatible_definition, as the backtest has it.
//   The two must cover one annual period, as financial-core's free_cash_flow
//   requires (periodMismatch): an end whose two figures cover different
//   periods is mismatched_period.
// - Per share divides by diluted weighted-average shares. A split restates the
//   comparatives in the next 10-K, so each year's count is carried to the next
//   year's basis by the ratio of the next 10-K's figure for it to its own, and
//   the start count is chained through all five. A link the next 10-K does not
//   state is missing_shares.
// - Revenue is RevenueFromContractWithCustomerExcludingAssessedTax, else
//   SalesRevenueNet, else Revenues (sec-edgar.ts's order). Starting revenue
//   picks the size bucket; revenue growth is shown beside free cash flow per
//   share and never enters the Call's model.
//
// Every window with a starting figure is counted: those with a growth go into
// the sorted points, and the rest are named outcomes beside them, so a filer
// that stopped filing before year 5 (ended_early) is never silently dropped.
// Whether a filer reached year 5 is read from its 10-Ks, any us-gaap fact, not
// from the tracked series: a year-5 10-K without the figure is missing_end.
// A positive start and a zero or negative end is a growth of -100%, the floor,
// counted as a point and also as non_positive_end.
//
// Runbook (the operator approved one download on 2026-11-24; never fetch again,
// build from the cached copy, whose name carries its date):
//
//   cd services/fundamentals
//   npm run --silent build:growth-base-rates -- \
//     --archive ~/.local/share/market-agent/sec-bulk/companyfacts-2026-11-24.zip \
//     > ../../docs/eval-runs/growth-base-rates/<date>.table.md
//
// It reads the archive itself (zipEntries), prints the bucket table the results
// doc quotes, leaves every earlier table in place (a saved Call regenerates from
// the one it names), and with --windows <file> caches every filer's windows there, so
// a change of buckets re-reads the cache instead of the archive. The cache
// holds the archive's sha256 and a hash of the window code, and a cache with
// either different is read again from the archive and rewritten.

import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { inflateRawSync } from "node:zlib";

export const HORIZON_YEARS = 5;
/** The last start year: its window ends in FY2025, whose 10-Ks were due by spring 2026. */
export const LAST_START = 2020;
/** Lower edges of the starting-revenue buckets, USD. */
export const BUCKET_EDGES = [0, 100_000_000, 1_000_000_000, 10_000_000_000, 50_000_000_000] as const;
export const METRICS = ["fcf_per_share", "fcf", "revenue"] as const;
export type Metric = (typeof METRICS)[number];
export const OUTCOMES = ["non_positive_base", "ended_early", "missing_end", "incompatible_definition", "mismatched_period", "missing_shares"] as const;
export type Outcome = (typeof OUTCOMES)[number];

type Entry = Readonly<{ start?: string; end: string; val: number; accn: string; form: string; filed: string }>;
export type Companyfacts = Readonly<{ cik: number; facts?: Readonly<{ "us-gaap"?: Readonly<Record<string, Readonly<{ units?: Readonly<Record<string, ReadonlyArray<Entry>>> }>>> }> }>;

/** One fiscal year's figure as its own 10-K reports it, and every 10-K's figure for that year by accession. */
type Year = { end: string; own: Entry; byFiling: Map<string, number>; conflict: boolean };
type Series = ReadonlyMap<number, Year>;

/** One window's result for one metric: a growth (a fraction, -1 at the floor), or the outcome that keeps it from one. */
export type WindowResult = Readonly<{ growth: number; non_positive_end: boolean }> | Readonly<{ outcome: Outcome }>;
export type Window = Readonly<{ cik: number; start_year: number; revenue: number | null; results: Partial<Record<Metric, WindowResult>> }>;

const DAY_MS = 86_400_000;

const endYear = (end: string): number => new Date(Date.parse(`${end}T00:00:00Z`) - 7 * DAY_MS).getUTCFullYear();

function annual(facts: Companyfacts, concept: string, unit: string): Series {
  const years = new Map<number, Year>();
  for (const entry of facts.facts?.["us-gaap"]?.[concept]?.units?.[unit] ?? []) {
    if (entry.form !== "10-K" || entry.start === undefined || !Number.isFinite(entry.val)) continue;
    const days = (Date.parse(entry.end) - Date.parse(entry.start)) / DAY_MS;
    if (days < 350 || days > 380) continue;
    const key = endYear(entry.end);
    const year = years.get(key);
    if (year === undefined) {
      years.set(key, { end: entry.end, own: entry, byFiling: new Map([[entry.accn, entry.val]]), conflict: false });
      continue;
    }
    // Two annual periods ending in one year (a fiscal year change) leave that year without a figure.
    if (year.end !== entry.end) year.conflict = true;
    if (entry.filed < year.own.filed || (entry.filed === year.own.filed && entry.accn < year.own.accn)) year.own = entry;
    if (!year.byFiling.has(entry.accn)) year.byFiling.set(entry.accn, entry.val);
  }
  for (const [key, year] of years) if (year.conflict) years.delete(key);
  return years;
}

// The first concept with a figure for the year, and whether it is the preferred one.
function firstOf(series: ReadonlyArray<Series>, key: number): Readonly<{ entry: Entry; preferred: boolean }> | null {
  for (const [index, one] of series.entries()) {
    const year = one.get(key);
    if (year !== undefined) return { entry: year.own, preferred: index === 0 };
  }
  return null;
}

/**
 * The year the filer's latest 10-K is for, read from every us-gaap fact: each
 * 10-K's period ends with its latest annual period, or, when it states none,
 * its latest instant. -Infinity when it filed no 10-K fact. An instant never
 * outranks an annual period: of the archive's 95,867 10-Ks, 1,372 state an
 * instant within 120 days after their latest annual period, a subsequent
 * event, against 228 a year after it (measured 2026-11-25).
 */
function lastFiledYear(facts: Companyfacts): number {
  const ends = new Map<string, { annual: string | null; instant: string | null }>();
  for (const concept of Object.values(facts.facts?.["us-gaap"] ?? {})) {
    for (const entries of Object.values(concept.units ?? {})) {
      for (const entry of entries) {
        if (entry.form !== "10-K") continue;
        const filing = ends.get(entry.accn) ?? ends.set(entry.accn, { annual: null, instant: null }).get(entry.accn)!;
        if (entry.start === undefined) {
          if (filing.instant === null || entry.end > filing.instant) filing.instant = entry.end;
          continue;
        }
        const days = (Date.parse(entry.end) - Date.parse(entry.start)) / DAY_MS;
        if (days >= 350 && days <= 380 && (filing.annual === null || entry.end > filing.annual)) filing.annual = entry.end;
      }
    }
  }
  let last = -Infinity;
  for (const { annual, instant } of ends.values()) {
    const end = annual ?? instant;
    if (end !== null) last = Math.max(last, endYear(end));
  }
  return last;
}

/** Every window a filer's companyfacts give, from its first fiscal year to LAST_START. */
export function filerWindows(facts: Companyfacts, lastStart = LAST_START): Window[] {
  const revenue = ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"].map((concept) => annual(facts, concept, "USD"));
  const ocf = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"].map((concept) => annual(facts, concept, "USD"));
  const capex = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"].map((concept) => annual(facts, concept, "USD"));
  const shares = annual(facts, "WeightedAverageNumberOfDilutedSharesOutstanding", "shares");
  const all = [...revenue, ...ocf, ...capex, shares];
  const keys = all.flatMap((series) => [...series.keys()]);
  if (keys.length === 0) return [];
  const lastYear = lastFiledYear(facts);

  // Operating cash flow less capex when both cover one annual period, as free_cash_flow requires.
  const freeCashFlow = (key: number): Readonly<{ value: number; scope: string }> | "mismatched_period" | null => {
    const flow = firstOf(ocf, key);
    const spend = firstOf(capex, key);
    if (flow === null || spend === null) return null;
    if (flow.entry.start !== spend.entry.start || flow.entry.end !== spend.entry.end) return "mismatched_period";
    return { value: flow.entry.val - spend.entry.val, scope: `${flow.preferred}/${spend.preferred}` };
  };
  // The end count over the start count, the start carried to each next 10-K's basis in turn.
  const shareRatio = (start: number): number | null => {
    let count = shares.get(start)?.own.val;
    for (let key = start; key < start + HORIZON_YEARS && count !== undefined; key += 1) {
      const year = shares.get(key);
      const next = shares.get(key + 1);
      const restated = year === undefined || next === undefined ? undefined : year.byFiling.get(next.own.accn);
      count = restated === undefined || year!.own.val <= 0 ? undefined : count * (restated / year!.own.val);
    }
    const end = shares.get(start + HORIZON_YEARS)?.own.val;
    return count === undefined || end === undefined || count <= 0 || end <= 0 ? null : end / count;
  };
  // Free cash flow's end over its start, the outcome that keeps a window from one, or null with no start figure.
  const cashRatio = (start: number, end: number): number | Outcome | null => {
    const first = freeCashFlow(start);
    if (first === null) return null;
    if (first === "mismatched_period") return first;
    if (first.value <= 0) return "non_positive_base";
    if (lastYear < end) return "ended_early";
    const last = freeCashFlow(end);
    if (last === null) return "missing_end";
    if (last === "mismatched_period") return last;
    return last.scope === first.scope ? last.value / first.value : "incompatible_definition";
  };
  const grown = (ratio: number): WindowResult => ratio <= 0
    ? { growth: -1, non_positive_end: true }
    : { growth: ratio ** (1 / HORIZON_YEARS) - 1, non_positive_end: false };

  const windows: Window[] = [];
  for (const start of [...new Set(keys)].sort((a, b) => a - b)) {
    if (start > lastStart) continue;
    const end = start + HORIZON_YEARS;
    const results: Partial<Record<Metric, WindowResult>> = {};
    const ended = lastYear < end;
    const sales = firstOf(revenue, start)?.entry.val;
    if (sales !== undefined) {
      const later = firstOf(revenue, end);
      results.revenue = sales <= 0 ? { outcome: "non_positive_base" }
        : ended ? { outcome: "ended_early" }
        : later === null ? { outcome: "missing_end" }
        : grown(later.entry.val / sales);
    }
    const cash = cashRatio(start, end);
    if (typeof cash === "string") results.fcf = results.fcf_per_share = { outcome: cash };
    else if (cash !== null) {
      results.fcf = grown(cash);
      const ratio = shareRatio(start);
      results.fcf_per_share = ratio === null ? { outcome: "missing_shares" } : grown(cash / ratio);
    }
    if (Object.keys(results).length > 0) windows.push({ cik: facts.cik, start_year: start, revenue: sales ?? null, results });
  }
  return windows;
}

export type MetricRates = {
  /** Windows with a growth: the points' count. */
  n: number;
  /** Each window's growth, a fraction to 4 places, ascending. */
  points: string[];
  /** Points at the -100% floor because the end figure was zero or negative. */
  non_positive_end: number;
  outcomes: Record<Outcome, number>;
};
export type Bucket = { id: string; revenue_min: string; revenue_max: string | null; filers: number; metrics: Record<Metric, MetricRates> };
export type BaseRateTable = Readonly<{
  version: "growth_base_rates.v1";
  archive: Readonly<{ file: string; date: string; sha256: string }>;
  horizon_years: number;
  start_years: Readonly<{ first: number; last: number }>;
  filers_read: number;
  /** Windows with a starting figure but no positive starting revenue to bucket them by, per metric. */
  unbucketed: Record<Metric, number>;
  buckets: Bucket[];
}>;

const usd = (value: number): string => value >= 1e9 ? `${value / 1e9}B` : `${value / 1e6}M`;

/** The table from every filer's windows. */
export function baseRateTable(windows: ReadonlyArray<Window>, archive: BaseRateTable["archive"], filersRead: number): BaseRateTable {
  const empty = (): MetricRates => ({ n: 0, points: [], non_positive_end: 0, outcomes: Object.fromEntries(OUTCOMES.map((name) => [name, 0])) as Record<Outcome, number> });
  const buckets: Bucket[] = BUCKET_EDGES.map((min, index) => {
    const max = BUCKET_EDGES[index + 1] ?? null;
    return {
      id: max === null ? `revenue_${usd(min)}_plus` : `revenue_${min === 0 ? "0" : usd(min)}_to_${usd(max)}`,
      revenue_min: String(min),
      revenue_max: max === null ? null : String(max),
      filers: 0,
      metrics: Object.fromEntries(METRICS.map((metric) => [metric, empty()])) as Record<Metric, MetricRates>,
    };
  });
  const unbucketed = Object.fromEntries(METRICS.map((metric) => [metric, 0])) as Record<Metric, number>;
  const growths = new Map<MetricRates, number[]>();
  const filers = new Map<Bucket, Set<number>>();
  for (const window of windows) {
    const bucket = window.revenue === null || window.revenue <= 0 ? undefined : buckets.findLast((entry) => window.revenue! >= Number(entry.revenue_min));
    for (const metric of METRICS) {
      const result = window.results[metric];
      if (result === undefined) continue;
      if (bucket === undefined) { unbucketed[metric] += 1; continue; }
      const rates = bucket.metrics[metric];
      if ("outcome" in result) { rates.outcomes[result.outcome] += 1; continue; }
      (growths.get(rates) ?? growths.set(rates, []).get(rates)!).push(result.growth);
      if (result.non_positive_end) rates.non_positive_end += 1;
    }
    if (bucket !== undefined) (filers.get(bucket) ?? filers.set(bucket, new Set()).get(bucket)!).add(window.cik);
  }
  for (const bucket of buckets) {
    bucket.filers = filers.get(bucket)?.size ?? 0;
    for (const rates of Object.values(bucket.metrics)) {
      const sorted = (growths.get(rates) ?? []).map((growth) => growth.toFixed(4)).sort((a, b) => Number(a) - Number(b));
      rates.points = sorted.map((text) => text === "-0.0000" ? "0.0000" : text);
      rates.n = sorted.length;
    }
  }
  // A loop, not Math.min(...): the archive gives about 57,000 windows, near the engine's argument limit.
  const first = windows.reduce((low, window) => Math.min(low, window.start_year), Infinity);
  const last = windows.reduce((high, window) => Math.max(high, window.start_year), -Infinity);
  return {
    version: "growth_base_rates.v1",
    archive,
    horizon_years: HORIZON_YEARS,
    start_years: { first, last },
    filers_read: filersRead,
    unbucketed,
    buckets,
  };
}

const PERCENTILES = [10, 25, 50, 75, 90] as const;

// The nearest-rank percentile: the point at rank ceil(p/100 × n), the rule the Call reads its 25th percentile by.
const nearestRank = (points: ReadonlyArray<string>, p: number): string => points[Math.max(Math.ceil((p / 100) * points.length), 1) - 1]!;

/** The Markdown table of counts and percentiles per bucket and metric. */
export function renderTable(table: BaseRateTable): string {
  const pct = (text: string) => `${(Number(text) * 100).toFixed(1)}%`;
  const lines = [
    `Archive ${table.archive.file}, sha256 ${table.archive.sha256}. ${table.filers_read} filers read; start years FY${table.start_years.first} to FY${table.start_years.last}, ${table.horizon_years}-year windows. Unbucketed (no positive starting revenue): ${METRICS.map((metric) => `${metric} ${table.unbucketed[metric]}`).join(", ")}.`,
    "",
    `| Bucket (starting revenue) | Filers | Metric | N | ${PERCENTILES.map((p) => `p${p}`).join(" | ")} | At -100% (end ≤ 0) | ${OUTCOMES.join(" | ")} |`,
    `|---|---|---|---|${PERCENTILES.map(() => "---").join("|")}|---|${OUTCOMES.map(() => "---").join("|")}|`,
  ];
  for (const bucket of table.buckets) {
    for (const metric of METRICS) {
      const rates = bucket.metrics[metric];
      const marks = PERCENTILES.map((p) => rates.n === 0 ? "-" : pct(nearestRank(rates.points, p)));
      lines.push(`| ${bucket.id} | ${bucket.filers} | ${metric} | ${rates.n} | ${marks.join(" | ")} | ${rates.non_positive_end} | ${OUTCOMES.map((name) => rates.outcomes[name]).join(" | ")} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Each .json entry of a zip archive, inflated, in central-directory order. No zip64: the 2026 archive needs none, and one that does fails here. */
export function* zipEntries(path: string): Generator<Readonly<{ name: string; text: string }>> {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const read = (position: number, length: number) => {
      const buffer = Buffer.alloc(length);
      if (readSync(fd, buffer, 0, length, position) !== length) throw new Error(`short read at ${position}`);
      return buffer;
    };
    const tail = read(Math.max(0, size - 65_557), Math.min(size, 65_557));
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error("no end of central directory");
    const [entries, directorySize, directoryOffset] = [tail.readUInt16LE(end + 10), tail.readUInt32LE(end + 12), tail.readUInt32LE(end + 16)];
    if (entries === 0xffff || directoryOffset === 0xffffffff) throw new Error("zip64 archives are not read");
    const directory = read(directoryOffset, directorySize);
    for (let at = 0, index = 0; index < entries; index += 1) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory entry ${index}`);
      const [method, compressed, nameLength, extraLength, commentLength, local] = [
        directory.readUInt16LE(at + 10), directory.readUInt32LE(at + 20), directory.readUInt16LE(at + 28),
        directory.readUInt16LE(at + 30), directory.readUInt16LE(at + 32), directory.readUInt32LE(at + 42),
      ];
      const name = directory.toString("utf8", at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      if (!name.endsWith(".json")) continue;
      if (compressed === 0xffffffff || local === 0xffffffff) throw new Error("zip64 archives are not read");
      const header = read(local, 30);
      const data = read(local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), compressed);
      if (method !== 0 && method !== 8) throw new Error(`${name}: compression method ${method}`);
      yield { name, text: (method === 8 ? inflateRawSync(data) : data).toString("utf8") };
    }
  } finally {
    closeSync(fd);
  }
}

// ponytail: the window code is these functions' text and the window constants; a helper added outside this list is not in the key.
const WINDOWS_CODE = createHash("sha256").update(JSON.stringify([[endYear, annual, firstOf, lastFiledYear, filerWindows].map(String), HORIZON_YEARS, LAST_START])).digest("hex");

export type WindowsCache = Readonly<{ archive_sha256: string; windows_code: string; filers: number; windows: Window[] }>;

/** The cached windows when the cache was built from this archive by this window code, else null. */
export function readWindowsCache(path: string, archiveSha256: string): WindowsCache | null {
  if (!existsSync(path)) return null;
  const cache = JSON.parse(readFileSync(path, "utf8")) as Partial<WindowsCache>;
  return cache.archive_sha256 === archiveSha256 && cache.windows_code === WINDOWS_CODE ? cache as WindowsCache : null;
}

export function writeWindowsCache(path: string, archiveSha256: string, filers: number, windows: Window[]): void {
  writeFileSync(path, JSON.stringify({ archive_sha256: archiveSha256, windows_code: WINDOWS_CODE, filers, windows } satisfies WindowsCache));
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { archive: { type: "string" }, out: { type: "string" }, windows: { type: "string" } } });
  const archive = values.archive;
  const date = archive === undefined ? null : /^companyfacts-(\d{4}-\d{2}-\d{2})\.zip$/u.exec(basename(archive))?.[1];
  if (archive === undefined || date == null) throw new Error("--archive must name a cached companyfacts-<YYYY-MM-DD>.zip");
  const out = values.out ?? new URL("../../financial-core/data/growth-base-rates/", import.meta.url).pathname;
  const archiveSha256 = await sha256(archive);
  const cached = values.windows === undefined ? null : readWindowsCache(values.windows, archiveSha256);
  let filers = cached?.filers ?? 0;
  const windows: Window[] = cached?.windows ?? [];
  if (cached === null) {
    for (const { text } of zipEntries(archive)) {
      windows.push(...filerWindows(JSON.parse(text) as Companyfacts));
      filers += 1;
      if (filers % 2000 === 0) process.stderr.write(`${filers} filers read\n`);
    }
    if (values.windows !== undefined) writeWindowsCache(values.windows, archiveSha256, filers, windows);
  }
  const table = baseRateTable(windows, { file: basename(archive), date, sha256: archiveSha256 }, filers);
  const text = `${JSON.stringify(table)}\n`;
  const name = createHash("sha256").update(text).digest("hex");
  writeFileSync(join(out, `${name}.json`), text);
  writeFileSync(join(out, "CURRENT"), `${name}\n`);
  process.stderr.write(`table ${name}\n`);
  process.stdout.write(renderTable(table));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
