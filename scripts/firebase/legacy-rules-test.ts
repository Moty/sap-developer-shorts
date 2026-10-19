import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { toFirestoreFields } from "../../src/firebase/rest-client.js";

const projectId = "demo-sap-shorts-legacy";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
assert.ok(authHost && firestoreHost && storageHost, "Firebase emulator endpoints are required");

const auth = getAuth(initializeApp({ projectId }, "legacy-rules-test"));
async function authRequest(method: string, data: unknown) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  const body = (await response.json()) as Record<string, string>;
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

const anonymous = await authRequest("signUp", { returnSecureToken: true });
const editorPassword = "Only-for-local-rules-test-4387!";
const editor = await authRequest("signUp", {
  email: "editor@sap.com",
  password: editorPassword,
  returnSecureToken: true,
});
await auth.updateUser(String(editor.localId), { emailVerified: true });
await auth.setCustomUserClaims(String(editor.localId), { role: "editor" });
const authorized = await authRequest("signInWithPassword", {
  email: "editor@sap.com",
  password: editorPassword,
  returnSecureToken: true,
});

const firestoreBase = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
async function writeDocument(path: string, data: Record<string, unknown>, token?: string) {
  return fetch(`${firestoreBase}/${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
}

const timestamp = new Date().toISOString();
const writes = [
  {
    path: "episodes/CAP-01",
    data: {
      schemaVersion: 1,
      id: "CAP-01",
      version: 1,
      title: "Authorized fixture",
      audience: "Developers",
      language: "en",
      targetDurationSeconds: 45,
      sources: [{ url: "https://example.test" }],
      scenes: [{ id: "scene-1" }],
      publication: { channel: "test", text: "fixture" },
    },
  },
  {
    path: "episodes/CAP-01/variants/secure",
    data: {
      schemaVersion: 1,
      baseEpisodeId: "CAP-01",
      baseInputHash: "fixture-hash",
      title: "Authorized variant",
      presentation: {
        tone: "casual",
        format: "explainer",
        humor: "light",
        speakers: [{ id: "mira" }],
        variant: "secure",
      },
      scenes: [{ id: "scene-1" }],
    },
  },
  {
    path: "productions/job-1",
    data: {
      schemaVersion: 1,
      id: "job-1",
      selector: "CAP-01@secure",
      stage: "PENDING",
      startedAt: timestamp,
      updatedAt: timestamp,
      createdBy: editor.localId,
    },
  },
  {
    path: "workflow/CAP-01--secure",
    data: {
      selector: "CAP-01@secure",
      renderKey: "render-hash",
      inputHash: "input-hash",
      videoHash: "video-hash",
    },
  },
  {
    path: "avatars/portrait.png",
    data: { imageId: "portrait.png", sha256: "avatar-hash" },
  },
  {
    path: "auditions/audition-1",
    data: { id: "audition-1", text: "Hello", voice: "af_heart", status: "PENDING" },
  },
  {
    path: "workers/worker-1",
    data: {
      workerId: "worker-1",
      hostname: "test-mac",
      status: "ONLINE",
      lastHeartbeatAt: timestamp,
    },
  },
];

for (const fixture of writes) {
  assert.equal((await writeDocument(fixture.path, fixture.data)).status, 403, fixture.path);
  assert.equal(
    (await writeDocument(fixture.path, fixture.data, anonymous.idToken)).status,
    403,
    fixture.path,
  );
  const allowed = await writeDocument(fixture.path, fixture.data, authorized.idToken);
  assert.equal(allowed.ok, true, `${fixture.path}: ${allowed.status} ${await allowed.text()}`);
}

const storageBase = `http://${storageHost}/v0/b/${projectId}.appspot.com/o`;
async function upload(path: string, contentType: string, token?: string) {
  return fetch(`${storageBase}?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: new Uint8Array([1, 2, 3, 4]),
  });
}

assert.equal((await upload("avatars/portrait.png", "image/png")).status, 403);
assert.equal((await upload("avatars/portrait.png", "image/png", anonymous.idToken)).status, 403);
assert.equal((await upload("avatars/portrait.png", "text/plain", authorized.idToken)).status, 403);
assert.equal((await upload("avatars/portrait.png", "image/png", authorized.idToken)).ok, true);
assert.equal(
  (await upload("private/secret.bin", "application/octet-stream", authorized.idToken)).status,
  403,
);
assert.equal((await upload("episodes/CAP-01/short.mp4", "video/mp4", authorized.idToken)).ok, true);
const publicMedia = await fetch(
  `${storageBase}/${encodeURIComponent("episodes/CAP-01/short.mp4")}?alt=media`,
);
assert.equal(publicMedia.ok, true);

console.log(
  "PASS: legacy rules deny anonymous and ordinary authenticated mutations, allow authorized editor writes on explicit paths, keep public exported media readable, and deny the bucket catch-all.",
);
