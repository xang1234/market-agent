-- LLM enrichment marker for 8-K material-event claims (fra-ajvd.6). The deterministic
-- 8-K handler writes a generic claim ("Material event reported via 8-K: restatement
-- (4.02)."); a separate batch step (enrich:sec-8k) LLM-extracts a narrative of what
-- actually happened for high-severity items and augments the claim's text in place.
-- enriched_at marks an augmented claim: it gates idempotency (the batch only enriches
-- where enriched_at is null) and signals the text is LLM-derived, not the deterministic
-- template. The enrichment is also recorded in a tool_call_log for audit (not a
-- seal-consumable provenance link — see sec-8k-enrichment.ts). Nullable; null = not yet
-- enriched.
alter table claims add column enriched_at timestamptz;
