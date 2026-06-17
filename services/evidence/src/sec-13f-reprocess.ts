// 13F harvest + read-model reprocess (fra-msx1, pairs with the fra-ajvd.7 CUSIP
// enrichment). A 13F-HR first ingested with a mix of resolvable and unresolvable
// CUSIPs persists a document (>=1 holding resolved), so the daily crawl's accession
// dedup skips it forever — the unresolvable holdings are never backfilled even after
// OpenFIGI enrichment makes their CUSIPs resolvable. This pass closes that gap for
// the seeded superinvestor filers:
//
//   per filer → each 13F-HR accession in the window:
//     1. fetch + parse the filing
//     2. HARVEST: enrich each distinct CUSIP via OpenFIGI (resolver's enrichCusip).
//        It DB-checks first, so an already-resolvable CUSIP is a cheap no-op (no API
//        call); only genuinely unresolved CUSIPs hit OpenFIGI.
//     3. RE-RESOLVE: resolve holdings by issuer (now more resolve) and upsert the
//        read model — insertHolding upserts on (filer, issuer, period), so a rerun
//        is idempotent.
//
// Read-model ONLY: it does not re-emit position-change claims/events. createClaim/
// createEvent are non-idempotent plain inserts, and retroactively recomputing
// historical change-signals is lower-value + riskier — tracked separately as fra-su3m.
// The harvest's live OpenFIGI calls are deliberately OUT of the atomic crawl, so this
// is a CLI/batch step, never inline ingest.
import { parse13fInfoTable } from "./sec-13f-extractor.ts";
import { resolveHoldingsByIssuer } from "./sec-13f-resolve.ts";
import { isSuperinvestorFiler, superinvestorName } from "./superinvestor-filers.ts";
import { insertHolding, sourceIdForAccession } from "./institutional-holdings-repo.ts";
import { createSource } from "./source-repo.ts";
import { withTransaction } from "./transaction.ts";
import { recentSubmissionRows, type SecFilingFetcher, type SecSubmissions } from "./sec-edgar.ts";
import type { QueryExecutor } from "./types.ts";
import { enrichCusip } from "../../resolver/src/cusip-enrichment.ts";
import type { OpenReferenceProviderConfig } from "../../resolver/src/provider-sources.ts";
import type { FetchImpl } from "../../resolver/src/open-reference-providers.ts";

// Only the original 13F-HR is reprocessed — amendments (13F-HR/A) are not ingested
// by the crawl either (their partial-update semantics are tracked in fra-kb2p).
const FORM_13F_HR = "13F-HR";
const DAY_MS = 24 * 60 * 60 * 1000;

// Listing discovery (submissions) + per-filing fetch — SecEdgarClient satisfies it.
export type Reprocess13fClient = SecFilingFetcher & {
  fetchSubmissions(cik: number): Promise<SecSubmissions>;
};

export type Reprocess13fDeps = {
  db: QueryExecutor;
  secClient: Reprocess13fClient;
  openfigi: OpenReferenceProviderConfig["openfigi"];
  // Injected into enrichCusip's OpenFIGI call (defaults to the global fetch).
  openfigiFetch?: FetchImpl;
};

export type Reprocess13fInput = {
  cik: number;
  // 13F filings are quarterly; the default window covers ~3 years of filings.
  sinceDays?: number;
  maxFilings?: number;
  now?: () => Date;
};

export type Reprocess13fResult = {
  accessionsProcessed: number;
  cusipsEnriched: number; // newly mapped to an issuer via OpenFIGI this run
  cusipsUnmapped: number; // OpenFIGI returned no/ambiguous/non-equity match
  holdingsUpserted: number; // read-model rows written across all accessions
};

