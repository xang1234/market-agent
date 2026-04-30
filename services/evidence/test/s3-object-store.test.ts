import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { RAW_BLOB_ID_PREFIX } from "../src/object-store.ts";
import { S3ObjectStore } from "../src/s3-object-store.ts";

type SentCommand = HeadObjectCommand | GetObjectCommand | PutObjectCommand;
type Handler = (command: SentCommand) => Promise<unknown>;

function mockClient(handler: Handler): { client: S3Client; sent: SentCommand[] } {
  const sent: SentCommand[] = [];
  const client = {
    async send(command: SentCommand) {
      sent.push(command);
      return handler(command);
    },
  } as unknown as S3Client;
  return { client, sent };
}

function notFound() {
  return Object.assign(new Error("Not Found"), {
    name: "NotFound",
    $metadata: { httpStatusCode: 404 },
  });
}

const HELLO = new TextEncoder().encode("hello");
const HELLO_HEX = createHash("sha256").update(HELLO).digest("hex");
const HELLO_ID = `${RAW_BLOB_ID_PREFIX}${HELLO_HEX}`;
const HELLO_KEY = `sha256/${HELLO_HEX}`;
const HELLO_CHECKSUM_BASE64 = createHash("sha256").update(HELLO).digest("base64");

test("constructor rejects missing bucket and missing client", () => {
  const fakeClient = {} as S3Client;
  assert.throws(
    () => new S3ObjectStore({ client: fakeClient, bucket: "" }),
    /bucket must be a non-empty string/,
  );
  assert.throws(
    () => new S3ObjectStore({ client: null as unknown as S3Client, bucket: "x" }),
    /client is required/,
  );
});

test("constructor strips leading and trailing slashes from keyPrefix", async () => {
  const { client, sent } = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) throw notFound();
    return {};
  });
  const store = new S3ObjectStore({ client, bucket: "b", keyPrefix: "/prod/blobs/" });
  await store.put(HELLO);
  const put = sent.find((c) => c instanceof PutObjectCommand) as PutObjectCommand;
  assert.equal(put.input.Key, `prod/blobs/${HELLO_KEY}`);
});

test("put HEADs first, returns created on miss, and uploads with sha256 checksum", async () => {
  const { client, sent } = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) throw notFound();
    if (command instanceof PutObjectCommand) return {};
    throw new Error("unexpected command");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  const result = await store.put(HELLO);

  assert.equal(result.status, "created");
  assert.equal(result.blob.raw_blob_id, HELLO_ID);
  assert.equal(result.blob.size, HELLO.byteLength);

  assert.equal(sent.length, 2);
  assert.ok(sent[0] instanceof HeadObjectCommand);
  assert.equal(sent[0].input.Bucket, "blobs");
  assert.equal(sent[0].input.Key, HELLO_KEY);

  assert.ok(sent[1] instanceof PutObjectCommand);
  assert.equal(sent[1].input.Bucket, "blobs");
  assert.equal(sent[1].input.Key, HELLO_KEY);
  assert.equal(sent[1].input.ContentLength, HELLO.byteLength);
  assert.equal(sent[1].input.ChecksumSHA256, HELLO_CHECKSUM_BASE64);
  assert.equal(sent[1].input.Body, HELLO);
});

test("put returns already_present on HEAD hit and skips PutObject", async () => {
  const { client, sent } = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) return { ContentLength: HELLO.byteLength };
    throw new Error("Put should not be called");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  const result = await store.put(HELLO);

  assert.equal(result.status, "already_present");
  assert.equal(result.blob.raw_blob_id, HELLO_ID);
  assert.equal(result.blob.size, HELLO.byteLength);
  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof HeadObjectCommand);
});

