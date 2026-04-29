# Snapshot Service

Snapshot helpers stage and verify evidence manifests before they are sealed into
the `snapshots` table.

## Manifest staging

`stageSnapshotManifest()` assembles a draft manifest from tool-call
contributions. Every contribution must carry a valid `tool_call_id`, and all
fact, claim, event, source, and series references are deduplicated in first-seen
order.

`auditManifestToolCallLog()` checks staged `tool_call_ids` against the durable
`tool_call_logs` table so callers can reject manifests whose evidence cannot be
traced to an observed tool call.

## Disclosure policy

`compileDisclosurePolicy()` derives required disclosure requirements and
schema-valid draft disclosure blocks from staged snapshot state plus referenced
fact and series signals. It emits deterministic disclosures for delayed pricing,
end-of-day or filing-time data, low coverage, candidate or disputed facts, and
explicit FX conversion or currency normalization.
