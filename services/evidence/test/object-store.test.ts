import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  EPHEMERAL_RAW_BLOB_ID_PREFIX,
  MemoryObjectStore,
  RAW_BLOB_ID_PREFIX,
  assertRawBlobId,
  assertRawBlobIdOrEphemeral,
  ephemeralRawBlobIdForSource,
  isEphemeralRawBlobId,
  rawBlobIdFromBytes,
} from "../src/object-store.ts";

const SAMPLE_SOURCE_ID = "11111111-1111-4111-a111-111111111111";

const HELLO = new TextEncoder().encode("hello");
const HELLO_HEX = createHash("sha256").update(HELLO).digest("hex");
const HELLO_ID = `${RAW_BLOB_ID_PREFIX}${HELLO_HEX}`;

test("rawBlobIdFromBytes derives a sha256:<hex> id from the bytes", () => {
  assert.equal(rawBlobIdFromBytes(HELLO), HELLO_ID);
});

test("rawBlobIdFromBytes rejects non-Uint8Array input", () => {
  assert.throws(
    () => rawBlobIdFromBytes("hello" as unknown as Uint8Array),
    /bytes must be a Uint8Array/,
  );
});

test("assertRawBlobId accepts well-formed ids and rejects malformed ones", () => {
  assertRawBlobId(HELLO_ID);
  assert.throws(() => assertRawBlobId("blob:hello"), /sha256:/);
  assert.throws(() => assertRawBlobId(`${RAW_BLOB_ID_PREFIX}SHORT`), /64 lowercase hex/);
  assert.throws(
    () => assertRawBlobId(`${RAW_BLOB_ID_PREFIX}${HELLO_HEX.toUpperCase()}`),
    /lowercase hex/,
  );
  assert.throws(() => assertRawBlobId(123 as unknown as string), /must match/);
});

test("MemoryObjectStore.put returns created on first ingest and already_present on second", async () => {
  const store = new MemoryObjectStore();

  const first = await store.put(HELLO);
  assert.equal(first.status, "created");
  assert.equal(first.blob.raw_blob_id, HELLO_ID);
  assert.equal(first.blob.size, HELLO.byteLength);

  const second = await store.put(new TextEncoder().encode("hello"));
  assert.equal(second.status, "already_present");
  assert.equal(second.blob.raw_blob_id, HELLO_ID);
  assert.equal(second.blob.size, HELLO.byteLength);
});

test("MemoryObjectStore.put rejects non-Uint8Array input before storing", async () => {
  const store = new MemoryObjectStore();
  await assert.rejects(
    store.put("hello" as unknown as Uint8Array),
    /bytes must be a Uint8Array/,
  );
  assert.equal(await store.has(HELLO_ID), false);
});

test("MemoryObjectStore.get returns the stored bytes for a known id and null for unknown", async () => {
  const store = new MemoryObjectStore();
  await store.put(HELLO);

  const found = await store.get(HELLO_ID);
  assert.ok(found);
  assert.equal(found.raw_blob_id, HELLO_ID);
  assert.equal(found.size, HELLO.byteLength);
  assert.deepEqual(Array.from(found.bytes), Array.from(HELLO));

  const missingHex = createHash("sha256").update("absent").digest("hex");
  const missing = await store.get(`${RAW_BLOB_ID_PREFIX}${missingHex}`);
  assert.equal(missing, null);
});

test("MemoryObjectStore.get and has reject malformed ids before lookup", async () => {
  const store = new MemoryObjectStore();
  await assert.rejects(store.get("not-a-blob-id"), /sha256:/);
  await assert.rejects(store.has("not-a-blob-id"), /sha256:/);
});

test("MemoryObjectStore.has reflects put state", async () => {
  const store = new MemoryObjectStore();
  assert.equal(await store.has(HELLO_ID), false);
  await store.put(HELLO);
  assert.equal(await store.has(HELLO_ID), true);
});

test("MemoryObjectStore.delete removes a stored blob and is idempotent", async () => {
  const store = new MemoryObjectStore();
  await store.put(HELLO);

  assert.equal(await store.delete(HELLO_ID), true);
  assert.equal(await store.has(HELLO_ID), false);
  assert.equal(await store.get(HELLO_ID), null);
  assert.equal(await store.delete(HELLO_ID), false);
});

