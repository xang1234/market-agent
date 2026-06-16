# SEC EDGAR Evidence Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Tracking lives in beads, not this file.** This document is the engineering design/reference. Work state (open/in_progress/closed) is tracked in the `fra-` beads epic + child issues that link here. Do not duplicate task state into markdown.

**Goal:** Ingest three new free, primary-trust SEC EDGAR data streams — Form 4 (insider transactions), 8-K (material events), and 13F (institutional holdings) — into the existing evidence plane, upgrading the Holders tab from unofficial data and feeding the Agents/Signals/Screener features.

**Architecture:** A small shared "daily-index crawl spine" added to the `evidence` service generalizes the existing per-issuer SEC backfill into a cross-market, watermarked, idempotent daily crawler invoked by an external scheduler (the established one-shot-CLI pattern — there is no in-process scheduler in this codebase). Each form type is a vertical slice: a form handler (fetch → parse embedded XML → persist) that the spine dispatches to. Form 4 and 13F additionally write a typed read-model table and expose a new SEC-backed `HoldersRepository` implementation that the `fundamentals` service composes ahead of the yfinance dev provider, so the Holders tab upgrades to primary-trust data with no frontend change.

**Tech Stack:** Node 22 (`--experimental-strip-types`), TypeScript, `node:test` + `node:assert/strict`, PostgreSQL (raw `pg` via the injected `QueryExecutor`), S3/MinIO object store. No new runtime dependencies.

---

## What already exists (do NOT rebuild)

Confirmed by reading the code — the spine is ~70% present in `services/evidence/`:

| Capability | Location | Reuse as-is? |
|---|---|---|
| SEC client w/ User-Agent + token-bucket rate limit (8 rps, 10 rps ceiling) + 30s timeout | `services/evidence/src/sec-edgar.ts` `SecEdgarClient` | Yes — extend with one method |
| Fetch a filing document's bytes | `SecEdgarClient.fetchFiling()` | Yes |
| Fetch per-issuer submissions index | `SecEdgarClient.fetchSubmissions()` | Yes (used by 8-K/Form 4 issuer fallback) |
| Archive/index URL builders + accession/path-traversal guards | `filingArchiveUrl()`, `filingIndexUrl()`, `submissionsUrl()` | Yes |
| Closed form-code set (typo guard) | `SEC_FORM_CODES` (`10-K,10-Q,8-K,20-F,6-K,40-F`) | **Extend** with `4`, `4/A`, `8-K/A`, `13F-HR`, `13F-HR/A` |
| Source + blob + documents persistence | `createSource()` (`source-repo.ts`), `ingestDocument()` (`ingest.ts`) | Yes |
| Per-issuer backfill (idempotent by accession) | `sec-filings-backfill.ts` `backfillIssuerFilings()` | Pattern to mirror |
| Backfill CLI | `sec-filings-backfill-cli.ts` + `npm run backfill:sec-filings` | Pattern to mirror |
| Evidence write API: events/claims | `event-repo.ts` (`createEvent`, `createEventSubject`, `EVENT_TYPES`), `claim-repo.ts` (`createClaim`, `createClaimArgument`, `createClaimEvidence`) | Yes |
| One-shot worker invoked by external cron | `services/market/src/refresh-worker.ts` | Pattern to mirror |
| ETL idempotency ledger precedent | migration `0031_artifact_ingestion_ledger` | Pattern to mirror |
| Holders read interface + envelope | `services/fundamentals/src/holders.ts`, `holders-repository.ts` (`HoldersRepository.find(issuer_id, kind)`); HTTP `GET /v1/fundamentals/holders` | Implement a new SEC-backed variant |

**There is NO generic scheduler** (no cron/queue/daemon anywhere). All periodic work is a one-shot CLI triggered externally. The spine follows that pattern; do not add an in-process scheduler.

---

## Cross-cutting design decisions (locked — confirmed via grilling 2026-06-15; see `CONTEXT.md` + `docs/adr/0001-universe-issuer-expansion-for-agent-evidence.md`)

