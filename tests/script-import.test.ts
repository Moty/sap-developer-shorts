import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { readContentEpisode } from "../src/contracts.js";
import { hash } from "../src/digest.js";
import { projectRoot } from "../src/paths.js";
import { importScript } from "../src/script-import.js";
import { type PresentationDefinition, validatePresentationDefinition } from "../src/variants.js";

function required<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "sap-script-import-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const presentationDirectory = resolve(root, "presentations");
  await mkdir(presentationDirectory);
  return { root, presentationDirectory, input: resolve(root, "download.json") };
}

async function definition(
  selector: string,
  variant = "my-revision",
): Promise<PresentationDefinition> {
  const episode = await readContentEpisode(selector);
  const base = await readContentEpisode(episode.id);
  return {
    schemaVersion: 1,
    baseEpisodeId: base.id,
    baseInputHash: hash(JSON.stringify(base)),
    title: episode.title,
    presentation: {
      ...(episode.presentation ?? {
        tone: "professional",
        format: "explainer",
        humor: "none",
        speakers: [{ id: "narrator", name: "Narrator", voice: "af_heart" }],
      }),
      variant,
    },
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      narration: scene.narration,
      overlay: scene.overlay,
      ...(scene.dialogue ? { dialogue: structuredClone(scene.dialogue) } : {}),
    })),
    publicationText: episode.publication.text,
  };
}

test("script imports preserve solo, dialogue, and dated news evidence and use canonical filenames", async (t) => {
  const { input, presentationDirectory } = await fixture(t);
  for (const [index, selector] of ["CAP-02@quiz", "CAP-01@duo", "NEWS-02"].entries()) {
    const draft = await definition(selector, `my-revision-${index}`);
    draft.title = `Revised: ${draft.title}`;
    await writeFile(input, JSON.stringify(draft));
    const result = await importScript(input, { presentationDirectory });
    assert.equal(result.selector, `${draft.baseEpisodeId}@my-revision-${index}`);
    assert.equal(
      result.file,
      resolve(presentationDirectory, `${draft.baseEpisodeId}--my-revision-${index}.json`),
    );
    assert.deepEqual(JSON.parse(await readFile(result.file, "utf8")), draft);
    const base = await readContentEpisode(draft.baseEpisodeId);
    assert.deepEqual(result.episode.sources, base.sources);
    assert.deepEqual(result.episode.claims, base.claims);
    assert.deepEqual(
      result.episode.scenes.map(({ id, phase, startSeconds, endSeconds, visual }) => ({
        id,
        phase,
        startSeconds,
        endSeconds,
        visual,
      })),
      base.scenes.map(({ id, phase, startSeconds, endSeconds, visual }) => ({
        id,
        phase,
        startSeconds,
        endSeconds,
        visual,
      })),
    );
    if ("demo" in base && "demo" in result.episode)
      assert.deepEqual(result.episode.demo, base.demo);
    if ("news" in base && "news" in result.episode)
      assert.deepEqual(result.episode.news, base.news);
    assert.deepEqual(result.episode.presentation, draft.presentation);
    assert.equal(result.episode.publication.text, draft.publicationText);
    for (const scene of result.episode.scenes)
      if (scene.dialogue)
        assert.equal(scene.dialogue.map((turn) => turn.text.trim()).join(" "), scene.narration);
  }
  assert.equal((await readdir(presentationDirectory)).length, 3);
});

