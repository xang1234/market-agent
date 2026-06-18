// 13F-HR ingest handler (forms "13F-HR", "13F-HR/A"). Filer-gated to the seeded
// superinvestor set (Q8). Atomic per filing: the document + every resolvable
// aggregated holding (read model) + notable period-over-period position-change
// claims/events are written in one transaction. Holdings whose CUSIP doesn't
// resolve to a tracked issuer are skipped + logged (coverage grows via fra-ajvd.7).
import type { FilingIndexEntry } from "./sec-daily-index.ts";
import type { FormHandlerDeps } from "./sec-daily-crawl.ts";
import { withTransaction } from "./transaction.ts";
import { createSource } from "./source-repo.ts";
import { ingestDocumentInTransaction } from "./ingest.ts";
import { createEvent, createEventSubject } from "./event-repo.ts";
import { createClaim } from "./claim-repo.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { parse13fInfoTable } from "./sec-13f-extractor.ts";
import { isSuperinvestorFiler, superinvestorName } from "./superinvestor-filers.ts";
import { resolveHoldingsByIssuer } from "./sec-13f-resolve.ts";
import { insertHolding, holdingsByFiler, priorPeriodForFiler, supersede13fFiling } from "./institutional-holdings-repo.ts";

export type Form13fFilingRef = Pick<FilingIndexEntry, "cik" | "accession" | "form" | "filedDate">;

const NOTABLE_CHANGE_PCT = 0.2;

type ChangeKind = "new_position" | "increased" | "decreased" | "exit";

function classifyChange(current: number, prior: number | undefined): ChangeKind | null {
  if (prior === undefined || prior === 0) return current > 0 ? "new_position" : null;
  const delta = (current - prior) / prior;
  if (delta >= NOTABLE_CHANGE_PCT) return "increased";
  if (delta <= -NOTABLE_CHANGE_PCT) return "decreased";
  return null;
}

function changeVerb(kind: ChangeKind): string {
  return {
    new_position: "opened a position in",
    increased: "increased its position in",
    decreased: "reduced its position in",
    exit: "exited its position in",
  }[kind];
}

