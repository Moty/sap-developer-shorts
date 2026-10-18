import type { getStorage } from "firebase-admin/storage";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

import { digest } from "./contracts.js";

export interface BlobStore {
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
}
function valid(path: string) {
  if (
    !/^tenants\/[a-zA-Z0-9_-]+\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/u.test(path) ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("Invalid private object path");
  return path;
}
export class FirebaseBlobs implements BlobStore {
  constructor(private readonly bucket: Bucket) {}
  async put(path: string, bytes: Buffer, contentType: string) {
    await this.bucket.file(valid(path)).save(bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType,
        cacheControl: "private, no-store",
        metadata: { sha256: digest(bytes) },
      },
    });
  }
  async get(path: string) {
    return (await this.bucket.file(valid(path)).download())[0];
  }
  async delete(path: string) {
    await this.bucket.file(valid(path)).delete({ ignoreNotFound: true });
  }
}
export class MemoryBlobs implements BlobStore {
  private readonly data = new Map<string, Buffer>();
  async put(path: string, bytes: Buffer) {
    if (this.data.has(valid(path))) throw new Error("Object already exists");
    this.data.set(path, Buffer.from(bytes));
  }
  async get(path: string) {
    const bytes = this.data.get(valid(path));
    if (!bytes) throw new Error("Object unavailable");
    return Buffer.from(bytes);
  }
  async delete(path: string) {
    this.data.delete(valid(path));
  }
}
