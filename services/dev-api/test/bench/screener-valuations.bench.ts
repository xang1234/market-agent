// What a screen costs now that market cap and P/E are certified figures, what
// certifying the universe costs, and what valuing them inline per screen would
// cost, on a real PostgreSQL. Opt-in, never part of `npm test`:
//
//   REQUIRE_DOCKER=1 node --experimental-strip-types --test test/bench/screener-valuations.bench.ts
//
// BENCH_SIZES (default "100,500,1000") are the universe sizes a screen's
// candidate load is timed at, and BENCH_RUNS (default 7) the runs per side.
// BENCH_LEGACY_LOADER names an older db-candidates.ts to time against the
// current one, the two sides alternating. BENCH_PLAN_SIZES (default
// "1,5,10,25") are the issuers per engine plan the batch's cost is timed at;
// one issuer per plan is what valuing inline per screen would cost.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { Pool } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable, registerLifoCleanup } from "../../../../db/test/docker-pg.ts";
import { createRuntimeAuthority } from "../../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../../financial-engine/src/evidence-adapter.ts";
import { buildDeterministicPlan } from "../../../financial-engine/src/planner.ts";
import { publishRequest } from "../../../financial-engine/src/request.ts";
import { valuationOperations, valuationOutputs } from "../../../financial-engine/src/valuation-plan.ts";
import { loadPostgresScreenerCandidates, type ScreenerCandidateQueryExecutor } from "../../../screener/src/db-candidates.ts";
import { certifyScreenerUniverse } from "../../src/screener-certification.ts";
import { BENCH_CUTOFF, seedBenchBase, seedSyntheticListings, type SyntheticListing } from "./synthetic-universe.ts";

const SIZES = (process.env.BENCH_SIZES ?? "100,500,1000").split(",").map(Number);
const RUNS = Number(process.env.BENCH_RUNS ?? "7");
const PLAN_SIZES = (process.env.BENCH_PLAN_SIZES ?? "1,5,10,25").split(",").map(Number);
/** 11:00 on Monday 2024-06-10 in New York: the figures certified at BENCH_CUTOFF are current. */
const SCREEN_AT = new Date("2024-06-10T15:00:00.000Z");

type Loader = (db: ScreenerCandidateQueryExecutor, now: Date) => Promise<ReadonlyArray<{ fundamentals: { market_cap: number | null; pe_ratio: number | null } }>>;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function summary(label: string, samples: number[]): string {
  return `${label}: median ${median(samples).toFixed(1)} ms, range ${Math.min(...samples).toFixed(1)}-${Math.max(...samples).toFixed(1)} ms over ${samples.length} runs`;
}

/** An executor that counts the statements sent through it. */
function counting(pool: Pool): { db: ScreenerCandidateQueryExecutor; statements: () => number } {
  let statements = 0;
  const db = { query: (text: string, values?: unknown[]) => { statements += 1; return pool.query(text, values); } } as ScreenerCandidateQueryExecutor;
  return { db, statements: () => statements };
}

