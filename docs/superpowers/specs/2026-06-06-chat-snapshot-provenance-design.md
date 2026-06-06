# Cite Quote+Fundamentals Sources & Facts in Sealed Chat Snapshots (fra-eegq)

**Status:** Design approved 2026-06-06
**Bead:** fra-eegq — "Cite quote+fundamentals sources in sealed chat snapshots (provenance hardening)"
**Stacks on:** fra-savt (`feat/fra-savt-fundamentals-reader`) — extends the `loadRecentIssuerFundamentals` reader with `fact_id`.

## Problem

A chat answer grounded in structured fundamentals/price data is **not provenance-linked** to those sources in its sealed snapshot. `loadStructuredSubjectContext` feeds quote + fundamentals facts (each with a `source_id`) to the analyst LLM via the tool result, but after composition those refs are dropped: `manifestFromBlockRefs` (`chat/src/local-runtime.ts:243`) hardcodes `fact_refs: []`, and `source_ids` derives only from blocks' `source_refs` — which carry the *evidence* (claim) sources, not the structured ones (`defaultEvidenceRefs`, line 136). So the manifest cites research claims but never the fundamentals facts or the quote that actually backed the answer.

## Decisions (from brainstorming)

1. **Scope: `source_ids` + `fact_refs`.** Cite both the quote+fundamentals **sources** (in `manifest.source_ids`) and the fundamentals **facts** (in `manifest.fact_refs`). The quote is source-only (it is not a `facts` row).
2. **Thread through the existing blocks → manifest → verifier pipeline**, not a side channel. `fact_refs` becomes block-derived, symmetric with `source_ids`/`claim_refs`.
3. **No per-fact block binding.** The LLM writes prose; facts ride the block *default* refs. The verifier accepts manifest `fact_refs` that are not bound to a rendered block (it only relaxes a metadata check for rendered facts — see Verifier contract).

## Verifier contract (confirmed)

`snapshot-verifier.ts` (`verifySnapshotSeal`):
- `manifest.fact_refs`: each must exist in `input.facts` (line 844); each such fact must have a non-null `source_id` that is in both the loaded `sources` and `manifest.source_ids` (lines 885–908).
- `manifest.source_ids`: each must exist in the loaded `sources` — **no claim/document backing required** (line 882). Bare fact-sources are accepted.
- `factMetadataMismatch` (line 1691): for a manifest fact **not** referenced by a rendered block, requires the binding fields for its `period_kind` (`unit`, `period_kind`, plus `fiscal_year`/`fiscal_period` for `fiscal_q`, `fiscal_year` for `fiscal_y`, etc.). Real DB rows satisfy this.
- `VerifierFact` shape: `{ fact_id, source_id?, unit?, period_kind?, period_start?, period_end?, fiscal_year?, fiscal_period?, freshness_class? }`.

Source loading (`loadVerifierRowsForRefs`, `evidence/src/local-runtime-evidence.ts`) returns a source when it is public (`user_id is null`) or owned by the requesting user. SEC/vendor fundamentals sources and market quote sources are public → loadable.

## Architecture / changes

### 1. Reader exposes `fact_id`
`services/fundamentals/src/issuer-fundamentals-reader.ts`: add `fact_id: string` to `IssuerFundamentalFact`; add `f.fact_id::text as fact_id` to the select and the `FactRow`→fact mapping.

### 2. Structured refs flow into block default-refs
`services/chat/src/local-runtime.ts`, `analystToolRuntime`:
- Add `structuredContextForToolCalls(toolCalls)` — mirrors `evidenceForToolCalls` (lines 209–218): for each `ok` tool call with a JSON-object result, extract `result.structured_context` (`{ quote, facts, source_ids, fact_recency }`) when shape-valid.
- Replace `const defaultRefs = defaultEvidenceRefs(evidence)` (line 136) with a combined builder that unions in the structured context:
  - `source_refs` ← firstSeen([...evidence source_ids, ...structured.flatMap(s => s.source_ids)])
  - `fact_refs` ← firstSeen(structured.flatMap(s => s.facts.map(f => f.fact_id)))

`normalizeAssistantBlock` (lines ~331–364): default `fact_refs` on each block, parallel to the existing `source_refs`/`claim_refs`/`document_refs` defaulting (`block.fact_refs` if a non-empty array, else `defaultRefs.fact_refs`).

