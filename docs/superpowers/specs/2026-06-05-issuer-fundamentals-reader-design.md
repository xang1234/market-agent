# Canonical Issuer-Fundamentals Reader (fra-savt)

**Status:** Design approved 2026-06-05
**Bead:** fra-savt — "Extract canonical issuer-fundamentals reader; add entitlement/verification parity to chat facts query"
**Branch:** `feat/fra-savt-fundamentals-reader`

## Problem

Three code paths read `facts` for a subject, and their eligibility filters have drifted:

| Reader | `method='reported'` | active (`superseded_by`/`invalidated_at` null) | `entitlement_channels ? ch` | `verification_status` |
|---|:---:|:---:|:---:|:---:|
| `chat/src/local-runtime-structured.ts` `loadIssuerFacts` | yes | yes | **no** | **no** |
| `screener/src/db-candidates.ts` `loadLatestFundamentals` | yes | yes | **no** | **no** |
| `evidence/src/fact-repo.ts` `listFactsForEgress` (egress guard) | no | no | yes | no |

The chat path builds the fundamentals context that grounds a user-facing answer, but applies neither:

- **`entitlement_channels`** — the canonical egress guard (`listFactsForEgress`) filters `entitlement_channels ? channel`; the chat read does not, so a fact not entitled to the `app` channel can still ground an `app` answer.
- **`verification_status`** — nothing filters it on the read path, so `candidate` (unverified) and `disputed` (contested) facts can surface.

Harmless in dev (every fact is `authoritative` and `["app"]`-entitled), but a correctness/leak risk once the default runtime serves entitlement-gated prod data.

## Decisions (from brainstorming)

1. **Scope:** chat now; screener is a fast-follow bead. The reader is built for reuse, but only chat migrates in this change.
2. **Display-worthy verification statuses:** `{authoritative, corroborated}` — the two outcomes of the promotion rules' `action: "promote"` decision (`evidence/src/promotion-rules.ts`). `candidate` and `disputed` are excluded.
3. **A real reader** (not an inline filter or a bare WHERE-fragment helper) is the centralization point.

## Architecture

### New canonical constant (evidence owns the verification taxonomy)

`evidence/src/promotion-rules.ts` gains:

```ts
// The verification statuses a fact must hold to ground a user-facing answer —
// the outcomes of a "promote" decision. candidate (unverified) and disputed
// (contested) are not display-worthy.
export const DISPLAYABLE_VERIFICATION_STATUSES = Object.freeze([
  "authoritative",
  "corroborated",
] as const);
export type DisplayableVerificationStatus =
  (typeof DISPLAYABLE_VERIFICATION_STATUSES)[number];
```

`FactEntitlementChannel` is already exported from `evidence/src/fact-repo.ts:36` and is reused as-is.

### New reader module

`services/fundamentals/src/issuer-fundamentals-reader.ts`:

```ts
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { IssuerSubjectRef } from "./subject-ref.ts";
import {
  DISPLAYABLE_VERIFICATION_STATUSES,
} from "../../evidence/src/promotion-rules.ts";
import type { FactEntitlementChannel } from "../../evidence/src/fact-repo.ts";

export type IssuerFundamentalFact = {
  metric_key: string;
  display_name: string;
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
  channel?: FactEntitlementChannel; // defaults to "app"
  limit: number;
};

export async function loadRecentIssuerFundamentals(
  db: QueryExecutor,
  issuer: IssuerSubjectRef,
  options: LoadRecentIssuerFundamentalsOptions,
): Promise<IssuerFundamentalFact[]>;
```

The query is chat's current SQL plus the two missing predicates. It owns the eligibility filter — this is the single place the parity lives:

```sql
select m.metric_key,
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
   and f.entitlement_channels ? $2                                  -- NEW
   and f.verification_status = any($3::verification_status[])       -- NEW
 order by f.fiscal_year desc nulls last,
          f.as_of desc,
          m.metric_key
 limit $4
```

Bind params: `[issuer.id, channel ?? "app", [...DISPLAYABLE_VERIFICATION_STATUSES], limit]`.

The return shape is a **rich superset** (carries `display_name`, `value_text`, `unit`, `currency`, period fields, `source_id`) so the screener follow-up can project `metric_key`/`fiscal_year`/`value_num` from the same reader once `periodKind`/`metricKeys` options are added.

### Chat migration

`chat/src/local-runtime-structured.ts`:

- `loadIssuerFacts` collapses to a thin adapter calling `loadRecentIssuerFundamentals(db, issuer, { channel: "app", limit })` (keeping its existing `issuer === null → []` guard).
- Its inline SQL, the local `FactRow` type, and `factSummaryFromRow` are deleted.
- `IssuerFactSummary` becomes a type alias: `export type IssuerFactSummary = IssuerFundamentalFact`. The field set is identical, so `StructuredSubjectContext.facts`, `factRecencyFrom`, and the test (which imports `IssuerFactSummary`) keep working with zero rename churn. The alias is retained because it is exported and referenced across the chat module + its test.

## Data flow (unchanged shape, tightened filter)

`loadStructuredSubjectContext` → `loadRecentIssuerFundamentals` (eligible facts only) → `IssuerFundamentalFact[]` → `StructuredSubjectContext.facts` + derived `source_ids` + `fact_recency`. The only behavioral change: `candidate`/`disputed`/non-`app`-entitled facts no longer appear.

## Error handling

No new error surface. The reader is a plain read returning `[]` for a null/absent issuer is the caller's concern (chat already guards `issuer === null` before calling; that guard stays in the adapter). DB errors propagate to `loadStructuredSubjectContext`'s existing `Promise.allSettled` degradation (a failed facts read serves the answer without fundamentals, as today).

## Testing

The new predicates are no-ops against dev data (all facts `authoritative` + `["app"]`), so correctness requires seeded counter-examples:

- **Docker-pg integration test** for `loadRecentIssuerFundamentals` (mirrors `services/analyze/test/template-runner.integration.test.ts`, gated on `dockerAvailable()`). Seed one issuer with four facts:
  1. `authoritative`, `["app"]` → **returned**
  2. `candidate`, `["app"]` → excluded
  3. `disputed`, `["app"]` → excluded
  4. `authoritative`, `["export"]` (no `app`) → excluded

  Assert only fact (1) returns; assert `channel: "export"` instead returns fact (4) and excludes (1).
- **Chat adapter unit test:** update the existing `chat/test/local-runtime-structured.test.ts` to the new shape and confirm the adapter still maps eligible rows into `StructuredSubjectContext.facts` and derives `source_ids`.

## Out of scope (follow-up bead)

Screener `loadLatestFundamentals` migration: add `periodKind` + `metricKeys` options to the reader and rework the screener's `latest_year` CTE into a JS current+prior pick over eligible FY rows. A new bead will be created and linked to fra-savt.

## Files

- **Create:** `services/fundamentals/src/issuer-fundamentals-reader.ts`
- **Create:** `services/fundamentals/test/issuer-fundamentals-reader.integration.test.ts`
- **Modify:** `services/evidence/src/promotion-rules.ts` (add `DISPLAYABLE_VERIFICATION_STATUSES`)
- **Modify:** `services/chat/src/local-runtime-structured.ts` (adapter + type alias; delete inline SQL/`FactRow`/`factSummaryFromRow`)
- **Modify:** `services/chat/test/local-runtime-structured.test.ts` (new shape)

(`services/fundamentals/src` has no barrel `index.ts`; the reader is imported directly by relative path, consistent with the other fundamentals modules.)
