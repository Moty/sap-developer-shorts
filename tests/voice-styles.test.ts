import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hash } from "../src/digest.js";
import { createLibraryPages } from "../src/library-review.js";
import { encodePcmWav } from "../src/media/audio.js";
import {
  createVoiceProfile,
  profileDirectory,
  readVoiceProfile,
} from "../src/media/voice-profiles.js";
import {
  readVoiceStyleMetadata,
  saveVoiceStyleMetadata,
} from "../src/media/voice-style-metadata.js";
import { projectRoot } from "../src/paths.js";
import { voiceLibraryPanel } from "../src/voice-library-panel.js";
import { voiceReadingScripts } from "../src/voice-reading-scripts.js";
import { voiceStyleRecording, voiceStyles } from "../src/voice-styles.js";

test("delivery styles have original reading guidance and bounded, validated profile names", () => {
  for (const id of ["professional", "calm", "comic", "upbeat", "sad"])
    assert.ok(voiceStyles.some((style) => style.id === id));
  for (const style of voiceStyles) {
    const passage = voiceReadingScripts.find((passage) => passage.id === style.readingScript);
    assert.ok(passage?.text && passage.guidance);
    assert.ok(voiceStyleRecording("M".repeat(40), style.id).name.length <= 64);
  }
  assert.equal(voiceStyleRecording(" Moty ", "professional").name, "Moty · Professional");
  for (const input of [
    ["", "calm"],
    ["M".repeat(41), "calm"],
    ["<bad>", "calm"],
    ["Moty", "unsupported"],
  ])
    assert.throws(() => voiceStyleRecording(input[0], input[1]));
});

test("style metadata preserves recorded audio, revisions and existing approval files; older recordings need no migration", async (t) => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "sap-voice-styles-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pcm = Buffer.alloc(22050 * 2 * 4);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(3000 * Math.sin(i / 20)), i * 2);
  const bytes = encodePcmWav(pcm);
  const profile = await createVoiceProfile(
    bytes,
    {
      name: "Original fixture",
      transcript: "Synthetic fixture, not a person.",
      consent: true,
      endSeconds: 4,
    },
    root,
  );
  const directory = await profileDirectory(profile.voice, root);
  const accepted = JSON.stringify({
    runtimeHash: hash("fixture runtime"),
    auditionHash: hash(bytes),
  });
  await writeFile(resolve(directory, "audition.wav"), bytes);
  await writeFile(resolve(directory, "accepted.json"), accepted);
  const original = await readFile(resolve(directory, "profile.json"));
  const originalSample = await readFile(resolve(directory, "sample.wav"));
  assert.equal(await readVoiceStyleMetadata(profile.voice, root), null);
  await saveVoiceStyleMetadata(profile.voice, "Fixture", "calm", root);
  assert.equal((await readVoiceStyleMetadata(profile.voice, root))?.style, "calm");
  assert.deepEqual(await readFile(resolve(directory, "profile.json")), original);
  assert.equal(await readFile(resolve(directory, "accepted.json"), "utf8"), accepted);
  assert.deepEqual((await readVoiceProfile(profile.voice, { root })).sample, originalSample);
  await writeFile(
    resolve(directory, "library.json"),
    JSON.stringify({
      schemaVersion: 1,
      voice: profile.voice,
      speakerName: "Fixture",
      style: "invalid",
    }),
  );
  assert.equal(await readVoiceStyleMetadata(profile.voice, root), null);
  await rm(resolve(directory, "library.json"));
  await writeFile(
    resolve(root, "outside.json"),
    JSON.stringify({
      schemaVersion: 1,
      voice: profile.voice,
      speakerName: "Fixture",
      style: "sad",
    }),
  );
  await symlink(resolve(root, "outside.json"), resolve(directory, "library.json"));
  assert.equal(
    await readVoiceStyleMetadata(profile.voice, root),
    null,
    "redirected metadata is ignored",
  );
});

