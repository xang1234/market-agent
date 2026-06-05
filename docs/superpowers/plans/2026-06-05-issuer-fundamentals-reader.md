# Issuer-Fundamentals Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a canonical `loadRecentIssuerFundamentals` reader in `services/fundamentals` that filters facts by `entitlement_channels` + `verification_status` (parity with the egress guard + promotion rules), and migrate chat's `loadIssuerFacts` onto it.

**Architecture:** A new fundamentals reader owns the eligibility filter (method/active/channel/verification) in one place and returns a rich fact-summary shape. Chat's `loadIssuerFacts` becomes a thin adapter over it. The display-worthy verification set is a new canonical constant in evidence; the entitlement channel type is reused from evidence.

**Tech Stack:** Node `--experimental-strip-types` services (no build step, cross-service imports via relative `../../`), `node:test`, PostgreSQL (`facts` table jsonb `entitlement_channels`, enum `verification_status`), docker-pg integration harness at `db/test/docker-pg.ts`.

**Test commands:**
- Evidence: `cd services/evidence && node --experimental-strip-types --test 'test/**/*.test.ts'`
- Fundamentals: `cd services/fundamentals && node --experimental-strip-types --test 'test/**/*.test.ts'`
- Chat: `cd services/chat && node --experimental-strip-types --test 'test/**/*.test.ts'`
- A single file: `node --experimental-strip-types --test test/<file>.test.ts`

---

## File Structure

- **Create** `services/fundamentals/src/issuer-fundamentals-reader.ts` — the canonical reader: `IssuerFundamentalFact` type, `loadRecentIssuerFundamentals`, and the private row→fact mapping (`numericOrNull`, `isoString`).
- **Create** `services/fundamentals/test/issuer-fundamentals-reader.test.ts` — always-on unit test (recording fake db: asserts the query predicates + params + row mapping).
- **Create** `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts` — docker-gated: seeds mixed facts via `createFact`, proves the filter excludes candidate/disputed/non-channel facts.
- **Modify** `services/evidence/src/promotion-rules.ts` — add `DISPLAYABLE_VERIFICATION_STATUSES`.
- **Modify** `services/evidence/test/promotion-rules.test.ts` (or create if absent) — assert the new constant.
- **Modify** `services/chat/src/local-runtime-structured.ts` — adapter + `IssuerFactSummary` alias; delete inline SQL, `FactRow`, `factSummaryFromRow`, `numericOrNull`, `isoString`.
- **Modify** `services/chat/test/local-runtime-structured.test.ts` — drop the `factSummaryFromRow` import + its two unit tests (they move to the reader test); keep the rest.

---

## Task 1: `DISPLAYABLE_VERIFICATION_STATUSES` constant in evidence

**Files:**
- Modify: `services/evidence/src/promotion-rules.ts` (after the existing `PROMOTION_VERIFICATION_STATUSES` block, ~line 13)
- Test: `services/evidence/test/promotion-rules.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `services/evidence/test/promotion-rules.test.ts` (create the file with this content if it does not exist; if it exists, append the test and add the import):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  DISPLAYABLE_VERIFICATION_STATUSES,
  PROMOTION_VERIFICATION_STATUSES,
} from "../src/promotion-rules.ts";

test("DISPLAYABLE_VERIFICATION_STATUSES is the promoted subset, excluding candidate/disputed", () => {
  assert.deepEqual([...DISPLAYABLE_VERIFICATION_STATUSES], ["authoritative", "corroborated"]);
  // Every displayable status is a real verification status.
  for (const status of DISPLAYABLE_VERIFICATION_STATUSES) {
    assert.ok(PROMOTION_VERIFICATION_STATUSES.includes(status));
  }
  assert.ok(!DISPLAYABLE_VERIFICATION_STATUSES.includes("candidate" as never));
  assert.ok(!DISPLAYABLE_VERIFICATION_STATUSES.includes("disputed" as never));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/evidence && node --experimental-strip-types --test test/promotion-rules.test.ts`
Expected: FAIL — `DISPLAYABLE_VERIFICATION_STATUSES` is not exported (`SyntaxError`/`undefined`).

- [ ] **Step 3: Add the constant**

In `services/evidence/src/promotion-rules.ts`, immediately after the `PromotionVerificationStatus` type (~line 13), add:

