import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { hash } from "../digest.js";
import type { FirebaseClientConfig } from "./config.js";

export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export interface FirestoreRawDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export interface StorageUploadResult {
  readonly storagePath: string;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface FirebaseCloudStore {
  getDocument<T extends Record<string, unknown> = Record<string, unknown>>(
    collectionPath: string,
    documentId: string,
  ): Promise<T | null>;
  setDocument(
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
    options?: { mergeFields?: readonly string[] },
  ): Promise<void>;
  listDocuments<T extends Record<string, unknown> = Record<string, unknown>>(
    collectionPath: string,
  ): Promise<Array<{ id: string; data: T }>>;
  deleteDocument(collectionPath: string, documentId: string): Promise<void>;
  uploadStorageObject(
    storagePath: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<StorageUploadResult>;
  downloadStorageObject(storagePath: string): Promise<Buffer | null>;
}

export function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    if (Number.isSafeInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    const values = value.filter((item) => item !== undefined).map((item) => toFirestoreValue(item));
    return { arrayValue: values.length ? { values } : {} };
  }
  if (typeof value === "object") {
    const fields = toFirestoreFields(value as Record<string, unknown>);
    return { mapValue: Object.keys(fields).length ? { fields } : {} };
  }
  return { stringValue: String(value) };
}

export function toFirestoreFields(record: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, val] of Object.entries(record)) {
    if (val === undefined) continue;
    fields[key] = toFirestoreValue(val);
  }
  return fields;
}

export function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || "nullValue" in value) return null;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map((item) => fromFirestoreValue(item));
  }
  if ("mapValue" in value) {
    return fromFirestoreFields(value.mapValue.fields);
  }
  return null;
}

export function fromFirestoreFields<T extends Record<string, unknown> = Record<string, unknown>>(
  fields: Record<string, FirestoreValue> | undefined,
): T {
  const result: Record<string, unknown> = {};
  if (!fields) return result as T;
  for (const [key, val] of Object.entries(fields)) {
    result[key] = fromFirestoreValue(val);
  }
  return result as T;
}

export function encodeFirestoreDocId(id: string): string {
  // Firestore document IDs cannot contain forward slashes; encode '@' and '/' safely if needed.
  return encodeURIComponent(id);
}

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

let cachedAuthToken: TokenCache | null = null;

export async function resolveFirebaseAccessToken(
  config: FirebaseClientConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const explicit =
    process.env.FIREBASE_ACCESS_TOKEN?.trim() || process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
  if (explicit) return explicit;

  if (cachedAuthToken && cachedAuthToken.expiresAtMs - Date.now() > 60_000) {
    return cachedAuthToken.token;
  }

  // 1. Check Firebase CLI configstore (~/.config/configstore/firebase-tools.json)
  try {
    const cliConfigPath = resolve(homedir(), ".config/configstore/firebase-tools.json");
    const cliData = JSON.parse(await readFile(cliConfigPath, "utf8")) as {
      tokens?: { access_token?: string; expires_at?: number };
    };
    const accessToken = cliData.tokens?.access_token;
    const expiresAt = Number(cliData.tokens?.expires_at ?? 0);
    if (accessToken && (!expiresAt || expiresAt - Date.now() > 60_000)) {
      cachedAuthToken = {
        token: accessToken,
        expiresAtMs: expiresAt || Date.now() + 1800_000,
      };
      return accessToken;
    }
  } catch {
    /* ignore missing firebase-tools configstore */
  }

  // 2. Check Google Application Default Credentials refresh token
  try {
    const adcPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      resolve(homedir(), ".config/gcloud/application_default_credentials.json");
    const adc = JSON.parse(await readFile(adcPath, "utf8")) as {
      client_id?: string;
      client_secret?: string;
      refresh_token?: string;
      type?: string;
    };
    if (adc.type === "authorized_user" && adc.client_id && adc.client_secret && adc.refresh_token) {
      const response = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: adc.client_id,
          client_secret: adc.client_secret,
          refresh_token: adc.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        if (payload.access_token) {
          cachedAuthToken = {
            token: payload.access_token,
            expiresAtMs: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
          };
          return payload.access_token;
        }
      }
    }
  } catch {
    /* ignore missing ADC */
  }

  // 3. Fallback: Firebase Anonymous Auth via Identity Toolkit if apiKey is configured
  if (config.apiKey) {
    try {
      const response = await fetchImpl(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(config.apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ returnSecureToken: true }),
        },
      );
      if (response.ok) {
        const payload = (await response.json()) as {
          idToken?: string;
          expiresIn?: string;
        };
        if (payload.idToken) {
          cachedAuthToken = {
            token: payload.idToken,
            expiresAtMs: Date.now() + Number(payload.expiresIn ?? 3600) * 1000,
          };
          return payload.idToken;
        }
      }
    } catch {
      /* ignore anonymous auth error */
    }
  }

  return null;
}

