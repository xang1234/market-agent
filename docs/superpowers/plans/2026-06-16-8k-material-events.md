# 8-K Material Events Implementation Plan (fra-ajvd.3)

> **For agentic workers:** bite-sized, TDD, one commit per task gated on `# fail 0`.

**Goal:** Ingest SEC 8-K filings as typed evidence events (+ material-event claims) so agents raise material-event findings and the issuer timeline shows them, every event click-through to the 8-K.

**Architecture:** Deterministic Item-number → event-type taxonomy (no LLM in v1; LLM enrichment is the separate fra-ajvd.6). Atomic `FormHandler` (document + mention + events + claims in one transaction), registered in the daily crawl, plus a per-issuer backfill. Claims attach to the **issuer**; listing-scoped agents match via the ADR-0001 universe→issuer expansion.

**Tech stack:** Node 22 `--experimental-strip-types`, `node:test`, Postgres, `services/evidence`.

---

## Ground-truth findings (verified against live EDGAR — do not re-guess)

**The two ingest paths carry 8-K items in DIFFERENT formats:**

1. **Crawl path** — the full-submission `.txt` header (`/Archives/.../{accession}.txt`) lists items as human-readable **descriptions, NOT numbers**:
   ```
   ITEM INFORMATION:		Results of Operations and Financial Condition
   ITEM INFORMATION:		Financial Statements and Exhibits
   ```
   → the crawl handler must map descriptions → item codes.

2. **Backfill path** — the submissions API (`data.sec.gov/submissions/CIK…json`) `filings.recent.items` is a parallel array of comma-joined **numeric codes**: `"2.02,9.01"`, `"5.02"`.
   → the backfill reads codes directly.

Both converge on `classify8kItems(codes)`. The epic sketch said "read `<ITEMS>` from the SGML header" — that tag form is **not** in the `.txt`; this plan supersedes it.

## Key decisions