### 3. Manifest derives `fact_refs` from blocks
`manifestFromBlockRefs` (line 243): `fact_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "fact_refs"))` (was `[]`). `source_ids` already derives from blocks' `source_refs`, so the structured sources now flow in unchanged.

### 4. Seal loads facts for the verifier
`services/evidence/src/local-runtime-evidence.ts`: add `loadVerifierFactsForRefs(db, { fact_refs, user_id })` → `VerifierFact[]`, selecting `fact_id, source_id, unit, period_kind, period_start, period_end, fiscal_year, fiscal_period` from `facts where fact_id = any($1::uuid[]) and superseded_by is null and invalidated_at is null`. (Sibling to `loadVerifierRowsForRefs`; entitlement of the *sources* is enforced by the existing source load.)

`sealAssistantMessageSnapshot` (`chat/src/local-runtime.ts:188`): after loading verifier rows, also `const facts = await loadVerifierFactsForRefs(pool(), { fact_refs: manifest.fact_refs, user_id: userId })` and pass `facts` into `sealSnapshotWithPool({ ..., facts })`. (`SnapshotSealInput` already carries `facts`; chat just never populated it.)

### 5. Verifier — no change.

## Data flow

structured context (tool-runtime) → block default `source_refs` + `fact_refs` → `manifest.source_ids` + `manifest.fact_refs` → seal loads sources (existing) + facts (new) → verifier checks fact↔source↔manifest integrity → sealed snapshot now links the answer to the fundamentals facts, their sources, and the quote source.

## Error handling — the real failure surface

**A failed seal is not graceful today: it throws and the message is dropped.** `createChatMessagePersistence` (`chat/src/messages.ts:149-151`) throws `"snapshot seal failed; chat message was not persisted"` when the seal is not verified. This change does **not** alter that behavior; it relies on the same invariant the existing evidence-ref path already relies on — that block-cited refs are loadable:

- **Empty case** (no fundamentals/quote — the common dev case): `structured` is empty → no added `source_ids`/`fact_refs` → byte-identical to today. The change is purely additive when structured context exists.
- **Normal case**: structured facts come from `loadRecentIssuerFundamentals` (app-entitled, public sources) and the quote from the market cache (public source). All cited sources are public → loadable → seal passes. Proven by the integration test below.
- **TOCTOU edge** (a fact invalidated, or a source de-visibilized, in the ~ms between answering and sealing): the verifier would emit `missing_fact_ref`/`missing_source_ref` and the message would be dropped. This is the **same** hard-fail the existing evidence-ref path already has (evidence sources are block-cited and unfiltered too); the change extends that trust model to structured refs rather than introducing a new one. We deliberately do **not** add defensive "cite only loadable refs" filtering: it would be inconsistent with the evidence path and would require inverting the manifest-then-load order. If this edge proves real in prod, a follow-up can make the *whole* seal path (evidence + structured) cite-only-loadable in one consistent place.

## Testing

- **Reader unit test** (extend `services/fundamentals/test/issuer-fundamentals-reader.test.ts`): assert `fact_id` is selected and returned on `IssuerFundamentalFact` (recording-fake db asserts `f.fact_id` in the SQL; mapping test returns the seeded `fact_id`).
- **Chat seal integration test** (docker-pg, extend `services/chat/test/local-runtime.integration.test.ts`): seed an issuer with one app-entitled `authoritative` fundamentals fact (+ its public source) and a cached quote (+ its public source); drive the analyst tool runtime + persist; assert the persisted snapshot row's `fact_refs == [factId]` and `source_ids` ⊇ {fact source, quote source}, **and that persistence succeeds** (the seal verified — the end-to-end proof the bead asks for).
- **No new verifier test** — `snapshot-verifier.test.ts` already covers `fact_refs` validation.

## Files

- **Modify:** `services/fundamentals/src/issuer-fundamentals-reader.ts` (add `fact_id`)
- **Modify:** `services/fundamentals/test/issuer-fundamentals-reader.test.ts` (assert `fact_id`)
- **Modify:** `services/chat/src/local-runtime.ts` (structured extractor, combined default-refs, block `fact_refs` default, manifest `fact_refs`, seal loads+passes facts)
- **Modify:** `services/evidence/src/local-runtime-evidence.ts` (new `loadVerifierFactsForRefs`)
- **Modify:** `services/chat/test/local-runtime.integration.test.ts` (seed fundamentals fact + quote; assert `fact_refs`/`source_ids` + successful seal)