export class RestFirebaseCloudStore implements FirebaseCloudStore {
  private readonly config: FirebaseClientConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: FirebaseClientConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private get baseFirestoreUrl(): string {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/${encodeURIComponent(this.config.databaseId)}/documents`;
  }

  private async authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await resolveFirebaseAccessToken(this.config, this.fetchImpl);
    return {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  private documentUrl(collectionPath: string, documentId: string): string {
    const cleanCollection = collectionPath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const cleanId = encodeFirestoreDocId(documentId);
    const url = new URL(`${this.baseFirestoreUrl}/${cleanCollection}/${cleanId}`);
    if (this.config.apiKey) url.searchParams.set("key", this.config.apiKey);
    return url.toString();
  }

  private collectionUrl(collectionPath: string): string {
    const cleanCollection = collectionPath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = new URL(`${this.baseFirestoreUrl}/${cleanCollection}`);
    url.searchParams.set("pageSize", "200");
    if (this.config.apiKey) url.searchParams.set("key", this.config.apiKey);
    return url.toString();
  }

  async getDocument<T extends Record<string, unknown> = Record<string, unknown>>(
    collectionPath: string,
    documentId: string,
  ): Promise<T | null> {
    const response = await this.fetchImpl(this.documentUrl(collectionPath, documentId), {
      method: "GET",
      headers: await this.authHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Firestore GET ${collectionPath}/${documentId} failed (${response.status}): ${text.slice(0, 240)}`,
      );
    }
    const raw = (await response.json()) as FirestoreRawDocument;
    return fromFirestoreFields<T>(raw.fields);
  }

  async setDocument(
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
    options: { mergeFields?: readonly string[] } = {},
  ): Promise<void> {
    const url = new URL(this.documentUrl(collectionPath, documentId));
    if (options.mergeFields?.length) {
      for (const field of options.mergeFields) {
        url.searchParams.append("updateMask.fieldPaths", field);
      }
    }
    const response = await this.fetchImpl(url.toString(), {
      method: "PATCH",
      headers: await this.authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Firestore PATCH ${collectionPath}/${documentId} failed (${response.status}): ${text.slice(0, 240)}`,
      );
    }
  }

  async listDocuments<T extends Record<string, unknown> = Record<string, unknown>>(
    collectionPath: string,
  ): Promise<Array<{ id: string; data: T }>> {
    const response = await this.fetchImpl(this.collectionUrl(collectionPath), {
      method: "GET",
      headers: await this.authHeaders(),
    });
    if (response.status === 404) return [];
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Firestore LIST ${collectionPath} failed (${response.status}): ${text.slice(0, 240)}`,
      );
    }
    const payload = (await response.json()) as {
      documents?: FirestoreRawDocument[];
    };
    return (payload.documents ?? []).map((doc) => {
      const rawName = doc.name ?? "";
      const lastSegment = rawName.slice(rawName.lastIndexOf("/") + 1);
      return {
        id: decodeURIComponent(lastSegment),
        data: fromFirestoreFields<T>(doc.fields),
      };
    });
  }

  async deleteDocument(collectionPath: string, documentId: string): Promise<void> {
    const response = await this.fetchImpl(this.documentUrl(collectionPath, documentId), {
      method: "DELETE",
      headers: await this.authHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Firestore DELETE ${collectionPath}/${documentId} failed (${response.status}): ${text.slice(0, 240)}`,
      );
    }
  }

  async uploadStorageObject(
    storagePath: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<StorageUploadResult> {
    const cleanPath = storagePath.replace(/^\/+/u, "");
    const encodedName = encodeURIComponent(cleanPath);
    const uploadUrl = new URL(
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.config.storageBucket)}/o`,
    );
    uploadUrl.searchParams.set("uploadType", "media");
    uploadUrl.searchParams.set("name", cleanPath);
    if (this.config.apiKey) uploadUrl.searchParams.set("key", this.config.apiKey);

    const sha256 = hash(bytes);
    const response = await this.fetchImpl(uploadUrl.toString(), {
      method: "POST",
      headers: await this.authHeaders({
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
      }),
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Firebase Storage upload ${cleanPath} failed (${response.status}): ${text.slice(0, 240)}`,
      );
    }
    const meta = (await response.json().catch(() => ({}))) as {
      downloadTokens?: string;
    };
    const tokenSuffix = meta.downloadTokens
      ? `&token=${encodeURIComponent(meta.downloadTokens.split(",")[0] ?? "")}`
      : "";
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.config.storageBucket)}/o/${encodedName}?alt=media${tokenSuffix}`;
    return {
      storagePath: cleanPath,
      downloadUrl,
      sha256,
      byteLength: bytes.byteLength,
    };
  }

  async downloadStorageObject(storagePath: string): Promise<Buffer | null> {
    const cleanPath = storagePath.replace(/^\/+/u, "");
    const encodedName = encodeURIComponent(cleanPath);
    const downloadUrl = new URL(
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.config.storageBucket)}/o/${encodedName}`,
    );
    downloadUrl.searchParams.set("alt", "media");
    if (this.config.apiKey) downloadUrl.searchParams.set("key", this.config.apiKey);

    const response = await this.fetchImpl(downloadUrl.toString(), {
      method: "GET",
      headers: await this.authHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Firebase Storage download ${cleanPath} failed (${response.status}): ${text.slice(0, 240)}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export class InMemoryFirebaseCloudStore implements FirebaseCloudStore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly blobs = new Map<
    string,
    { bytes: Buffer; contentType: string; sha256: string }
  >();

  async getDocument<T extends Record<string, unknown> = Record<string, unknown>>(
    collectionPath: string,
    documentId: string,
  ): Promise<T | null> {
    const col = this.collections.get(collectionPath);
    const doc = col?.get(documentId);
    if (!doc) return null;
    return fromFirestoreFields<T>(toFirestoreFields(doc));
  }

  async setDocument(
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
    options: { mergeFields?: readonly string[] } = {},
  ): Promise<void> {
    let col = this.collections.get(collectionPath);
    if (!col) {
      col = new Map();
      this.collections.set(collectionPath, col);
    }
    const roundtripped = fromFirestoreFields(toFirestoreFields(data));
    const existing = col.get(documentId) ?? {};
    if (options.mergeFields?.length) {
      const next = { ...existing };
      for (const field of options.mergeFields) {
        if (field in roundtripped) next[field] = roundtripped[field];
        else delete next[field];
      }
      col.set(documentId, next);
    } else {
      col.set(documentId, roundtripped);
    }
  }

  async listDocuments<T extends Record<string, unknown> = Record<string, unknown>>(
    collectionPath: string,
  ): Promise<Array<{ id: string; data: T }>> {
    const col = this.collections.get(collectionPath);
    if (!col) return [];
    return [...col.entries()].map(([id, data]) => ({
      id,
      data: fromFirestoreFields<T>(toFirestoreFields(data)),
    }));
  }

  async deleteDocument(collectionPath: string, documentId: string): Promise<void> {
    this.collections.get(collectionPath)?.delete(documentId);
  }

  async uploadStorageObject(
    storagePath: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<StorageUploadResult> {
    const cleanPath = storagePath.replace(/^\/+/u, "");
    const sha256 = hash(bytes);
    const copy = Buffer.from(bytes);
    this.blobs.set(cleanPath, { bytes: copy, contentType, sha256 });
    return {
      storagePath: cleanPath,
      downloadUrl: `https://storage.local/sap-shorts-160871/${encodeURIComponent(cleanPath)}?token=${randomUUID()}`,
      sha256,
      byteLength: copy.byteLength,
    };
  }

  async downloadStorageObject(storagePath: string): Promise<Buffer | null> {
    const cleanPath = storagePath.replace(/^\/+/u, "");
    const found = this.blobs.get(cleanPath);
    return found ? Buffer.from(found.bytes) : null;
  }
}
