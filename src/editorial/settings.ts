import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { projectRoot, repositoryRoot } from "../paths.js";

const exec = promisify(execFile);
export type WritingProvider = "local" | "hyperspace";
export interface WritingSettings {
  schemaVersion: 1;
  provider: WritingProvider;
  local: { baseUrl: string; model: string };
  hyperspace: { baseUrl: string; model: string };
  outputTokens: { writing: number | null; finalReview: number | null };
}
export const defaultWritingSettings: WritingSettings = {
  schemaVersion: 1,
  provider: "local",
  local: { baseUrl: "http://127.0.0.1:1234/v1", model: "gemma-4-31b-it" },
  hyperspace: { baseUrl: "http://127.0.0.1:6655/litellm/v1", model: "" },
  outputTokens: { writing: 8192, finalReview: 16384 },
};
export const editorialRoot = resolve(projectRoot, ".state/editorial");

/** No external URL, redirects, URL credentials or custom proxy route. */
export function writingBaseUrl(value: unknown, provider: WritingProvider): string {
  if (typeof value !== "string" || value.length > 200)
    throw new Error("Use the local writing service's HTTP address.");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/u, "") !== (provider === "local" ? "/v1" : "/litellm/v1")
  )
    throw new Error(
      "Writing services must use localhost: LM Studio /v1 or Hyperspace /litellm/v1.",
    );
  // Resolve the special localhost spelling ourselves; never use a DNS result for it.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.href.replace(/\/$/u, "");
}

export function parseWritingSettings(value: unknown): WritingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a writing provider and model.");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["schemaVersion", "provider", "local", "hyperspace", "outputTokens"].includes(key),
    ) ||
    input.schemaVersion !== 1 ||
    !["local", "hyperspace"].includes(input.provider as string)
  )
    throw new Error("Choose a supported writing provider.");
  const result = structuredClone(defaultWritingSettings);
  result.provider = input.provider as WritingProvider;
  // Older saved settings inherit the new defaults until explicitly saved.
  if (input.outputTokens !== undefined) {
    const budgets = input.outputTokens as Record<string, unknown> | null;
    if (
      !budgets ||
      typeof budgets !== "object" ||
      Array.isArray(budgets) ||
      Object.keys(budgets).some((key) => !["writing", "finalReview"].includes(key))
    )
      throw new Error("Choose writing and final-review response budgets.");
    for (const task of ["writing", "finalReview"] as const) {
      const budget = budgets[task];
      if (
        budget !== null &&
        (typeof budget !== "number" ||
          !Number.isSafeInteger(budget) ||
          budget < 256 ||
          budget > 131072)
      )
        throw new Error("Response budgets must be 256–131,072 tokens, or provider default.");
      result.outputTokens[task] = budget as number | null;
    }
  }
  for (const provider of ["local", "hyperspace"] as const) {
    const item = input[provider] as Record<string, unknown> | undefined;
    if (
      !item ||
      Object.keys(item).some((key) => !["baseUrl", "model"].includes(key)) ||
      typeof item.model !== "string" ||
      item.model.length > 200 ||
      /\p{Cc}/u.test(item.model)
    )
      throw new Error("Use an exact model ID from the writing service.");
    result[provider] = { baseUrl: writingBaseUrl(item.baseUrl, provider), model: item.model };
  }
  return result;
}

export async function readWritingSettings(directory = editorialRoot): Promise<WritingSettings> {
  try {
    return parseWritingSettings(
      JSON.parse(await readFile(resolve(directory, "settings.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return structuredClone(defaultWritingSettings);
    throw new Error("Writing settings could not be read. Save them again in Writing setup.");
  }
}
export async function saveWritingSettings(value: unknown, directory = editorialRoot) {
  const settings = parseWritingSettings(value);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "settings.json");
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return settings;
}

export interface WritingSecrets {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}
function validateKey(value: string) {
  if (!value.trim() || value.length > 4096 || /\p{Cc}/u.test(value))
    throw new Error("Enter the API key from your Hyperspace AI proxy.");
  return value.trim();
}
async function keychain(action: "put" | "get" | "delete", value = "") {
  if (process.platform !== "darwin")
    throw new Error("Use SHORTS_HYPERSPACE_API_KEY on this operating system.");
  const helper = process.env.SHORTS_KEYCHAIN_HELPER;
  const task = exec(
    helper ?? "/usr/bin/swift",
    helper
      ? [action, "editorial-hyperspace"]
      : [resolve(repositoryRoot, "scripts/private/keychain.swift"), action, "editorial-hyperspace"],
    {
      timeout: 30_000,
      maxBuffer: 8192,
      env: {
        ...process.env,
        DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? "/Library/Developer/CommandLineTools",
      },
    },
  );
  task.child.stdin?.end(value);
  try {
    return (await task).stdout.trim();
  } catch {
    throw new Error("The writing credential could not be accessed in macOS Keychain.");
  }
}
export const writingSecrets: WritingSecrets = {
  async get() {
    if (process.env.SHORTS_HYPERSPACE_API_KEY)
      return validateKey(process.env.SHORTS_HYPERSPACE_API_KEY);
    try {
      return (await keychain("get")) || undefined;
    } catch {
      return undefined;
    }
  },
  async set(value) {
    await keychain("put", validateKey(value));
  },
  async remove() {
    await keychain("delete");
  },
};
