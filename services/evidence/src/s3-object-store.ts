import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import {
  RAW_BLOB_ID_PREFIX,
  assertRawBlobId,
  rawBlobIdFromBytes,
  type ObjectStore,
  type PutResult,
  type StoredBlob,
} from "./object-store.ts";

export type S3ObjectStoreConfig = {
  client: S3Client;
  bucket: string;
  keyPrefix?: string;
};

export class S3ObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #keyPrefix: string;

  constructor(config: S3ObjectStoreConfig) {
    if (config.client == null) {
      throw new Error("S3ObjectStore: client is required");
    }
    if (typeof config.bucket !== "string" || config.bucket.trim().length === 0) {
      throw new Error("S3ObjectStore: bucket must be a non-empty string");
    }
    if (config.keyPrefix !== undefined && typeof config.keyPrefix !== "string") {
      throw new Error("S3ObjectStore: keyPrefix must be a string when provided");
    }
    this.#client = config.client;
    this.#bucket = config.bucket;
    this.#keyPrefix = (config.keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
  }

  async put(bytes: Uint8Array): Promise<PutResult> {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("put: bytes must be a Uint8Array");
    }
    const raw_blob_id = rawBlobIdFromBytes(bytes);
    const key = this.#keyFor(raw_blob_id);

    if (await this.#headExists(key)) {
      return Object.freeze({
        status: "already_present" as const,
        blob: Object.freeze({ raw_blob_id, size: bytes.byteLength }),
      });
    }

    const checksumBase64 = createHash("sha256").update(bytes).digest("base64");
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ChecksumSHA256: checksumBase64,
      }),
    );

    return Object.freeze({
      status: "created" as const,
      blob: Object.freeze({ raw_blob_id, size: bytes.byteLength }),
    });
  }

  async get(rawBlobId: string): Promise<StoredBlob | null> {
    assertRawBlobId(rawBlobId);
    const key = this.#keyFor(rawBlobId);

    let response: Awaited<ReturnType<S3Client["send"]>> & {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
    };
    try {
      response = (await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      )) as typeof response;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }

    if (response.Body === undefined) {
      throw new Error(`S3ObjectStore.get: object ${key} returned no body`);
    }
    const body = await response.Body.transformToByteArray();
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    return Object.freeze({
      raw_blob_id: rawBlobId,
      size: bytes.byteLength,
      bytes,
    });
  }

  async has(rawBlobId: string): Promise<boolean> {
    assertRawBlobId(rawBlobId);
    return this.#headExists(this.#keyFor(rawBlobId));
  }

  async #headExists(key: string): Promise<boolean> {
    try {
      await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  #keyFor(rawBlobId: string): string {
    const hex = rawBlobId.slice(RAW_BLOB_ID_PREFIX.length);
    const namespaced = `sha256/${hex}`;
    return this.#keyPrefix.length > 0 ? `${this.#keyPrefix}/${namespaced}` : namespaced;
  }
}

function isNotFoundError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (candidate.name === "NotFound" || candidate.name === "NoSuchKey") return true;
  if (candidate.Code === "NotFound" || candidate.Code === "NoSuchKey") return true;
  // Fallback ONLY when no error name is available. Some S3-compatible gateways
  // (notably Cloudflare R2 in some configs) return HTTP 404 for AccessDenied at
  // the object level — if we trusted httpStatusCode alone we'd silently mask
  // those as "object missing." Trust a present name first; use status only when
  // the SDK left us nothing else to go on.
  if (
    typeof candidate.name !== "string" &&
    typeof candidate.Code !== "string" &&
    typeof candidate.$metadata === "object" &&
    candidate.$metadata !== null &&
    candidate.$metadata.httpStatusCode === 404
  ) {
    return true;
  }
  return false;
}