```ts
// The verification statuses a fact must hold to ground a user-facing answer —
// the outcomes of a "promote" decision (see CandidateFactPromotionDecision).
// candidate (unverified) and disputed (contested) are not display-worthy.
export const DISPLAYABLE_VERIFICATION_STATUSES = Object.freeze([
  "authoritative",
  "corroborated",
] as const);
export type DisplayableVerificationStatus =
  (typeof DISPLAYABLE_VERIFICATION_STATUSES)[number];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/evidence && node --experimental-strip-types --test test/promotion-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/promotion-rules.ts services/evidence/test/promotion-rules.test.ts
git commit -m "feat(evidence): add DISPLAYABLE_VERIFICATION_STATUSES (fra-savt)"
```

---

## Task 2: the canonical reader + row mapping (always-on unit test)

**Files:**
- Create: `services/fundamentals/src/issuer-fundamentals-reader.ts`
- Test: `services/fundamentals/test/issuer-fundamentals-reader.test.ts`

The unit test uses a **recording fake `QueryExecutor`** — it captures the SQL text + bind params and returns canned rows. This proves the query carries the two new predicates and the correct params, and that rows map correctly — without needing Postgres. (The live filter behavior is proven by the docker-gated integration test in Task 3.)

- [ ] **Step 1: Write the failing test**

Create `services/fundamentals/test/issuer-fundamentals-reader.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import { loadRecentIssuerFundamentals } from "../src/issuer-fundamentals-reader.ts";

const ISSUER = { kind: "issuer" as const, id: "11111111-1111-4111-8111-111111111111" };

function recordingDb(rows: unknown[]): {
  db: QueryExecutor;
  calls: Array<{ text: string; values: unknown[] }>;
} {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });
      return { rows, rowCount: rows.length } as never;
    },
  };
  return { db, calls };
}

test("loadRecentIssuerFundamentals filters on channel + displayable verification, binding the defaults", async () => {
  const { db, calls } = recordingDb([]);
  await loadRecentIssuerFundamentals(db, ISSUER, { limit: 24 });

  assert.equal(calls.length, 1);
  const { text, values } = calls[0];
  // The two new eligibility predicates are present...
  assert.match(text, /entitlement_channels \? \$2/);
  assert.match(text, /verification_status = any\(\$3::verification_status\[\]\)/);
  // ...alongside the pre-existing ones.
  assert.match(text, /f\.method = 'reported'/);
  assert.match(text, /f\.superseded_by is null/);
  assert.match(text, /f\.invalidated_at is null/);
  // Params: issuer id, default channel 'app', displayable statuses, limit.
  assert.deepEqual(values, [
    ISSUER.id,
    "app",
    ["authoritative", "corroborated"],
    24,
  ]);
});

test("loadRecentIssuerFundamentals honors an explicit channel", async () => {
  const { db, calls } = recordingDb([]);
  await loadRecentIssuerFundamentals(db, ISSUER, { channel: "export", limit: 5 });
  assert.deepEqual(calls[0].values, [
    ISSUER.id,
    "export",
    ["authoritative", "corroborated"],
    5,
  ]);
});

test("loadRecentIssuerFundamentals coerces numeric/Date columns and preserves provenance", async () => {
  const { db } = recordingDb([
    {
      metric_key: "revenue",
      display_name: "Revenue",
      value_num: "190872000", // pg returns numeric as string
      value_text: null,
      unit: "currency",
      currency: "USD",
      fiscal_year: 2021,
      fiscal_period: "FY",
      as_of: new Date("2026-05-08T16:57:05.951Z"),
      source_id: "00000000-0000-4000-a000-000000000001",
    },
  ]);
  const [fact] = await loadRecentIssuerFundamentals(db, ISSUER, { limit: 24 });
  assert.equal(fact.value_num, 190872000);
  assert.equal(fact.as_of, "2026-05-08T16:57:05.951Z");
  assert.equal(fact.display_name, "Revenue");
  assert.equal(fact.source_id, "00000000-0000-4000-a000-000000000001");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/fundamentals && node --experimental-strip-types --test test/issuer-fundamentals-reader.test.ts`
Expected: FAIL — module `../src/issuer-fundamentals-reader.ts` does not exist.

- [ ] **Step 3: Write the reader**

Create `services/fundamentals/src/issuer-fundamentals-reader.ts`:

