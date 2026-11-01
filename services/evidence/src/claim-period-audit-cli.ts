// A census of the fiscal periods earnings-release explanations are bound to
// (#542), checked against each issuer's facts. Read-only. It counts the
// explanations a reader may cite: a superseded (corrected) one is not.
//
//   DATABASE_URL=... npm run audit:claim-periods
//
// A release's bound period is "matched" when the issuer has an active fact of
// that kind ending that day. It is "mismatched", and flagged, when it has none
// but has a fiscal quarter or year spanning that day, so the fiscal year holds
// facts and none ends there: the model may have misread the end or the kind.
// It is "uncovered" when no fact spans the day, as before its facts are in.
import { Pool } from "pg";
import type { ClaimPeriod } from "./claim-repo.ts";
import { factActiveSql } from "./fact-activity.ts";
import { citableClaimSql } from "./local-runtime-evidence.ts";
import type { QueryExecutor } from "./types.ts";

export type ClaimPeriodAudit = {
  document_id: string;
  issuer_id: string;
  period: ClaimPeriod;
  status: "matched" | "mismatched" | "uncovered";
};

export async function auditClaimPeriods(db: QueryExecutor): Promise<ClaimPeriodAudit[]> {
  const { rows } = await db.query<{
    document_id: string;
    issuer_id: string;
    period_kind: ClaimPeriod["kind"];
    period_end: string;
    held: boolean;
    covered: boolean;
  }>(
    `select distinct c.document_id::text as document_id,
            ca.subject_id::text as issuer_id,
            c.period_kind,
            c.period_end::text as period_end,
            exists (select 1 from facts f
                     where f.subject_kind = 'issuer' and f.subject_id = ca.subject_id
                       and f.period_kind = c.period_kind and f.period_end = c.period_end
                       and ${factActiveSql("f")}) as held,
            exists (select 1 from facts f
                     where f.subject_kind = 'issuer' and f.subject_id = ca.subject_id
                       and f.period_kind in ('fiscal_q', 'fiscal_y')
                       and c.period_end between f.period_start and f.period_end
                       and ${factActiveSql("f")}) as covered
       from claims c
       join documents d on d.document_id = c.document_id
       join sources s on s.source_id = c.reported_by_source_id
       join claim_arguments ca on ca.claim_id = c.claim_id and ca.subject_kind = 'issuer' and ca.role = 'subject'
      where c.predicate like 'management.explanation.%'
        and c.period_kind is not null
        and ${citableClaimSql("null::uuid", "null::timestamptz")}
      order by issuer_id, period_end, period_kind, document_id`,
  );
  return rows.map((row) => ({
    document_id: row.document_id,
    issuer_id: row.issuer_id,
    period: { kind: row.period_kind, end: row.period_end },
    status: row.held ? "matched" : row.covered ? "mismatched" : "uncovered",
  }));
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, options: "-c default_transaction_read_only=on" });
  let rows: ClaimPeriodAudit[];
  try {
    rows = await auditClaimPeriods(pool);
  } finally {
    await pool.end();
  }
  const flagged = rows.filter((row) => row.status === "mismatched");
  for (const row of flagged) {
    console.log(`mismatched: document ${row.document_id}, issuer ${row.issuer_id}, ${row.period.kind} ending ${row.period.end}`);
  }
  const matched = rows.filter((row) => row.status === "matched").length;
  console.log(`${rows.length} bound periods: ${matched} matched, ${flagged.length} mismatched, ${rows.length - matched - flagged.length} uncovered`);
  if (flagged.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