test("put rejects non-Uint8Array input before any S3 call", async () => {
  const { client, sent } = mockClient(async () => {
    throw new Error("send must not be called");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  await assert.rejects(
    store.put("hello" as unknown as Uint8Array),
    /bytes must be a Uint8Array/,
  );
  assert.equal(sent.length, 0);
});

test("put rethrows non-404 HEAD errors (e.g., AccessDenied)", async () => {
  const accessDenied = Object.assign(new Error("Access Denied"), {
    name: "AccessDenied",
    $metadata: { httpStatusCode: 403 },
  });
  const { client } = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) throw accessDenied;
    throw new Error("Put should not be called");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  await assert.rejects(store.put(HELLO), /Access Denied/);
});

test("get returns the object bytes on hit", async () => {
  const { client, sent } = mockClient(async (command) => {
    if (command instanceof GetObjectCommand) {
      return {
        Body: {
          async transformToByteArray() {
            return HELLO;
          },
        },
      };
    }
    throw new Error("unexpected command");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  const blob = await store.get(HELLO_ID);
  assert.ok(blob);
  assert.equal(blob.raw_blob_id, HELLO_ID);
  assert.equal(blob.size, HELLO.byteLength);
  assert.deepEqual(Array.from(blob.bytes), Array.from(HELLO));
  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof GetObjectCommand);
  assert.equal(sent[0].input.Key, HELLO_KEY);
});

test("get returns null on 404", async () => {
  const { client } = mockClient(async (command) => {
    if (command instanceof GetObjectCommand) throw notFound();
    throw new Error("unexpected command");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  assert.equal(await store.get(HELLO_ID), null);
});

test("get rethrows non-404 errors", async () => {
  const internalError = Object.assign(new Error("Internal Server Error"), {
    name: "InternalError",
    $metadata: { httpStatusCode: 500 },
  });
  const { client } = mockClient(async (command) => {
    if (command instanceof GetObjectCommand) throw internalError;
    throw new Error("unexpected command");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  await assert.rejects(store.get(HELLO_ID), /Internal Server Error/);
});

test("get rejects malformed ids before any S3 call", async () => {
  const { client, sent } = mockClient(async () => {
    throw new Error("send must not be called");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  await assert.rejects(store.get("not-a-blob-id"), /sha256:/);
  assert.equal(sent.length, 0);
});

test("has returns true on HEAD success and false on 404", async () => {
  const present = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) return {};
    throw new Error("unexpected command");
  });
  const presentStore = new S3ObjectStore({ client: present.client, bucket: "blobs" });
  assert.equal(await presentStore.has(HELLO_ID), true);

  const missing = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) throw notFound();
    throw new Error("unexpected command");
  });
  const missingStore = new S3ObjectStore({ client: missing.client, bucket: "blobs" });
  assert.equal(await missingStore.has(HELLO_ID), false);
});

test("has rethrows non-404 HEAD errors (e.g., AccessDenied)", async () => {
  const accessDenied = Object.assign(new Error("Access Denied"), {
    name: "AccessDenied",
    $metadata: { httpStatusCode: 403 },
  });
  const { client } = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) throw accessDenied;
    throw new Error("unexpected command");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  await assert.rejects(store.has(HELLO_ID), /Access Denied/);
});

test("isNotFoundError recognizes the legacy NoSuchKey error name (S3 GET 404)", async () => {
  const noSuchKey = Object.assign(new Error("The specified key does not exist."), {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 },
  });
  const { client } = mockClient(async (command) => {
    if (command instanceof GetObjectCommand) throw noSuchKey;
    throw new Error("unexpected command");
  });
  const store = new S3ObjectStore({ client, bucket: "blobs" });

  assert.equal(await store.get(HELLO_ID), null);
});

test("does NOT classify AccessDenied-with-status-404 as not-found (R2 gateway edge case)", async () => {
  // Some S3-compatible gateways (notably Cloudflare R2) return HTTP 404 with
  // an AccessDenied error name for object-level permission failures. If we
  // trusted httpStatusCode alone we'd silently return null for misconfigured
  // buckets. The error name takes precedence over the HTTP status.
  const accessDeniedAs404 = Object.assign(new Error("Access denied"), {
    name: "AccessDenied",
    $metadata: { httpStatusCode: 404 },
  });
  const { client: getClient } = mockClient(async (command) => {
    if (command instanceof GetObjectCommand) throw accessDeniedAs404;
    throw new Error("unexpected command");
  });
  const getStore = new S3ObjectStore({ client: getClient, bucket: "blobs" });
  await assert.rejects(getStore.get(HELLO_ID), /Access denied/);

  const { client: hasClient } = mockClient(async (command) => {
    if (command instanceof HeadObjectCommand) throw accessDeniedAs404;
    throw new Error("unexpected command");
  });
  const hasStore = new S3ObjectStore({ client: hasClient, bucket: "blobs" });
  await assert.rejects(hasStore.has(HELLO_ID), /Access denied/);
});