```ts
import type { QueryExecutor } from "../../evidence/src/types.ts";
import { DISPLAYABLE_VERIFICATION_STATUSES } from "../../evidence/src/promotion-rules.ts";
import type { FactEntitlementChannel } from "../../evidence/src/fact-repo.ts";
import type { IssuerSubjectRef } from "./subject-ref.ts";

// Canonical "recent fundamentals for an issuer" reader. Owns the single
// definition of which facts may ground a user-facing answer: reported, active,
// entitled for the egress channel, and display-verified. Chat reads through
// this; the screener follow-up (fra-savt sibling) will reuse it.
export type IssuerFundamentalFact = {
  metric_key: string;
  display_name: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: string;
  source_id: string;
};

export type LoadRecentIssuerFundamentalsOptions = {
  // Egress channel the facts must be entitled to. Defaults to "app" — the
  // channel chat answers render on.
  channel?: FactEntitlementChannel;
  limit: number;
};

type FactRow = {
  metric_key: string;
  display_name: string | null;
  value_num: number | string | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: Date | string;
  source_id: string;
};

export async function loadRecentIssuerFundamentals(
  db: QueryExecutor,
  issuer: IssuerSubjectRef,
  options: LoadRecentIssuerFundamentalsOptions,
): Promise<IssuerFundamentalFact[]> {
  const channel = options.channel ?? "app";
  const { rows } = await db.query<FactRow>(
    // Eligibility filter — the one place chat + screener share. method='reported'
    // keeps derived/estimated out; entitlement_channels and verification_status
    // give parity with the egress guard (fact-repo.listFactsForEgress) and the
    // promotion rules (only promoted facts ground answers).
    `select m.metric_key,
            m.display_name,
            f.value_num,
            f.value_text,
            f.unit,
            f.currency,
            f.fiscal_year,
            f.fiscal_period,
            f.as_of,
            f.source_id::text as source_id
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1::uuid
        and f.method = 'reported'
        and f.superseded_by is null
        and f.invalidated_at is null
        and f.entitlement_channels ? $2
        and f.verification_status = any($3::verification_status[])
      order by f.fiscal_year desc nulls last,
               f.as_of desc,
               m.metric_key
      limit $4`,
    [issuer.id, channel, [...DISPLAYABLE_VERIFICATION_STATUSES], options.limit],
  );
  return rows.map(factFromRow);
}

function factFromRow(row: FactRow): IssuerFundamentalFact {
  return Object.freeze({
    metric_key: row.metric_key,
    display_name: row.display_name,
    value_num: numericOrNull(row.value_num),
    value_text: row.value_text,
    unit: row.unit,
    currency: row.currency,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    as_of: isoString(row.as_of),
    source_id: row.source_id,
  });
}

function numericOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
```

