// Merges each issuer that holds a company's listing apart from the issuer
// holding the company's SEC identity onto that issuer (#597). The weekly
// reference import carries no CIK, so it makes one issuer per name, GOOG's
// "Alphabet Inc" apart from GOOGL's "Alphabet Inc. Class A Common Stock". The
// CIK fill then gives the CIK to one of them. Each run follows that fill
// (scripts/dev-shell.sh reference-import). --census lists the merges and
// writes nothing.
//
//   DATABASE_URL=... npm run repair:issuer-splits -- --file company_tickers.json [--census]
//
// A rerun merges nothing more.

import { parseArgs } from "node:util";
import { Pool } from "pg";
import { goesBy } from "../../resolver/src/lookup.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { US_EQUITY_MICS } from "../../shared/src/identifiers.ts";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { loadSecTickerCiks } from "./cik-fill.ts";
import { type TransactionalQueryExecutor, withPinnedTransaction } from "./pinned-transaction.ts";

export type IssuerSplit = { keep: string; keep_name: string; drop: string; drop_name: string; basis: string };
type Queryable = Pick<TransactionalQueryExecutor, "query">;

// Every column that names an issuer, with `kind` the column saying a row's id
// names one. With the issuer, `unique` keys a row once, so the merged issuer's
// row clashes with the kept issuer's row under it and goes. Before it goes,
// the kept row takes `combine`'s columns, SQL over the kept row `k` and the
// merged row `d`, and `referencedBy`'s rows that point at the merged row point
// at the kept one. Append-only rows move by delete and insert. Any other clash
// fails the repair. A test fails when the schema names an issuer in a column
// not listed here.
export const ISSUER_KEYED_ROWS: ReadonlyArray<{
  table: string;
  id: string;
  kind?: string;
  unique?: ReadonlyArray<string>;
  combine?: Readonly<Record<string, string>>;
  referencedBy?: { table: string; column: string };
  appendOnly?: true;
}> = [
  { table: "instruments", id: "issuer_id" },
  { table: "insider_transactions", id: "issuer_id" },
  { table: "segments", id: "issuer_id" },
  { table: "discovery_candidates", id: "issuer_id" },
  { table: "issuer_profile_enrichments", id: "issuer_id", unique: ["field_name", "source_id"] },
  { table: "ir_source_registry", id: "issuer_id", unique: ["url"], referencedBy: { table: "ir_document_assets", column: "ir_source_id" } },
  { table: "ir_document_assets", id: "issuer_id", unique: ["canonical_url"] },
  // Each class of a filing's position is a distinct CUSIP, which sec-13f-resolve.ts sums per issuer.
  { table: "institutional_holdings", id: "issuer_id", unique: ["filer_cik", "filing_period"], combine: { shares: "k.shares + d.shares", value_usd: "k.value_usd + d.value_usd" } },
  { table: "screener_certified_valuations", id: "issuer_id", unique: ["valuation"] },
  { table: "sec_issuer_downloads", id: "issuer_id", unique: [] },
  { table: "consensus_captures", id: "issuer_id", unique: ["source_id", "captured_on", "field_key"], appendOnly: true },
  { table: "facts", id: "subject_id", kind: "subject_kind" },
  // As linkDocumentMentions adds up one subject's mentions in a document.
  {
    table: "mentions",
    id: "subject_id",
    kind: "subject_kind",
    unique: ["document_id", "prominence"],
    combine: { mention_count: "k.mention_count + d.mention_count", confidence: "greatest(k.confidence, d.confidence)" },
  },
  { table: "claims", id: "attributed_to_id", kind: "attributed_to_type" },
  { table: "claim_arguments", id: "subject_id", kind: "subject_kind" },
  { table: "entity_impacts", id: "subject_id", kind: "subject_kind" },
  { table: "event_subjects", id: "subject_id", kind: "subject_kind" },
  { table: "watchlist_members", id: "subject_id", kind: "subject_kind", unique: ["watchlist_id"] },
  { table: "portfolio_holdings", id: "subject_id", kind: "subject_kind" },
  {
    table: "theme_memberships",
    id: "subject_id",
    kind: "subject_kind",
    unique: ["theme_id"],
    combine: { rationale_claim_ids: "coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(k.rationale_claim_ids || d.rationale_claim_ids) e), '[]')" },
  },
  { table: "chat_threads", id: "primary_subject_id", kind: "primary_subject_kind" },
];

