# 13F Institutional Holdings Implementation Plan (fra-ajvd.4)

> **For agentic workers:** bite-sized, TDD, one commit per task gated on `# fail 0`.

**Goal:** Ingest 13F-HR filings from a seeded set of "superinvestor" filers as institutional-holdings evidence — a read model behind the Holders "Institutional" tab + a "superinvestor moves" surface, with notable position changes raised to agents.

**Architecture:** Deterministic, filer-gated `FormHandler` (process only seeded superinvestor CIKs, Q8). Holdings map to issuers by CUSIP when DB-resolvable (skip+log misses); resolution coverage grows as OpenFIGI enrichment (`fra-ajvd.7`) populates instrument identifiers. Atomic per filing. Claims attach to the issuer; listing universes match via ADR-0001 expansion.

**Scope (user-chosen): full plumbing, enrichment-driven** — all 8 tasks; no curated CUSIP seed (resolution grows via enrichment).

---

## Ground-truth findings (verified against live EDGAR — Berkshire 0001193125-26-226661)

- The full-submission `.txt` contains **two `<XML>` documents**: the cover (`edgarSubmission`, default ns `…/thirteenffiler`, carrying `<periodOfReport>03-31-2026</periodOfReport>` in **MM-DD-YYYY**) and the **`informationTable`** (default ns `…/informationtable`, no prefix on child tags).
- Each `<infoTable>` row: `<nameOfIssuer>`, `<cusip>`, `<value>`, `<sshPrnamt>` (shares), `<sshPrnamtType>` (SH | PRN).
- **`<value>` is whole USD** (Ally: 498992850 / 12719675 sh ≈ $39/sh ✓). The SEC switched from thousands to whole dollars for filings on/after **2023-01-01**; pre-2023 filing dates need `×1000`.
- **Multiple rows per CUSIP** (a filer reports a position split across managers/discretion) → **aggregate by CUSIP per filer** (sum shares + value) before storing one row per (filer, issuer, period).
- No CUSIP column / enrichment exists today; `instruments` already has `isin` + `figi_composite`. A **US ISIN embeds the CUSIP** (`US` + 9-char CUSIP + check digit), so the resolver can derive CUSIP from existing ISINs in addition to a new `cusip` column.

## Key decisions
- **Resolvable-only storage.** Only holdings whose CUSIP resolves to a tracked issuer are stored (issuer_id NOT NULL); misses are logged, not stored (acceptance: "lists resolvable positions"). Coverage is sparse until `fra-ajvd.7` enrichment — the spine is correct and grows automatically.
- **Notable-change baseline.** A filer's first ingested period for an issuer establishes a baseline (read-model only, no claims — "new vs prior" is undefined). Subsequent periods compare to the prior period: new position / full exit / |Δshares| ≥ 20% → event + claim.
- **percent_of_shares_outstanding nullable.** 13F has no percentage; compute from a `shares_outstanding` fact when available, else null. Relax the shared `InstitutionalHolder` type + validator to `number | null` and guard consumers.

---

## Task 1 — migration + read model
**Files:** Create `db/migrations/0035_institutional_holdings.{up,down}.sql`; Create `services/evidence/src/institutional-holdings-repo.ts`; add both new tables/columns to `spec/finance_research_db_schema.sql` (DB-parity gate); Test `services/evidence/test/institutional-holdings-repo.test.ts`.

Migration adds:
- `institutional_holdings (institutional_holding_id uuid pk, filer_cik text not null, filer_name text not null, issuer_id uuid not null references issuers, cusip text not null, shares numeric not null, value_usd numeric not null, filing_period date not null, filing_date date not null, source_id uuid not null references sources, accession text not null, created_at timestamptz default now())`; indexes `(issuer_id, filing_period desc)`, `(filer_cik, filing_period desc)`; unique `(filer_cik, issuer_id, filing_period)`.
- `alter table instruments add column cusip text;` + index `(cusip)`.

Repo: `insertHolding(db, input)` (upsert on the unique key — reruns replace), `topHoldersByIssuer(db, issuerId, period?)`, `holdingsByFiler(db, filerCik, period)`, `findFilerIssuerHolding(db, filerCik, issuerId, period)` (prior-period lookup), `latestPeriodForFiler(db, filerCik)`. Tests with a fake db (query-text routing).

## Task 2 — `superinvestor-filers.ts`
**Files:** Create `services/evidence/src/superinvestor-filers.ts`; Test alongside.