1. **Home of the spine = `evidence` service.** It already owns the EDGAR client, rate limiter, blob ingest, and evidence-plane writers. No new service.
2. **Two ingestion paths (Q1=C).** (a) A **market-wide daily crawl** of the EDGAR daily *master* index (`/Archives/edgar/daily-index/{year}/QTR{q}/master.{YYYYMMDD}.idx`, pipe-delimited) for forward freshness; and (b) **on-demand per-issuer backfill** (extend `backfillIssuerFilings()` to forms `4`/`8-K`) plus a **filer-seeded 13F crawl**. Both dedup by accession, so they compose without double-ingest.
3. **Daily-crawl scope = tracked issuers + seeded filers (Q9).** The daily crawl ingests a Form 4 / 8-K only when its CIK resolves to a tracked issuer (`resolveByCik`, `resolver/src/lookup.ts:138`), and a 13F only from a seeded filer. Unresolved CIKs are skipped + logged; lazy backfill picks them up if/when the issuer becomes tracked. (Avoids ingesting tens of thousands of irrelevant filings/day.)
4. **On-demand backfill = lazy-on-read (Q6).** When Holders/Signals is requested for an issuer with no/stale SEC coverage, serve cached data and kick off an **async** per-issuer backfill, tracked by a per-issuer coverage watermark + TTL (mirrors the market quote-cache idiom). First view may be partial; completes on next load.
5. **CIK is text.** `issuers.cik` is `text` with a unique index; pad/normalize the daily-index integer CIK before `resolveByCik`.
6. **Handlers ingest the full submission `.txt`** (`document = "{accession}.txt"`) and parse the embedded XML / SGML header. Reuses `fetchFiling()` unchanged; avoids a per-filing `index.json` round-trip.
7. **Materiality split (Q2).** *All* transactions/holdings land in a typed read-model table (`insider_transactions`, `institutional_holdings`) for the Holders tab + Screener. Only the **material/notable subset** also becomes a **claim** (agent-visible). Insider transactions also write an **event** for the Signals timeline. Material = open-market P/S by officers/directors ≥ $100k (Form 4); all recognized 8-K items except 9.01; notable 13F position changes (new / exit / large).
8. **No `person` subject kind (Q3).** `claim_argument` → `issuer`; the insider is denormalized: `insider_name`/`insider_role`/`insider_cik` on the read-model row, and `attributed_to_type="insider"`, `attributed_to_id="<rptOwnerCik>"` on the claim. The `SubjectKind` enum is NOT widened.
9. **Agents read claims, not events (ADR 0001).** A shared **universe→issuer expansion** in the evidence delta path (`local-runtime-evidence.ts` subject_refs CTE) maps `listing`/`instrument` universe refs to their `issuer`, so listing-based agents match issuer-attributed claims. **Prerequisite** (Slice X) for the Form 4 / 8-K agent-surfacing acceptance criteria — without it, those findings silently never fire.
10. **Screener insider filter computed on read (Q5).** `insider_net_shares_90d` / `insider_buy_count_90d` are computed in `screener/src/db-candidates.ts` (joining `insider_transactions`, like `market_cap`) and registered in `fields.ts` — never stored as facts (the screener gates `method='reported'`, `issuer-fundamentals-reader.ts:106`).
11. **Provenance reuses `sec_edgar`/`filing`** — `createSource()` stamps `trust_tier:"primary", license_class:"public"` per filing; no new seed UUID. Read-model rows + the computed screener value carry the originating filing's `source_id`.
12. **8-K depth = deterministic v1 + LLM follow-up (Q7=C).** Classify `<ITEMS>` from the SGML header → event types + claims; raw 8-K stays a `document`. LLM enrichment of high-severity items (4.02, 1.03) is a backlog follow-up; the handler is built so enrichment attaches to existing events/claims without re-ingest.
13. **13F = superinvestor-seeded + DB-resolvable CUSIP (Q8).** Seeded filer registry; map a holding to an issuer only when its CUSIP resolves to a tracked issuer (skip + log misses). `as_of` = report period-end, `freshness_class="stale"` (surfaces the ~45-day lag via the snapshot disclosure compiler); normalize values to whole USD (scale ×1000 for pre-2023 filings).
14. **Idempotency** mirrors the backfill: skip any filing whose `accession` already has a live `documents` row; a crawl ledger row records each day's progress per form.
15. **TDD with injected fakes** (in-memory `QueryExecutor` + `fetch` stubs); no live Postgres/EDGAR in unit tests.
16. **Handlers persist atomically (PR #94 review follow-up).** A form handler MUST write the `documents` row and all derived rows (events/claims/facts/mentions) in one DB transaction. The daily crawl skips any accession that already has a live `documents` row, so a non-atomic handler that commits the document then fails would strand the filing (the retry skips it and never repairs the missing rows). Compose the writes in a transaction (the `issuer-ir-ingest.ts` pattern); do NOT reuse the non-transactional `ingestSecFiling` followed by separate derived writes. **Acceptance criterion for Slices 1–3.**

---

## Epic structure & sequencing

```
Slice 0: Shared crawl spine  ──────────────┐ (blocks all)
                                            ├──> Slice 1: Form 4 (insider)  ──┐
                                            ├──> Slice 2: 8-K (events)         │ (1 establishes the
                                            └──> Slice 3: 13F (institutional) <┘  SEC-backed HoldersRepository
                                                                                  pattern that 3 reuses)
```

- **Slice 0 (spine) blocks 1, 2, 3** (hard).
- **Slice X (universe→issuer expansion, ADR 0001) blocks the *agent-surfacing* of 1 and 2** — without it, listing-based agents raise no insider/8-K findings. Independent of the spine; build in parallel. (Not shown in the diagram above.)
- **Slice 1 precedes Slice 3** (soft): Form 4 establishes the SEC-backed `HoldersRepository` + fundamentals fallback-composition that 13F reuses.
- Slices 1 and 2 are independent and parallelizable after Slice 0 + Slice X.
- **Backlog follow-ups (not v1):** "8-K LLM enrichment (high-severity items)"; "13F full-universe + CUSIP master".

Each slice produces working, testable software on its own. **Slice 0 below is full bite-sized TDD** (the immediate foundational build); **Slice X** is task-level (needs the `local-runtime-evidence.ts` subject_refs CTE read at pickup). Slices 1–3 are task/interface/acceptance granularity, expanded into their own bite-sized plans at pickup.

---

## File structure

**Slice 0 (spine) — `services/evidence/`**
- Create `src/sec-daily-index.ts` — pure parser: `parseMasterIndex(text)`, `deriveAccession(fileName)`, `FilingIndexEntry`.
- Modify `src/sec-edgar.ts` — extend `SEC_FORM_CODES`; add `SecEdgarClient.fetchDailyIndex(date)`.
- Create `db/migrations/0032_edgar_crawl_ledger.up.sql` / `.down.sql`.
- Create `src/edgar-crawl-ledger-repo.ts` — `recordCrawlBatch()`, `lastCrawledDate(form)`.
- Create `src/sec-daily-crawl.ts` — `crawlDailyFilings(deps, input)` orchestrator + `FormHandler` type.
- Create `src/sec-daily-crawl-cli.ts` — one-shot CLI; add `crawl:sec-daily` npm script.
- Tests under `services/evidence/test/`.

**Slice 1 (Form 4) — `services/evidence/` + `services/fundamentals/`**
- Create `evidence/src/sec-form4-extractor.ts` — `parseForm4(xml)` → typed transactions.
- Create `evidence/src/sec-form4-handler.ts` — `FormHandler` for `4`/`4/A`: persist events/claims + `insider_transactions` rows.
- Create `db/migrations/0033_insider_transactions.up/.down.sql`.
- Create `evidence/src/insider-transactions-repo.ts` — write + query.
- Create `fundamentals/src/sec-holders-repository.ts` — SEC-backed `HoldersRepository` (insider kind first).
- Modify `fundamentals` holders wiring to fallback-compose SEC ahead of dev provider.
- Add `insider_net_shares_90d`, `insider_buy_count_90d` to `db/seed/metrics.sql`; add Screener filter field.
- Extend `EVENT_TYPES` with `insider_transaction`.

**Slice 2 (8-K) — `services/evidence/`**
- Create `evidence/src/sec-8k-item-taxonomy.ts` — Item code → event type map + `classify8kItems()`.
- Create `evidence/src/sec-8k-handler.ts` — `FormHandler` for `8-K`/`8-K/A`: persist events/claims.
- Extend `EVENT_TYPES` with `officer_change`, `restatement`, `material_agreement`, `bankruptcy`, `delisting`, `auditor_change` (map common items; fall back to existing `m_and_a`, `guidance_update`, `lawsuit`).

**Slice 3 (13F) — `services/evidence/` + `services/fundamentals/`**
- Create `db/migrations/0034_institutional_holdings.up/.down.sql`.
- Create `evidence/src/sec-13f-extractor.ts` — `parse13fInfoTable(xml)` → holdings.
- Create `evidence/src/sec-13f-handler.ts` — `FormHandler` for `13F-HR`/`13F-HR/A`.
- Create `evidence/src/institutional-holdings-repo.ts`.
- Create `evidence/src/cusip-issuer-map.ts` — `resolveIssuerByCusip(db, cusip)` (DB-only v1).
- Create `evidence/src/superinvestor-filers.ts` — seed filer CIK registry.
- Extend `fundamentals/src/sec-holders-repository.ts` with the institutional kind.
- Add `institutional_ownership_pct`, `institutional_holders_count` to `db/seed/metrics.sql`.

---

## Slice X — Universe→issuer expansion (prerequisite for agent findings; ADR 0001)  *(expand to bite-sized at pickup)*

**Outcome:** listing/instrument agent universes match issuer-attributed claims, so Form 4 / 8-K findings actually fire. Also repairs the same latent gap for existing IR/news claims.

**Tasks**
1. Read `services/evidence/src/local-runtime-evidence.ts` and locate the `subject_refs` CTE feeding the `claim_arguments` join (exact `(subject_kind, subject_id)` match, ~lines 101-104).
2. Add an expansion step: for each universe ref of kind `listing` or `instrument`, also emit an `issuer` ref (join `listings`/`instruments` → `issuer_id`) into `subject_refs`, deduped. `issuer`/`theme`/etc. refs pass through unchanged.
3. **Tests** (`services/evidence/test/`): (a) a `listing`-kind universe matches an issuer-attributed claim; (b) an `instrument`-kind universe matches; (c) an `issuer`-kind universe still matches (no regression); (d) an unrelated issuer does NOT match; (e) the `exclude_claim_ids` watermark still excludes processed claims after expansion.

**Acceptance:** the delta query returns issuer-attributed claims for a listing-kind agent universe; existing issuer/instrument universes unaffected; the behavior change (agents surface more findings — intended per ADR 0001) is covered by tests before release.

---

## Slice 0 — Shared crawl spine (full bite-sized TDD)

### Task 0.1: Daily master-index parser + form-code extension

**Files:**
- Create: `services/evidence/src/sec-daily-index.ts`
- Modify: `services/evidence/src/sec-edgar.ts:35-43` (extend `SEC_FORM_CODES`)
- Test: `services/evidence/test/sec-daily-index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/evidence/test/sec-daily-index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMasterIndex, deriveAccession } from "../src/sec-daily-index.ts";

const SAMPLE = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    June 12, 2026
Comment:               office hours
 
CIK|Company Name|Form Type|Date Filed|File Name
--------------------------------------------------------------------------------
320193|Apple Inc.|4|2026-06-12|edgar/data/320193/0000320193-26-000050.txt
789019|MICROSOFT CORP|8-K|2026-06-12|edgar/data/789019/0000789019-26-000015.txt
1067983|BERKSHIRE HATHAWAY INC|13F-HR|2026-06-12|edgar/data/1067983/0000950123-26-000789.txt
320193|Apple Inc.|10-Q|2026-06-12|edgar/data/320193/0000320193-26-000051.txt
`;

test("parseMasterIndex returns one entry per data row with derived accession", () => {
  const entries = parseMasterIndex(SAMPLE);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], {
    cik: 320193,
    company: "Apple Inc.",
    form: "4",
    filedDate: "2026-06-12",
    fileName: "edgar/data/320193/0000320193-26-000050.txt",
    accession: "0000320193-26-000050",
  });
});

