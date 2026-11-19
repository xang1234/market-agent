import type { QueryExecutor } from "../src/types.ts";

// The weekly CIK fill commits a move of `cik` between a writer's read of its
// issuer by that CIK and the writer's persist (#685).
export function cikMovesAfterRead(db: QueryExecutor, move: { cik: string; from: string; to: string }): QueryExecutor {
  let moved = false;
  const query = async (text: string, values?: unknown[]) => {
    const result = await db.query(text, values);
    if (!moved && text.includes("from issuers where cik = $1 or cik = $2")) {
      moved = true;
      await db.query(`update issuers set cik = null where issuer_id = $1`, [move.from]);
      await db.query(`update issuers set cik = $2 where issuer_id = $1`, [move.to, move.cik]);
    }
    return result;
  };
  return { query } as QueryExecutor;
}