test("invalid imports reject stale bases, structural changes, and unknown nested fields before writing", async (t) => {
  const { input, presentationDirectory } = await fixture(t);
  const valid = await definition("CAP-01@duo");
  const mutations: Array<(draft: PresentationDefinition) => void> = [
    (draft) => {
      draft.baseInputHash = "0".repeat(64);
    },
    (draft) => {
      draft.baseEpisodeId = "CAP-01@duo";
    },
    (draft) => {
      draft.presentation.variant = "../outside";
    },
    (draft) => {
      Object.assign(draft, { claims: [] });
    },
    (draft) => {
      Object.assign(draft.presentation, { emotion: "happy" });
    },
    (draft) => {
      Object.assign(required(draft.presentation.speakers[0]), { extra: true });
    },
    (draft) => {
      required(draft.presentation.speakers[0]).voice = "unavailable-profile";
    },
    (draft) => {
      required(draft.presentation.speakers[1]).voice = required(
        draft.presentation.speakers[0],
      ).voice;
    },
    (draft) => {
      draft.scenes.reverse();
    },
    (draft) => {
      draft.scenes.pop();
    },
    (draft) => {
      Object.assign(required(draft.scenes[0]), { visual: { kind: "presenter" } });
    },
    (draft) => {
      Object.assign(required(draft.scenes[0]), { startSeconds: 5 });
    },
    (draft) => {
      Reflect.deleteProperty(required(draft.scenes[0]), "narration");
    },
    (draft) => {
      Object.assign(required(required(draft.scenes[0]).dialogue?.[0]), { extra: true });
    },
    (draft) => {
      required(required(draft.scenes[0]).dialogue?.[0]).speakerId = "missing";
    },
    (draft) => {
      required(required(draft.scenes[0]).dialogue?.[0]).text = "This does not match narration.";
    },
    (draft) => {
      required(draft.scenes[0]).narration =
        "This opening has far too many words to be a valid hook.";
    },
    (draft) => {
      Object.assign(draft, { publicationText: 42 });
    },
  ];
  for (const mutate of mutations) {
    const draft = structuredClone(valid);
    mutate(draft);
    await writeFile(input, JSON.stringify(draft));
    await assert.rejects(importScript(input, { presentationDirectory }));
    assert.deepEqual(await readdir(presentationDirectory), []);
  }
  for (const value of [null, [], {}, { ...valid, scenes: [null] }]) {
    await writeFile(input, JSON.stringify(value));
    await assert.rejects(importScript(input, { presentationDirectory }));
    assert.deepEqual(await readdir(presentationDirectory), []);
  }
  await assert.rejects(validatePresentationDefinition(valid, "CAP-01@other"), /selector/);
});

test("collisions and concurrent imports cannot overwrite a script or leave staging files", async (t) => {
  const { input, presentationDirectory } = await fixture(t);
  const draft = await definition("CAP-02@quiz");
  await writeFile(input, JSON.stringify(draft));
  const results = await Promise.allSettled([
    importScript(input, { presentationDirectory }),
    importScript(input, { presentationDirectory }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const files = await readdir(presentationDirectory);
  assert.deepEqual(files, ["CAP-02--my-revision.json"]);
  const original = await readFile(resolve(presentationDirectory, required(files[0])));
  draft.title = "Must never replace the original";
  await writeFile(input, JSON.stringify(draft));
  await assert.rejects(importScript(input, { presentationDirectory }), /already exists/);
  assert.deepEqual(await readFile(resolve(presentationDirectory, required(files[0]))), original);
  assert.deepEqual(await readdir(presentationDirectory), files);
});

test("imports refuse symlink sources, destinations, and existing symlink targets", async (t) => {
  const { root, input, presentationDirectory } = await fixture(t);
  await writeFile(input, JSON.stringify(await definition("CAP-02@quiz")));
  const linkedInput = resolve(root, "linked-input.json");
  await symlink(input, linkedInput);
  await assert.rejects(importScript(linkedInput, { presentationDirectory }), /symlink/);
  const linkedDirectory = resolve(root, "linked-presentations");
  await symlink(presentationDirectory, linkedDirectory);
  await assert.rejects(importScript(input, { presentationDirectory: linkedDirectory }), /symlink/);
  assert.deepEqual(await readdir(presentationDirectory), []);
  const outside = resolve(root, "outside.json");
  await writeFile(outside, "unchanged");
  await symlink(outside, resolve(presentationDirectory, "CAP-02--my-revision.json"));
  await assert.rejects(importScript(input, { presentationDirectory }), /already exists/);
  assert.equal(await readFile(outside, "utf8"), "unchanged");
  assert.deepEqual(await readdir(presentationDirectory), ["CAP-02--my-revision.json"]);
});

test("oversized or malformed input leaves the destination untouched", async (t) => {
  const { input, presentationDirectory } = await fixture(t);
  await writeFile(input, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(importScript(input, { presentationDirectory }), /1 MiB/);
  await writeFile(input, "{ invalid JSON");
  await assert.rejects(importScript(input, { presentationDirectory }));
  await assert.rejects(
    importScript(presentationDirectory, { presentationDirectory }),
    /regular JSON/,
  );
  assert.deepEqual(await readdir(presentationDirectory), []);
});

test("existing presentation files still validate through the shared definition authority", async () => {
  const filename = resolve(projectRoot, "content/presentations/CAP-01--duo.json");
  const result = await validatePresentationDefinition(
    JSON.parse(await readFile(filename, "utf8")),
    "CAP-01@duo",
  );
  assert.equal(result.file, "content/presentations/CAP-01--duo.json");
  assert.deepEqual(result.episode, await readContentEpisode("CAP-01@duo"));
});
