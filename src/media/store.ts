import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hash } from "../digest.js";
import type { MediaJob } from "./model.js";

interface Row {
  record: string;
  version: number;
  lease_owner: string | null;
  lease_pid: number | null;
  lease_host: string | null;
}

export class MediaStore {
  private constructor(private readonly db: DatabaseSync) {}
  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS media_jobs (
        id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, record TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_pid INTEGER, lease_host TEXT
      );
      CREATE TABLE IF NOT EXISTS media_budgets (scope TEXT PRIMARY KEY, cap INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS media_reservations (job_id TEXT PRIMARY KEY, scope TEXT NOT NULL, cents INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS provider_jobs (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, record TEXT NOT NULL);`);
    return new MediaStore(db);
  }
  close() {
    this.db.close();
  }
  static async readJobs(path: string): Promise<MediaJob[]> {
    try {
      await access(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const store = new MediaStore(new DatabaseSync(path, { readOnly: true }));
    try {
      return store.list();
    } finally {
      store.close();
    }
  }
  list(): MediaJob[] {
    return (
      this.db.prepare("SELECT * FROM media_jobs ORDER BY rowid DESC").all() as unknown as Row[]
    ).map((row) => this.decode(row));
  }
  private decode(row: Row): MediaJob {
    const job = JSON.parse(row.record) as MediaJob;
    if (job.schemaVersion !== 1 || hash(JSON.stringify(job.request)) !== job.requestHash) {
      throw new Error("Media job request is corrupt or was changed after creation");
    }
    return job;
  }
  get(id: string): MediaJob {
    const row = this.db.prepare("SELECT * FROM media_jobs WHERE id=?").get(id) as unknown as
      | Row
      | undefined;
    if (!row) throw new Error(`Unknown media job: ${id}`);
    return this.decode(row);
  }
  findByKey(key: string): MediaJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM media_jobs WHERE request_key=?")
      .get(key) as unknown as Row | undefined;
    return row ? this.decode(row) : undefined;
  }
  create(job: MediaJob, scope: string): MediaJob {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT * FROM media_jobs WHERE request_key=?")
        .get(job.requestKey) as unknown as Row | undefined;
      if (existing) {
        const decoded = this.decode(existing);
        this.db.exec("COMMIT");
        return decoded;
      }
      const cap = job.request.settings.pilotBudgetCents;
      if (
        !Number.isSafeInteger(job.quoteCents) ||
        job.quoteCents < 0 ||
        !Number.isSafeInteger(cap) ||
        cap < 0
      )
        throw new Error("Invalid media budget or quote");
      this.db.prepare("INSERT OR IGNORE INTO media_budgets(scope,cap) VALUES(?,?)").run(scope, cap);
      const budget = this.db
        .prepare("SELECT cap,reserved,spent FROM media_budgets WHERE scope=?")
        .get(scope) as { cap: number; reserved: number; spent: number };
      const effectiveCap = Math.min(cap, budget.cap);
      if (budget.reserved + budget.spent + job.quoteCents > effectiveCap)
        throw new Error("Pilot spending limit would be exceeded");
      this.db
        .prepare("UPDATE media_budgets SET cap=?,reserved=reserved+? WHERE scope=?")
        .run(effectiveCap, job.quoteCents, scope);
      this.db
        .prepare("INSERT INTO media_reservations(job_id,scope,cents) VALUES(?,?,?)")
        .run(job.id, scope, job.quoteCents);
      this.db
        .prepare("INSERT INTO media_jobs(id,request_key,record) VALUES(?,?,?)")
        .run(job.id, job.requestKey, JSON.stringify(job));
      this.db.exec("COMMIT");
      return job;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  acquire(id: string): string {
    const row = this.db.prepare("SELECT * FROM media_jobs WHERE id=?").get(id) as unknown as
      | Row
      | undefined;
    if (!row) throw new Error(`Unknown media job: ${id}`);
    if (row.lease_owner) {
      let alive = true;
      if (row.lease_host === hostname() && row.lease_pid) {
        try {
          process.kill(row.lease_pid, 0);
        } catch (error) {
          alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
      }
      if (alive) throw new Error("This media job is already being processed");
    }
    const owner = randomUUID();
    const result = this.db
      .prepare(
        "UPDATE media_jobs SET lease_owner=?,lease_pid=?,lease_host=? WHERE id=? AND version=? AND lease_owner IS ?",
      )
      .run(owner, process.pid, hostname(), id, row.version, row.lease_owner);
    if (result.changes !== 1) throw new Error("Another worker acquired this media job");
    return owner;
  }
  save(job: MediaJob, owner: string) {
    const result = this.db
      .prepare("UPDATE media_jobs SET record=?,version=version+1 WHERE id=? AND lease_owner=?")
      .run(JSON.stringify(job), job.id, owner);
    if (result.changes !== 1) throw new Error("Media job lease was lost");
  }
  release(id: string, owner: string) {
    this.db
      .prepare(
        "UPDATE media_jobs SET lease_owner=NULL,lease_pid=NULL,lease_host=NULL WHERE id=? AND lease_owner=?",
      )
      .run(id, owner);
  }
  settle(job: MediaJob, cents: number) {
    if (!Number.isSafeInteger(cents) || cents < 0)
      throw new Error("Provider returned an invalid cost");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const reservation = this.db
        .prepare("SELECT * FROM media_reservations WHERE job_id=?")
        .get(job.id) as { scope: string; cents: number; settled: number };
      if (!reservation.settled) {
        this.db
          .prepare("UPDATE media_budgets SET reserved=reserved-?,spent=spent+? WHERE scope=?")
          .run(reservation.cents, cents, reservation.scope);
        this.db.prepare("UPDATE media_reservations SET settled=1 WHERE job_id=?").run(job.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    if (cents > job.quoteCents)
      throw new Error("Provider cost exceeded the reserved maximum; spending recorded");
  }
  providerGet(key: string): { id: string; value: unknown } | undefined {
    const row = this.db
      .prepare("SELECT id,record FROM provider_jobs WHERE request_key=? OR id=?")
      .get(key, key) as { id: string; record: string } | undefined;
    return row ? { id: row.id, value: JSON.parse(row.record) } : undefined;
  }
  providerPut(id: string, key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO provider_jobs(id,request_key,record) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
      )
      .run(id, key, JSON.stringify(value));
  }
}
