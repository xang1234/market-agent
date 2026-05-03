import {
  MemoryObjectStore,
  type ObjectStore,
  type PutResult,
  type StoredBlob,
} from "../src/object-store.ts";

export class RecordingObjectStore implements ObjectStore {
  putCalls = 0;
  deleteCalls = 0;
  readonly deletedRawBlobIds: string[] = [];
  readonly inner = new MemoryObjectStore();
  async put(bytes: Uint8Array): Promise<PutResult> {
    this.putCalls += 1;
    return this.inner.put(bytes);
  }
  async get(rawBlobId: string): Promise<StoredBlob | null> {
    return this.inner.get(rawBlobId);
  }
  async has(rawBlobId: string): Promise<boolean> {
    return this.inner.has(rawBlobId);
  }
  async delete(rawBlobId: string): Promise<boolean> {
    this.deleteCalls += 1;
    this.deletedRawBlobIds.push(rawBlobId);
    return this.inner.delete(rawBlobId);
  }
}
