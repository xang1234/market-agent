import type { QueryExecutor } from "./types.ts";
import { assertUuidV4 } from "./validators.ts";

/**
 * Product-owned references that make a sealed snapshot durable. Discovery is
 * deliberately included here, rather than in blob GC, so all lifecycle paths
 * use the same shared-reference decision. A child snapshot, such as an
 * answer's cause, is held by the message holding its parent. A child never
 * holds its parent, or the cause would keep a deleted answer's snapshot.
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
       select 1 from chat_messages m join snapshots child on child.parent_snapshot=m.snapshot_id
        where child.snapshot_id=$1::uuid
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
