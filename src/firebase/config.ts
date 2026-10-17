import { readFile } from "node:fs/promises";
import { arch, hostname } from "node:os";
import { resolve } from "node:path";
import { projectRoot } from "../paths.js";

export interface FirebaseClientConfig {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly authDomain: string;
  readonly storageBucket: string;
  readonly databaseId: string;
  readonly apiKey: string;
  readonly appId?: string;
}

export interface WorkerIdentity {
  readonly workerId: string;
  readonly hostname: string;
  readonly arch: string;
}

const defaultProjectId = "sap-shorts-160871";

export async function loadFirebaseConfig(
  configPath = resolve(projectRoot, "config/firebase-client.json"),
): Promise<FirebaseClientConfig> {
  let raw: Partial<FirebaseClientConfig> = {};
  try {
    raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<FirebaseClientConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID ?? raw.projectId ?? defaultProjectId).trim();
  if (!projectId || !/^[a-z0-9-]+$/u.test(projectId)) {
    throw new Error(`Invalid Firebase projectId: ${projectId}`);
  }

  const authDomain = (
    process.env.FIREBASE_AUTH_DOMAIN ??
    raw.authDomain ??
    `${projectId}.firebaseapp.com`
  ).trim();

  const storageBucket = (
    process.env.FIREBASE_STORAGE_BUCKET ??
    raw.storageBucket ??
    `${projectId}.firebasestorage.app`
  ).trim();

  const databaseId = (process.env.FIREBASE_DATABASE_ID ?? raw.databaseId ?? "(default)").trim();

  const apiKey = (process.env.FIREBASE_API_KEY ?? raw.apiKey ?? "").trim();
  const appId = (process.env.FIREBASE_APP_ID ?? raw.appId ?? "").trim();

  return {
    schemaVersion: 1,
    projectId,
    authDomain,
    storageBucket,
    databaseId,
    apiKey,
    ...(appId ? { appId } : {}),
  };
}

export function resolveWorkerIdentity(customWorkerId?: string): WorkerIdentity {
  const host =
    hostname()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48) || "mac";
  const cpuArch = arch();
  const workerId = (customWorkerId ?? process.env.SHORTS_WORKER_ID ?? `mac-${host}-${cpuArch}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .slice(0, 80);

  return {
    workerId,
    hostname: hostname(),
    arch: cpuArch,
  };
}
