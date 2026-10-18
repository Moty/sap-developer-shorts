import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = "demo-sap-shorts-private";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const admin = getAuth(initializeApp({ projectId }, "private-integration"));
const base = "http://127.0.0.1:5890";
const password = "Only-for-local-emulators-4387!";
async function authRequest(method: string, data: unknown) {
  const response = await fetch(
    `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) },
  );
  return { response, data: await response.json() };
}
async function account(email: string) {
  let result = await authRequest("signUp", { email, password, returnSecureToken: true });
  if (!result.response.ok)
    result = await authRequest("signInWithPassword", { email, password, returnSecureToken: true });
  assert.ok(result.response.ok);
  const unverified = await fetch(`${base}/v1/bootstrap`, {
    method: "POST",
    headers: { authorization: `Bearer ${result.data.idToken}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!result.data.emailVerified) assert.ok([200, 403].includes(unverified.status));
  await admin.updateUser(result.data.localId, { emailVerified: true });
  const verified = await authRequest("signInWithPassword", {
    email,
    password,
    returnSecureToken: true,
  });
  return verified.data.idToken as string;
}
async function api(token: string, path: string, data?: unknown, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { response, data: await response.json() };
}
const temporary = await authRequest("signUp", {
  email: `uninvited-${randomUUID()}@example.test`,
  password,
  returnSecureToken: true,
});
assert.ok(temporary.response.ok);
try {
  const unverified = await api(temporary.data.idToken, "/v1/bootstrap", {});
  assert.equal(unverified.response.status, 403);
  assert.equal(unverified.data.code, "EMAIL_UNVERIFIED");
  await admin.updateUser(temporary.data.localId, { emailVerified: true });
  const verified = await authRequest("signInWithPassword", {
    email: temporary.data.email,
    password,
    returnSecureToken: true,
  });
  const uninvited = await api(verified.data.idToken, "/v1/bootstrap", {});
  assert.equal(uninvited.response.status, 403);
  assert.equal(uninvited.data.code, "ACCESS_PENDING");
  await admin.updateUser(temporary.data.localId, { disabled: true });
  assert.equal((await api(verified.data.idToken, "/v1/me")).response.status, 401);
} finally {
  await admin.deleteUser(temporary.data.localId);
}
const owner = await account("creator@example.test"),
  other = await account("second@example.test");
const bootstrap = await api(owner, "/v1/bootstrap", {});
assert.equal(bootstrap.response.status, 200, JSON.stringify(bootstrap.data));
await api(other, "/v1/bootstrap", {});
const tenantId = bootstrap.data.tenantId;
const templates = await api(owner, "/v1/templates");
assert.equal(templates.response.status, 200, JSON.stringify(templates.data));
const saved = await api(owner, `/v1/workspaces/${tenantId}/episodes`, {
  episode: templates.data.find((item: { selector: string }) => item.selector === "CAP-01@casual-v2")
    .episode,
  expectedRevision: null,
});
assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
const denied = await api(other, `/v1/workspaces/${tenantId}/episodes`);
assert.equal(denied.response.status, 404);
const forged = await fetch(`${base}/v1/me`, { headers: { authorization: "Bearer not-a-token" } });
assert.equal(forged.status, 401);
const anonymous = await fetch(`${base}/v1/workspaces/${tenantId}/episodes`);
assert.equal(anonymous.status, 401);
const directory = resolve(".state/private-tests");
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(directory, "session.json"),
  JSON.stringify({
    origin: base,
    owner,
    other,
    tenantId,
    episodeId: saved.data.id,
    revision: saved.data.revision,
  }),
  { mode: 0o600 },
);
console.log(
  "PASS: real Auth + Firestore emulator login, bootstrap, draft save; unverified/uninvited/disabled, cross-user, forged and anonymous access denied.",
);
console.log(
  "Synthetic UI account: creator@example.test (password is the emulator-only fixture in this script).",
);
console.log(`Created synthetic draft ${saved.data.id}.`);
