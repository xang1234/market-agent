// Form 4 ingest handler (forms "4" and "4/A"). Atomic per the FormHandler
// contract: the filing document + every transaction (read-model row + event) and
// the materiality-gated claims are written in a single transaction, so a partial
// write can never strand a filing (the daily crawl skips accessions that already
// have a documents row).
import type { FilingIndexEntry } from "./sec-daily-index.ts";
import type { FormHandlerDeps } from "./sec-daily-crawl.ts";
import { withTransaction } from "./transaction.ts";
import { createSource } from "./source-repo.ts";
import { ingestDocumentInTransaction } from "./ingest.ts";
import { createEvent, createEventSubject } from "./event-repo.ts";
import { createClaim } from "./claim-repo.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { insertInsiderTransaction } from "./insider-transactions-repo.ts";
import { parseForm4, type Form4Transaction, type Form4ReportingOwner } from "./sec-form4-extractor.ts";
import { resolveIssuerIdByCik } from "./sec-issuer-resolve.ts";

// handleForm4 reads only these fields of a filing — the CIK to resolve the
// issuer, the accession to fetch/dedup, and form/filing date for the document
// row. It deliberately does NOT depend on the daily-index-only fields
// (company, fileName), so both the crawl (which has a full FilingIndexEntry)
// and the backfill (which has no index row) can drive it without fabricating
// fields. FilingIndexEntry is a structural supertype, so the FORM_HANDLERS
// registration still type-checks against the FormHandler contract.
export type Form4FilingRef = Pick<FilingIndexEntry, "cik" | "accession" | "form" | "filedDate">;

const MATERIAL_VALUE_THRESHOLD = 100_000;

const TRANSACTION_TYPE_BY_CODE: Readonly<Record<string, string>> = {
  P: "buy",
  S: "sell",
  M: "option_exercise",
  G: "gift",
};

function transactionType(code: string): string {
  return TRANSACTION_TYPE_BY_CODE[code] ?? "other";
}

function insiderRole(owner: Form4ReportingOwner): string {
  if (owner.isOfficer) return owner.officerTitle ?? "Officer";
  if (owner.isDirector) return "Director";
  if (owner.isTenPercentOwner) return "10% Owner";
  return "Insider";
}

// Material (→ agent-visible claim): an open-market purchase or sale (codes P/S)
// by an officer or director, at or above the value threshold. Everything else
// (grants, option exercises, gifts, tax withholding, sub-threshold) is recorded
// in the read model + timeline but not surfaced to agents.
function isMaterial(txn: Form4Transaction, owner: Form4ReportingOwner): boolean {
  return (
    (txn.code === "P" || txn.code === "S") &&
    (owner.isOfficer || owner.isDirector) &&
    // Contract is |value| ≥ threshold. value = shares × price is non-negative
    // today, so Math.abs is currently a no-op, but it keeps the code faithful to
    // the stated contract and robust if value ever carries a sign.
    Math.abs(txn.value ?? 0) >= MATERIAL_VALUE_THRESHOLD
  );
}

function claimText(owner: Form4ReportingOwner, txn: Form4Transaction, type: string): string {
  const action = type === "buy" ? "bought" : type === "sell" ? "sold" : type;
  const price = txn.pricePerShare === null ? "" : ` at $${txn.pricePerShare}`;
  return `${owner.name} (${insiderRole(owner)}) ${action} ${txn.shares} shares${price}.`;
}

export const handleForm4 = async (entry: Form4FilingRef, deps: FormHandlerDeps) => {
  // Fetch + parse + resolve the issuer outside the transaction (network/reads).
  const fetched = await deps.client.fetchFiling({
    cik: entry.cik,
    accession_number: entry.accession,
    document: `${entry.accession}.txt`,
  });
  const filing = parseForm4(new TextDecoder("utf-8").decode(fetched.bytes));

  // A Form 4 with no non-derivative transactions (e.g. derivative/option-only
  // filings, which this extractor does not yet parse) has nothing to record.
  // Skip WITHOUT persisting source/document, so the accession is not marked done
  // by the crawl/backfill dedup — a later run can reprocess it once derivative
  // parsing lands, rather than the filing being masked by an orphan documents row.
  if (filing.transactions.length === 0) {
    console.warn(`[sec-form4] skip ${entry.accession}: no non-derivative transactions extracted`);
    return { ingested: false };
  }

  const issuerId = await resolveIssuerIdByCik(deps.db, filing.issuerCik);
  if (issuerId === null) {
    console.warn(`[sec-form4] skip ${entry.accession}: issuer CIK ${filing.issuerCik} not tracked`);
    return { ingested: false };
  }

  const filedAt = `${entry.filedDate}T00:00:00Z`;

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

    for (const txn of filing.transactions) {
      const type = transactionType(txn.code);
      const role = insiderRole(filing.reportingOwner);
      const occurredAt = `${txn.transactionDate}T00:00:00Z`;

      await insertInsiderTransaction(tx.db, {
        issuer_id: issuerId,
        insider_name: filing.reportingOwner.name,
        insider_role: role,
        insider_cik: filing.reportingOwner.cik,
        transaction_date: txn.transactionDate,
        transaction_code: txn.code,
        transaction_type: type,
        acquired_disposed: txn.acquiredDisposed,
        shares: txn.shares,
        price: txn.pricePerShare,
        value: txn.value,
        source_id: source.source_id,
        accession: entry.accession,
        filed_at: filedAt,
      });

      const claimIds: string[] = [];
      if (isMaterial(txn, filing.reportingOwner)) {
        const claim = await createClaim(tx.db, {
          document_id: document.document_id,
          predicate: "insider.transaction",
          text_canonical: claimText(filing.reportingOwner, txn, type),
          polarity: "neutral",
          modality: "asserted",
          reported_by_source_id: source.source_id,
          attributed_to_type: "insider",
          attributed_to_id: filing.reportingOwner.cik,
          effective_time: occurredAt,
          confidence: 0.95,
          status: "extracted",
        });
        await createClaimArgument(tx.db, {
          claim_id: claim.claim_id,
          subject_kind: "issuer",
          subject_id: issuerId,
          role: "subject",
        });
        claimIds.push(claim.claim_id);
      }

      const event = await createEvent(tx.db, {
        event_type: "insider_transaction",
        occurred_at: occurredAt,
        status: "reported",
        source_claim_ids: claimIds,
        source_ids: [source.source_id],
        payload_json: {
          insider: filing.reportingOwner.name,
          role,
          code: txn.code,
          transaction_type: type,
          acquired_disposed: txn.acquiredDisposed,
          shares: txn.shares,
          price: txn.pricePerShare,
          value: txn.value,
        },
      });
      await createEventSubject(tx.db, {
        event_id: event.event_id,
        subject_kind: "issuer",
        subject_id: issuerId,
        role: "subject",
      });
    }
  });

  return { ingested: true };
};
