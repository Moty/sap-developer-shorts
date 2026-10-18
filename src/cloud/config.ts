import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CloudProviderConfig } from "./cloud-dispatch.js";
import { fail, object, text } from "./contracts.js";

export interface PrivateConfig {
  projectId: string;
  storageBucket: string;
  apiKey: string;
  authDomain: string;
  appId: string;
  origin: string;
  pilotEmails: string[];
  port: number;
  emulator: boolean;
  authEmulator: string;
  firestoreEmulator: string;
  storageEmulator: string;
  cloud?: CloudProviderConfig;
}
export async function loadPrivateConfig(path = process.env.SHORTS_PRIVATE_CONFIG) {
  if (!path)
    fail(
      500,
      "CONFIG_REQUIRED",
      "Set SHORTS_PRIVATE_CONFIG to an explicit private workspace configuration.",
    );
  const raw = object(JSON.parse(await readFile(resolve(path), "utf8")));
  const projectId = text(raw.projectId, "project ID");
  const emulator = raw.emulator === true;
  if (emulator && !projectId.startsWith("demo-"))
    fail(500, "UNSAFE_CONFIG", "Emulator mode requires a demo- project ID.");
  const origin = new URL(text(raw.origin, "studio origin", 300));
  if (
    origin.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  )
    fail(500, "UNSAFE_CONFIG", "Private studio requires HTTPS outside loopback emulators.");
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
    fail(500, "UNSAFE_CONFIG", "Configure an origin without a path or credentials.");
  const endpoint = (key: string, fallback: string) => {
    const value = String(raw[key] ?? fallback);
    if (!/^(127\.0\.0\.1|localhost):[0-9]{4,5}$/u.test(value))
      fail(500, "UNSAFE_CONFIG", "Emulators must be bound to loopback.");
    return value;
  };
  const config: PrivateConfig = {
    projectId,
    storageBucket: text(raw.storageBucket, "storage bucket"),
    apiKey: text(raw.apiKey, "Firebase API key", 200),
    authDomain: text(raw.authDomain, "Auth domain", 200),
    appId: text(raw.appId, "app ID", 200),
    origin: origin.origin,
    pilotEmails: Array.isArray(raw.pilotEmails)
      ? raw.pilotEmails.map((email) => text(email, "pilot email", 254).toLowerCase())
      : [],
    port: Number(raw.port ?? 5890),
    emulator,
    authEmulator: endpoint("authEmulator", "127.0.0.1:9099"),
    firestoreEmulator: endpoint("firestoreEmulator", "127.0.0.1:8080"),
    storageEmulator: endpoint("storageEmulator", "127.0.0.1:9199"),
  };
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535)
    fail(500, "UNSAFE_CONFIG", "Invalid server port.");
  if (raw.cloud) {
    const cloud = object(raw.cloud);
    if (cloud.enabled === true) {
      if (emulator)
        fail(
          500,
          "UNSAFE_CONFIG",
          "Paid cloud dispatch is never enabled by the emulator configuration.",
        );
      const jobName = text(cloud.jobName, "cloud job resource", 300);
      const runtimeDigest = text(cloud.runtimeDigest, "cloud image runtime digest", 64);
      const budgetCents = Number(cloud.budgetCents),
        attemptCents = Number(cloud.attemptCents);
      if (
        !jobName.startsWith(`projects/${projectId}/locations/`) ||
        !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/u.test(jobName) ||
        !/^[a-f0-9]{64}$/u.test(runtimeDigest) ||
        !Number.isSafeInteger(budgetCents) ||
        !Number.isSafeInteger(attemptCents) ||
        attemptCents < 50 ||
        budgetCents < attemptCents
      )
        fail(
          500,
          "UNSAFE_CONFIG",
          "Configure an approved job, exact runtime digest, and cloud allocation.",
        );
      config.cloud = { jobName, runtimeDigest, budgetCents, attemptCents };
    }
  }
  return config;
}