`SUPERINVESTOR_FILERS: ReadonlyMap<string, string>` (zero-padded CIK → display name): Berkshire `0001067983`, plus a handful (Scion `0001649339`, Pershing Square `0001336528`, …). `isSuperinvestorFiler(cik: number): boolean` and `superinvestorName(cik): string | null` (match padded/bare). Tests: known CIK (padded + bare) resolves; unknown → false/null.

## Task 3 — `cusip-issuer-map.ts`
**Files:** Create `services/evidence/src/cusip-issuer-map.ts`; Test (docker).

`resolveIssuerByCusip(db, cusip): Promise<string | null>` — `select issuer_id from instruments where cusip = $1 or (isin like 'US%' and substr(isin,3,9) = $1) limit 1`, normalizing cusip to 9 chars uppercased. Docker test: instrument with matching `cusip` resolves; instrument with US `isin` embedding the cusip resolves; unknown → null.

## Task 4 — `sec-13f-extractor.ts`
**Files:** Create `services/evidence/src/sec-13f-extractor.ts`; Test `services/evidence/test/sec-13f-extractor.test.ts`.

`parse13fInfoTable(submissionTxt): { periodOfReport: string; holdings: Form13fHolding[] }` where `Form13fHolding = { nameOfIssuer, cusip, valueRaw: number, shares: number, sshPrnamtType: string }`. Parse `periodOfReport` (MM-DD-YYYY → YYYY-MM-DD) from the cover; extract the `informationTable` block; iterate `<infoTable>` rows, tolerating optional `ns:` prefixes. Tests: the live multi-row fixture; namespace-prefixed variant; period normalization.

## Task 5 — `sec-13f-handler.ts`
**Files:** Create `services/evidence/src/sec-13f-handler.ts`; extend `EVENT_TYPES` with `position_change` (+ contract-pin test); register `13F-HR`/`13F-HR/A` in `sec-daily-crawl-cli.ts`; Test (docker).

`handle13f` (entry: `Form13fFilingRef = Pick<FilingIndexEntry,"cik"|"accession"|"form"|"filedDate">`): gate `isSuperinvestorFiler(entry.cik)` → else `{ingested:false}`. Fetch `.txt`; `parse13fInfoTable`; **aggregate** SH rows by CUSIP (sum shares + value); normalize value (`×1000` when `entry.filedDate < 2023-01-01`); resolve CUSIP→issuer (skip+log misses); `withTransaction`: createSource + ingestDocumentInTransaction + issuer mention + per resolved holding `insertHolding`; **notable-change** vs `findFilerIssuerHolding(prior period)` — new / exit / |Δ|≥20% → `createEvent("position_change")` + `createEventSubject(issuer)` + `createClaim(predicate:"position_change.<kind>")` + `createClaimArgument(issuer)`. Exits: prior-period holdings for the filer whose issuer is absent now. Tests: seeded filer persists resolvable holdings; non-seed ignored; new-position claim; sub-threshold rebalance → read-model only; CUSIP miss skipped+logged.

## Task 6 — Holders "institutional"
**Files:** Modify `services/fundamentals/src/sec-holders-repository.ts` (+ `holders.ts` to make `percent_of_shares_outstanding` nullable); Tests.

`find(issuer_id, "institutional")` → `topHoldersByIssuer` mapped to `InstitutionalHolder[]` (`holder_name=filer_name, shares_held, market_value=value_usd, percent_of_shares_outstanding` (null v1), `shares_change` vs prior, `filing_date`); `freezeInstitutionalHoldersEnvelope`; null when no coverage (falls through to dev provider). Relax `InstitutionalHolder.percent_of_shares_outstanding` to `number | null` + validator; guard the web consumer.

## Task 7 — disclosure / as_of staleness
**Files:** within Task 6's repo; Test.

Envelope `as_of = filing_period` (quarter-end), so the existing snapshot-disclosure compiler surfaces the ~45-day-lag staleness. Test: `as_of` reflects the filing period, not now.

## Task 8 — metrics
**Files:** Modify `db/seed/metrics.sql`; Test that the keys exist.

Add `institutional_ownership_pct`, `institutional_holders_count` metric rows.

## Sequencing
1 → 2 → 3 → 4 → 5 (core ingest) → 6 → 7 (Holders) → 8 (metrics). **Follow-ups:** `fra-ajvd.7` (CUSIP-to-issuer master / full-universe coverage); a per-filer 13F backfill to bootstrap superinvestor history for notable-change comparisons.
