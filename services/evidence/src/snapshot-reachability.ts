import type { QueryExecutor } from "./types.ts";
import { assertUuidV4 } from "./validators.ts";

/**
 * Product-owned references that make a sealed snapshot durable. Discovery is
 * deliberately included here, rather than in blob GC, so all lifecycle paths
 * use the same shared-reference decision.
 */
export async function snapshotHasCurrentReachability(db: QueryExecutor, snapshotId: string): Promise<boolean> {
  assertUuidV4(snapshotId, "snapshot_id");
  const { rows } = await db.query<{ reachable: boolean }>(
    `select exists (
       select 1 from chat_messages where snapshot_id=$1::uuid
       union all
       select 1 from analyze_template_runs where snapshot_id=$1::uuid
       union all
       select 1 from findings where snapshot_id=$1::uuid
       union all
       select 1 from agent_thesis_assessments where snapshot_id=$1::uuid
       union all
       select 1 from grid_cells where snapshot_id=$1::uuid
       union all
       select 1 from discovery_candidates where snapshot_id=$1::uuid
       union all
       select 1 from snapshots where parent_snapshot=$1::uuid
     ) as reachable`,
    [snapshotId],
  );
  return rows[0]?.reachable === true;
}

/** Call from a transaction after deleting one branch; shared snapshots stay intact. */
export async function deleteSnapshotIfUnreachable(db: QueryExecutor, snapshotId: string): Promise<boolean> {
  assertUuidV4(snapshotId, "snapshot_id");
  await db.query("select snapshot_id from snapshots where snapshot_id=$1::uuid for update", [snapshotId]);
  if (await snapshotHasCurrentReachability(db, snapshotId)) return false;
  const result = await db.query("delete from snapshots where snapshot_id=$1::uuid", [snapshotId]);
  return result.rowCount === 1;
}