/**
 * Each issuer to merge, with the issuer it merges into. A frozen golden
 * issuer is never merged away. In order of precedence:
 * 1. an issuer listing a golden ticker merges into the golden issuer;
 * 2. a second holder of a CIK, with or without leading zeros, merges into the
 *    first (a golden one first);
 * 3. an issuer with no CIK, listing a ticker SEC files under another issuer's
 *    CIK, merges into it when the two go by one name. A share class does; an
 *    ETN a bank files under its own CIK, such as JPMorgan's AMJB, does not.
 */
export async function findIssuerSplits(db: Queryable, ciks: ReadonlyMap<string, string>): Promise<IssuerSplit[]> {
  const golden = Object.entries(GOLDEN_ISSUER_IDS);
  const { rows } = await db.query<IssuerSplit & { by_name: boolean }>(
    `with listed as (
       select distinct iss.issuer_id, iss.cik, l.ticker
         from issuers iss
         join instruments i on i.issuer_id = iss.issuer_id
         join listings l on l.instrument_id = i.instrument_id
        where l.active_to is null and l.mic = any($1::text[])
     ), pairs as (
       select 1 as rank, k.issuer_id as keep, d.issuer_id as drop, 'lists golden ' || g.ticker as basis, false as by_name
         from unnest($2::text[], $3::uuid[]) as g(ticker, issuer_id)
         join issuers k on k.issuer_id = g.issuer_id
         join listed d on d.ticker = g.ticker and d.issuer_id <> k.issuer_id
       union all
       select 2, k.issuer_id, d.issuer_id, 'holds CIK ' || ltrim(d.cik, '0'), false
         from issuers k
         join issuers d on ltrim(d.cik, '0') = ltrim(k.cik, '0') and d.issuer_id <> k.issuer_id
        where k.issuer_id = any($3::uuid[]) or (k.created_at, k.issuer_id) < (d.created_at, d.issuer_id)
       union all
       select 3, k.issuer_id, d.issuer_id, d.ticker || ' files under CIK ' || sec.cik, true
         from listed d
         join unnest($4::text[], $5::text[]) as sec(ticker, cik) on sec.ticker = d.ticker
         join issuers k on ltrim(k.cik, '0') = sec.cik and k.issuer_id <> d.issuer_id
        where d.cik is null
     )
     select p.keep::text as keep, k.legal_name as keep_name, p.drop::text as drop, d.legal_name as drop_name, p.basis, p.by_name
       from pairs p
       join issuers k on k.issuer_id = p.keep
       join issuers d on d.issuer_id = p.drop
      where p.drop <> all($3::uuid[])
      order by p.rank, d.legal_name, p.drop, p.keep`,
    [US_EQUITY_MICS, golden.map(([ticker]) => ticker), golden.map(([, id]) => id), [...ciks.keys()], [...ciks.values()]],
  );
  const splits = new Map<string, IssuerSplit>();
  for (const { by_name, ...split } of rows) {
    if (!splits.has(split.drop) && (!by_name || goesBy(split.keep_name) === goesBy(split.drop_name))) splits.set(split.drop, split);
  }
  return [...splits.values()];
}

/**
 * Merges every split in one transaction, rereading after each merge, since a
 * kept issuer can be another split's merged one. Then stores each CIK without
 * leading zeros, as every lookup by CIK writes it. The golden seed once wrote
 * them with zeros.
 */
