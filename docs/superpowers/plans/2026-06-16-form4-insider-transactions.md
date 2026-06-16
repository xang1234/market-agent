# Form 4 Insider Transactions — Implementation Plan (fra-ajvd.2)

> **For agentic workers:** execute task-by-task with superpowers:subagent-driven-development (fresh subagent + spec/quality review per task). Tracking lives in beads (`fra-ajvd.2`), not this file.

**Goal:** Ingest SEC Form 4 (officer/director/10%-owner transactions) into the evidence plane and surface it: official-data Holders "Insider" view (replacing the unofficial yfinance path), a *material*-insider Agent finding, and a computed Screener filter — built on the merged spine + universe-expansion.

**Architecture:** A `FormHandler` for forms `4`/`4/A` registered in `FORM_HANDLERS`; the daily crawl dispatches to it. The handler is **atomic** (`withTransaction`): it persists the SEC filing document + every transaction (typed read-model) + an event per transaction, and a claim only for *material* transactions (so agents get high-signal findings, not routine Form-4 chatter). A SEC-backed `HoldersRepository` reads the read-model and is composed ahead of the yfinance dev provider. The Screener filter is computed on read.

---

## Grounded facts (verified on `origin/main`)
- **Atomic ingest:** `withTransaction(db, async (tx) => …)` (`evidence/src/transaction.ts`). Inside, use `tx.db` for repo writes; for the document use `ingestDocumentInTransaction({ tx, objectStore }, …)` (`ingest.ts`). **Do NOT use `ingestSecFiling`** — it is non-transactional; compose `createSource(tx.db, …)` + `ingestDocumentInTransaction` like `issuer-ir-ingest.ts`.
- **Fetch full submission:** `client.fetchFiling({ cik, accession_number, document: "<accession>.txt" })` → `{ bytes, … }`. The `.txt` is the full SGML submission; the Form 4 XML is the `<XML>…</XML>` block inside.
- **XML parsing:** the repo has **no XML dependency** (mirror `issuer-ir-extraction.ts`); use dependency-free targeted tag extraction. Form 4's `ownershipDocument` schema is stable/flat.
- **Write signatures:** `createSource(db,{provider,kind,canonical_url?,trust_tier,license_class,retrieved_at,content_hash?,user_id?})`; `ingestDocumentInTransaction({tx,objectStore},{source:{source_id,license_class},bytes,document:Omit<DocumentInput,"source_id"|"content_hash"|"raw_blob_id">})`; `createClaim(db,{document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,attributed_to_type?,attributed_to_id?,effective_time?,confidence,status})`; `createClaimArgument(db,{claim_id,subject_kind,subject_id,role})`; `createEvent(db,{event_type,occurred_at,status,source_claim_ids,source_ids,payload_json?})`; `createEventSubject(db,{event_id,subject_kind,subject_id,role?})`.
- **CIK→issuer:** direct SQL `select issuer_id::text from issuers where cik = $1` (issuers.cik is **text**; pad CIK to 10 digits to match how it is stored — confirm format at build). Skip + log when not found (Q9 tracked-scope).
- **Holders:** `HoldersRepository.find(issuer_id, kind): Promise<HoldersEnvelope | null>`. `InsiderTransaction = {insider_name, insider_role, transaction_date(YYYY-MM-DD), transaction_type(buy|sell|option_exercise|gift|other), shares(int≥0), price(number|null), value(number|null)}`. Build via `freezeInsiderHoldersEnvelope({subject,currency,holders,as_of(ISO-UTC),source_id})` (price/value both-null-or-both-present; sorted newest-first). Wire seam: `fundamentals/src/dev.ts:58`.
- **Screener:** add a descriptor to `fields.ts DEFINITIONS`; compute in `db-candidates.ts` (mirror `market_cap`); add to `result.ts` type + null-default in `freezeFundamentalsSummary`. `query.ts`/`executor.ts` need no change (registry-driven).
- **Next migration:** `0034`. **EVENT_TYPES** (`event-repo.ts`) needs `"insider_transaction"`. **FORM_HANDLERS** registry: `sec-daily-crawl-cli.ts:35`.

