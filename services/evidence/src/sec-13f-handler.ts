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
import { parse13fInfoTable, classify13fAmendment } from "./sec-13f-extractor.ts";
import { isSuperinvestorFiler, superinvestorName } from "./superinvestor-filers.ts";
import { resolveHoldingsByIssuer } from "./sec-13f-resolve.ts";
import { insertHolding, holdingsByFiler, priorPeriodForFiler, supersede13fFiling, findFilerIssuerHolding } from "./institutional-holdings-repo.ts";

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
  const amendmentType = classify13fAmendment(filing.amendmentType);
  if (isAmendment && amendmentType === null) {
    console.warn(
      `[sec-13f] skip ${entry.accession}: 13F-HR/A with unrecognized amendmentType ` +
        `"${filing.amendmentType ?? "(absent)"}" — not ingested (fra-kb2p)`,
    );
    return { ingested: false };
  }
  const restate = isAmendment && amendmentType === "RESTATEMENT";
  const supplemental = isAmendment && amendmentType === "NEW HOLDINGS";

  // Resolve holdings to tracked issuers (aggregation + value normalization live in
  // the shared resolver). Misses are skipped + logged with this accession's context;
  // coverage grows via CUSIP enrichment (fra-ajvd.7) + the reprocess pass (fra-msx1).
  const { resolved, unresolved } = await resolveHoldingsByIssuer(deps.db, filing, entry.filedDate);
  for (const miss of unresolved) {
    console.warn(`[sec-13f] ${entry.accession}: CUSIP ${miss.cusip} (${miss.nameOfIssuer}) not resolvable — skipped`);
  }
  const hadUnresolved = unresolved.length > 0;
  // A RESTATEMENT with no resolvable holdings must STILL proceed: it authoritatively
  // restates the portfolio (possibly to empty), so the transaction below has to supersede
  // the original's rows + claims — returning here would leave them stale. For an original
  // or a supplemental amendment, an empty resolve has nothing to do (no rows to insert,
  // nothing to supersede).
  if (resolved.length === 0 && !restate) {
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
    //
    // The supersede deletes the FULL period; the loop below re-inserts only CUSIP-
    // resolvable holdings. So an issuer resolvable in the original but not in the amendment
    // (a CUSIP that no longer resolves) is dropped, not re-added — unlike an original
    // filing, where an unresolved CUSIP simply never stored a row. Acceptable: a
    // restatement is authoritative and CUSIP coverage only grows, so this is rare.
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

    // Insert each resolved holding and emit a notable change vs the prior quarter. For a
    // NEW HOLDINGS supplemental amendment the row is ADDED to the period: insertHolding
    // upserts on (filer, issuer, period), so if this issuer is already held — e.g. the
    // original reported a different share class (GOOGL) and the supplement adds another
    // (GOOG), both resolving to the same issuer — the supplement must be MERGED into the
    // existing total rather than overwriting it, and the change claim computed from the
    // merged total. An original/restatement is the full portfolio, so it overwrites as-is.
    for (const h of resolved) {
      let shares = h.shares;
      let valueUsd = h.valueUsd;
      if (supplemental) {
        const existing = await findFilerIssuerHolding(tx.db, filerCik, h.issuerId, period);
        if (existing) {
          shares += existing.shares;
          valueUsd += existing.value_usd;
        }
      }
      await insertHolding(tx.db, {
        filer_cik: filerCik,
        filer_name: filerName,
        issuer_id: h.issuerId,
        cusip: h.cusip,
        shares,
        value_usd: valueUsd,
        filing_period: period,
        filing_date: entry.filedDate,
        source_id: source.source_id,
        accession: entry.accession,
      });
      if (priorPeriod === null) continue; // baseline period
      const kind = classifyChange(shares, priorByIssuer.get(h.issuerId)?.shares);
      if (kind === null) continue; // routine rebalance → read-model only
      await emitNotable(
        h.issuerId,
        kind,
        `${filerName} ${changeVerb(kind)} ${h.nameOfIssuer} (${shares.toLocaleString("en-US")} shares as of ${period}).`,
        { cusip: h.cusip, shares, prior_shares: priorByIssuer.get(h.issuerId)?.shares ?? null },
      );
    }

    // Exits: issuers held in the prior period but absent now (fully sold). Skipped for a
    // supplemental (NEW HOLDINGS) amendment — it's add-only, so an unlisted original is
    // still held, not exited. Otherwise detect exits only when EVERY current CUSIP
    // resolved; an unresolved one could mask a still-held issuer as an exit, so it's
    // deferred until coverage is complete (fra-ajvd.7). new/increased/decreased above stay
    // reliable (issuer present + resolved in both periods).
    if (!supplemental && priorPeriod !== null) {
      if (!hadUnresolved) {
        for (const prior of priorHoldings) {
          if (currentIssuerIds.has(prior.issuer_id)) continue;
          await emitNotable(
            prior.issuer_id,
            "exit",
            `${filerName} exited its position in ${prior.cusip} (held ${prior.shares.toLocaleString("en-US")} shares as of ${priorPeriod}).`,
            { cusip: prior.cusip, shares: 0, prior_shares: prior.shares },
          );
        }
      } else {
        console.warn(`[sec-13f] ${entry.accession}: unresolved CUSIPs present — exit detection skipped to avoid false positives`);
      }
    }
  });

  return { ingested: true };
};