test("parseMasterIndex skips the header, comment, and dashed separator lines", () => {
  const entries = parseMasterIndex(SAMPLE);
  assert.ok(!entries.some((e) => e.form === "Form Type"));
  assert.ok(entries.every((e) => Number.isInteger(e.cik)));
});

test("deriveAccession extracts the accession from a full-submission path", () => {
  assert.equal(
    deriveAccession("edgar/data/789019/0000789019-26-000015.txt"),
    "0000789019-26-000015",
  );
});

test("parseMasterIndex tolerates a trailing blank line and CRLF", () => {
  const entries = parseMasterIndex(SAMPLE.replace(/\n/g, "\r\n"));
  assert.equal(entries.length, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-daily-index.test.ts`
Expected: FAIL — `Cannot find module '../src/sec-daily-index.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/evidence/src/sec-daily-index.ts
// Parses the EDGAR daily "master" index (pipe-delimited, one row per filing):
//   CIK|Company Name|Form Type|Date Filed|File Name
// File Name points at the full submission .txt, e.g.
//   edgar/data/320193/0000320193-26-000050.txt
// from which the accession (0000320193-26-000050) is derived.

const ACCESSION_FROM_PATH = /(\d{10}-\d{2}-\d{6})\.txt$/;

export type FilingIndexEntry = {
  cik: number;
  company: string;
  form: string;
  filedDate: string;
  fileName: string;
  accession: string;
};

export function deriveAccession(fileName: string): string {
  const match = ACCESSION_FROM_PATH.exec(fileName.trim());
  if (match === null) {
    throw new Error(`deriveAccession: no accession in fileName "${fileName}"`);
  }
  return match[1];
}

export function parseMasterIndex(text: string): FilingIndexEntry[] {
  const entries: FilingIndexEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Data rows have exactly 5 pipe fields and a numeric CIK; everything
    // else (header banner, "CIK|Company Name|...", dashed rule) is skipped.
    const fields = line.split("|");
    if (fields.length !== 5) continue;
    const cik = Number(fields[0]);
    if (!Number.isInteger(cik) || cik <= 0) continue;
    const fileName = fields[4].trim();
    if (!ACCESSION_FROM_PATH.test(fileName)) continue;
    entries.push({
      cik,
      company: fields[1].trim(),
      form: fields[2].trim(),
      filedDate: fields[3].trim(),
      fileName,
      accession: deriveAccession(fileName),
    });
  }
  return entries;
}
```

Then extend the form-code set in `services/evidence/src/sec-edgar.ts:35-43`:

```ts
export const SEC_FORM_CODES = Object.freeze([
  "10-K",
  "10-Q",
  "8-K",
  "8-K/A",
  "20-F",
  "6-K",
  "40-F",
  "4",
  "4/A",
  "13F-HR",
  "13F-HR/A",
] as const);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-daily-index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/sec-daily-index.ts services/evidence/src/sec-edgar.ts services/evidence/test/sec-daily-index.test.ts
git commit -m "feat(evidence): parse EDGAR daily master index; add Form 4/13F form codes"
```

---

### Task 0.2: `SecEdgarClient.fetchDailyIndex(date)`

**Files:**
- Modify: `services/evidence/src/sec-edgar.ts` (add method + URL builder)
- Test: `services/evidence/test/sec-edgar-daily-index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/evidence/test/sec-edgar-daily-index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SecEdgarClient, dailyIndexUrl } from "../src/sec-edgar.ts";

test("dailyIndexUrl builds the master index path for the right quarter", () => {
  assert.equal(
    dailyIndexUrl(new Date("2026-06-12T00:00:00Z")),
    "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260612.idx",
  );
  assert.equal(
    dailyIndexUrl(new Date("2026-01-05T00:00:00Z")),
    "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR1/master.20260105.idx",
  );
});

test("fetchDailyIndex fetches and parses the master index", async () => {
  const body = `CIK|Company Name|Form Type|Date Filed|File Name
--------------------------------------------------------------------------------
320193|Apple Inc.|4|2026-06-12|edgar/data/320193/0000320193-26-000050.txt
`;
  let calledUrl = "";
  const fakeFetch = async (url: string) => {
    calledUrl = url;
    return new Response(body, { status: 200 });
  };
  const client = new SecEdgarClient({ userAgent: "Test/0.1 (t@example.com)", fetch: fakeFetch });
  const entries = await client.fetchDailyIndex(new Date("2026-06-12T00:00:00Z"));
  assert.equal(calledUrl, "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260612.idx");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accession, "0000320193-26-000050");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-edgar-daily-index.test.ts`
Expected: FAIL — `dailyIndexUrl is not exported` / `fetchDailyIndex is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `services/evidence/src/sec-edgar.ts` (import the parser at top: `import { parseMasterIndex, type FilingIndexEntry } from "./sec-daily-index.ts";`):

```ts
export function dailyIndexUrl(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = date.getUTCMonth(); // 0-based
  const dd = date.getUTCDate();
  const quarter = Math.floor(mm / 3) + 1;
  const stamp = `${yyyy}${String(mm + 1).padStart(2, "0")}${String(dd).padStart(2, "0")}`;
  return `https://www.sec.gov/Archives/edgar/daily-index/${yyyy}/QTR${quarter}/master.${stamp}.idx`;
}
```

Add a method to `SecEdgarClient` (uses the existing private `fetchBytes`, so it inherits rate-limiting, timeout, and 429 handling):

```ts
  // The day's cross-market filing index (every filer, every form). Same Fair
  // Access policy as the archive, so it shares the rate limiter + User-Agent.
  async fetchDailyIndex(date: Date): Promise<FilingIndexEntry[]> {
    const url = dailyIndexUrl(date);
    const { bytes } = await this.fetchBytes(url);
    return parseMasterIndex(new TextDecoder("utf-8").decode(bytes));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-edgar-daily-index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/sec-edgar.ts services/evidence/test/sec-edgar-daily-index.test.ts
git commit -m "feat(evidence): SecEdgarClient.fetchDailyIndex for cross-market daily crawl"
```

---

### Task 0.3: Crawl-ledger migration + repository

**Files:**
- Create: `db/migrations/0032_edgar_crawl_ledger.up.sql`, `db/migrations/0032_edgar_crawl_ledger.down.sql`
- Create: `services/evidence/src/edgar-crawl-ledger-repo.ts`
- Test: `services/evidence/test/edgar-crawl-ledger-repo.test.ts`

- [ ] **Step 1: Write the migration (mirrors `0031_artifact_ingestion_ledger`)**

```sql
-- db/migrations/0032_edgar_crawl_ledger.up.sql
-- Watermark + idempotency ledger for the daily EDGAR master-index crawl.
-- One row per (form, index_date) crawl attempt so reruns resume and an
-- operator can see coverage gaps.
create table edgar_crawl_ledger (
  ledger_id      uuid primary key default gen_random_uuid(),
  form           text not null,
  index_date     date not null,
  status         text not null default 'succeeded' check (status in ('succeeded', 'partial', 'failed')),
  filings_total  integer not null default 0 check (filings_total >= 0),
  filings_ingested integer not null default 0 check (filings_ingested >= 0),
  filings_skipped  integer not null default 0 check (filings_skipped >= 0),
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (form, index_date),
  check (finished_at >= started_at)
);

create index edgar_crawl_ledger_form_date_idx
  on edgar_crawl_ledger(form, index_date desc);
```

```sql
-- db/migrations/0032_edgar_crawl_ledger.down.sql
drop table if exists edgar_crawl_ledger;
```

- [ ] **Step 2: Write the failing repo test (fake `QueryExecutor`)**

```ts
// services/evidence/test/edgar-crawl-ledger-repo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordCrawlBatch, lastCrawledDate } from "../src/edgar-crawl-ledger-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

function fakeDb(rows: unknown[]): { db: QueryExecutor; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: QueryExecutor = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows } as never;
    },
  } as QueryExecutor;
  return { db, calls };
}

