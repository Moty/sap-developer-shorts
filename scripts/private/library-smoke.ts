import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { encodePcmWav } from "../../src/media/audio.js";

const session = JSON.parse(await readFile(".state/private-tests/session.json", "utf8"));
if (session.origin !== "http://127.0.0.1:5890") throw new Error("Loopback demo only.");
const config = await (await fetch(`${session.origin}/v1/config`)).json();
if (config.projectId !== "demo-sap-shorts-private") throw new Error("Demo project only.");
async function request(path: string, body?: unknown, method = "POST", token = session.other) {
  const response = await fetch(`${session.origin}${path}`, {
    method: body === undefined ? "GET" : method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
const account = await request("/v1/me");
assert.equal(account.status, 200);
const root = `/v1/workspaces/${account.data.workspace.id}`;
const photoIds: string[] = [];
let voiceId: string | null = null;
try {
  for (const color of ["#264e65", "#97724b"]) {
    const canvas = createCanvas(256, 256),
      context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = "#e3d4bb";
    context.beginPath();
    context.arc(128, 90, 45, 0, Math.PI * 2);
    context.fill();
    context.fillRect(73, 150, 110, 106);
    const response = await fetch(`${session.origin}${root}/assets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.other}`,
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array(await canvas.encode("png")),
    });
    assert.equal(response.status, 201, await response.clone().text());
    const asset = await response.json();
    photoIds.push(asset.id);
    assert.equal(
      (
        await request(
          `${root}/assets/${asset.id}`,
          { name: `Synthetic presenter · look ${photoIds.length}` },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(`${root}/assets/${asset.id}`, undefined, "GET", session.owner)).status,
      404,
    );
  }
  // A synthetic tone verifies enrollment storage; this is never a real speaker or a naturalness test.
  const pcm = Buffer.alloc(4 * 22050 * 2);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(5000 * Math.sin((i * 2 * Math.PI * 180) / 22050)), i * 2);
  const response = await fetch(`${session.origin}${root}/voices`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.other}`,
      "content-type": "application/octet-stream",
      "x-voice-metadata": Buffer.from(
        JSON.stringify({
          name: "Photo library · synthetic fixture",
          transcript: "Synthetic fixture only.",
          consent: true,
          allowMac: true,
          trustedMacPool: true,
          endSeconds: 4,
        }),
      ).toString("base64"),
    },
    body: new Uint8Array(encodePcmWav(pcm)),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const voice = await response.json();
  voiceId = voice.id;
  const links = {
    portraitIds: photoIds,
    defaultPortraitId: photoIds[1],
    expectedPortraitRevision: null,
  };
  const linked = await request(`${root}/voices/${voiceId}`, links, "PATCH");
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.revision, voice.revision);
  assert.deepEqual(linked.data.portraitIds, photoIds);
  assert.equal((await request(`${root}/voices/${voiceId}`, links, "PATCH")).status, 409);
  assert.equal(
    (await request(`${root}/voices/${voiceId}`, links, "PATCH", session.owner)).status,
    404,
  );
  assert.equal(
    (await request(`${root}/assets/${photoIds[0]}`, { archived: true }, "PATCH")).status,
    200,
  );
  const privatePhoto = await fetch(`${session.origin}${root}/assets/${photoIds[0]}`, {
    headers: { authorization: `Bearer ${session.other}` },
  });
  assert.equal(privatePhoto.status, 200);
  assert.ok((await privatePhoto.arrayBuffer()).byteLength > 0);
  assert.equal(
    (await request(`${root}/assets/${photoIds[0]}`, { archived: false }, "PATCH")).status,
    200,
  );
  const templates = await request("/v1/templates");
  const episode = structuredClone(
    templates.data.find((item: { selector: string }) => item.selector === "CAP-01@casual-v2")
      .episode,
  );
  episode.title = "Photo library · synthetic editor test";
  episode.presentation.speakers[0].voice = {
    kind: "workspace-voice",
    tenantId: account.data.workspace.id,
    profileId: voiceId,
    revision: voice.revision,
  };
  episode.presentation.speakers[0].avatar = {
    mode: "photo",
    imageId: `${photoIds[1]}.png`,
    animation: "mouth-only",
  };
  const draft = await request(`${root}/episodes`, { episode, expectedRevision: null });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  await writeFile(
    ".state/private-tests/library.json",
    JSON.stringify({
      tenantId: account.data.workspace.id,
      voiceId,
      photoIds,
      episodeId: draft.data.id,
    }),
    { mode: 0o600 },
  );
  console.log(
    "PASS: private photo upload/rename, multiple voice links/default, revision conflict, cross-account denial, archive/restore and saved episode photo.",
  );
} finally {
  if (process.env.SHORTS_TEST_KEEP_LIBRARY !== "1") {
    for (const id of photoIds)
      assert.equal(
        (await request(`${root}/assets/${id}`, { archived: true }, "PATCH")).status,
        200,
      );
    if (voiceId)
      assert.equal((await request(`${root}/voices/${voiceId}`, {}, "DELETE")).status, 200);
  }
}