Note: `numericOrNull`/`isoString` are copied from chat's `local-runtime-structured.ts` (lines ~291/~301); Task 4 deletes them there. Verify the chat originals match this behavior when you delete them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/fundamentals && node --experimental-strip-types --test test/issuer-fundamentals-reader.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/fundamentals/src/issuer-fundamentals-reader.ts services/fundamentals/test/issuer-fundamentals-reader.test.ts
git commit -m "feat(fundamentals): canonical issuer-fundamentals reader with channel+verification filter (fra-savt)"
```

---

## Task 3: docker-pg integration test (proves the live filter)

**Files:**
- Create: `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts`

This test proves the jsonb `?` and enum `any()` predicates actually exclude rows. It is gated on `dockerAvailable()` (skips cleanly when Docker is absent, like the analyze integration tests). It seeds via `createFact` (`services/evidence/src/fact-repo.ts`), which writes all required fact columns including `verification_status`, `entitlement_channels`, and `method`.

**Before writing:** read `services/evidence/src/fact-repo.ts` for the exact `FactInput` shape (the fields `createFact` requires), and look at an existing evidence integration test (e.g. `services/evidence/test/*integration*.test.ts`) for how it seeds the prerequisite `sources` and `metrics` rows and bootstraps the db. Reuse those seed helpers; do not hand-roll raw `facts` inserts.

- [ ] **Step 1: Write the integration test**

Create `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createFact } from "../../evidence/src/fact-repo.ts";
import { loadRecentIssuerFundamentals } from "../src/issuer-fundamentals-reader.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";

// Helper: seed a single revenue fact with explicit verification_status +
// entitlement_channels. Fill the remaining FactInput fields from the shape you
// read in fact-repo.ts (subject, metric_id, period, value, unit, as_of,
// observed_at, source_id, method, freshness_class, coverage_level, confidence).
// Seed one `sources` row and one `metrics` row (metric_key 'revenue') first,
// reusing the evidence integration-test seed helpers.

test(
  "loadRecentIssuerFundamentals returns only app-entitled, display-verified facts",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-reader");
    const db = await connectedClient(t, databaseUrl);

    // seedSource(db, SOURCE_ID); seedMetric(db, REVENUE_METRIC_ID, "revenue");
    // const base = { subject_kind: "issuer", subject_id: ISSUER_ID, metric_id: REVENUE_METRIC_ID, ...commonFields };

    // (1) authoritative + ["app"]  -> KEPT
    await createFact(db, { /* ...base, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] */ } as never);
    // (2) candidate + ["app"]      -> EXCLUDED
    await createFact(db, { /* ...base, value_num: 200, verification_status: "candidate",     entitlement_channels: ["app"] */ } as never);
    // (3) disputed + ["app"]       -> EXCLUDED
    await createFact(db, { /* ...base, value_num: 300, verification_status: "disputed",      entitlement_channels: ["app"] */ } as never);
    // (4) authoritative + ["export"] (no app) -> EXCLUDED for app, KEPT for export
    await createFact(db, { /* ...base, value_num: 400, verification_status: "authoritative", entitlement_channels: ["export"] */ } as never);

    const appFacts = await loadRecentIssuerFundamentals(db, { kind: "issuer", id: ISSUER_ID }, { limit: 50 });
    assert.deepEqual(appFacts.map((f) => f.value_num), [100], "only the authoritative app fact survives the app-channel filter");

    const exportFacts = await loadRecentIssuerFundamentals(db, { kind: "issuer", id: ISSUER_ID }, { channel: "export", limit: 50 });
    assert.deepEqual(exportFacts.map((f) => f.value_num), [400], "export channel surfaces the export-only fact, not the app one");
  },
);
```

Replace the commented seed scaffolding with the concrete `FactInput` fields once you have read `fact-repo.ts`. The four facts share everything except `value_num`, `verification_status`, and `entitlement_channels`.

- [ ] **Step 2: Run it**

Run: `cd services/fundamentals && node --experimental-strip-types --test test/issuer-fundamentals-reader.integration.test.ts`
Expected: with Docker — PASS; without Docker — `# SKIP`. (If it FAILS once seeds are filled in, the predicate or the seed is wrong — fix until the four-fact filter assertions hold.)

- [ ] **Step 3: Commit**

```bash
git add services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts
git commit -m "test(fundamentals): integration test proving channel+verification fact filter (fra-savt)"
```

---

## Task 4: migrate chat `loadIssuerFacts` onto the reader

**Files:**
- Modify: `services/chat/src/local-runtime-structured.ts`
- Modify: `services/chat/test/local-runtime-structured.test.ts`

- [ ] **Step 1: Update the chat test first (it pins the new shape)**

In `services/chat/test/local-runtime-structured.test.ts`:
- Remove `factSummaryFromRow` from the import block (lines ~7-17). The two `factSummaryFromRow` unit tests (the `"factSummaryFromRow coerces..."` and `"factSummaryFromRow keeps text-only..."` tests, ~lines 45-95) are now covered by the reader's unit test (Task 2, third test) — delete them here.
- Keep `IssuerFactSummary`, `factRecencyFrom`, `loadStructuredSubjectContext`, and all other imports/tests as-is. `IssuerFactSummary` stays valid because Task 4 Step 3 keeps it as an alias.

