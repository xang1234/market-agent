import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { repairIssuerSplits } from "../src/issuer-splits.ts";

/** Merges the issuer into a new, older issuer of its CIK (written without its leading zero), as repair:issuer-splits does, and returns the kept issuer. */
export async function mergeIssuerAway(db: Pool, issuerId: string, keptName: string): Promise<string> {
  const kept = randomUUID();
  await db.query(`update issuers set cik = '09000705' where issuer_id = $1`, [issuerId]);
  await db.query(`insert into issuers (issuer_id, legal_name, cik, created_at) values ($1, $2, '9000705', '2000-01-01')`, [kept, keptName]);
  const { merged } = await repairIssuerSplits(db, new Map(), { log: () => {} });
  assert.deepEqual(merged.map(({ drop, keep }) => [drop, keep]), [[issuerId, kept]]);
  return kept;
}
