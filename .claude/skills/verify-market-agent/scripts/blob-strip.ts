// `verify blob-strip`: proves the readers of stored filing bytes read the same
// from a submission without its uuencoded bodies (#757) as from SEC's bytes.
//
//   files PATH...       each file (or each file in a directory) read as sent and
//                       stripped, one line per file; exit 1 when a reader differs.
//   seed PATH...        store each file in this stack as the code before #757 did:
//                       SEC's bytes under their own hash, one filing document each.
//   readers save NAME   each stored filing's reader digests, read through its
//                       raw_blob_id from this stack's object store.
//   readers diff NAME   compare with a saved run by document; exit 1 on a change.
//   reingest PATH...    ingest each file again as a filing through ingestDocument;
//                       exit 1 when one makes a second document for its content_hash.
//
// Each digest hashes a reader's whole output. The extract tool's candidate
// facts are the XBRL segment and non-GAAP readers over the decoded blob, run
// here with a fixed as_of. Campaign and analyst-grid text read the whole blob
// and so lose the uuencoded lines; they are reported, not compared, since
// the rewrite keeps the blob of any document a whole-blob offset cites.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createEvidenceStoreRuntime } from "../../../../services/evidence/src/evidence-cli-runtime.ts";
import { ingestDocument } from "../../../../services/evidence/src/ingest.ts";
import { issuerIrTextFromBytes } from "../../../../services/evidence/src/issuer-ir-extraction.ts";
import { rawBlobIdFromBytes } from "../../../../services/evidence/src/object-store.ts";
import { extractNonGaapReconciliations } from "../../../../services/evidence/src/reader/non-gaap-reconciliation-extractor.ts";
import { extractXbrlExtensionSegments } from "../../../../services/evidence/src/reader/xbrl-segment-extractor.ts";
import { classify8kHeader } from "../../../../services/evidence/src/sec-8k-item-taxonomy.ts";
import { tenKSections } from "../../../../services/evidence/src/sec-10k-sections.ts";
import { releaseExhibits } from "../../../../services/evidence/src/sec-earnings-release-extraction.ts";
import { releaseReconciliations } from "../../../../services/evidence/src/sec-non-gaap-reconciliations.ts";
import { stripUuencodedBodies } from "../../../../services/evidence/src/sec-submission-strip.ts";

const SOURCE = "00000000-0000-4000-8000-000000000757";
const AS_OF = "2026-11-23T00:00:00.000Z";
const EVIDENCE = join(import.meta.dirname, "../../../../.dev/verify");

type Digest = Record<string, string>;

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value, (_key, v) => (v instanceof Set ? [...v].sort((a, b) => a - b) : v))).digest("hex").slice(0, 12);

// Each reader's output hash, and how much it read, so an empty reader is seen.
function readerDigests(bytes: Uint8Array): Digest {
  const text = new TextDecoder().decode(bytes);
  const exhibits = releaseExhibits(text);
  const filed = /FILED AS OF DATE:\s*(\d{4})(\d{2})(\d{2})/.exec(text.slice(0, 4096));
  const reconciliations = releaseReconciliations(text, filed ? `${filed[1]}-${filed[2]}-${filed[3]}` : null);
  const xbrl = extractXbrlExtensionSegments({ xbrl: text, source_id: SOURCE, as_of: AS_OF });
  const nonGaap = extractNonGaapReconciliations({ html: text, source_id: SOURCE, as_of: AS_OF });
  const digest: Digest = {
    header_items: `${classify8kHeader(text).length}:${hash(classify8kHeader(text))}`,
    exhibits: `${exhibits.length}:${hash(exhibits)}`,
    reconciliations: `${reconciliations.reconciliations.length}:${hash(reconciliations)}`,
    xbrl_segments: `${xbrl.items.length}:${hash(xbrl)}`,
    non_gaap: `${nonGaap.items.length}:${hash(nonGaap)}`,
  };
  // A 10-K is stored as its primary .htm; tenKSections reads that.
  if (!text.startsWith("<SEC-DOCUMENT>")) digest.ten_k_sections = hash(tenKSections(text));
  return digest;
}

function wholeBlobTextLength(bytes: Uint8Array): number {
  const read = issuerIrTextFromBytes({ bytes, contentType: null });
  return read.status === "available" ? read.text.length : -1;
}

function filesUnder(paths: string[]): string[] {
  return paths.flatMap((path) => (statSync(path).isDirectory() ? readdirSync(path).sort().map((name) => join(path, name)) : [path]));
}

function files(paths: string[]): number {
  let differ = 0;
  let before = 0;
  let after = 0;
  for (const file of filesUnder(paths)) {
    const bytes = new Uint8Array(readFileSync(file));
    const stripped = stripUuencodedBodies(bytes) ?? bytes;
    const [sent, kept] = [readerDigests(bytes), readerDigests(stripped)];
    const changed = Object.keys(sent).filter((reader) => sent[reader] !== kept[reader]);
    differ += changed.length > 0 ? 1 : 0;
    before += bytes.length;
    after += stripped.length;
    console.log(`${file.split("/").pop()} ${bytes.length}->${stripped.length} ${changed.length === 0 ? "same" : `DIFF ${changed.join(",")}`} ${Object.entries(sent).map(([reader, value]) => `${reader}=${value}`).join(" ")} campaign_text=${wholeBlobTextLength(bytes)}->${wholeBlobTextLength(stripped)}`);
  }
  console.log(`files with a reader that differs: ${differ}; bytes ${before} -> ${after} (${((1 - after / before) * 100).toFixed(1)}% saved)`);
  return differ === 0 ? 0 : 1;
}

