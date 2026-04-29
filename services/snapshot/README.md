# Snapshot Service

Snapshot helpers stage and verify evidence manifests before they are sealed into
the `snapshots` table.

## Manifest staging

`stageSnapshotManifest()` assembles a draft manifest from tool-call
contributions. Every contribution must carry a valid `tool_call_id`, and all
fact, claim, event, document, source, and series references are deduplicated in
first-seen order.

`auditManifestToolCallLog()` checks staged `tool_call_ids` against the durable
`tool_call_logs` table and compares staged contribution hashes with
`tool_call_logs.result_hash` so callers can reject manifests whose evidence
cannot be traced to the observed tool-call result.

## Disclosure policy

`compileDisclosurePolicy()` derives required disclosure requirements and
schema-valid draft disclosure blocks from staged snapshot state plus referenced
fact and series signals. It emits deterministic disclosures for delayed pricing,
end-of-day or filing-time data, low coverage, candidate or disputed facts, and
explicit FX conversion or currency normalization. Aggregate manifest series
specs without a concrete `series_ref` may fall back to manifest-level sources;
concrete `series_ref` specs must carry their own `source_id`.

## Seal verifier

`verifySnapshotSeal()` checks a candidate snapshot artifact before seal. It
validates manifest refs, block source bindings, fact unit and period bindings,
document refs and document source bindings, required disclosure text, block
snapshot/as-of boundaries, and approval state for write-intent tools. If callers
omit precompiled `required_disclosures`, the verifier derives them from the
disclosure policy compiler. When passed a query executor, every failure is
written to `verifier_fail_logs` with its deterministic `reason_code`.

## Transactional sealing

`sealSnapshot()` verifies a staged artifact and then writes the full manifest,
including tool-call result hashes, to `snapshots` inside a single database
transaction. If persistence fails after the transaction starts, the helper rolls
back instead of leaving a partial seal.