## Locked decisions
1. **Atomic handler** — all writes for one filing in one `withTransaction`; document existence ⟺ fully ingested (honors the spine's FormHandler contract).
2. **Materiality (→ claim):** open-market purchase/sale (Form 4 codes **P**/**S**) by an officer or director with `|value| ≥ 100_000`. Routine (M/A/G/F, sub-threshold, non-officer/director) → read-model + event only, no claim.
3. **No metrics.sql entry** — the Screener field is computed on read (Q5), not a stored fact.
4. **Provenance** — `sec_edgar` / `filing` / `primary` / `public`, one source row per filing.
5. **Deferred to follow-up (new sub-issue):** the lazy-on-read auto-trigger + coverage TTL (Q6). v1 populates `insider_transactions` via the daily crawl (forward) **and** a per-issuer Form 4 backfill CLI (historical / on-demand) — enough for the Holders tab to show data without the read-path auto-trigger.

## File structure
- Create `evidence/src/sec-form4-extractor.ts` — `parseForm4(txt): Form4Filing`.
- Modify `evidence/src/event-repo.ts` — `EVENT_TYPES += "insider_transaction"`.
- Create `db/migrations/0034_insider_transactions.{up,down}.sql`; modify `spec/finance_research_db_schema.sql`.
- Create `evidence/src/insider-transactions-repo.ts`.
- Create `evidence/src/sec-form4-handler.ts`; modify `evidence/src/sec-daily-crawl-cli.ts` (register handler).
- Create `evidence/src/sec-form4-backfill.ts` + `sec-form4-backfill-cli.ts`; add npm script.
- Create `fundamentals/src/sec-holders-repository.ts` + `fundamentals/src/fallthrough-holders-repository.ts`; modify `fundamentals/src/dev.ts`.
- Modify `screener/src/fields.ts`, `screener/src/db-candidates.ts`, `screener/src/result.ts`.
- Tests under each service's `test/` (extractor + repo fake-db unit; handler + holders + agent-finding docker integration).

---

## Tasks (TDD; sequence)

### Task 1 — `sec-form4-extractor.ts` (pure, no DB, no new dep)
`parseForm4(submissionTxt: string): Form4Filing` where:
```ts
export type Form4Transaction = {
  transactionDate: string;        // YYYY-MM-DD
  code: string;                   // P,S,A,M,G,F,...
  acquiredDisposed: "A" | "D";
  shares: number;                 // >= 0
  pricePerShare: number | null;
  value: number | null;           // shares * pricePerShare, or null
};
export type Form4Filing = {
  issuerCik: number;
  reportingOwner: { name: string; cik: string | null; isOfficer: boolean; officerTitle: string | null; isDirector: boolean; isTenPercentOwner: boolean };
  transactions: Form4Transaction[];   // non-derivative only for v1
};
```
Extract the `<XML>…</XML>` block from the `.txt`, then targeted-extract `<issuer><issuerCik>`, `<reportingOwner>` (`<rptOwnerName>`,`<rptOwnerCik>`,`<isOfficer>`/`<officerTitle>`/`<isDirector>`/`<isTenPercentOwner>`), and each `<nonDerivativeTransaction>` (`<transactionDate><value>`, `<transactionCoding><transactionCode>`, `<transactionShares><value>`, `<transactionPricePerShare><value>`, `<transactionAcquiredDisposedCode><value>`). Tests: a P buy, an S sell, multi-transaction, a derivative-only/empty filing (→ empty transactions), malformed/no-`<XML>` (throws or returns empty — decide + test). **No network, no DB.**

### Task 2 — extend `EVENT_TYPES`
Add `"insider_transaction"` to `event-repo.ts EVENT_TYPES`. Test: `createEvent` accepts it (fake db) / the const includes it.

### Task 3 — migration `0034` + `insider-transactions-repo.ts`
`0034_insider_transactions.up.sql`:
```sql
create table insider_transactions (
  insider_transaction_id uuid primary key default gen_random_uuid(),
  issuer_id        uuid not null references issuers(issuer_id) on delete cascade,
  insider_name     text not null,
  insider_role     text not null,
  insider_cik      text,
  transaction_date date not null,
  transaction_code text not null,
  transaction_type text not null,           -- buy|sell|option_exercise|gift|other
  acquired_disposed text not null check (acquired_disposed in ('A','D')),
  shares           numeric not null check (shares >= 0),
  price            numeric,
  value            numeric,
  source_id        uuid not null references sources(source_id),
  accession        text not null,
  filed_at         timestamptz not null,
  created_at       timestamptz not null default now()
);
create index insider_transactions_issuer_date_idx on insider_transactions(issuer_id, transaction_date desc);
create index insider_transactions_issuer_filed_idx on insider_transactions(issuer_id, filed_at desc);
```
`.down.sql` drops it. **Add the same table + indexes to `spec/finance_research_db_schema.sql`** (db-parity job). Repo: `insertInsiderTransaction(db, input)`, `findRecentByIssuer(db, issuer_id, sinceDays)`. Tests: fake-db SQL-shape + params; migrate.test parity (docker).

### Task 4 — `sec-form4-handler.ts` (atomic) + register
`FormHandler` for `4`/`4/A`. Fetch `.txt`; `parseForm4`; resolve `issuerCik`→`issuer_id` (skip+log if untracked). Then:
```ts
return withTransaction(deps.db, async (tx) => {
  const source = await createSource(tx.db, { provider:"sec_edgar", kind:"filing", trust_tier:"primary", license_class:"public", canonical_url: fetched.url, retrieved_at: fetched.retrievedAt });
  const { document } = await ingestDocumentInTransaction({ tx, objectStore: deps.objectStore }, { source:{source_id:source.source_id,license_class:source.license_class}, bytes: fetched.bytes, document:{ kind:"filing", provider_doc_id: entry.accession, title: entry.form } });
  for (const txn of filing.transactions) {
    await insertInsiderTransaction(tx.db, { issuer_id, source_id: source.source_id, accession: entry.accession, filed_at: entry.filedDate, ...mapTxn(txn, filing.reportingOwner) });
    const event = await createEvent(tx.db, { event_type:"insider_transaction", occurred_at: isoFrom(txn.transactionDate), status:"reported", source_claim_ids:[], source_ids:[source.source_id], payload_json:{ code: txn.code, shares: txn.shares, price: txn.pricePerShare, acquired_disposed: txn.acquiredDisposed, insider: filing.reportingOwner.name } });
    await createEventSubject(tx.db, { event_id: event.event_id, subject_kind:"issuer", subject_id: issuer_id, role:"subject" });
    if (isMaterial(txn, filing.reportingOwner)) {
      const claim = await createClaim(tx.db, { document_id: document.document_id, predicate:"insider.transaction", text_canonical: claimText(txn, filing.reportingOwner), polarity:"neutral", modality:"asserted", reported_by_source_id: source.source_id, attributed_to_type:"insider", attributed_to_id: filing.reportingOwner.cik, effective_time: isoFrom(txn.transactionDate), confidence: 0.95, status:"extracted" });
      await createClaimArgument(tx.db, { claim_id: claim.claim_id, subject_kind:"issuer", subject_id: issuer_id, role:"subject" });
    }
  }
  return { ingested: true };
});
```
`isMaterial = txn.code in {P,S} && (owner.isOfficer||owner.isDirector) && (txn.value ?? 0) >= 100_000`. Register `FORM_HANDLERS["4"]=FORM_HANDLERS["4/A"]=handler`. Tests (docker integration): seed a tracked issuer; run handler on a fixture `.txt` with one P≥$100k officer buy + one small grant → 2 read-model rows + 2 events + exactly 1 claim+claim_argument(issuer); untracked CIK → skipped, nothing written (atomic).

### Task 5 — per-issuer Form 4 backfill + CLI
`backfillIssuerForm4(deps, {issuerId, cik, sinceDays})`: `fetchSubmissions(cik)` → filter form `4`/`4/A` within window → for each, dedup by accession (`findLiveDocumentIdByAccession`) then run the Task-4 handler logic per filing. CLI `sec-form4-backfill-cli.ts` (reuse `createEvidenceCliRuntime`, guarded `main`) + npm script `backfill:sec-form4`. Tests: handler invoked per new filing, skips existing.

### Task 6 — `fundamentals/src/sec-holders-repository.ts`
`createSecHoldersRepository(db): HoldersRepository`. `find(id,"institutional") → null`. `find(id,"insider")` → query `insider_transactions` recent-by-issuer, map `code`→`transaction_type` (P→buy,S→sell,M→option_exercise,G→gift,else→other), build via `freezeInsiderHoldersEnvelope` (currency from the issuer's listing or "USD"; `as_of` = latest `filed_at`; `source_id` = latest filing's source). Reads the evidence-owned table directly (shared schema). Tests fake-db.

### Task 7 — fallthrough wiring
`createFallthroughHoldersRepository(primary, fallback)` (returns `primary.find() ?? fallback.find()`); wire at `fundamentals/dev.ts:58` so SEC is tried before the dev provider. Tests: SEC hit short-circuits; SEC null falls through; institutional always falls through.

### Task 8 — Screener filter `insider_net_shares_90d`
`fields.ts`: add `{ field:"insider_net_shares_90d", dimension:"fundamentals", kind:"numeric", sortable:true }`. `db-candidates.ts`: `loadInsiderNetShares90d(db, issuer_id, now)` → `select sum(shares) from insider_transactions where issuer_id=$1 and filed_at>=$2`, assign to `fundamentals.insider_net_shares_90d`. `result.ts`: add to `ScreenerFundamentalsSummary` + null-default in `freezeFundamentalsSummary` (mirror `forward_pe`). Tests: a screen `insider_net_shares_90d > 0` returns the seeded issuer.

### Task 9 — Agent-finding integration test
Seed (docker): tracked issuer + instrument + listing + a material insider buy ingested via the handler; an agent universe of the **listing**; assert the delta surfaces the `insider.transaction` claim (relies on the merged universe→issuer expansion) and a sub-threshold buy does not. (No new prod code — verifies the slice end-to-end.)

## Sequencing & scope
1 → 2 → 3 → 4 (core ingest) → 6 → 7 (Holders) → 8 (Screener) → 5 (backfill) → 9 (agent E2E). Tasks 6–8 are independent after 3/4. **Deferred follow-up issue:** lazy-on-read auto-trigger + per-issuer coverage TTL (Q6).

## Self-review
- Honors the FormHandler atomicity contract (single `withTransaction`); uses `ingestDocumentInTransaction`, not `ingestSecFiling`.
- New table registered in the canonical schema (db-parity).
- Screener field computed on read (no `method='reported'` fact masquerade).
- Materiality gate keeps agent deltas signal-rich; full record retained for the Holders tab.
- No new dependency (regex extraction, repo convention).
