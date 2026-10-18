import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";

const session = JSON.parse(await readFile(".state/private-tests/session.json", "utf8"));
const png = await createCanvas(512, 512).encode("png");
const saved = await fetch(`${session.origin}/v1/workspaces/${session.tenantId}/assets`, {
  method: "POST",
  headers: { authorization: `Bearer ${session.owner}`, "content-type": "application/octet-stream" },
  body: new Uint8Array(png),
});
assert.equal(saved.status, 201, await saved.clone().text());
const asset = await saved.json();
const storagePath = encodeURIComponent(`tenants/${session.tenantId}/assets/${asset.id}/data`);
for (const token of [null, session.owner, session.other]) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const firestore = `http://127.0.0.1:8080/v1/projects/demo-sap-shorts-private/databases/(default)/documents/tenants/${session.tenantId}`;
  assert.equal((await fetch(firestore, { headers })).status, 403);
  assert.equal(
    (
      await fetch(`${firestore}/members/forged`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ fields: { role: { stringValue: "owner" } } }),
      })
    ).status,
    403,
  );
  const storage = `http://127.0.0.1:9199/v0/b/demo-sap-shorts-private.appspot.com/o`;
  assert.equal((await fetch(`${storage}/${storagePath}?alt=media`, { headers })).status, 403);
  assert.equal(
    (
      await fetch(
        `${storage}?uploadType=media&name=${encodeURIComponent(`tenants/${session.tenantId}/forged.wav`)}`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "audio/wav" },
          body: new Uint8Array([1, 2, 3]),
        },
      )
    ).status,
    403,
  );
}
console.log(
  "PASS: existing private Firestore and Storage objects deny direct reads/writes for anonymous, owner, and unrelated accounts.",
);