test("recordCrawlBatch upserts on (form, index_date) with counts", async () => {
  const { db, calls } = fakeDb([]);
  await recordCrawlBatch(db, {
    form: "4",
    indexDate: "2026-06-12",
    status: "succeeded",
    filingsTotal: 10,
    filingsIngested: 8,
    filingsSkipped: 2,
    startedAt: "2026-06-12T06:00:00Z",
  });
  assert.match(calls[0].sql, /insert into edgar_crawl_ledger/i);
  assert.match(calls[0].sql, /on conflict \(form, index_date\) do update/i);
  assert.deepEqual(calls[0].params.slice(0, 3), ["4", "2026-06-12", "succeeded"]);
});

test("lastCrawledDate returns the newest succeeded index_date for a form, or null", async () => {
  const hit = fakeDb([{ index_date: "2026-06-11" }]);
  assert.equal(await lastCrawledDate(hit.db, "4"), "2026-06-11");
  const miss = fakeDb([]);
  assert.equal(await lastCrawledDate(miss.db, "8-K"), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/edgar-crawl-ledger-repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// services/evidence/src/edgar-crawl-ledger-repo.ts
import type { QueryExecutor } from "./types.ts";

export type RecordCrawlBatchInput = {
  form: string;
  indexDate: string; // ISO date (YYYY-MM-DD)
  status: "succeeded" | "partial" | "failed";
  filingsTotal: number;
  filingsIngested: number;
  filingsSkipped: number;
  startedAt: string; // ISO8601
};

export async function recordCrawlBatch(db: QueryExecutor, input: RecordCrawlBatchInput): Promise<void> {
  await db.query(
    `insert into edgar_crawl_ledger
       (form, index_date, status, filings_total, filings_ingested, filings_skipped, started_at, finished_at)
     values ($1, $2::date, $3, $4, $5, $6, $7::timestamptz, now())
     on conflict (form, index_date) do update set
       status = excluded.status,
       filings_total = excluded.filings_total,
       filings_ingested = excluded.filings_ingested,
       filings_skipped = excluded.filings_skipped,
       finished_at = now()`,
    [
      input.form,
      input.indexDate,
      input.status,
      input.filingsTotal,
      input.filingsIngested,
      input.filingsSkipped,
      input.startedAt,
    ],
  );
}

export async function lastCrawledDate(db: QueryExecutor, form: string): Promise<string | null> {
  const result = await db.query<{ index_date: string }>(
    `select to_char(index_date, 'YYYY-MM-DD') as index_date
       from edgar_crawl_ledger
      where form = $1 and status = 'succeeded'
      order by index_date desc
      limit 1`,
    [form],
  );
  const row = (result.rows as Array<{ index_date: string }>)[0];
  return row?.index_date ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes, then apply the migration**

Run: `cd services/evidence && node --experimental-strip-types --test test/edgar-crawl-ledger-repo.test.ts`
Expected: PASS (2 tests).
Run: `cd db && npm run migrate -- up` then `npm run migrate -- status`
Expected: `0032_edgar_crawl_ledger` shown as applied.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0032_edgar_crawl_ledger.up.sql db/migrations/0032_edgar_crawl_ledger.down.sql services/evidence/src/edgar-crawl-ledger-repo.ts services/evidence/test/edgar-crawl-ledger-repo.test.ts
git commit -m "feat(evidence): EDGAR crawl ledger (watermark + idempotency)"
```

---

### Task 0.4: `crawlDailyFilings` orchestrator + `FormHandler` dispatch

**Files:**
- Create: `services/evidence/src/sec-daily-crawl.ts`
- Test: `services/evidence/test/sec-daily-crawl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/evidence/test/sec-daily-crawl.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlDailyFilings, type FormHandler } from "../src/sec-daily-crawl.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { QueryExecutor } from "../src/types.ts";

const ENTRIES: FilingIndexEntry[] = [
  { cik: 320193, company: "Apple", form: "4", filedDate: "2026-06-12", fileName: "edgar/data/320193/0000320193-26-000050.txt", accession: "0000320193-26-000050" },
  { cik: 789019, company: "MSFT", form: "8-K", filedDate: "2026-06-12", fileName: "edgar/data/789019/0000789019-26-000015.txt", accession: "0000789019-26-000015" },
  { cik: 1, company: "Ignore", form: "10-Q", filedDate: "2026-06-12", fileName: "edgar/data/1/0000000001-26-000001.txt", accession: "0000000001-26-000001" },
];

function deps(opts: { existingAccessions?: Set<string> } = {}) {
  const existing = opts.existingAccessions ?? new Set<string>();
  const ledgerCalls: unknown[] = [];
  const db: QueryExecutor = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/from documents/i.test(sql)) {
        const accession = params[0] as string;
        return { rows: existing.has(accession) ? [{ document_id: "doc-1" }] : [] } as never;
      }
      if (/edgar_crawl_ledger/i.test(sql)) ledgerCalls.push(params);
      return { rows: [] } as never;
    },
  } as QueryExecutor;
  const client = { fetchDailyIndex: async (_d: Date) => ENTRIES } as never;
  return { db, client, ledgerCalls };
}

