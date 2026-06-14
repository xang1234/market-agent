import { mintVendorPointFact } from "../../analyze/src/vendor-fact.ts";
import { MAPPED_METRIC_KEYS, mapPayloadToVendorStats } from "./fact-mapper.ts";
import { writeIssuerEnrichments } from "./enrichment-writer.ts";
import { isAlreadyIngested, writeLedgerEntry, type LedgerStatus } from "./ledger.ts";
import {
  ARTIFACT_PROVIDER,
  loadMetricIds,
  newIngestionBatchId,
  resolveSourceId,
} from "./provenance.ts";
import { domicileFromCountry, seedUniverseEntry } from "./universe-seed.ts";
import type {
  BundleRow,
  QueryExecutor,
  WeeklyReferenceBundle,
  WeeklyReferenceManifest,
} from "./types.ts";

const WEEKLY_RELEASE_TAG = "weekly-reference-data";
const SOURCE_KIND = "reference_data";
// Weekly fundamentals lag the market by ~3 days — point facts are vendor-stale,
// never real-time.
const VENDOR_FRESHNESS = "stale";
const ERROR_SAMPLE_CAP = 5;

export type EtlReport = {
  status: "ingested" | "skipped";
  market: string;
  sha256: string;
  rowsTotal: number;
  rowsIngested: number;
  rowsSkipped: number;
  factsWritten: number;
  ingestionBatchId: string | null;
  errorSamples: string[];
};

export type EtlOptions = {
  clock?: () => Date;
  force?: boolean;
};

// Lands one weekly-reference bundle into Postgres: seed the universe identity,
// coalesce-fill issuer sector/industry/domicile, write provenance enrichments, and
// mint method='vendor' point facts for the populated technical/momentum stats. The
// run is idempotent (the ledger sha256 gate skips an unchanged bundle) and resilient
// (a row that throws is counted and skipped, never aborting the batch). Pure of IO:
// the caller fetches + validates the manifest/bundle and passes a db handle.
export async function runWeeklyReferenceEtl(
  db: QueryExecutor,
  manifest: WeeklyReferenceManifest,
  bundle: WeeklyReferenceBundle,
  options: EtlOptions = {},
): Promise<EtlReport> {
  const clock = options.clock ?? (() => new Date());
  const { market, sha256 } = manifest;
  const rowsTotal = bundle.universe.length;
  const startedAt = clock();

  if (!options.force && (await isAlreadyIngested(db, { releaseTag: WEEKLY_RELEASE_TAG, market, sha256 }))) {
    return skipped(market, sha256, rowsTotal);
  }

  const sourceId = await resolveSourceId(db, { provider: ARTIFACT_PROVIDER, kind: SOURCE_KIND });
  const metricIds = await loadMetricIds(db, MAPPED_METRIC_KEYS);
  const ingestionBatchId = newIngestionBatchId();
  const asOf = `${manifest.as_of_date}T00:00:00Z`;
  const observedAt = startedAt.toISOString();
  const rowsBySymbol = indexRowsBySymbol(bundle.snapshot.rows);

  let rowsIngested = 0;
  let rowsSkipped = 0;
  let factsWritten = 0;
  const errorSamples: string[] = [];

  for (const entry of bundle.universe) {
    try {
      const symbol = entry.symbol?.trim().toUpperCase();
      const row = symbol ? rowsBySymbol.get(symbol) : undefined;
      const domicile =
        domicileFromCountry(payloadCountry(row)) ?? (entry.market === "US" ? "US" : undefined);

      const seeded = await seedUniverseEntry(db, entry, { domicile });
      if (!seeded) {
        rowsSkipped++;
        continue;
      }

      await writeIssuerEnrichments(
        db,
        seeded.issuerId,
        { sector: entry.sector, industry: entry.industry, domicile },
        { sourceId, provider: ARTIFACT_PROVIDER, retrievedAt: observedAt },
      );

      if (row) {
        const stats = mapPayloadToVendorStats(row.normalized_payload, {
          currency: entry.currency ?? "USD",
        });
        for (const stat of stats) {
          const metricId = metricIds.get(stat.metricKey);
          if (!metricId) continue;
          await mintVendorPointFact(db, {
            subject: { kind: "issuer", id: seeded.issuerId },
            metricId,
            value: stat.value,
            unit: stat.unit,
            ...(stat.currency ? { currency: stat.currency } : {}),
            asOf,
            sourceId,
            freshnessClass: VENDOR_FRESHNESS,
            observedAt,
            ingestionBatchId,
          });
          factsWritten++;
        }
      }
      rowsIngested++;
    } catch (error) {
      rowsSkipped++;
      if (errorSamples.length < ERROR_SAMPLE_CAP) {
        errorSamples.push(`${entry.symbol ?? "?"}: ${messageOf(error)}`);
      }
    }
  }

  const status = runStatus(rowsIngested, rowsTotal, rowsSkipped);
  await writeLedgerEntry(db, {
    provider: ARTIFACT_PROVIDER,
    releaseTag: WEEKLY_RELEASE_TAG,
    market,
    schemaVersion: bundle.schema_version,
    bundleAssetName: manifest.bundle_asset_name,
    sha256,
    asOfDate: manifest.as_of_date,
    sourceId,
    ingestionBatchId,
    rowsTotal,
    rowsIngested,
    rowsSkipped,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: clock().toISOString(),
  });

  return {
    status: "ingested",
    market,
    sha256,
    rowsTotal,
    rowsIngested,
    rowsSkipped,
    factsWritten,
    ingestionBatchId,
    errorSamples,
  };
}

function runStatus(rowsIngested: number, rowsTotal: number, rowsSkipped: number): LedgerStatus {
  if (rowsIngested === 0 && rowsTotal > 0) return "failed";
  if (rowsSkipped > 0) return "partial";
  return "succeeded";
}

function indexRowsBySymbol(rows: BundleRow[]): Map<string, BundleRow> {
  const bySymbol = new Map<string, BundleRow>();
  for (const row of rows) {
    const symbol = row.symbol?.trim().toUpperCase();
    if (symbol) bySymbol.set(symbol, row);
  }
  return bySymbol;
}

function payloadCountry(row: BundleRow | undefined): string | null | undefined {
  const country = row?.normalized_payload.country;
  return typeof country === "string" ? country : undefined;
}

function skipped(market: string, sha256: string, rowsTotal: number): EtlReport {
  return {
    status: "skipped",
    market,
    sha256,
    rowsTotal,
    rowsIngested: 0,
    rowsSkipped: 0,
    factsWritten: 0,
    ingestionBatchId: null,
    errorSamples: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