async function seed(paths: string[]): Promise<void> {
  const { db, objectStore } = createEvidenceStoreRuntime();
  try {
    await db.query(
      `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'primary', 'public', now()) on conflict do nothing`,
      [SOURCE],
    );
    for (const file of filesUnder(paths)) {
      const bytes = new Uint8Array(readFileSync(file));
      const head = new TextDecoder().decode(bytes.subarray(0, 4096));
      const form = /CONFORMED SUBMISSION TYPE:\s*(\S+)/.exec(head)?.[1] ?? (head.startsWith("<SEC-DOCUMENT>") ? "8-K" : "10-K");
      const accession = /ACCESSION NUMBER:\s*(\S+)/.exec(head)?.[1] ?? null;
      const id = rawBlobIdFromBytes(bytes);
      await objectStore.put(bytes);
      await db.query(
        `insert into documents (source_id, kind, title, provider_doc_id, content_hash, raw_blob_id) values ($1, 'filing', $2, $3, $4, $4) on conflict do nothing`,
        [SOURCE, form, accession, id],
      );
      console.log(`seeded ${file.split("/").pop()} as ${form} ${bytes.length} bytes`);
    }
  } finally {
    await db.end();
  }
}

async function readers(action: string, name: string): Promise<number> {
  const { db, objectStore } = createEvidenceStoreRuntime();
  const run: Record<string, Digest & { raw_blob_id: string; content_hash: string; bytes: string }> = {};
  try {
    const { rows } = await db.query<{ document_id: string; content_hash: string; raw_blob_id: string }>(
      `select document_id::text, content_hash, raw_blob_id from documents where kind = 'filing' and raw_blob_id like 'sha256:%' order by document_id`,
    );
    for (const row of rows) {
      const blob = await objectStore.get(row.raw_blob_id);
      if (blob === null) throw new Error(`${row.document_id}: ${row.raw_blob_id} is not stored`);
      run[row.document_id] = { ...readerDigests(blob.bytes), content_hash: row.content_hash, raw_blob_id: row.raw_blob_id, bytes: String(blob.bytes.length) };
    }
  } finally {
    await db.end();
  }
  const path = join(EVIDENCE, `blob-strip-${name}.json`);
  if (action === "save") {
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
    console.log(`saved ${Object.keys(run).length} filings to ${path}`);
    return 0;
  }
  const saved = JSON.parse(readFileSync(path, "utf8")) as typeof run;
  let moved = 0;
  for (const [documentId, was] of Object.entries(saved)) {
    const now = run[documentId];
    if (now === undefined) {
      console.log(`${documentId} GONE`);
      moved += 1;
      continue;
    }
    const changed = Object.keys(was).filter((key) => !["raw_blob_id", "bytes"].includes(key) && was[key] !== now[key]);
    if (changed.length > 0) moved += 1;
    console.log(`${documentId} ${was.bytes}->${now.bytes} blob ${was.raw_blob_id === now.raw_blob_id ? "kept" : "moved"} content_hash ${was.content_hash === now.content_hash ? "kept" : "MOVED"} ${changed.length === 0 ? "readers same" : `DIFF ${changed.join(",")}`}`);
  }
  console.log(`filings ${Object.keys(saved).length}, with a change: ${moved}`);
  return moved === 0 ? 0 : 1;
}

async function reingest(paths: string[]): Promise<number> {
  const { db, objectStore } = createEvidenceStoreRuntime();
  let duplicated = 0;
  try {
    for (const file of filesUnder(paths)) {
      const bytes = new Uint8Array(readFileSync(file));
      const contentHash = rawBlobIdFromBytes(bytes);
      const named = async () => (await db.query<{ document_id: string }>(`select document_id::text from documents where content_hash = $1 order by document_id`, [contentHash])).rows.map((row) => row.document_id);
      const before = await named();
      const result = await ingestDocument({ db, objectStore }, {
        source: { source_id: SOURCE, license_class: "public" },
        bytes,
        document: { kind: "filing", title: "8-K" },
      });
      const after = await named();
      if (after.length > Math.max(before.length, 1)) duplicated += 1;
      console.log(`${file.split("/").pop()} documents ${before.length}->${after.length} ${before.includes(result.document.document_id) ? "found" : "new"} ${result.document.document_id} stored ${result.raw_blob_id === contentHash ? "as sent" : "stripped"}`);
    }
  } finally {
    await db.end();
  }
  console.log(`files ${filesUnder(paths).length}, with a second document: ${duplicated}`);
  return duplicated === 0 ? 0 : 1;
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "files" && args.length > 0) process.exitCode = files(args);
else if (mode === "seed" && args.length > 0) await seed(args);
else if (mode === "reingest" && args.length > 0) process.exitCode = await reingest(args);
else if (mode === "readers" && (args[0] === "save" || args[0] === "diff") && args[1]) process.exitCode = await readers(args[0], args[1]);
else {
  console.error("usage: blob-strip files PATH... | seed PATH... | readers save|diff NAME | reingest PATH...");
  process.exitCode = 2;
}