test("dispatches only the requested forms to their handler; ignores others", async () => {
  const seen: string[] = [];
  const handler: FormHandler = async (entry) => { seen.push(`${entry.form}:${entry.accession}`); return { ingested: true }; };
  const d = deps();
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler, "8-K": handler } },
  );
  assert.deepEqual(seen.sort(), ["4:0000320193-26-000050", "8-K:0000789019-26-000015"]);
  assert.equal(result.byForm["4"].ingested, 1);
  assert.equal(result.byForm["8-K"].ingested, 1);
});

test("skips filings whose accession already has a documents row (idempotent)", async () => {
  const handlerCalls: string[] = [];
  const handler: FormHandler = async (entry) => { handlerCalls.push(entry.accession); return { ingested: true }; };
  const d = deps({ existingAccessions: new Set(["0000320193-26-000050"]) });
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler } },
  );
  assert.deepEqual(handlerCalls, []);
  assert.equal(result.byForm["4"].skipped, 1);
  assert.equal(result.byForm["4"].ingested, 0);
});

test("a handler throwing marks that form partial but does not abort the crawl", async () => {
  const ok: FormHandler = async () => ({ ingested: true });
  const boom: FormHandler = async () => { throw new Error("parse failed"); };
  const d = deps();
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": boom, "8-K": ok } },
  );
  assert.equal(result.byForm["4"].status, "partial");
  assert.equal(result.byForm["8-K"].status, "succeeded");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-daily-crawl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/evidence/src/sec-daily-crawl.ts
// Cross-market daily EDGAR crawl: fetch the day's master index, dispatch each
// filing of a requested form to its handler, skipping any accession already
// stored (idempotent), and record per-form progress in the crawl ledger.
import type { FilingIndexEntry } from "./sec-daily-index.ts";
import { recordCrawlBatch } from "./edgar-crawl-ledger-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

export type FormHandlerDeps = { db: QueryExecutor; objectStore: ObjectStore; client: DailyCrawlClient };
export type FormHandler = (entry: FilingIndexEntry, deps: FormHandlerDeps) => Promise<{ ingested: boolean }>;

export type DailyCrawlClient = { fetchDailyIndex(date: Date): Promise<FilingIndexEntry[]> };

export type CrawlDailyFilingsDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  client: DailyCrawlClient & { fetchFiling?: unknown };
};

export type CrawlDailyFilingsInput = {
  date: Date;
  handlers: Record<string, FormHandler>;
  now?: () => Date;
};

