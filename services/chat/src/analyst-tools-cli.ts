// One analyst tool for one ticker against the stack database, its packet
// entries one per line, then its status and each run's wall-clock:
//   node --experimental-strip-types --env-file=.env.dev services/chat/src/analyst-tools-cli.ts \
//     <tool> <TICKER> [--predicate <p> ...] [--role subject|competitor] [--as-of YYYY-MM-DD] [--n N] [--runs N]
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Pool } from "pg";

import { ANALYST_TOOL_NAMES, CLAIM_PREDICATES, CLAIM_ROLES, isAnalystToolName, runAnalystTool, type AnalystToolInput, type AnalystToolName } from "./analyst-tools.ts";
import { analystPacketEntries, type AnalystPacketEntry } from "./evidence-packet.ts";

export type CliRequest = { tool: AnalystToolName; ticker: string; input: Omit<AnalystToolInput, "issuer_ids">; runs: number };

export function parseCliArgs(args: string[], now: Date = new Date()): CliRequest {
  const { values: flags, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      predicate: { type: "string", multiple: true },
      role: { type: "string" },
      "as-of": { type: "string" },
      n: { type: "string" },
      runs: { type: "string" },
    },
  });
  const [tool, ticker, ...extra] = positionals;
  if (tool === undefined || !isAnalystToolName(tool) || ticker === undefined || extra.length > 0) {
    throw new Error(`usage: analyst-tools-cli.ts <${ANALYST_TOOL_NAMES.join("|")}> <TICKER> [flags]`);
  }
  const predicates = flags.predicate;
  if (predicates?.some((predicate) => !(CLAIM_PREDICATES as ReadonlyArray<string>).includes(predicate))) {
    throw new Error(`--predicate takes ${CLAIM_PREDICATES.join(", ")}`);
  }
  const role = flags.role;
  if (role !== undefined && !(CLAIM_ROLES as ReadonlyArray<string>).includes(role)) throw new Error(`--role takes ${CLAIM_ROLES.join(" or ")}`);
  const asOf = flags["as-of"];
  if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of takes YYYY-MM-DD");
  const n = flags.n === undefined ? undefined : Number(flags.n);
  if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= 20)) throw new Error("--n takes 1 to 20");
  const runs = flags.runs === undefined ? 1 : Number(flags.runs);
  if (!(Number.isInteger(runs) && runs >= 1)) throw new Error("--runs takes a whole number");
  return {
    tool,
    ticker: ticker.toUpperCase(),
    runs,
    input: {
      as_of: asOf === undefined ? now.toISOString() : `${asOf}T23:59:59.999Z`,
      ...(predicates === undefined ? {} : { predicates }),
      ...(role === undefined ? {} : { role: role as AnalystToolInput["role"] }),
      ...(n === undefined ? {} : { peer_limit: n }),
    },
  };
}

export function entryLine(entry: AnalystPacketEntry): string {
  return [entry.id, entry.predicate, entry.company, ...entryRef(entry), entry.text].join("\t");
}

function entryRef(entry: AnalystPacketEntry): string[] {
  switch (entry.kind) {
    case "claim": return [entry.filing, `claim=${entry.claim_id}`];
    case "consensus": return [`capture=${entry.capture_id}`, `source=${entry.source_id}`];
    case "peer": return [`issuer=${entry.peer_issuer_id}`, `sources=${entry.source_ids.join(",")}`];
    case "filing_read": return [`document=${entry.document_id}`, `state=${entry.state}`, ...(entry.newer_unread ? [`newer=${entry.newer_unread.document_id}`, `newer_state=${entry.newer_unread.state}`] : [])];
    case "no_filing": return [`issuer=${entry.issuer_id}`];
  }
}

function databaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DEV_POSTGRES_USER: user = "postgres", DEV_POSTGRES_PASSWORD: password = "postgres", DEV_POSTGRES_PORT: port, DEV_POSTGRES_DB: database = "market_agent" } = env;
  if (!port) throw new Error("set DATABASE_URL, or pass the stack's .env.dev with --env-file");
  return `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
}

async function main(): Promise<void> {
  const request = parseCliArgs(process.argv.slice(2));
  const db = new Pool({ connectionString: databaseUrl(process.env), max: 1 });
  try {
    const { rows } = await db.query<{ issuer_id: string }>(
      `select distinct n.issuer_id::text as issuer_id
         from listings l join instruments n on n.instrument_id = l.instrument_id
        where l.ticker = $1 and (l.active_to is null or l.active_to > now())`,
      [request.ticker],
    );
    if (rows.length !== 1) throw new Error(`${request.ticker} names ${rows.length} stored issuers; it must name one`);
    const input = { ...request.input, issuer_ids: [rows[0]!.issuer_id] };
    const ms: number[] = [];
    let result = null;
    for (let run = 0; run < request.runs; run += 1) {
      const started = performance.now();
      result = await runAnalystTool(db, request.tool, input);
      ms.push(Math.round(performance.now() - started));
    }
    const entries = analystPacketEntries([result!]);
    for (const entry of entries) console.log(entryLine(entry));
    const sorted = [...ms].sort((a, b) => a - b);
    console.log([
      `tool=${request.tool}`,
      `status=${result!.status}`,
      ..."reason" in result! ? [`reason=${JSON.stringify(result!.reason)}`] : [],
      `entries=${entries.length}`,
      ..."truncated" in result! ? [`truncated=${result!.truncated}`] : [],
      `ms=${ms.join(",")}`,
      `median_ms=${sorted[Math.floor((sorted.length - 1) / 2)]}`,
    ].join(" "));
  } finally {
    await db.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