- [ ] **Step 2: Run the chat test to confirm it fails**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured.test.ts`
Expected: FAIL — `factSummaryFromRow` import removed but the source still exports it (no failure yet) OR passes; this step is a checkpoint. If it still passes, that's fine — proceed. The real failure surfaces after Step 3 if the alias is wrong.

- [ ] **Step 3: Rewrite the chat source**

In `services/chat/src/local-runtime-structured.ts`:

1. Add the import (top of file, near the other `../../` imports):

```ts
import {
  loadRecentIssuerFundamentals,
  type IssuerFundamentalFact,
} from "../../fundamentals/src/issuer-fundamentals-reader.ts";
```

2. Replace the `IssuerFactSummary` type definition (lines ~22-33) with an alias:

```ts
// Re-exported alias: the canonical reader owns this shape now. Kept so the
// chat module + its test reference one local name.
export type IssuerFactSummary = IssuerFundamentalFact;
```

3. Delete the `FactRow` type (lines ~84-95).

4. Replace `loadIssuerFacts` (lines ~151-184) with a thin adapter:

```ts
async function loadIssuerFacts(
  db: QueryExecutor,
  issuer: (SubjectRef & { kind: "issuer" }) | null,
  limit: number,
): Promise<IssuerFactSummary[]> {
  if (issuer === null) return [];
  return loadRecentIssuerFundamentals(db, issuer, { channel: "app", limit });
}
```

5. Delete `factSummaryFromRow` (lines ~208-221), `numericOrNull` (~line 291), and `isoString` (~line 301). (Confirm via grep that nothing else in the file calls them — `factRecencyFrom` does not; the quote path does not.)

- [ ] **Step 4: Run all chat tests**

Run: `cd services/chat && node --experimental-strip-types --test 'test/**/*.test.ts'`
Expected: PASS. `loadStructuredSubjectContext` tests still pass — their fake db returns canned fact rows regardless of the SQL text, and the adapter still calls `db.query`. If a test imported `factSummaryFromRow` and you missed it, fix the import.

- [ ] **Step 5: Confirm no dangling references**

Run: `grep -rn "factSummaryFromRow\|numericOrNull\|isoString\|type FactRow" services/chat/src services/chat/test`
Expected: no matches (all removed/relocated).

- [ ] **Step 6: Commit**

```bash
git add services/chat/src/local-runtime-structured.ts services/chat/test/local-runtime-structured.test.ts
git commit -m "refactor(chat): read issuer facts through canonical fundamentals reader (fra-savt)"
```

---

## Task 5: screener follow-up bead + full verification + finish

**Files:** none (process task)

- [ ] **Step 1: Create the screener follow-up bead**

```bash
bd create --title="Migrate screener loadLatestFundamentals onto loadRecentIssuerFundamentals" \
  --description="Follow-up to fra-savt. services/screener/src/db-candidates.ts loadLatestFundamentals still queries facts directly (FY current+prior via a latest_year CTE) without entitlement_channels/verification_status parity. Add periodKind + metricKeys options to loadRecentIssuerFundamentals and rework the screener's latest_year CTE into a JS current+prior pick over eligible FY rows, so the parity filter lives in one place." \
  --type=task --priority=3
bd dep add <new-id> fra-savt
```

- [ ] **Step 2: Run the three affected suites**

```bash
cd services/evidence && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../fundamentals && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../chat && node --experimental-strip-types --test 'test/**/*.test.ts'
```
Expected: all pass (fundamentals integration test may show `# SKIP` without Docker).

- [ ] **Step 3: Close the bead, push**

```bash
bd close fra-savt --reason="Canonical loadRecentIssuerFundamentals reader added with entitlement_channels + verification_status filtering; chat loadIssuerFacts migrated onto it. Screener migration deferred to follow-up bead."
git add -A && git commit -m "chore(fundamentals): finish fra-savt reader extraction" --allow-empty
git push -u origin feat/fra-savt-fundamentals-reader
```

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to verify tests, then present merge/PR options.

---

## Self-Review

**Spec coverage:**
- Module boundary + constant home (evidence) → Task 1 + Task 2. ✓
- Reader contract (signature, filter, rich shape) → Task 2. ✓
- Chat migration (adapter, alias, deletions) → Task 4. ✓
- Testing (integration filter proof + adapter/mapping) → Task 2 (unit) + Task 3 (integration) + Task 4 (chat). ✓
- Screener out-of-scope follow-up → Task 5 Step 1. ✓

**Type consistency:** `loadRecentIssuerFundamentals(db, issuer, options)` and `IssuerFundamentalFact` are referenced identically in Tasks 2/3/4. `IssuerFactSummary = IssuerFundamentalFact` alias keeps chat's existing references valid. `DISPLAYABLE_VERIFICATION_STATUSES` defined in Task 1, consumed in Task 2.

**Known follow-through (not placeholders):** Task 3's seed scaffolding is intentionally completed by reading `FactInput` in `fact-repo.ts` — the test's assertions (the four facts and their expected filtering) are fully specified; only the FK-prerequisite field names are deferred to the implementer with explicit instructions, because they must match `createFact`'s real signature.