export async function reprocessFiler13f(
  deps: Reprocess13fDeps,
  input: Reprocess13fInput,
): Promise<Reprocess13fResult> {
  // Q8 guard: this writes superinvestor holdings, so it must only run for seeded
  // filers (the same gate handle13f applies on the crawl).
  if (!isSuperinvestorFiler(input.cik)) {
    throw new Error(`reprocessFiler13f: CIK ${input.cik} is not a seeded superinvestor filer`);
  }
  const filerCik = String(input.cik).padStart(10, "0");
  const filerName = superinvestorName(input.cik) ?? `CIK ${input.cik}`;
  const sinceDays = input.sinceDays ?? 365 * 3;
  const maxFilings = input.maxFilings ?? 20;
  const now = input.now ?? (() => new Date());
  const cutoffMs = now().getTime() - sinceDays * DAY_MS;

  const submissions = await deps.secClient.fetchSubmissions(input.cik);
  const inWindow = recentSubmissionRows(submissions.filings.recent)
    .filter((row) => row.form === FORM_13F_HR)
    .filter((row) => row.filedAtMs >= cutoffMs);
  // No silent truncation: EDGAR returns `recent` newest-first, so the slice keeps the
  // most recent filings — but a caller should know coverage was capped.
  if (inWindow.length > maxFilings) {
    console.warn(
      `[sec-13f-reprocess] CIK ${input.cik}: ${inWindow.length} 13F-HR filings in the last ${sinceDays}d ` +
        `exceed the cap of ${maxFilings}; processing the most recent ${maxFilings}.`,
    );
  }
  const candidates = inWindow.slice(0, maxFilings);

  const result: Reprocess13fResult = { accessionsProcessed: 0, cusipsEnriched: 0, cusipsUnmapped: 0, holdingsUpserted: 0 };
  for (const candidate of candidates) {
    const fetched = await deps.secClient.fetchFiling({
      cik: input.cik,
      accession_number: candidate.accession,
      document: `${candidate.accession}.txt`,
    });
    const filing = parse13fInfoTable(new TextDecoder("utf-8").decode(fetched.bytes));

    // HARVEST: enrich each distinct reported CUSIP. enrichCusip DB-checks first, so
    // an already-resolvable CUSIP costs one cheap query (status "already"); only an
    // unresolved CUSIP hits OpenFIGI. A transport failure propagates (it must fail
    // the run for retry, not masquerade as "unmapped").
    for (const cusip of new Set(filing.holdings.map((h) => h.cusip))) {
      const outcome = await enrichCusip(
        { db: deps.db, openfigi: deps.openfigi, fetchImpl: deps.openfigiFetch },
        cusip,
      );
      if (outcome.status === "enriched") result.cusipsEnriched += 1;
      else if (outcome.status === "unmapped") result.cusipsUnmapped += 1;
    }

    // RE-RESOLVE against the now-enriched instruments and upsert the read model.
    const { resolved } = await resolveHoldingsByIssuer(deps.db, filing, candidate.filedDate);
    result.accessionsProcessed += 1;
    if (resolved.length === 0) {
      console.warn(`[sec-13f-reprocess] ${candidate.accession}: still no resolvable holdings for ${filerName}`);
      continue;
    }

    // Reuse the source that archived this filing at first ingest: its retrieval is
    // the authoritative provenance and it carries the stored document. Only mint a
    // new source if the accession was never ingested (a corner case for the seeded
    // superinvestors) — and that source is itself reused on the next run, so a rerun
    // never leaks document-less sources. This is a read-model refresh, not
    // re-archival (the bytes are already content-addressed at first ingest; no S3).
    const existingSourceId = await sourceIdForAccession(deps.db, candidate.accession);
    await withTransaction(deps.db, async (tx) => {
      const sourceId =
        existingSourceId ??
        (
          await createSource(tx.db, {
            provider: "sec_edgar",
            kind: "filing",
            canonical_url: fetched.url,
            trust_tier: "primary",
            license_class: "public",
            retrieved_at: fetched.retrievedAt,
          })
        ).source_id;
      for (const h of resolved) {
        await insertHolding(tx.db, {
          filer_cik: filerCik,
          filer_name: filerName,
          issuer_id: h.issuerId,
          cusip: h.cusip,
          shares: h.shares,
          value_usd: h.valueUsd,
          filing_period: filing.periodOfReport,
          filing_date: candidate.filedDate,
          source_id: sourceId,
          accession: candidate.accession,
        });
        result.holdingsUpserted += 1;
      }
    });
  }
  return result;
}
