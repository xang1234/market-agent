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