test("MemoryObjectStore.delete rejects malformed ids before lookup", async () => {
  const store = new MemoryObjectStore();
  await assert.rejects(store.delete("not-a-blob-id"), /sha256:/);
});

test("stored bytes are isolated from the input buffer (mutating the input does not change storage)", async () => {
  const store = new MemoryObjectStore();
  const buffer = new Uint8Array([1, 2, 3, 4]);
  const id = (await store.put(buffer)).blob.raw_blob_id;

  buffer[0] = 99;
  const fetched = await store.get(id);
  assert.ok(fetched);
  assert.deepEqual(Array.from(fetched.bytes), [1, 2, 3, 4]);
});

test("returned bytes are isolated from internal storage (mutating the result does not change storage)", async () => {
  const store = new MemoryObjectStore();
  const id = (await store.put(HELLO)).blob.raw_blob_id;

  const first = await store.get(id);
  assert.ok(first);
  first.bytes[0] = 99;

  const second = await store.get(id);
  assert.ok(second);
  assert.deepEqual(Array.from(second.bytes), Array.from(HELLO));
});

test("ephemeralRawBlobIdForSource returns the 'ephemeral:<source_id>' sentinel", () => {
  assert.equal(
    ephemeralRawBlobIdForSource(SAMPLE_SOURCE_ID),
    `${EPHEMERAL_RAW_BLOB_ID_PREFIX}${SAMPLE_SOURCE_ID}`,
  );
});

test("ephemeralRawBlobIdForSource rejects non-uuid inputs (sentinel must round-trip to a real source)", () => {
  assert.throws(() => ephemeralRawBlobIdForSource("not-a-uuid"), /uuid/i);
  assert.throws(() => ephemeralRawBlobIdForSource(""), /uuid/i);
});

test("isEphemeralRawBlobId distinguishes the sentinel from sha256 ids and arbitrary strings", () => {
  assert.equal(isEphemeralRawBlobId(ephemeralRawBlobIdForSource(SAMPLE_SOURCE_ID)), true);
  assert.equal(isEphemeralRawBlobId(HELLO_ID), false);
  assert.equal(isEphemeralRawBlobId("ephemeral:not-a-uuid"), false);
  assert.equal(isEphemeralRawBlobId(""), false);
  assert.equal(isEphemeralRawBlobId("ephemeral:"), false);
});

test("assertRawBlobIdOrEphemeral accepts both sha256 ids and the ephemeral sentinel", () => {
  assertRawBlobIdOrEphemeral(HELLO_ID);
  assertRawBlobIdOrEphemeral(ephemeralRawBlobIdForSource(SAMPLE_SOURCE_ID));
});

test("assertRawBlobIdOrEphemeral rejects malformed ephemeral sentinels", () => {
  assert.throws(() => assertRawBlobIdOrEphemeral("ephemeral:not-a-uuid"), /sha256:|ephemeral:/);
  assert.throws(() => assertRawBlobIdOrEphemeral("ephemeral:"), /sha256:|ephemeral:/);
});

test("MemoryObjectStore.get/has refuse the ephemeral sentinel (storage layer never touches it)", async () => {
  // Defensive: the object-store contract is for sha256-addressed bytes
  // only. If a caller ever tries to fetch an ephemeral document from
  // storage, that's a bug — surface it loud rather than silently
  // returning null/false and masking the design break.
  const store = new MemoryObjectStore();
  const sentinel = ephemeralRawBlobIdForSource(SAMPLE_SOURCE_ID);
  await assert.rejects(store.get(sentinel), /sha256:/);
  await assert.rejects(store.has(sentinel), /sha256:/);
});

test("different content produces different ids and is stored independently", async () => {
  const store = new MemoryObjectStore();
  const a = new TextEncoder().encode("content-a");
  const b = new TextEncoder().encode("content-b");

  const putA = await store.put(a);
  const putB = await store.put(b);
  assert.notEqual(putA.blob.raw_blob_id, putB.blob.raw_blob_id);

  const fetchedA = await store.get(putA.blob.raw_blob_id);
  const fetchedB = await store.get(putB.blob.raw_blob_id);
  assert.ok(fetchedA && fetchedB);
  assert.deepEqual(Array.from(fetchedA.bytes), Array.from(a));
  assert.deepEqual(Array.from(fetchedB.bytes), Array.from(b));
});