export type FormCrawlOutcome = {
  total: number;
  ingested: number;
  skipped: number;
  status: "succeeded" | "partial" | "failed";
};

export type CrawlDailyFilingsResult = { byForm: Record<string, FormCrawlOutcome> };

export async function crawlDailyFilings(
  deps: CrawlDailyFilingsDeps,
  input: CrawlDailyFilingsInput,
): Promise<CrawlDailyFilingsResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const indexDate = isoDate(input.date);
  const wanted = new Set(Object.keys(input.handlers));
  const entries = (await deps.client.fetchDailyIndex(input.date)).filter((e) => wanted.has(e.form));

  const byForm: Record<string, FormCrawlOutcome> = {};
  for (const form of wanted) byForm[form] = { total: 0, ingested: 0, skipped: 0, status: "succeeded" };

  for (const entry of entries) {
    const outcome = byForm[entry.form];
    outcome.total += 1;
    try {
      if (await accessionExists(deps.db, entry.accession)) {
        outcome.skipped += 1;
        continue;
      }
      const handlerDeps: FormHandlerDeps = {
        db: deps.db,
        objectStore: deps.objectStore,
        client: deps.client as DailyCrawlClient,
      };
      const result = await input.handlers[entry.form](entry, handlerDeps);
      if (result.ingested) outcome.ingested += 1;
      else outcome.skipped += 1;
    } catch {
      // One bad filing must not sink the day's crawl; mark the form partial
      // and continue. The ledger row records the discrepancy for an operator.
      outcome.status = "partial";
    }
  }

  for (const form of wanted) {
    const o = byForm[form];
    await recordCrawlBatch(deps.db, {
      form,
      indexDate,
      status: o.status,
      filingsTotal: o.total,
      filingsIngested: o.ingested,
      filingsSkipped: o.skipped,
      startedAt,
    });
  }
  return { byForm };
}

