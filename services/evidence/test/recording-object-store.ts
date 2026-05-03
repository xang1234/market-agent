import {
  MemoryObjectStore,
  type ObjectStore,
  type PutResult,
  type StoredBlob,
} from "../src/object-store.ts";

export class RecordingObjectStore implements ObjectStore {
  putCalls = 0;
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
}
