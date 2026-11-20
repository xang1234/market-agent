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
import { goesBy, normalizeNameForLookup } from "../../resolver/src/lookup.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { US_EQUITY_MICS } from "../../shared/src/identifiers.ts";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { loadSecTickerCiks } from "./cik-fill.ts";
import { type TransactionalQueryExecutor, withPinnedTransaction } from "./pinned-transaction.ts";
import { retireGoldenFacts } from "./sec-facts-repository.ts";

export type IssuerSplit = { keep: string; keep_name: string; drop: string; drop_name: string; basis: string };
export type SkippedSplit = IssuerSplit & { constraint: string };
type Queryable = Pick<TransactionalQueryExecutor, "query">;

const UNIQUE_VIOLATION = "23505";
// "Alphabet Inc. Class A Common Stock" names a class of Alphabet Inc's shares.
const SHARE_CLASS = /^[\s.,-]+(?:(?:class|series) [a-z]\b|(?:common|capital|ordinary) (?:stock|shares)\b)/i;

// Every column that names an issuer, with `kind` the column saying a row's id
// names one. With the issuer, `unique` keys a row once, so the merged issuer's
// row clashes with the kept issuer's row under it and goes. Before it goes,
// the kept row takes `combine`'s columns, SQL over the kept row `k` and the
// merged row `d`, and `referencedBy`'s rows that point at the merged row point
// at the kept one. Append-only rows move by delete and insert. Any other clash
// leaves the pair apart for the repair to report, since each row holds what
// the other lacks: two active facts for one period and source, two
// definitions of one segment, one discovery run's candidate for each. A test
// fails when the schema names an issuer in a column not listed here.
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
  // The newest filing either issuer downloaded: an older download must not re-infer what it refuted (#342).
  { table: "sec_issuer_downloads", id: "issuer_id", unique: [], combine: { newest_filed: "greatest(k.newest_filed, d.newest_filed)" } },
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
 * Each issuer to merge, with the issuer it merges into. In order of
 * precedence, and a pair two rules match merges by the first:
 * 1. a golden issuer merges into the issuer listing its ticker, unless that
 *    issuer holds another CIK than the golden one's, or than SEC's for the
 *    ticker once the CIK fill moved the golden one's to it. The ticker then
 *    gets live prices and SEC filings, which the frozen golden issuers skip;
 * 2. a second holder of a CIK, with or without leading zeros, merges into the
 *    first (a golden one first). A CIK of zeros names no filer;
 * 3. an issuer with no CIK, listing a ticker SEC files under another issuer's
 *    CIK, merges into it when the two go by one name. A share class does; an
 *    ETN a bank files under its own CIK, such as JPMorgan's AMJB, does not.
 * No other rule merges a golden issuer away.
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
       select 1 as rank, k.issuer_id as keep, d.issuer_id as drop, 'golden issuer of ' || g.ticker as basis, false as by_name
         from unnest($2::text[], $3::uuid[]) as g(ticker, issuer_id)
         join issuers d on d.issuer_id = g.issuer_id
         join listed k on k.ticker = g.ticker and k.issuer_id <> d.issuer_id
         left join unnest($4::text[], $5::text[]) as sec(ticker, cik) on sec.ticker = g.ticker
        where k.cik is null or ltrim(k.cik, '0') = ltrim(coalesce(d.cik, sec.cik), '0')
       union all
       select 2, k.issuer_id, d.issuer_id, 'holds CIK ' || ltrim(d.cik, '0'), false
         from issuers k
         join issuers d on ltrim(d.cik, '0') = ltrim(k.cik, '0') and d.issuer_id <> k.issuer_id
        where ltrim(k.cik, '0') <> '' and (k.issuer_id = any($3::uuid[]) or (k.created_at, k.issuer_id) < (d.created_at, d.issuer_id))
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
      where p.rank = 1 or p.drop <> all($3::uuid[])
      order by p.rank, d.legal_name, p.drop, p.keep`,
    [US_EQUITY_MICS, golden.map(([ticker]) => ticker), golden.map(([, id]) => id), [...ciks.keys()], [...ciks.values()]],
  );
  const splits = new Map<string, IssuerSplit>();
  for (const { by_name, ...split } of rows) {
    if (splits.has(split.drop) || splits.get(split.keep)?.keep === split.drop) continue;
    if (!by_name || goesBy(split.keep_name) === goesBy(split.drop_name)) splits.set(split.drop, split);
  }
  return [...splits.values()];
}

/**
 * Merges every split in one transaction, rereading after each merge, since a
 * kept issuer can be another split's merged one. A split whose rows clash
 * where the merge cannot combine them stays apart, reported, and the rest
 * still merge. Then stores each CIK without leading zeros, as every lookup by
 * CIK writes it, unless a split left apart holds it too. The golden seed once
 * wrote them with zeros.
 */
export async function repairIssuerSplits(
  db: TransactionalQueryExecutor,
  ciks: ReadonlyMap<string, string>,
  out: Pick<Console, "log"> = console,
): Promise<{ merged: IssuerSplit[]; skipped: SkippedSplit[] }> {
  const { merged, skipped, stored } = await withPinnedTransaction(db, async (tx) => {
    const merged: IssuerSplit[] = [];
    const skipped: SkippedSplit[] = [];
    const next = async () => (await findIssuerSplits(tx, ciks)).find((split) => !skipped.some(({ drop }) => drop === split.drop));
    for (let split = await next(); split; split = await next()) {
      await tx.query("savepoint merge");
      try {
        if (await mergeIssuer(tx, split)) merged.push(split);
      } catch (error) {
        if ((error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error;
        await tx.query("rollback to savepoint merge");
        skipped.push({ ...split, constraint: String((error as { constraint?: unknown }).constraint) });
      }
      await tx.query("release savepoint merge");
    }
    const { rows: stored } = await tx.query<{ issuer_id: string; legal_name: string; padded: string; cik: string }>(
      `update issuers iss set cik = ltrim(iss.cik, '0'), updated_at = now()
         from issuers old
        where old.issuer_id = iss.issuer_id and iss.cik like '0%' and ltrim(iss.cik, '0') <> ''
          and not exists (select 1 from issuers other where other.issuer_id <> iss.issuer_id and ltrim(other.cik, '0') = ltrim(iss.cik, '0'))
        returning iss.issuer_id::text as issuer_id, iss.legal_name, old.cik as padded, iss.cik`,
    );
    return { merged, skipped, stored };
  });
  for (const split of merged) out.log(`merged issuer ${split.drop} (${split.drop_name}) into ${split.keep} (${split.keep_name}): ${split.basis}`);
  for (const split of skipped) {
    out.log(`skipped issuer ${split.drop} (${split.drop_name}) into ${split.keep} (${split.keep_name}): ${split.basis}; both hold a row under ${split.constraint}`);
  }
  for (const row of stored.sort((a, b) => a.legal_name.localeCompare(b.legal_name))) {
    out.log(`stored CIK ${row.padded} of issuer ${row.issuer_id} (${row.legal_name}) as ${row.cik}`);
  }
  return { merged, skipped };
}

async function mergeIssuer(db: Queryable, { keep, drop }: IssuerSplit): Promise<boolean> {
  // storeFiling's lock, taken before the row locks its writes wait on, so a filing stored for either issuer meanwhile moves and retires the golden figures it reports.
  for (const id of [keep, drop].sort()) await db.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [id]);
  // A writer adding an instrument for the merged issuer waits, then fails on its key, instead of losing the row to the delete's cascade.
  const { rows: locked } = await db.query<{ issuer_id: string; legal_name: string; former_names: string[] }>(
    `select issuer_id::text as issuer_id, legal_name, former_names from issuers where issuer_id in ($1::uuid, $2::uuid) order by issuer_id for update`,
    [keep, drop],
  );
  const k = locked.find((row) => row.issuer_id === keep);
  const d = locked.find((row) => row.issuer_id === drop);
  // A repair running beside this one merged an issuer away while this one waited on its locks. The next search sees what is left.
  if (!k || !d) return false;
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
  await retireGoldenFacts(db, keep);
  const { rows: [dropped] } = await db.query<{ cik: string | null; lei: string | null; domicile: string | null; sector: string | null; industry: string | null }>(
    `delete from issuers where issuer_id = $1::uuid returning cik, lei, domicile, sector, industry`,
    [drop],
  );
  // The kept issuer goes by the plain name of the two and still answers to every other. No golden name ends in a share class.
  const legalName = isShareClassOf(k.legal_name, d.legal_name) ? d.legal_name : k.legal_name;
  const known = new Set([legalName, ...k.former_names].map(normalizeNameForLookup));
  const added = [k.legal_name, d.legal_name, ...d.former_names].filter((name) => {
    const normalized = normalizeNameForLookup(name);
    if (known.has(normalized)) return false;
    known.add(normalized);
    return true;
  });
  await db.query(
    `update issuers
        set cik = coalesce(cik, $2), lei = coalesce(lei, $3), domicile = coalesce(domicile, $4),
            sector = coalesce(sector, $5), industry = coalesce(industry, $6),
            legal_name = $7, former_names = former_names || $8::jsonb, updated_at = now()
      where issuer_id = $1::uuid`,
    [keep, dropped!.cik, dropped!.lei, dropped!.domicile, dropped!.sector, dropped!.industry, legalName, JSON.stringify(added)],
  );
  return true;
}

function isShareClassOf(name: string, plain: string): boolean {
  const stem = plain.replace(/\.$/, "");
  return name.startsWith(stem) && SHARE_CLASS.test(name.slice(stem.length));
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
      const { rows: [padded] } = await pool.query<{ n: number }>(`select count(*)::int as n from issuers where cik like '0%' and ltrim(cik, '0') <> ''`);
      console.log(`issuer-splits: ${splits.length} to merge, ${padded!.n} CIKs to store without leading zeros`);
    } else {
      const { merged, skipped } = await repairIssuerSplits(pool, ciks);
      console.log(`issuer-splits: merged=${merged.length} skipped=${skipped.length}`);
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