test("library and editor share recording controls while exported HTML contains no saved private profiles", async () => {
  const library = voiceLibraryPanel({ context: "library" });
  const editor = voiceLibraryPanel({ context: "editor", speakers: [{ name: "Narrator" }] });
  for (const html of [library, editor]) {
    assert.match(html, /id="my-voice-style"/u);
    assert.match(html, /value="professional"/u);
    assert.match(html, /value="sad"/u);
    assert.match(html, /id="my-voice-filter"/u);
    assert.match(html, /id="my-voice-review-pane" hidden/u);
    assert.match(html, /id="my-voice-consent"/u);
    assert.match(html, /id="my-voice-controls" hidden/u);
  }
  const files = await createLibraryPages({
    entries: [],
    topics: [],
    newsTopics: [],
    budgetCents: 500,
    voiceCatalog: { installed: [], selected: "af_heart", samples: [] },
  });
  const html = String(files["review.html"]);
  assert.match(html, /My voice styles/u);
  assert.match(html, /voice-library-data/u);
  assert.doesNotMatch(html, /profileId":/u);
});

test("local API saves multiple style recordings, returns their labels, and keeps consent and legacy samples", async (t) => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "sap-voice-style-api-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(projectRoot, "schemas"), resolve(root, "schemas"), { recursive: true });
  await writeFile(resolve(root, "review.html"), "Isolated synthetic recording test");
  const pcm = Buffer.alloc(22050 * 2 * 4);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(3000 * Math.sin(i / 20)), i * 2);
  await writeFile(resolve(root, "fixture.wav"), encodePcmWav(pcm));
  const serve = new URL("../src/serve.js", import.meta.url).href.replace(
    /\.js$/u,
    import.meta.url.endsWith(".ts") ? ".ts" : ".js",
  );
  const script = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { startPreviewServer } from ${JSON.stringify(serve)};
    const root = process.env.SHORTS_WORKSPACE_ROOT;
    const {server,url} = await startPreviewServer(root,0);
    try {
      const base=new URL(url).origin;
      const session=await fetch(base+'/api/local-voices/session');
      const cookie=session.headers.get('set-cookie').split(';')[0];
      const headers={cookie,'content-type':'application/json',origin:base};
      const audio=(await readFile(root+'/fixture.wav')).toString('base64');
      const send=async (body)=>{const r=await fetch(base+'/api/local-voices/enroll',{method:'POST',headers,body:JSON.stringify({audio,transcript:'Synthetic fixture, not a person.',consent:true,...body})});return {status:r.status,data:await r.json()};};
      const voices=[];
      for(const style of ['professional','calm','upbeat']){
        const result=await send({speakerName:'Fixture',style});
        assert.equal(result.status,200,JSON.stringify(result.data));
        assert.equal(result.data.style,style);
        assert.equal(result.data.speakerName,'Fixture');
        voices.push(result.data.voice.profileId);
      }
      assert.equal(new Set(voices).size,3);
      assert.equal((await send({speakerName:'Fixture',style:'unsupported'})).status,400);
      assert.equal((await send({speakerName:'Fixture',style:'sad',consent:false})).status,400);
      assert.equal((await send({name:'Legacy synthetic profile'})).status,200);
      const catalog=await (await fetch(base+'/api/local-voices',{headers})).json();
      assert.equal(catalog.profiles.length,4);
      assert.equal(catalog.profiles.filter(p=>p.style).length,3);
      assert.ok(catalog.profiles.every(p=>p.accepted===false));
      assert.ok(catalog.profiles.some(p=>p.name==='Legacy synthetic profile' && !p.style));
      console.log('Four synthetic profiles saved; styles, consent and legacy behavior verified.');
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SHORTS_WORKSPACE_ROOT: root,
        SHORTS_MODEL_STATE_ROOT: resolve(root, ".state"),
      },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.match(result.stdout, /Four synthetic profiles saved/u);
});
