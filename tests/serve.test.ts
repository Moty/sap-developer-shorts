import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { startPreviewServer } from "../src/serve.js";

test("the local preview server supports audio byte ranges and confines reads to its artifact", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "sap-shorts-server-"));
  const artifact = resolve(directory, "artifact");
  await mkdir(artifact);
  const bytes = Buffer.from("0123456789");
  await writeFile(resolve(artifact, "narration.wav"), bytes);
  await writeFile(resolve(artifact, "review.html"), "Preview");
  await writeFile(resolve(directory, "outside.json"), "Private test fixture");
  await symlink(resolve(directory, "outside.json"), resolve(artifact, "escape.json"));
  const { server, url } = await startPreviewServer(artifact, 0);
  assert.equal((server.address() as { address: string }).address, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  const audioUrl = new URL("narration.wav", url);
  const partial = await fetch(audioUrl, { headers: { Range: "bytes=2-5" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(partial.headers.get("accept-ranges"), "bytes");
  assert.equal(await partial.text(), "2345");
  const suffix = await fetch(audioUrl, { headers: { Range: "bytes=-3" } });
  assert.equal(await suffix.text(), "789");
  assert.equal((await fetch(audioUrl, { headers: { Range: "bytes=99-100" } })).status, 416);
  assert.equal((await fetch(new URL("escape.json", url))).status, 404);
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
});
