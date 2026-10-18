import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { RecordData } from "./contracts.js";

export interface DatabaseReader {
  get<T extends RecordData = RecordData>(path: string): Promise<T | null>;
  list<T extends RecordData = RecordData>(path: string): Promise<T[]>;
}
export interface Transactional extends DatabaseReader {
  set(path: string, data: RecordData): void;
  delete(path: string): void;
}
export interface Database extends DatabaseReader {
  transaction<T>(action: (tx: Transactional) => Promise<T>): Promise<T>;
}
function validPath(path: string, document: boolean) {
  const parts = path.split("/");
  if (
    parts.some((part) => !/^[a-zA-Z0-9_-]+$/u.test(part)) ||
    (parts.length % 2 === 0) !== document
  )
    throw new Error("Invalid database path");
  return path;
}
export class FirebaseDatabase implements Database {
  constructor(private readonly db: Firestore) {}
  async get<T extends RecordData>(path: string) {
    const snapshot = await this.db.doc(validPath(path, true)).get();
    return snapshot.exists ? (snapshot.data() as T) : null;
  }
  async list<T extends RecordData>(path: string) {
    const snapshot = await this.db.collection(validPath(path, false)).limit(500).get();
    return snapshot.docs.map((doc) => doc.data() as T);
  }
  transaction<T>(action: (tx: Transactional) => Promise<T>): Promise<T> {
    return this.db.runTransaction((tx) => action(this.adapter(tx)));
  }
  private adapter(tx: Transaction): Transactional {
    return {
      get: async <T extends RecordData>(path: string) => {
        const doc = await tx.get(this.db.doc(validPath(path, true)));
        return doc.exists ? (doc.data() as T) : null;
      },
      list: async <T extends RecordData>(path: string) => {
        const snapshot = await tx.get(this.db.collection(validPath(path, false)).limit(500));
        return snapshot.docs.map((doc) => doc.data() as T);
      },
      set: (path, data) => {
        tx.set(this.db.doc(validPath(path, true)), data);
      },
      delete: (path) => {
        tx.delete(this.db.doc(validPath(path, true)));
      },
    };
  }
}

/** Serialized copy-on-write transactions: failed transactions never mutate test data. */
export class MemoryDatabase implements Database {
  private data = new Map<string, RecordData>();
  private pending: Promise<unknown> = Promise.resolve();
  async get<T extends RecordData>(path: string) {
    return structuredClone(this.data.get(validPath(path, true)) ?? null) as T | null;
  }
  async list<T extends RecordData>(path: string) {
    validPath(path, false);
    return [...this.data.entries()]
      .filter(
        ([key]) =>
          key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1,
      )
      .slice(0, 500)
      .map(([, value]) => structuredClone(value) as T);
  }
  transaction<T>(action: (tx: Transactional) => Promise<T>): Promise<T> {
    const run = this.pending.then(async () => {
      const staged = new Map(this.data);
      const result = await action({
        get: async <U extends RecordData>(path: string) =>
          structuredClone(staged.get(validPath(path, true)) ?? null) as U | null,
        list: async <U extends RecordData>(path: string) =>
          [...staged.entries()]
            .filter(
              ([key]) =>
                key.startsWith(`${validPath(path, false)}/`) &&
                key.split("/").length === path.split("/").length + 1,
            )
            .slice(0, 500)
            .map(([, value]) => structuredClone(value) as U),
        set: (path, data) => {
          staged.set(validPath(path, true), structuredClone(data));
        },
        delete: (path) => {
          staged.delete(validPath(path, true));
        },
      });
      this.data = staged;
      return result;
    });
    this.pending = run.catch(() => {});
    return run;
  }
}