/** The listings' market cap and P/E valued in one plan shaped like the batch's: a unit per issuer and figure. */
async function valuePlan(pool: Pool, owner: string, listings: ReadonlyArray<SyntheticListing>): Promise<void> {
  const authority = createRuntimeAuthority({
    owner_user_id: owner,
    egress_channel: "screener",
    parent: { kind: "screener_valuation_run", id: randomUUID(), version: "bench.v1" },
    allowed_source_classes: ["sec_filing", "market_data"],
    feature: { surface: "screener", capability: "screener-valuation", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
  const cells = listings.flatMap((_, row) => (["market_cap", "pe_ratio"] as const).map((valuation) => ({ valuation, row, unit: `${valuation}_r${row}` })));
  const outcome = await publishRequest(pool, {
    authority,
    request_key: randomUUID(),
    plan: async () => buildDeterministicPlan({
      plan_id: randomUUID(),
      origin: { kind: "api_request", ref: "bench" },
      knowledge_cutoff: BENCH_CUTOFF,
      cutoff_timezone: "UTC",
      reporting_basis: "as_reported",
      freshness_max_age_days: null,
      authority,
      parent_limits: {},
      max_model_calls: 0,
      requested_subjects: listings.map((listing, row) => ({ mention: `row ${row}`, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: listing.issuer_id }, label: listing.ticker } })),
      publication_unit_kind: "screener_valuation",
    }, {
      subjects: listings.map((_, row) => ({ slot_id: `r${row}`, mention: `row ${row}` })),
      operations: cells.flatMap((cell) => valuationOperations(cell.unit, `r${cell.row}`, cell.valuation)),
      outputs: cells.flatMap((cell) => valuationOutputs(cell.unit, cell.valuation).map((node) => ({ output_id: `o_${node}`, node_id: node }))),
      thresholds: [],
    }, cells.map((cell) => ({ unit_id: cell.unit, output_ids: valuationOutputs(cell.unit, cell.valuation).map((node) => `o_${node}`) }))),
    evidence: createEvidenceFinancialPort,
    persistParent: async () => {},
  });
  assert.equal(outcome.status, "driven", JSON.stringify(outcome));
}

test("screener valuation benchmark", { timeout: 3_600_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the benchmark");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "screener-bench");
  const db = await connectedClient(t, databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  registerLifoCleanup(t, () => pool.end());
  await seedBenchBase(db);
  const current: Loader = loadPostgresScreenerCandidates;
  const legacy = process.env.BENCH_LEGACY_LOADER
    ? (await import(pathToFileURL(resolve(process.env.BENCH_LEGACY_LOADER)).href)).loadPostgresScreenerCandidates as Loader
    : null;

  const report: string[] = [];
  const listings: SyntheticListing[] = [];
  for (const size of SIZES) {
    const added = await seedSyntheticListings(db, listings.length, size - listings.length);
    listings.push(...added);
    const started = performance.now();
    const outcomes = await certifyScreenerUniverse({ pool, evidence: createEvidenceFinancialPort }, BENCH_CUTOFF);
    const elapsed = performance.now() - started;
    assert.deepEqual([...new Set(outcomes.map((chunk) => `${chunk.outcome}/${chunk.rejected_units}`))], ["published/0"], "every run published every unit");
    report.push(`certifying ${added.length} new issuer(s) in runs of 25: ${elapsed.toFixed(0)} ms, ${(elapsed / added.length).toFixed(1)} ms per issuer`);
    await db.query("analyze");

    const sides: Array<[string, Loader]> = legacy ? [["legacy", legacy], ["certified", current]] : [["certified", current]];
    const samples = new Map(sides.map(([name]) => [name, [] as number[]]));
    for (let run = 0; run < RUNS; run += 1) {
      for (const [name, load] of sides) {
        const begun = performance.now();
        const candidates = await load(pool, SCREEN_AT);
        samples.get(name)!.push(performance.now() - begun);
        assert.equal(candidates.length, size, `${name}: every seeded listing is a candidate`);
        if (name === "certified") assert.ok(candidates.every((candidate) => candidate.fundamentals.market_cap !== null && candidate.fundamentals.pe_ratio !== null), "every certified figure is read");
      }
    }
    for (const [name, load] of sides) {
      const recorder = counting(pool);
      const cpu = process.cpuUsage();
      const begun = performance.now();
      await load(recorder.db, SCREEN_AT);
      const wall = performance.now() - begun;
      const { user, system } = process.cpuUsage(cpu);
      report.push(`${summary(`${name} screen, ${size} listings`, samples.get(name)!)}; ${recorder.statements()} statements; this process's CPU ${((user + system) / 1000).toFixed(0)} ms of ${wall.toFixed(0)} ms`);
    }
    const certifiedRead: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const begun = performance.now();
      await pool.query(
        `select v.issuer_id::text, v.valuation, v.value::text, v.currency, v.session_date::text, l.timezone
           from screener_certified_valuations v join listings l on l.listing_id = v.listing_id
          where v.issuer_id = any($1::uuid[]) and v.value is not null`,
        [listings.map((listing) => listing.issuer_id)],
      );
      certifiedRead.push(performance.now() - begun);
    }
    report.push(summary(`the certified read alone, ${size} issuers`, certifiedRead));
  }

  const owner = randomUUID();
  await db.query(`insert into users (user_id, email) values ($1, 'bench@example.test')`, [owner]);
  // Each plan size values its own 50 issuers, so no plan reuses another's bindings.
  const largest = Math.max(...PLAN_SIZES);
  const fresh = await seedSyntheticListings(db, listings.length, 50 * PLAN_SIZES.length + 1 + largest);
  await db.query("analyze");
  for (const [index, size] of PLAN_SIZES.entries()) {
    const perIssuer: number[] = [];
    let cpuMs = 0;
    let wallMs = 0;
    for (let start = 50 * index; start < 50 * (index + 1); start += size) {
      const plan = fresh.slice(start, Math.min(start + size, 50 * (index + 1)));
      const cpu = process.cpuUsage();
      const begun = performance.now();
      await valuePlan(pool, owner, plan);
      const elapsed = performance.now() - begun;
      const { user, system } = process.cpuUsage(cpu);
      cpuMs += (user + system) / 1000;
      wallMs += elapsed;
      perIssuer.push(elapsed / plan.length);
    }
    report.push(`${summary(`plans of ${size} issuer(s), per issuer`, perIssuer)}; this process's CPU ${(100 * cpuMs / wallMs).toFixed(0)}% of wall`);
  }
  let statements = 0;
  const countingPool = new Pool({ connectionString: databaseUrl, max: 4 });
  registerLifoCleanup(t, () => countingPool.end());
  const wrapped = new WeakSet<object>();
  countingPool.on("connect", (client) => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args) => { statements += 1; return query(...args); };
  });
  for (const plan of [fresh.slice(-1), fresh.slice(-1 - largest, -1)]) {
    statements = 0;
    await valuePlan(countingPool, owner, plan);
    report.push(`a plan of ${plan.length} issuer(s) sends ${statements} statements, ${(statements / plan.length).toFixed(0)} per issuer`);
  }
  const trips: number[] = [];
  for (let run = 0; run < 200; run += 1) {
    const begun = performance.now();
    await db.query("select 1");
    trips.push(performance.now() - begun);
  }
  report.push(summary("one select 1 round trip", trips));
  console.log(`\n${report.join("\n")}\n`);
});