export const handle13f = async (entry: Form13fFilingRef, deps: FormHandlerDeps) => {
  // Q8: process only the seeded superinvestor filers.
  if (!isSuperinvestorFiler(entry.cik)) {
    return { ingested: false };
  }
  const filerCik = String(entry.cik).padStart(10, "0");
  const filerName = superinvestorName(entry.cik) ?? `CIK ${entry.cik}`;

  const fetched = await deps.client.fetchFiling({
    cik: entry.cik,
    accession_number: entry.accession,
    document: `${entry.accession}.txt`,
  });
  const filing = parse13fInfoTable(new TextDecoder("utf-8").decode(fetched.bytes));

  // 13F-HR/A amendment routing (fra-kb2p). The cover's <amendmentType> says whether the
  // amendment RESTATES the whole portfolio or only adds NEW HOLDINGS (supplemental):
  //   - RESTATEMENT → supersede the original (filer, period) first, then re-ingest as a
  //     full filing, so an issuer the amendment dropped is removed (the stale-row bug)
  //     and real exits/changes are re-derived against the prior period.
  //   - NEW HOLDINGS → merge the added rows into the existing period and skip exit
  //     detection: the amendment isn't the full portfolio, so an unlisted original is
  //     NOT an exit (treating it as one would emit a false exit).
  // An amendment we can't classify is skipped, not guessed — guessing either way
  // corrupts the read model. An original 13F-HR is unaffected.
  const isAmendment = entry.form === "13F-HR/A";
  if (isAmendment && filing.amendmentType !== "RESTATEMENT" && filing.amendmentType !== "NEW HOLDINGS") {
    console.warn(
      `[sec-13f] skip ${entry.accession}: 13F-HR/A with unrecognized amendmentType ` +
        `"${filing.amendmentType ?? "(absent)"}" — not ingested (fra-kb2p)`,
    );
    return { ingested: false };
  }
  const restate = isAmendment && filing.amendmentType === "RESTATEMENT";
  const supplemental = isAmendment && filing.amendmentType === "NEW HOLDINGS";

  // Resolve holdings to tracked issuers (aggregation + value normalization live in
  // the shared resolver). Misses are skipped + logged with this accession's context;
  // coverage grows via CUSIP enrichment (fra-ajvd.7) + the reprocess pass (fra-msx1).
  const { resolved, unresolved } = await resolveHoldingsByIssuer(deps.db, filing, entry.filedDate);
  for (const miss of unresolved) {
    console.warn(`[sec-13f] ${entry.accession}: CUSIP ${miss.cusip} (${miss.nameOfIssuer}) not resolvable — skipped`);
  }
  const hadUnresolved = unresolved.length > 0;
  if (resolved.length === 0) {
    console.warn(`[sec-13f] skip ${entry.accession}: no resolvable holdings for ${filerName}`);
    return { ingested: false };
  }

  const period = filing.periodOfReport;
  const occurredAt = `${period}T00:00:00Z`;
  // Notable-change detection compares to the filer's prior reporting period; a
  // filer's first period is a baseline (read-model only — "new vs prior" is undefined).
  const priorPeriod = await priorPeriodForFiler(deps.db, filerCik, period);
  const priorHoldings = priorPeriod ? await holdingsByFiler(deps.db, filerCik, priorPeriod) : [];
  const priorByIssuer = new Map(priorHoldings.map((h) => [h.issuer_id, h]));
  const currentIssuerIds = new Set(resolved.map((h) => h.issuerId));

  await withTransaction(deps.db, async (tx) => {
    const source = await createSource(tx.db, {
      provider: "sec_edgar",
      kind: "filing",
      canonical_url: fetched.url,
      trust_tier: "primary",
      license_class: "public",
      retrieved_at: fetched.retrievedAt,
    });
    const { document } = await ingestDocumentInTransaction(
      { tx, objectStore: deps.objectStore },
      {
        source: { source_id: source.source_id, license_class: source.license_class },
        bytes: fetched.bytes,
        document: { kind: "filing", provider_doc_id: entry.accession, title: entry.form },
      },
    );

    const emitNotable = async (
      issuerId: string,
      kind: ChangeKind,
      text: string,
      payload: Record<string, unknown>,
    ) => {
      const claim = await createClaim(tx.db, {
        document_id: document.document_id,
        predicate: `position_change.${kind}`,
        text_canonical: text,
        polarity: "neutral",
        modality: "asserted",
        reported_by_source_id: source.source_id,
        attributed_to_type: "institution",
        attributed_to_id: filerCik,
        effective_time: occurredAt,
        confidence: 0.9,
        status: "extracted",
      });
      await createClaimArgument(tx.db, {
        claim_id: claim.claim_id,
        subject_kind: "issuer",
        subject_id: issuerId,
        role: "subject",
      });
      const event = await createEvent(tx.db, {
        event_type: "position_change",
        occurred_at: occurredAt,
        status: "reported",
        source_claim_ids: [claim.claim_id],
        source_ids: [source.source_id],
        payload_json: { filer_cik: filerCik, kind, period, ...payload },
      });
      await createEventSubject(tx.db, {
        event_id: event.event_id,
        subject_kind: "issuer",
        subject_id: issuerId,
        role: "subject",
      });
    };

    // A RESTATEMENT replaces the whole period: supersede the original filing's read-model
    // rows + derived claims/events before re-inserting, so the amendment replaces rather
    // than double-counts or leaves stale (an omitted issuer's row is removed here). Same
    // transaction as the re-insert, so a failure leaves neither applied.
    if (restate) {
      const superseded = await supersede13fFiling(tx.db, { filer_cik: filerCik, filing_period: period });
      if (superseded.holdings > 0) {
        console.warn(
          `[sec-13f] ${entry.accession} (13F-HR/A RESTATEMENT): superseded ${superseded.holdings} holding(s), ` +
            `${superseded.claims} claim(s), ${superseded.events} event(s), ${superseded.documents} document(s) ` +
            `for ${filerName} @ ${period}`,
        );
      } else {
        // No prior filing matched — the original may not be ingested yet (out-of-order
        // backfill). Surface it so an otherwise-silent gap is visible (robust handling
        // of amendment-before-original is a follow-up, mirroring fra-28yi).
        console.warn(
          `[sec-13f] ${entry.accession} (13F-HR/A RESTATEMENT): no prior filing matched for ` +
            `${filerName} @ ${period} — inserting without supersede`,
        );
      }
    }

    for (const h of resolved) {
      await insertHolding(tx.db, {
        filer_cik: filerCik,
        filer_name: filerName,
        issuer_id: h.issuerId,
        cusip: h.cusip,
        shares: h.shares,
        value_usd: h.valueUsd,
        filing_period: period,
        filing_date: entry.filedDate,
        source_id: source.source_id,
        accession: entry.accession,
      });
      if (priorPeriod === null) continue; // baseline period
      const kind = classifyChange(h.shares, priorByIssuer.get(h.issuerId)?.shares);
      if (kind === null) continue; // routine rebalance → read-model only
      await emitNotable(
        h.issuerId,
        kind,
        `${filerName} ${changeVerb(kind)} ${h.nameOfIssuer} (${h.shares.toLocaleString("en-US")} shares as of ${period}).`,
        { cusip: h.cusip, shares: h.shares, prior_shares: priorByIssuer.get(h.issuerId)?.shares ?? null },
      );
    }

    // Exits: issuers held in the prior period but absent now (fully sold). Only
    // safe when EVERY current CUSIP resolved — otherwise a still-held issuer whose
    // CUSIP didn't resolve this period would be misread as an exit. Under sparse
    // v1 resolution this usually defers exits to when coverage is complete
    // (fra-ajvd.7); new/increased/decreased above stay reliable (issuer present
    // and resolved in both periods).
    if (supplemental) {
      // Add-only amendment: the unlisted originals are still held, not exited — skip
      // exit detection entirely (the merge above just added the supplemental rows).
    } else if (priorPeriod !== null && !hadUnresolved) {
      for (const prior of priorHoldings) {
        if (currentIssuerIds.has(prior.issuer_id)) continue;
        await emitNotable(
          prior.issuer_id,
          "exit",
          `${filerName} exited its position in ${prior.cusip} (held ${prior.shares.toLocaleString("en-US")} shares as of ${priorPeriod}).`,
          { cusip: prior.cusip, shares: 0, prior_shares: prior.shares },
        );
      }
    } else if (priorPeriod !== null && hadUnresolved) {
      console.warn(`[sec-13f] ${entry.accession}: unresolved CUSIPs present — exit detection skipped to avoid false positives`);
    }
  });

  return { ingested: true };
};
