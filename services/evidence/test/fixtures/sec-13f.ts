// Shared SEC 13F test fixtures: the full-submission .txt wire-format builder and a
// minimal issuer+instrument seeder. Extracted so the 13F submission schema is encoded
// ONCE — it had already drifted (only the handler-test copy carried the putCall/option
// branch), which is exactly the bug class shared fixtures prevent.
import type { QueryExecutor } from "../../src/types.ts";

export type Form13fRow = { name: string; cusip: string; value: number; shares: number; putCall?: string };

// A 13F full-submission .txt: two <XML> docs — the cover (periodOfReport in
// MM-DD-YYYY) and the informationTable of <infoTable> rows. A row with `putCall`
// emits an option position (which the handler excludes from common-share holdings).
export function submission(periodMMDDYYYY: string, rows: Form13fRow[]): string {
  const tables = rows
    .map(
      (r) =>
        `<infoTable><nameOfIssuer>${r.name}</nameOfIssuer><cusip>${r.cusip}</cusip><value>${r.value}</value>` +
        `<shrsOrPrnAmt><sshPrnamt>${r.shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>` +
        (r.putCall ? `<putCall>${r.putCall}</putCall>` : "") +
        `</infoTable>`,
    )
    .join("\n");
  return `<SEC-DOCUMENT>
<XML><edgarSubmission><headerData><periodOfReport>${periodMMDDYYYY}</periodOfReport></headerData></edgarSubmission></XML>
<XML><informationTable>${tables}</informationTable></XML>
</SEC-DOCUMENT>`;
}

// Seed an issuer + a common-stock instrument carrying the given CUSIP; returns issuer_id.
export async function seedIssuerWithCusip(
  client: { query: QueryExecutor["query"] },
  name: string,
  cusip: string,
): Promise<string> {
  const r = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ($1) returning issuer_id::text as issuer_id`,
    [name],
  );
  const id = r.rows[0]!.issuer_id;
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', $2)`, [id, cusip]);
  return id;
}
