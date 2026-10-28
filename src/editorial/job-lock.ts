import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WritingError } from "./providers.js";

/** Separate from the GPU gate: never inherit its reentrant AsyncLocalStorage. */
export function writingJobLease(directory: string): DatabaseSync {
  const database = new DatabaseSync(resolve(directory, "writing-jobs.sqlite"));
  try {
    database.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch {
    database.close();
    throw new WritingError(
      "BUSY",
      "A writing request is active in another local studio. Wait or cancel it from Recent writing requests.",
    );
  }
  return database;
}
