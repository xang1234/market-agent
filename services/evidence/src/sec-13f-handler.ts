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
import { parse13fInfoTable, type Form13fHolding } from "./sec-13f-extractor.ts";
import { isSuperinvestorFiler, superinvestorName } from "./superinvestor-filers.ts";
import { resolveIssuerByCusip } from "./cusip-issuer-map.ts";
import { insertHolding, holdingsByFiler, priorPeriodForFiler } from "./institutional-holdings-repo.ts";

export type Form13fFilingRef = Pick<FilingIndexEntry, "cik" | "accession" | "form" | "filedDate">;

const NOTABLE_CHANGE_PCT = 0.2;
// SEC switched 13F <value> from thousands to whole USD for filings on/after this date.
const WHOLE_USD_FROM = "2023-01-01";

type ResolvedHolding = {
  issuerId: string;
  cusip: string;
  nameOfIssuer: string;
  shares: number;
  valueUsd: number;
};

type ChangeKind = "new_position" | "increased" | "decreased" | "exit";

// A filer reports a position split across managers, so the same CUSIP appears in
// multiple rows — sum shares + value. PRN (debt principal) rows are excluded; this
// is an equity-holdings view.
function aggregateByCusip(
  holdings: ReadonlyArray<Form13fHolding>,
): Map<string, { nameOfIssuer: string; shares: number; valueRaw: number }> {
  const byCusip = new Map<string, { nameOfIssuer: string; shares: number; valueRaw: number }>();
  for (const h of holdings) {
    if (h.sshPrnamtType !== "SH") continue;
    const existing = byCusip.get(h.cusip);
    if (existing) {
      existing.shares += h.shares;
      existing.valueRaw += h.valueRaw;
    } else {
      byCusip.set(h.cusip, { nameOfIssuer: h.nameOfIssuer, shares: h.shares, valueRaw: h.valueRaw });
    }
  }
  return byCusip;
}

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
  const valueMultiplier = entry.filedDate < WHOLE_USD_FROM ? 1000 : 1;

  // Aggregate, then resolve each CUSIP to a tracked issuer (skip + log misses).
  const resolved: ResolvedHolding[] = [];
  for (const [cusip, agg] of aggregateByCusip(filing.holdings)) {
    const issuerId = await resolveIssuerByCusip(deps.db, cusip);
    if (issuerId === null) {
      console.warn(`[sec-13f] ${entry.accession}: CUSIP ${cusip} (${agg.nameOfIssuer}) not resolvable — skipped`);
      continue;
    }
    resolved.push({
      issuerId,
      cusip,
      nameOfIssuer: agg.nameOfIssuer,
      shares: agg.shares,
      valueUsd: agg.valueRaw * valueMultiplier,
    });
  }
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

    // Exits: issuers held in the prior period but absent now (fully sold).
    if (priorPeriod !== null) {
      for (const prior of priorHoldings) {
        if (currentIssuerIds.has(prior.issuer_id)) continue;
        await emitNotable(
          prior.issuer_id,
          "exit",
          `${filerName} exited its position in ${prior.cusip} (held ${prior.shares.toLocaleString("en-US")} shares as of ${priorPeriod}).`,
          { cusip: prior.cusip, shares: 0, prior_shares: prior.shares },
        );
      }
    }
  });

  return { ingested: true };
};
