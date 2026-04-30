import { createHash } from "node:crypto";

export const RAW_BLOB_ID_PREFIX = "sha256:";
const RAW_BLOB_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type RawBlobMetadata = Readonly<{
  raw_blob_id: string;
  size: number;
}>;

export type StoredBlob = RawBlobMetadata & Readonly<{ bytes: Uint8Array }>;

export type PutResult =
  | { readonly status: "created"; readonly blob: RawBlobMetadata }
  | { readonly status: "already_present"; readonly blob: RawBlobMetadata };

export type ObjectStore = {
  put(bytes: Uint8Array): Promise<PutResult>;
  get(rawBlobId: string): Promise<StoredBlob | null>;
  has(rawBlobId: string): Promise<boolean>;
};

export function rawBlobIdFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("rawBlobIdFromBytes: bytes must be a Uint8Array");
  }
  const hex = createHash("sha256").update(bytes).digest("hex");
  return `${RAW_BLOB_ID_PREFIX}${hex}`;
}

export function assertRawBlobId(
  value: unknown,
  label = "raw_blob_id",
): asserts value is string {
  if (typeof value !== "string" || !RAW_BLOB_ID_PATTERN.test(value)) {
    throw new Error(`${label}: must match ${RAW_BLOB_ID_PREFIX}<64 lowercase hex chars>`);
  }
}

export class MemoryObjectStore implements ObjectStore {
  readonly #blobs = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array): Promise<PutResult> {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("put: bytes must be a Uint8Array");
    }
    const raw_blob_id = rawBlobIdFromBytes(bytes);
    const existing = this.#blobs.get(raw_blob_id);
    if (existing !== undefined) {
      return Object.freeze({
        status: "already_present" as const,
        blob: Object.freeze({ raw_blob_id, size: existing.byteLength }),
      });
    }
    const copy = new Uint8Array(bytes);
    this.#blobs.set(raw_blob_id, copy);
    return Object.freeze({
      status: "created" as const,
      blob: Object.freeze({ raw_blob_id, size: copy.byteLength }),
    });
  }

  async get(rawBlobId: string): Promise<StoredBlob | null> {
    assertRawBlobId(rawBlobId);
    const stored = this.#blobs.get(rawBlobId);
    if (stored === undefined) {
      return null;
    }
    const copy = new Uint8Array(stored);
    return Object.freeze({
      raw_blob_id: rawBlobId,
      size: copy.byteLength,
      bytes: copy,
    });
  }

  async has(rawBlobId: string): Promise<boolean> {
    assertRawBlobId(rawBlobId);
    return this.#blobs.has(rawBlobId);
  }
}
