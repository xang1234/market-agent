import type { QueryExecutor } from "../src/types.ts";

type CikMove = { cik: string; from: string; to: string };

// The weekly CIK fill commits a move of `cik` from one issuer to another (#685).
export async function moveCik(db: QueryExecutor, move: CikMove): Promise<void> {
  await db.query(`update issuers set cik = null where issuer_id = $1`, [move.from]);
  await db.query(`update issuers set cik = $2 where issuer_id = $1`, [move.to, move.cik]);
}

// The move lands between a writer's read of its issuer by that CIK and the writer's persist.
export function cikMovesAfterRead(db: QueryExecutor, move: CikMove): QueryExecutor {
  let moved = false;
  const query = async (text: string, values?: unknown[]) => {
    const result = await db.query(text, values);
    if (!moved && text.includes("from issuers where cik = $1 or cik = $2")) {
      moved = true;
      await moveCik(db, move);
    }
    return result;
  };
  return { query } as QueryExecutor;
}
