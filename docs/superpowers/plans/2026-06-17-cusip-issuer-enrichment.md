# CUSIP→Issuer Enrichment (fra-ajvd.7, phase 1)

> **For agentic workers:** bite-sized, TDD, one commit per task gated on `# fail 0`.

**Goal:** Resolve a 13F holding's CUSIP to a tracked issuer by mapping it through OpenFIGI and getting-or-creating the issuer/instrument — so 13F resolution coverage stops being sparse for held names.

**Scope (user-chosen): phase 1 — CUSIP→issuer enrichment.** Full-universe 13F ingest (reverse-index scale) is explicitly out of scope (a later effort). This phase builds the OpenFIGI-by-CUSIP capability + a get-or-create enrichment + a CLI.

**Architecture:** Lives in the resolver service (it owns OpenFIGI + instrument/issuer identity). OpenFIGI `/v3/mapping` queried by `ID_CUSIP` returns ticker/name/FIGI/ISIN/securityType for the security; we build a `DiscoveredListing` and call the existing idempotent `upsertDiscoveredListing` (get-or-create by instrument identity), recording the `cusip`. Enrichment is a CLI/batch step — NOT inline in the 13F ingest handler (which stays a pure DB resolve), so the atomic crawl never makes live API calls.

---

## Grounding (verified in-repo)
- `resolveByTicker`/`resolveByIsin` (lookup.ts) are pure DB lookups — no creation. Creation is `upsertDiscoveredListing(db, listing)` (discovery.ts:151), idempotent: it matches by instrument identity (figi/isin), fills issuer/instrument fields, upserts the listing. A later Polygon-driven discovery of the same security MATCHES and refines (no duplicate), so OpenFIGI-derived records are safe to create.
- `DiscoveredListing` (discovery.ts:14): `{ ticker, legal_name, market:"stocks", active:true, mic, trading_currency, timezone, asset_type, share_class?, cik?, lei?, domicile?, isin?, figi_composite? }`. It does NOT carry `cusip` today — Task 1 adds it.
- OpenFIGI config: `openReferenceProviderConfigFromEnv(env).openfigi = { enabled, apiKey, baseUrl }` (provider-sources.ts). The existing `fetchOpenFigiEnrichment` POSTs `[{idType:"TICKER", idValue, micCode}]`; we mirror it with `ID_CUSIP`.
- OpenFIGI `/v3/mapping` response rows carry `ticker, name, micCode, exchCode, compositeFIGI, isin, securityType(2), marketSector`. `name` → legal_name; `securityType` → asset_type (reuse the categories in `openFigiSecurityMatchesAssetType`).
- `resolveIssuerByCusip` (evidence) already resolves via `instruments.cusip` or US-ISIN derivation — so once enrichment records cusip/isin, the 13F handler's pure DB resolve hits.

## Deferred (noted, not built this phase)
- Creating untracked names with **precise** listing data (MIC/currency) via Polygon discovery — phase 1 uses OpenFIGI's MIC/name (refined later by idempotent Polygon merge).
- **13F-driven harvest** (feed unresolved CUSIPs from seeded superinvestors' filings into enrichment) — natural next step; pairs with `fra-msx1` (reprocess partially-resolved filings).
- **Full-universe 13F ingest** (drop the superinvestor gate; reverse-index scale) — the big spike, separate effort.

---

## Task 1 — record `cusip` on the discovery write-path
**Files:** Modify `services/resolver/src/discovery.ts` (`DiscoveredListing` + `upsertInstrument` / `fillInstrumentIdentityFields`); Test `services/resolver/test/discovery-cusip.test.ts` (docker).

Add optional `cusip?: string` to `DiscoveredListing`; `upsertInstrument` writes it on insert and `fillInstrumentIdentityFields` backfills it when null (same pattern as `isin`/`figi_composite`). Test: a listing with `cusip` creates an instrument carrying it; a second upsert backfills cusip onto an existing instrument that lacked it.

## Task 2 — OpenFIGI map-by-CUSIP
**Files:** Create `services/resolver/src/openfigi-cusip.ts`; Test `services/resolver/test/openfigi-cusip.test.ts`.

`mapCusipViaOpenFigi(config, cusip, fetchImpl, timeoutMs): Promise<OpenFigiCusipMatch | null>` where `OpenFigiCusipMatch = { ticker, mic, legalName, assetType, isin?, figiComposite }`. POST `[{idType:"ID_CUSIP", idValue: cusip}]`; pick the unique equity composite match (mirror `uniqueOpenFigiEnrichment`'s uniqueness discipline — null on 0 or ambiguous); map securityType→asset_type, micCode→mic (default US MIC when only a composite `exchCode` is present). Tests: faked fetch → match; non-equity/ambiguous → null; missing key/disabled → null.

## Task 3 — `enrichCusip`
**Files:** Create `services/resolver/src/cusip-enrichment.ts`; Test `services/resolver/test/cusip-enrichment.test.ts` (docker + faked OpenFIGI).

`enrichCusip(deps, cusip): Promise<EnrichmentResult>`, `deps = { db, openfigi, fetchImpl }`, `EnrichmentResult = { status: "already" | "enriched" | "unmapped"; issuer_id?: string; ticker?: string }`:
1. If `resolveIssuerByCusip(db, cusip)` hits → `{status:"already", issuer_id}` (no API call).
2. `mapCusipViaOpenFigi` → null ⇒ `{status:"unmapped"}` (logged).
3. Build a `DiscoveredListing` from the match (cusip set) → `upsertDiscoveredListing` → re-resolve issuer_id → `{status:"enriched", issuer_id, ticker}`.

Tests: unknown CUSIP for a security → creates issuer+instrument(+cusip) and resolves; already-resolvable CUSIP → no OpenFIGI call; unmapped → status unmapped, nothing written.

## Task 4 — CLI
**Files:** Create `services/resolver/src/cusip-enrichment-cli.ts`; npm script `enrich:cusips`; Test argv parsing.

`npm run enrich:cusips -- <cusip> [<cusip> ...]` — builds the OpenFIGI config from env (requires `OPENFIGI_REFERENCE_ENABLED=true`), runs `enrichCusip` per CUSIP, prints a per-CUSIP status line + an already/enriched/unmapped summary; non-zero exit if any errored. Guarded `main` (only runs as entrypoint).

## Sequencing
1 → 2 → 3 → 4. Follow-ups: 13F harvest + `fra-msx1` reprocessing; Polygon-precise creation; full-universe ingest.
