import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const directory = resolve(homedir(), "Library/Application Support/SAP Shorts/worker");
const configuration = resolve(directory, "device.json");

import { repositoryRoot } from "../paths.js";

async function keychain(action: string, workerId: string, credential?: string) {
  const operation = exec(
    "/usr/bin/swift",
    [resolve(repositoryRoot, "scripts/private/keychain.swift"), action, workerId],
    {
      timeout: 30_000,
      env: {
        ...process.env,
        DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? "/Library/Developer/CommandLineTools",
      },
    },
  );
  operation.child.stdin?.end(credential ?? "");
  return operation;
}
export interface DeviceConfig {
  origin: string;
  workerId: string;
  tenantId: string;
  expiresAt: number;
}
export async function saveDevice(config: DeviceConfig, credential: string) {
  if (process.platform !== "darwin")
    throw new Error("Paired Mac credentials require macOS Keychain.");
  await keychain("put", config.workerId, credential);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(configuration, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configuration, 0o600);
}
export async function loadDevice() {
  const config = JSON.parse(await readFile(configuration, "utf8")) as DeviceConfig;
  const { stdout } = await keychain("get", config.workerId);
  return { config, credential: stdout.trim() };
}
export async function removeDevice() {
  const { config } = await loadDevice();
  await keychain("delete", config.workerId);
  const { rm } = await import("node:fs/promises");
  await rm(configuration, { force: true });
}