- **D1 — `handle8k` is the canonical 8-K ingester.** Remove `8-K`/`8-K/A` from `BACKFILL_DEFAULT_FORMS` (they're there today, ingested as plain documents + mentions, no events). Two ingesters would collide on the crawl's document-dedup. The handler now produces document + mention + events + claims atomically — strictly richer than the old plain-document path — so nothing is lost. Mirrors the Form 4 ownership-forms exclusion. (Transitional note: 8-K docs already ingested by a prior generic backfill will be skipped by the crawl until they age past the window — acceptable, no correctness loss.)
- **D2 — materiality (Q2).** Every recognized item → an event (timeline). Only **9.01 (Financial Statements & Exhibits)** is excluded from claims; all other recognized items + the unknown-code fallback → a `material_event.<type>` claim (agent-visible). Severity refinement is fra-ajvd.6's job.

## Taxonomy (code → event type, claimable)

| Item | Event type | Claimable |
|------|-----------|-----------|
| 1.01 / 1.02 | `material_agreement` | yes |
| 1.03 | `bankruptcy` | yes |
| 2.01 | `m_and_a` | yes |
| 2.02 | `guidance_update` | yes |
| 3.01 | `delisting` | yes |
| 4.01 | `auditor_change` | yes |
| 4.02 | `restatement` | yes |
| 5.02 | `officer_change` | yes |
| 9.01 | `material_event` | **no** |
| unknown code | `material_event` | yes |

---

## Task 1 — `sec-8k-item-taxonomy.ts` (pure)
**Files:** Create `services/evidence/src/sec-8k-item-taxonomy.ts`; Test `services/evidence/test/sec-8k-item-taxonomy.test.ts`

- `ITEM_TAXONOMY: Record<string, {eventType: EventType; claimable: boolean}>` per the table.
- `ITEM_DESCRIPTION_TO_CODE: Record<string, string>` — normalized canonical SEC item titles → code (crawl path).
- `classify8kItems(codes: string[]): {itemCode: string; eventType: EventType; claimable: boolean}[]` — known code → its entry; unknown → `{material_event, claimable:true}`. De-dupes repeat codes.
- `itemCodeForDescription(desc: string): string | null` — normalize (trim, collapse ws, lowercase) and look up; null if unmatched.

Tests: each mapped code; 9.01 → claimable:false; unknown code → material_event fallback; description "Results of Operations and Financial Condition" → 2.02; unknown description → null.

## Task 2 — extend `EVENT_TYPES`
**Files:** Modify `services/evidence/src/event-repo.ts`; the contract-pin test in `event-repo.test.ts`.

Add `officer_change`, `restatement`, `material_agreement`, `bankruptcy`, `delisting`, `auditor_change`, `material_event`. Update the EVENT_TYPES contract-pin test's expected list. (Gate: the pin test is the one that broke for Form 4 T2.)

## Task 3 — `extract8kItemsFromHeader` (pure)
**Files:** add to `sec-8k-item-taxonomy.ts` (or a small `sec-8k-header.ts`); test alongside.

`extract8kItemCodesFromHeader(submissionTxt): string[]` — scan `ITEM INFORMATION:\t<desc>` lines in the `<SEC-HEADER>`, map each description → code via `itemCodeForDescription`; unmatched description → keep an `unknown:<desc-slug>` sentinel so it still yields a `material_event`. De-dupe. Tests: the real Apple header (2.02+9.01) → `["2.02","9.01"]`; unmatched description → one sentinel code.

## Task 4 — `sec-8k-handler.ts` (atomic FormHandler)
**Files:** Create `services/evidence/src/sec-8k-handler.ts`; register in `sec-daily-crawl-cli.ts` FORM_HANDLERS; Test `sec-8k-handler.test.ts` (docker).

`export const handle8k = async (entry: Form8kFilingRef, deps: FormHandlerDeps)` where `Form8kFilingRef = Pick<FilingIndexEntry,"cik"|"accession"|"form"|"filedDate">` (the Form 4 narrowing precedent). Flow: fetch `${accession}.txt`; `extract8kItemCodesFromHeader`; if empty → `{ingested:false}` (no orphan doc, like Form 4); `resolveIssuerId` by padded/unpadded CIK, skip+log untracked; `withTransaction`: `createSource` + `ingestDocumentInTransaction` + `createMention(issuer, headline)` (preserves reader doc-selection) + for each classified item `createEvent(eventType)` + `createEventSubject(issuer)`, and for `claimable` items `createClaim(predicate:"material_event.<eventType>", attributed_to_type:"issuer", attributed_to_id:issuerId)` + `createClaimArgument(issuer)`. Register `"8-K"` and `"8-K/A"`. Tests: Items 5.02+9.01 → 2 events, 1 claim (5.02); untracked CIK → nothing written; empty header → no document.

## Task 5 — remove 8-K from `BACKFILL_DEFAULT_FORMS`
**Files:** Modify `sec-filings-backfill.ts`; its `backfill-default-forms.test.ts`.

Drop `"8-K"`, `"8-K/A"`. Update the test's expected set + the comment (ownership AND 8-K now have dedicated event handlers).

## Task 6 — `sec-8k-backfill.ts` + CLI
**Files:** extend `SecSubmissionsRecent`/`recentSubmissionRows` with `items`; Create `sec-8k-backfill.ts`, `sec-8k-backfill-cli.ts`; npm script `backfill:sec-8k`; Tests.

Add `items: string[]` to `SecSubmissionsRecent` and carry `items: string` (raw comma string, "" if absent — NOT part of the ragged guard) on `SubmissionRow`. `backfillIssuer8k(deps,{cik,sinceDays,maxFilings,now})`: `recentSubmissionRows` → filter form 8-K/8-K/A + window → per filing, dedup by accession, build `Form8kFilingRef`, and run the same persist as the handler driven by `classify8kItems(row.items.split(","))`. **Extract the shared persist** (`persist8kFiling(tx, …, {issuerId, source, document, classified})`) used by both handler and backfill so the two paths don't duplicate the event/claim writes. CLI mirrors `sec-form4-backfill-cli.ts`. Test (docker): in-window 8-K ingested with events; idempotent rerun skips.

## Task 7 — `findEventsByIssuer` timeline reader
**Files:** Modify `event-repo.ts`; test in `event-repo.test.ts` (docker).

`findEventsByIssuer(db, issuerId, sinceDays): EventRow[]` — join `event_subjects` (subject_kind='issuer'), `occurred_at >= now - sinceDays`, newest-first. Test: returns the 8-K events newest-first; respects the window.

## Task 8 — agent-finding E2E (docker)
**Files:** Create `sec-8k-agent-finding.test.ts`.

Seed tracked issuer+instrument+listing; run `handle8k` on an Items 5.02+9.01 filing; assert a listing-universe `loadLocalRuntimeEvidence` surfaces exactly the 5.02 `material_event.officer_change` claim (via expansion) and a 9.01-only filing surfaces none. Mirrors the Form 4 E2E.

## Sequencing
1 → 2 → 3 → 4 (core) → 5 → 6 (backfill) → 7 (timeline) → 8 (E2E). **Follow-up:** fra-ajvd.6 (LLM enrichment for high-severity 4.02/1.03) attaches richer claims to existing events without re-ingest.
