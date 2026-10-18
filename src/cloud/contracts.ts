import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordData = Record<string, unknown>;
export type Role = "owner" | "admin" | "editor" | "viewer";
export type Actor = { uid: string; email: string; authTime: number };
export type Context = Actor & { tenantId: string; role: Role };
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export const id = () => randomUUID();
export const secret = () => randomBytes(32).toString("base64url");
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(digest(a), "hex");
  const y = Buffer.from(digest(b), "hex");
  return timingSafeEqual(x, y);
}
export function object(value: unknown): RecordData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "INVALID_INPUT", "Expected an object.");
  return value as RecordData;
}
export function text(value: unknown, name: string, max = 128) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    fail(400, "INVALID_INPUT", `Enter a valid ${name}.`);
  return value.trim();
}
export function identifier(value: unknown) {
  const result = text(value, "identifier", 100);
  if (!/^[a-zA-Z0-9_-]+$/u.test(result)) fail(400, "INVALID_INPUT", "Invalid identifier.");
  return result;
}
export function permit(context: Context, roles: Role[] = ["owner", "admin", "editor"]) {
  if (!roles.includes(context.role))
    fail(403, "FORBIDDEN", "This action needs a different workspace role.");
}
export const nowIso = (now: number) => new Date(now).toISOString();
export const terminal = (state: string) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(state);
export type Capability = { engine: string; digest: string; voices?: string[] };
export interface Worker extends RecordData {
  id: string;
  tenantId: string;
  name: string;
  providerId: "mac" | "cloud-run";
  registeredBy: string;
  status: "active" | "draining" | "disabled" | "revoked";
  lastSeenAt: number;
  capabilities: Capability[];
  busy: boolean;
  activeJobId: string | null;
  platform: string;
  architecture: string;
}
export type Target = { mode: "mac-pool" | "device" | "cloud"; workerId?: string };
export interface Job extends RecordData {
  id: string;
  tenantId: string;
  createdBy: string;
  kind: "episode" | "audition";
  createdAt: number;
  updatedAt: number;
  state: string;
  stage: string;
  target: Target;
  requirements: Capability[];
  snapshot: RecordData;
  attempt: number;
  workerId: string | null;
  leaseHash: string | null;
  leaseUntil: number;
  startedAt: number | null;
  completedAt: number | null;
  outputIds: string[];
  issue: string | null;
}
export interface Asset extends RecordData {
  id: string;
  tenantId: string;
  ownerId: string;
  kind:
    | "sample"
    | "portrait"
    | "audition"
    | "video"
    | "audio"
    | "captions"
    | "package"
    | "manifest";
  path: string;
  sha256: string;
  size: number;
  contentType: string;
  createdAt: number;
  jobId: string | null;
}
export function workerAvailability(worker: Worker, now: number) {
  if (worker.status !== "active") return worker.status;
  if (!worker.lastSeenAt || now - worker.lastSeenAt > 120_000) return "offline";
  if (now - worker.lastSeenAt > 90_000) return "stale";
  if (worker.busy || worker.activeJobId) return "busy";
  return worker.capabilities.length ? "online" : "setup-required";
}
export function matches(capabilities: Capability[], requirements: Capability[]) {
  return requirements.every((need) =>
    capabilities.some(
      (have) =>
        have.engine === need.engine &&
        (!need.digest || have.digest === need.digest) &&
        (!need.voices || need.voices.every((voice) => have.voices?.includes(voice))),
    ),
  );
}
export function parseCapabilities(value: unknown): Capability[] {
  if (!Array.isArray(value) || value.length > 12)
    fail(400, "INVALID_INPUT", "Invalid worker capabilities.");
  const allowed = ["kokoro", "qwen-mlx", "qwen-cuda", "ditto-mps", "video-compose"];
  return value.map((raw) => {
    const item = object(raw);
    const engine = text(item.engine, "engine", 32);
    const hash = text(item.digest, "runtime digest", 64);
    if (!allowed.includes(engine) || !/^[a-f0-9]{64}$/u.test(hash))
      fail(400, "INVALID_INPUT", "Unsupported runtime.");
    const result: Capability = { engine, digest: hash };
    if (item.voices !== undefined) {
      if (!Array.isArray(item.voices) || item.voices.length > 100)
        fail(400, "INVALID_INPUT", "Invalid voices.");
      result.voices = item.voices.map((voice) => text(voice, "stock voice", 32));
    }
    return result;
  });
}