export async function repairIssuerSplits(
  db: TransactionalQueryExecutor,
  ciks: ReadonlyMap<string, string>,
  out: Pick<Console, "log"> = console,
): Promise<IssuerSplit[]> {
  const { merged, stored } = await withPinnedTransaction(db, async (tx) => {
    const merged: IssuerSplit[] = [];
    for (let [split] = await findIssuerSplits(tx, ciks); split; [split] = await findIssuerSplits(tx, ciks)) {
      await mergeIssuer(tx, split);
      merged.push(split);
    }
    const { rows: stored } = await tx.query<{ issuer_id: string; legal_name: string; padded: string; cik: string }>(
      `update issuers iss set cik = ltrim(iss.cik, '0'), updated_at = now()
         from issuers old
        where old.issuer_id = iss.issuer_id and iss.cik like '0%'
        returning iss.issuer_id::text as issuer_id, iss.legal_name, old.cik as padded, iss.cik`,
    );
    return { merged, stored };
  });
  for (const split of merged) out.log(`merged issuer ${split.drop} (${split.drop_name}) into ${split.keep} (${split.keep_name}): ${split.basis}`);
  for (const row of stored.sort((a, b) => a.legal_name.localeCompare(b.legal_name))) {
    out.log(`stored CIK ${row.padded} of issuer ${row.issuer_id} (${row.legal_name}) as ${row.cik}`);
  }
  return merged;
}

async function mergeIssuer(db: Queryable, { keep, drop }: IssuerSplit): Promise<void> {
  // A writer adding an instrument for the merged issuer waits, then fails on its key, instead of losing the row to the delete's cascade.
  await db.query(`select 1 from issuers where issuer_id in ($1::uuid, $2::uuid) order by issuer_id for update`, [keep, drop]);
  for (const { table, id, kind, unique, combine, referencedBy, appendOnly } of ISSUER_KEYED_ROWS) {
    // Untyped, so each parameter takes its column's type, uuid or the text of claims.attributed_to_id.
    const of = (alias: string, param: string) => `${alias}.${id} = ${param}${kind ? ` and ${alias}.${kind} = 'issuer'` : ""}`;
    if (unique) {
      const clash = `${of("k", "$1")} and ${of("d", "$2")}${unique.map((column) => ` and k.${column} is not distinct from d.${column}`).join("")}`;
      if (combine) {
        const set = Object.entries(combine).map(([column, value]) => `${column} = ${value}`).join(", ");
        await db.query(`update ${table} k set ${set} from ${table} d where ${clash}`, [keep, drop]);
      }
      if (referencedBy) {
        const { table: referrer, column } = referencedBy;
        await db.query(`update ${referrer} r set ${column} = k.${column} from ${table} k, ${table} d where r.${column} = d.${column} and ${clash}`, [keep, drop]);
      }
      await db.query(`delete from ${table} d using ${table} k where ${clash}`, [keep, drop]);
    }
    await db.query(
      appendOnly
        ? `with moved as (delete from ${table} d where ${of("d", "$2")} returning d.*)
           insert into ${table} select (jsonb_populate_record(null::${table}, to_jsonb(moved) || jsonb_build_object('${id}', $1::uuid))).* from moved`
        : `update ${table} d set ${id} = $1 where ${of("d", "$2")}`,
      [keep, drop],
    );
  }
  const { rows: [dropped] } = await db.query<{ cik: string | null; lei: string | null; domicile: string | null; sector: string | null; industry: string | null }>(
    `delete from issuers where issuer_id = $1::uuid returning cik, lei, domicile, sector, industry`,
    [drop],
  );
  await db.query(
    `update issuers
        set cik = coalesce(cik, $2), lei = coalesce(lei, $3), domicile = coalesce(domicile, $4),
            sector = coalesce(sector, $5), industry = coalesce(industry, $6), updated_at = now()
      where issuer_id = $1::uuid`,
    [keep, dropped!.cik, dropped!.lei, dropped!.domicile, dropped!.sector, dropped!.industry],
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { values } = parseArgs({ options: { file: { type: "string" }, census: { type: "boolean", default: false } } });
  const ciks = await loadSecTickerCiks(values.file);
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  try {
    if (values.census) {
      const splits = await findIssuerSplits(pool, ciks);
      for (const split of splits) console.log([split.drop, split.drop_name, "->", split.keep, split.keep_name, split.basis].join("\t"));
      const { rows: [padded] } = await pool.query<{ n: number }>(`select count(*)::int as n from issuers where cik like '0%'`);
      console.log(`issuer-splits: ${splits.length} to merge, ${padded!.n} CIKs to store without leading zeros`);
    } else {
      console.log(`issuer-splits: merged=${(await repairIssuerSplits(pool, ciks)).length}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