async function accessionExists(db: QueryExecutor, accession: string): Promise<boolean> {
  const result = await db.query<{ document_id: string }>(
    `select document_id::text as document_id
       from documents
      where provider_doc_id = $1 and deleted_at is null
      limit 1`,
    [accession],
  );
  return (result.rows as unknown[]).length > 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-daily-crawl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/sec-daily-crawl.ts services/evidence/test/sec-daily-crawl.test.ts
git commit -m "feat(evidence): crawlDailyFilings orchestrator with per-form handler dispatch"
```

---

### Task 0.5: One-shot CLI entrypoint

**Files:**
- Create: `services/evidence/src/sec-daily-crawl-cli.ts`
- Modify: `services/evidence/package.json` (add `crawl:sec-daily` script)
- Test: `services/evidence/test/sec-daily-crawl-cli.test.ts`

- [ ] **Step 1: Write the failing test (date resolution is the only logic worth unit-testing)**

```ts
// services/evidence/test/sec-daily-crawl-cli.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCrawlDate } from "../src/sec-daily-crawl-cli.ts";

test("resolveCrawlDate parses an explicit --date", () => {
  assert.equal(resolveCrawlDate(["--date", "2026-06-12"], () => new Date("2026-06-15T00:00:00Z")).toISOString().slice(0, 10), "2026-06-12");
});

test("resolveCrawlDate defaults to today (UTC) when no flag is given", () => {
  assert.equal(resolveCrawlDate([], () => new Date("2026-06-15T09:00:00Z")).toISOString().slice(0, 10), "2026-06-15");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-daily-crawl-cli.test.ts`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Write minimal implementation (mirrors `sec-filings-backfill-cli.ts` / `market/src/refresh-worker.ts`)**

```ts
// services/evidence/src/sec-daily-crawl-cli.ts
// One-shot EDGAR daily crawl, invoked by an external scheduler (cron/CI), e.g.:
//   npm run crawl:sec-daily -- --date 2026-06-12
// No handlers are registered yet (Slices 1–3 register Form 4 / 8-K / 13F).
import { SecEdgarClient } from "./sec-edgar.ts";
import { crawlDailyFilings, type FormHandler } from "./sec-daily-crawl.ts";

export function resolveCrawlDate(argv: string[], now: () => Date = () => new Date()): Date {
  const flagIndex = argv.indexOf("--date");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return new Date(`${argv[flagIndex + 1]}T00:00:00Z`);
  }
  return now();
}

// Slices 1–3 add their handlers to this registry.
export const FORM_HANDLERS: Record<string, FormHandler> = {};

export async function main(argv: string[]): Promise<void> {
  const date = resolveCrawlDate(argv);
  const client = SecEdgarClient.fromEnv();
  const { createDb } = await import("./db.ts"); // existing db factory used by dev.ts
  const { db, objectStore } = await createDb();
  const result = await crawlDailyFilings({ db, client, objectStore }, { date, handlers: FORM_HANDLERS });
  console.log(JSON.stringify({ date: date.toISOString().slice(0, 10), result }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

> NOTE for implementer: confirm the db/objectStore bootstrap helper name used by `services/evidence/src/dev.ts` and import it the same way (the `./db.ts` import above is a placeholder for that existing factory — match what `dev.ts` does).

Add to `services/evidence/package.json` scripts:

```json
"crawl:sec-daily": "node --experimental-strip-types src/sec-daily-crawl-cli.ts"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/evidence && node --experimental-strip-types --test test/sec-daily-crawl-cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/sec-daily-crawl-cli.ts services/evidence/package.json services/evidence/test/sec-daily-crawl-cli.test.ts
git commit -m "feat(evidence): one-shot sec-daily-crawl CLI (external-cron entrypoint)"
```

**Slice 0 done-when:** `npm test` green in `services/evidence`; migration `0032` applied; `npm run crawl:sec-daily -- --date <recent business day>` runs clean and writes ledger rows (0 ingested until a slice registers a handler).

---

## Slice 1 — Form 4 insider transactions  *(expand to full bite-sized plan at pickup)*

**Outcome:** Holders tab "Insider" view (official, click-through provenance) + a *material*-insider Agent finding + a computed Screener filter. **Depends on:** Slice 0 (spine) and Slice X (universe expansion — for the agent finding to fire).

**Tasks**
1. **`sec-form4-extractor.ts`** — `parseForm4(xml): Form4Transaction[]`. Parse the Form 4 XML embedded in the full submission `.txt`: `<issuerCik>`, `<rptOwnerCik>` + `<rptOwnerName>`, role (`<officerTitle>` / `<isDirector>` / `<isTenPercentOwner>`), and each `<nonDerivativeTransaction>` (`transactionCode` P/S/A/M/G/F, `transactionShares`, `transactionPricePerShare`, `transactionAcquiredDisposedCode` A/D, `sharesOwnedFollowingTransaction`). Tests: purchase, sale, multi-transaction filing, malformed-XML guard.
2. **Extend `EVENT_TYPES`** in `event-repo.ts` with `"insider_transaction"`. Test: `createEvent` accepts it.
3. **`0033_insider_transactions` migration** + **`insider-transactions-repo.ts`** — read model `(issuer_id, insider_name, insider_role, insider_cik, transaction_date, transaction_code, transaction_type, acquired_disposed, shares, price, value, source_id, accession, created_at)`, indexed `(issuer_id, transaction_date desc)`. Functions `insertInsiderTransaction()`, `findRecentByIssuer(issuer_id, sinceDays)`, `netSharesByIssuer(issuer_id, windowDays)`. Tests with fake `QueryExecutor`.
4. **`sec-form4-handler.ts`** (`FormHandler` for `4`,`4/A`) — fetch `.txt`; `parseForm4`; `resolveByCik` (text-pad CIK) → issuer_id, **skip + log if not_found** (tracked-scope, Q9); `createSource`+`ingestDocument`. For **every** transaction: `insertInsiderTransaction` (read-model) + `createEvent("insider_transaction")`+`createEventSubject(issuer)` (timeline). For the **material** subset only (open-market P/S by officer/director, value ≥ $100k): also `createClaim(predicate:"insider.transaction", attributed_to_type:"insider", attributed_to_id:insider_cik, status:"extracted")` + `createClaimArgument(claim, subject_kind:"issuer", subject_id:issuer_id)` (agent-visible). Register in `FORM_HANDLERS`. Tests: N read-model rows + N events for an N-txn filing; only material txns produce claims; untracked CIK skipped + logged.
5. **`fundamentals/src/sec-holders-repository.ts`** — `createSecHoldersRepository(db)` implementing `HoldersRepository.find(issuer_id, "insider")`: query `insider-transactions-repo`, map to `InsiderTransaction[]` (`holders.ts` shape), return `InsiderHoldersEnvelope` with the most-recent filing's `source_id`. `transaction_type` maps P→`buy`, S→`sell`, M→`option_exercise`, G→`gift`, else→`other`. Reads evidence-owned tables directly (shared-schema convention). Tests vs fake db.
6. **Wire fallback composition** — compose SEC repo ahead of the yfinance dev provider: `find()` tries SEC; null (no coverage) → falls through to dev. Test: SEC hit short-circuits; SEC miss falls through.
7. **Lazy-on-read backfill (Q6)** — on a Holders `kind=insider` request with no/stale coverage, serve cached + kick off async `backfillIssuerFilings(forms:["4"])`; track a per-issuer coverage watermark + TTL. Test: stale coverage triggers exactly one async backfill; fresh does not.
8. **Screener filter (Q5)** — compute `insider_net_shares_90d` / `insider_buy_count_90d` in `screener/src/db-candidates.ts` by joining `insider_transactions` over the window (mirroring `market_cap`); register in `fields.ts`. **No stored fact.** Tests: screen "net insider buying > 0" returns expected rows.
9. **Agent finding** — relies on Slice X (claims attach to issuer; expansion lets listing universes match). Test: an agent whose universe is a *listing* whose issuer has a new **material** insider buy produces a finding; a sub-threshold buy does not.

**Acceptance:** `GET /v1/fundamentals/holders?...&kind=insider` returns SEC-sourced rows whose `source_id` resolves to an EDGAR filing in the inspector; the Screener filter works; an agent (listing-kind universe) raises a finding only for material insider buys; `npm test` green in evidence + fundamentals + screener.

---

## Slice 2 — 8-K material events  *(expand to full bite-sized plan at pickup)*

**Outcome:** real-time material-event stream feeding Agents + a per-issuer events timeline (Signals/Evidence), every event click-through to the 8-K. **Depends on:** Slice 0 (spine) and Slice X (for the agent finding to fire).

**Tasks**
1. **`sec-8k-item-taxonomy.ts`** — map 8-K Item numbers → event type, e.g. `5.02`→`officer_change`, `4.02`→`restatement`, `1.01`→`material_agreement`, `1.03`→`bankruptcy`, `3.01`→`delisting`, `4.01`→`auditor_change`, `2.02`→`guidance_update` (existing), `8.01`→`m_and_a`/other. **9.01 (Financial Statements & Exhibits) maps to an event but is excluded from claims** (no agent signal, Q7); all other recognized items → claims. `classify8kItems(items): {eventType, itemCode, claimable}[]`. Tests: each mapped item; 9.01 → `claimable:false`; unknown item → `material_event` fallback.
2. **Extend `EVENT_TYPES`** with the new values above. Test: `createEvent` accepts them.
3. **`sec-8k-handler.ts`** (`FormHandler` for `8-K`,`8-K/A`) — fetch `.txt`; read `<ITEMS>` from the SGML header; `resolveByCik` → issuer_id (skip + log if untracked, Q9); `createSource`+`ingestDocument`; for each item `createEvent`+`createEventSubject(issuer)`, and for `claimable` items also `createClaim(predicate:"material_event.<type>")` + `createClaimArgument(issuer)`. Register in `FORM_HANDLERS`. Tests: an 8-K with Items 5.02+9.01 yields two events but only one claim (5.02).
4. **Timeline reader** — add `findEventsByIssuer(issuer_id, sinceDays)` to `event-repo.ts` (none exists today — confirmed). Test: returns the new events newest-first.
5. **Follow-up hook** — structure the handler so the backlog "8-K LLM enrichment" issue can attach a richer claim to the existing event for high-severity items (4.02, 1.03) without re-ingest.

**Acceptance:** crawling a day of known 8-Ks produces correctly-typed, issuer-linked events; an agent (listing-kind universe, via Slice X) raises a material-event finding; 9.01-only filings produce no claim; events appear in the issuer timeline with provenance; `npm test` green.

---

## Slice 3 — 13F institutional holdings (superinvestor-seeded v1)  *(expand to full bite-sized plan at pickup)*

**Outcome:** Holders tab "Institutional" view + a "superinvestor moves" surface, backed by official 13F data. Scope is the seeded-filer subset (see flagged decision).

**Tasks**
1. **`0034_institutional_holdings` migration** + **`institutional-holdings-repo.ts`** — `(filer_cik, filer_name, issuer_id, cusip, shares, value_usd, filing_period, filing_date, source_id, accession)`, indexed on `(issuer_id, filing_period desc)` and `(filer_cik, filing_period desc)`. Functions `insertHolding()`, `topHoldersByIssuer(issuer_id, period)`, `holdingsByFiler(filer_cik, period)`. Tests with fake db.
2. **`superinvestor-filers.ts`** — seed registry of notable filer CIKs (Berkshire `1067983`, etc.) with display names. Test: registry shape + lookup.
3. **`cusip-issuer-map.ts`** — `resolveIssuerByCusip(db, cusip)` querying issuers/instruments already enriched with CUSIP (OpenFIGI tier). Returns `issuer_id | null`. Test: known CUSIP resolves; unknown → null (logged, skipped).
4. **`sec-13f-extractor.ts`** — `parse13fInfoTable(xml): Holding[]` (`<infoTable>` rows: `nameOfIssuer`, `cusip`, `value`, `sshPrnamt`). Tests: multi-holding table; value-unit normalization (13F values are in whole USD post-2023; handle both).
5. **`sec-13f-handler.ts`** (`FormHandler` for `13F-HR`,`13F-HR/A`) — **gate on filer**: process only if `cik ∈ superinvestor registry` (Q8 = seeded-only). Fetch `.txt`; `parse13fInfoTable`; for each holding resolve CUSIP→issuer (skip + log misses); `createSource`+`ingestDocument`; `insertHolding` (read-model, all holdings). Add `"position_change"` to `EVENT_TYPES`; for **notable** changes vs the prior period (new position / full exit / large change), `createEvent("position_change")`+`createEventSubject(issuer)` **and** `createClaim(predicate:"position_change.<kind>")`+`createClaimArgument(issuer)` (agent-visible, per Slice X). Routine rebalances → read-model only. Register in `FORM_HANDLERS`. Tests: a seeded-filer 13F persists holdings for resolvable CUSIPs and emits claims only for notable changes; non-seed filer is ignored.
6. **Extend `sec-holders-repository.ts`** with `kind: "institutional"` — `topHoldersByIssuer` → `InstitutionalHolder[]` (`holder_name, shares_held, market_value, percent_of_shares_outstanding, shares_change, filing_date`). `percent_of_shares_outstanding` computed from `shares_outstanding` fact if available, else null. Returns `InstitutionalHoldersEnvelope`. Compose ahead of dev provider (as Slice 1). Tests against fake db.
7. **Disclosure** — institutional facts carry the 45-day-lag reality; ensure the envelope/`as_of` reflects `filing_period`+lag so the existing snapshot disclosure compiler surfaces staleness. Test: `as_of` reflects filing date, not now.
8. **Metrics** — add `institutional_ownership_pct`, `institutional_holders_count` to `db/seed/metrics.sql`.

**Acceptance:** `GET /v1/fundamentals/holders?...&kind=institutional` returns SEC-sourced top holders for a covered issuer; a "Berkshire holdings" view lists resolvable positions; CUSIP-miss coverage is logged, not silently dropped; `npm test` green.

---

## Operational notes

- **Env:** reuse `SEC_EDGAR_USER_AGENT` (already required by `SecEdgarClient.fromEnv()`). No new keys for v1. Document the cron invocation in `services/evidence/README.md`: `npm run crawl:sec-daily -- --date <YYYY-MM-DD>` daily (Form 4 / 8-K) and a weekly run sufficient for 13F (quarterly cadence, 45-day windows).
- **Rate limits:** all fetches go through the existing token-bucket (8 rps, < 10 rps SEC ceiling). A full day's Form 4 volume (~thousands) at 8 rps is minutes of wall-clock — acceptable for a nightly one-shot. If it grows, raise `maxFilings`-style batching, not the rps.
- **Source UUIDs:** none required (per-filing `createSource`). Reserve `…014/015/016` only if canonical aggregate sources are added later.
- **No silent caps:** the 13F superinvestor gate and CUSIP-miss skips MUST `console.warn`/log counts so coverage gaps are visible, not mistaken for "no holdings."

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Full-submission `.txt` is large for some 8-Ks | Crawl restricted to 4/8-K/13F-HR; revisit primary-doc-only fetch if blob size is a problem |
| CIK→issuer mapping gaps (issuer not yet resolved) | Skip + log; a follow-up can trigger resolver on miss |
| 13F CUSIP→issuer coverage limited in v1 | Explicitly scoped (seeded filers, DB-resolvable CUSIPs); logged coverage; full master is a separate effort |
| EDGAR daily index missing on weekends/holidays | Crawl tolerates 404 (no filings that day) — treat as `succeeded` with 0 total |
| `event_type` proliferation | Keep the taxonomy small; reuse existing types where honest (`guidance_update`, `lawsuit`, `m_and_a`) |

## Self-review (against the epic spec)

- **Coverage:** Slice X (universe→issuer expansion, ADR 0001) ✓; spine (crawl + ledger + CLI + tracked-scope) ✓; Form 4 → Holders/Agents/Screener + lazy backfill ✓; 8-K → Agents/Signals ✓; 13F → Holders/superinvestor ✓.
- **Grilled corrections applied (2026-06-15):** no `person` subject kind (Q3); agents surface via *claims*, not events (Q4/ADR 0001); insider Screener filter computed, not a fact (Q5); materiality split for claims (Q2); dual ingestion + tracked-scope + lazy backfill (Q1/Q6/Q9); 13F seeded + DB-resolvable CUSIP + 45-day disclosure + value-unit normalization (Q8).
- **Placeholders:** Slice 0 has full code; one implementer NOTE in 0.5 (db bootstrap helper name) — confirm against `dev.ts`. Slice X + Slices 1–3 are task-level (per-slice expansion at pickup), not placeholders.
- **Type consistency:** `FilingIndexEntry`, `FormHandler`, `crawlDailyFilings`, `recordCrawlBatch`/`lastCrawledDate`, `HoldersRepository`/`InsiderTransaction`/`InstitutionalHolder` names match across tasks and the real code.
- **Backlog (not v1):** 8-K LLM enrichment; 13F full-universe + CUSIP master.
