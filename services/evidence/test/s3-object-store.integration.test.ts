import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { RAW_BLOB_ID_PREFIX } from "../src/object-store.ts";
import { S3ObjectStore } from "../src/s3-object-store.ts";
import { bootstrapMinio, dockerAvailable } from "./docker-minio.ts";

test("round-trips bytes through put → get against a real MinIO", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for S3ObjectStore integration coverage");
    return;
  }

  const { client, bucket } = await bootstrapMinio(t, "s3-roundtrip");
  const store = new S3ObjectStore({ client, bucket });

  const payload = new TextEncoder().encode("hello from minio");
  const expectedHex = createHash("sha256").update(payload).digest("hex");
  const expectedId = `${RAW_BLOB_ID_PREFIX}${expectedHex}`;

  // Initial put: created
  const first = await store.put(payload);
  assert.equal(first.status, "created");
  assert.equal(first.blob.raw_blob_id, expectedId);
  assert.equal(first.blob.size, payload.byteLength);

  // Re-put same bytes: already_present (HEAD short-circuits PutObject)
  const second = await store.put(payload);
  assert.equal(second.status, "already_present");
  assert.equal(second.blob.raw_blob_id, expectedId);

  // has reflects state
  assert.equal(await store.has(expectedId), true);

  // get round-trips the exact bytes
  const fetched = await store.get(expectedId);
  assert.ok(fetched);
  assert.equal(fetched.raw_blob_id, expectedId);
  assert.equal(fetched.size, payload.byteLength);
  assert.deepEqual(Array.from(fetched.bytes), Array.from(payload));

  // Content-addressed key derivation: confirm the actual S3 key matches sha256/<hex>
  const expectedKey = `sha256/${expectedHex}`;
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: expectedKey }));
});

test("get returns null for an unknown id (real 404 from MinIO)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for S3ObjectStore integration coverage");
    return;
  }

  const { client, bucket } = await bootstrapMinio(t, "s3-missing");
  const store = new S3ObjectStore({ client, bucket });

  const missingHex = createHash("sha256").update("never-uploaded").digest("hex");
  const missingId = `${RAW_BLOB_ID_PREFIX}${missingHex}`;

  assert.equal(await store.get(missingId), null);
  assert.equal(await store.has(missingId), false);
});

test("keyPrefix namespaces objects under the configured path in the bucket", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for S3ObjectStore integration coverage");
    return;
  }

  const { client, bucket } = await bootstrapMinio(t, "s3-prefix");
  const store = new S3ObjectStore({ client, bucket, keyPrefix: "prod/blobs" });

  const payload = new TextEncoder().encode("namespaced");
  const hex = createHash("sha256").update(payload).digest("hex");
  const id = `${RAW_BLOB_ID_PREFIX}${hex}`;

  await store.put(payload);

  // Object should exist at the prefixed key, not the bare sha256 key.
  // Verify the bare-key probe specifically returns a 404 — a bare assert.rejects
  // would also pass on AccessDenied or any other error, masking a real config bug.
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: `prod/blobs/sha256/${hex}` }));
  await assert.rejects(
    client.send(new HeadObjectCommand({ Bucket: bucket, Key: `sha256/${hex}` })),
    (err: unknown) => {
      assert.ok(err instanceof Error, `expected an Error, got: ${String(err)}`);
      const e = err as Error & { $metadata?: { httpStatusCode?: number } };
      assert.ok(
        e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404,
        `expected a 404 NotFound/NoSuchKey, got: name=${e.name} status=${e.$metadata?.httpStatusCode}`,
      );
      return true;
    },
  );

  // get works through the same prefixed store
  const fetched = await store.get(id);
  assert.ok(fetched);
  assert.deepEqual(Array.from(fetched.bytes), Array.from(payload));
});

test("put rejects body that does not match the SHA-256 checksum (server-side verification)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for S3ObjectStore integration coverage");
    return;
  }

  const { client, bucket } = await bootstrapMinio(t, "s3-checksum");

  const realBytes = new TextEncoder().encode("the truth");
  const lieBytes = new TextEncoder().encode("the lie  ");
  const wrongChecksum = createHash("sha256").update(realBytes).digest("base64");

  // Bypass the store: directly send a PutObject whose body does NOT match the
  // declared ChecksumSHA256. MinIO must reject this. This pins the property
  // that the store relies on for upload integrity.
  await assert.rejects(
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "sha256/0000000000000000000000000000000000000000000000000000000000000000",
        Body: lieBytes,
        ContentLength: lieBytes.byteLength,
        ChecksumSHA256: wrongChecksum,
      }),
    ),
  );
});
