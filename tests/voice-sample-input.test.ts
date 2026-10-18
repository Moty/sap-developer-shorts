import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { encodePcmWav, readPcmWav } from "../src/media/audio.js";
import { createVoiceProfile, readVoiceProfile } from "../src/media/voice-profiles.js";
import { prepareVoiceSample } from "../src/media/voice-sample-input.js";

const options = { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 };
function fixture(seconds: number) {
  const pcm = Buffer.alloc(seconds * 22050 * 2);
  for (let frame = 0; frame < pcm.length / 2; frame++)
    pcm.writeInt16LE(Math.round(3500 * Math.sin((frame * 2 * Math.PI * 220) / 22050)), frame * 2);
  return encodePcmWav(pcm);
}
test("a complete reading beyond 15s is saved intact with its transcript", options, async () => {
  const work = await mkdtemp(resolve(tmpdir(), "shorts-full-reading-test-"));
  try {
    const sample = await prepareVoiceSample(fixture(18), {}, work);
    const transcript = "This is a synthetic audio fixture, not a real speaker's recording.";
    const created = await createVoiceProfile(
      sample.bytes,
      {
        name: "Synthetic reading test",
        transcript,
        consent: true,
        startSeconds: sample.startSeconds,
        endSeconds: sample.endSeconds,
      },
      resolve(work, "profiles"),
    );
    const saved = await readVoiceProfile(created.voice, {
      accepted: false,
      root: resolve(work, "profiles"),
    });
    assert.equal(readPcmWav(saved.sample).length / 44100, 18);
    assert.equal(saved.profile.transcript, transcript);
    assert.equal(saved.profile.endSeconds, 18);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
test(
  "streamed WebM without a duration header can be used as a complete reference",
  options,
  async () => {
    const work = await mkdtemp(resolve(tmpdir(), "shorts-webm-reading-test-"));
    try {
      const encoded = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "wav", "-i", "pipe:0", "-c:a", "libopus", "-f", "webm", "pipe:1"],
        { input: fixture(5), maxBuffer: 2 * 1024 * 1024 },
      );
      assert.equal(encoded.status, 0, encoded.stderr.toString());
      const probe = spawnSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "json", "pipe:0"],
        { input: encoded.stdout },
      );
      assert.equal(JSON.parse(probe.stdout.toString()).format.duration, undefined);
      const sample = await prepareVoiceSample(encoded.stdout, {}, work);
      assert.ok(Math.abs(sample.endSeconds - 5) < 0.1);
      assert.equal(sample.startSeconds, 0);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
);
test("overlong whole readings are rejected instead of silently shortened", options, async () => {
  const work = await mkdtemp(resolve(tmpdir(), "shorts-long-reading-test-"));
  try {
    await assert.rejects(
      prepareVoiceSample(fixture(32), {}, work),
      /complete passage in 3–30 seconds/,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
test("explicit excerpt controls still select part of a longer upload", options, async () => {
  const work = await mkdtemp(resolve(tmpdir(), "shorts-excerpt-test-"));
  try {
    const sample = await prepareVoiceSample(fixture(45), { startSeconds: 5, endSeconds: 23 }, work);
    const created = await createVoiceProfile(
      sample.bytes,
      {
        name: "Synthetic excerpt test",
        transcript: "Synthetic excerpt.",
        consent: true,
        startSeconds: sample.startSeconds,
        endSeconds: sample.endSeconds,
      },
      resolve(work, "profiles"),
    );
    const saved = await readVoiceProfile(created.voice, {
      accepted: false,
      root: resolve(work, "profiles"),
    });
    assert.equal(readPcmWav(saved.sample).length / 44100, 18);
    assert.equal(saved.profile.startSeconds, 5);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
