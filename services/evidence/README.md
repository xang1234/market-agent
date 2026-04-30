# Evidence

Tracking beads: `fra-5gb`, `fra-131`, and related P3 evidence-plane work.

This package provides small repository helpers over the evidence-plane tables in
`spec/finance_research_db_schema.sql`.

## Source Repo

`createSource` writes rows to `sources` with the provenance fields ingestion and
promotion code needs:

- `provider`
- `kind`
- `canonical_url`
- `trust_tier`
- `license_class`
- `retrieved_at`
- `content_hash`

`getSource` reads a source by `source_id`.

The helpers validate enum-shaped fields before querying so callers fail before a
database round trip for malformed `kind`, `trust_tier`, timestamp, or empty
license/provider metadata. The database still enforces referential integrity:
`documents.source_id` must point at an existing source row.

## Document Repo

`createDocument` writes rows to `documents` and treats
`(content_hash, raw_blob_id)` as the identity for raw content. The first ingest
returns `{ status: "created" }`; a later ingest of the same content returns
`{ status: "already_present" }` with the existing row.

`getDocument` reads a document by `document_id`.

The repository validates document kind, parse status, UUID references,
timestamps, and required hash/blob metadata before querying. Parent document
threading is accepted as metadata here; threaded-source behavior is covered by
`fra-8la`.

## Threaded sources

Some sources have conversation structure: Reddit threads, earnings-call
transcripts split into segments, and any other reply-shaped feed. Two columns
on `documents` capture this:

- `parent_document_id` — the immediate parent (the post you replied to, or
  the transcript root for a segment). Always a UUID FK to `documents`.
- `conversation_id` — a free-form string that groups every document in the
  same thread regardless of depth. For Reddit, set this to the thread/post
  id (e.g., `reddit:t3_xyz`); for transcripts, the call/event id.

Use `parent_document_id` when you need to walk the immediate reply chain.
Use `conversation_id` when you need every document in a thread without
caring about depth (e.g., loading the full Reddit thread for claim
extraction).

```ts
import {
  getDocumentChildren,
  getDocumentAncestors,
  getDocumentThread,
  getConversation,
} from "evidence";

await getDocumentChildren(db, parentId);   // direct replies, ordered by published_at
await getDocumentAncestors(db, replyId);   // root → ... → replyId, inclusive
await getDocumentThread(db, rootId);       // root + all descendants, depth-first
await getConversation(db, "reddit:t3_xyz"); // every doc with this conversation_id
```

`getDocumentThread` and `getDocumentAncestors` use recursive CTEs so the
traversal is one round-trip regardless of depth. The walk includes the input
document itself, so a leaf doc returns `[self]` from both.

**Cycles are prevented by insert order.** A new `document_id` is generated at
insert time, so it cannot be its own parent. The repository never UPDATEs
`parent_document_id` on existing rows. Don't add an UPDATE path that mutates
this column without a separate cycle check.

## Object Store

`MemoryObjectStore` is a content-addressed blob store: callers `put()` raw
bytes and receive a `raw_blob_id` of the form `sha256:<64-hex>` that is the
SHA-256 hash of the bytes. Re-putting identical bytes returns the same id with
status `already_present`, so ingestion is naturally idempotent.

The store exposes only `put`, `get`, and `has` — there is no update or delete.
That keeps the "raw blobs are immutable" invariant from
`fra-6j0.1` physically true: changing the bytes always changes the id, and the
store has no API to overwrite a key. `put` and `get` defensively copy bytes at
both ends so callers cannot mutate stored content through retained references.

Typical composition with `DocumentRepo`:

```ts
// raw_blob_id is always the object-store id from store.put().
// content_hash is a SEPARATE hash over the canonical (parsed/normalized)
// form of the document. They are equal only when raw bytes already are the
// canonical form (e.g., a plain-text upload). For HTML, PDF, and most
// provider formats, they will diverge — content_hash is what dedupes
// "the same press release served by two aggregators."
const blob = await store.put(rawBytes);
const canonicalContentHash = sha256OfCanonicalForm(rawBytes); // ingestion-defined
await createDocument(db, {
  source_id,
  kind,
  content_hash: canonicalContentHash,
  raw_blob_id: blob.blob.raw_blob_id,
});
```

`createDocument` now validates `raw_blob_id` against the same `sha256:<64-hex>`
contract enforced by `MemoryObjectStore`, so callers cannot accidentally write
a document row whose `raw_blob_id` could not be served back by the store.

A real R2/S3-compatible adapter that talks to remote object storage is tracked
separately so ingestion (P3.2) can plug in a wire backend without changing
the `ObjectStore` interface.

## Tests

```bash
cd services/evidence
npm test
```

Integration coverage uses the shared Docker/Postgres harness and is skipped when
Docker is unavailable.
