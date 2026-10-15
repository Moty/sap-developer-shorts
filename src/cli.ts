import { resolve } from "node:path";
import { readContentEpisode, validateContent, words } from "./contracts.js";
import { doctor } from "./doctor.js";
import type { FakeScenario } from "./media/model.js";
import { MediaStore } from "./media/store.js";
import {
  advanceMediaJob,
  mediaDatabase,
  planMediaEpisode,
  productionSettings,
  providerForJob,
  rebuildMediaPackage,
} from "./media/worker.js";
import { prepareContentEpisode } from "./pipeline.js";
import { startPreviewServer } from "./serve.js";

const [command = "help", ...args] = process.argv.slice(2);

try {
  if (command === "styles" && !args.length) {
    const { presentationFormats, toneLabels, humorLabels } = await import("./presentation.js");
    console.log(`Tones: ${Object.values(toneLabels).join(", ")}`);
    console.log(`Humor: ${Object.values(humorLabels).join(", ")}`);
    for (const format of presentationFormats)
      console.log(`${format.id.padEnd(12)} ${format.name}: ${format.description}`);
    console.log(
      "Prepared previews: CAP-01 (professional), CAP-01@casual, CAP-01@comic, CAP-01@duo.",
    );
  } else if (command === "voices" && !args.length) {
    const { kokoroVoices } = await import("./media/voices.js");
    const settings = await productionSettings();
    for (const voice of kokoroVoices) {
      const selected =
        settings.localPreview.engine === "kokoro" && settings.localPreview.voice === voice.id;
      console.log(
        `${voice.id.padEnd(13)} ${voice.name.padEnd(9)} ${voice.accent} · ${voice.gender}${selected ? " · selected" : ""}`,
      );
    }
    console.log(
      "Choose localPreview.voice in config/production.json, then run voice-setup and narrate again.",
    );
  } else if (command === "voice-setup" && args.length <= 2) {
    const { setupNeuralVoice } = await import("./media/neural.js");
    console.log(
      "Setting up the optional local neural voice. The first setup downloads its model and dependencies.",
    );
    console.log(await setupNeuralVoice(args));
  } else if (command === "library" && !args.length) {
    const { buildLibrary } = await import("./library.js");
    const result = await buildLibrary();
    console.log(`Library: ${resolve(result.directory, "review.html")}`);
    console.log(`Serve: npm run shorts -- serve ${result.directory}`);
  } else if (command === "serve" && args.length === 1 && args[0]) {
    const { url } = await startPreviewServer(args[0]);
    console.log(`Preview: ${url}`);
    console.log("Serving this artifact locally. Stop with Ctrl+C.");
  } else if (command === "doctor" && !args.length) {
    if (!(await doctor())) process.exitCode = 1;
  } else if (command === "validate" && args.length <= 1) {
    if (args[0]) {
      const episode = await readContentEpisode(args[0]);
      console.log(
        `Valid: ${episode.id}; ${words(episode.scenes.map((scene) => scene.narration).join(" "))} spoken words; ${episode.targetDurationSeconds}s planned.`,
      );
    } else {
      const { topics, newsTopics, episodes, variants } = await validateContent();
      console.log(
        `Valid: ${topics.length} tutorial topics, ${newsTopics.length} news topics, ${episodes.length} episodes, and ${variants.length} presentation variants. Timing remains provisional until audio is measured.`,
      );
    }
  } else if ((command === "verify" || command === "preview") && args.length === 1 && args[0]) {
    await validateContent();
    const episode = await readContentEpisode(args[0]);
    const result = await prepareContentEpisode(episode, { preview: command === "preview" });
    console.log(
      `PASS ${episode.id}: ${"checks" in result.evidence ? `${result.evidence.checks.length} live checks` : `${result.evidence.claimReviews.length} dated source reviews; editorial approval pending`}; ${result.manifest.stage}.`,
    );
    console.log(`Run: ${result.directory}`);
    if (command === "preview") console.log(`Review: ${resolve(result.directory, "review.html")}`);
  } else if (
    (command === "narrate" || command === "media-simulate") &&
    args.length >= 1 &&
    args.length <= 2 &&
    args[0]
  ) {
    const scenario = args[1] ?? "success";
    if (
      !["success", "lost-submit", "unknown-submit", "poll-timeout", "failure"].includes(scenario) ||
      (command === "narrate" && args.length !== 1)
    )
      throw new Error("Invalid media scenario or arguments");
    let job = await planMediaEpisode(
      args[0],
      command === "narrate" ? "local" : "fake",
      scenario as FakeScenario,
    );
    console.log(`Media job: ${job.id}`);
    const store = await MediaStore.open(mediaDatabase);
    try {
      const provider = providerForJob(store, job);
      for (let step = 0; step < 200; step++) {
        job = await advanceMediaJob(store, job.id, provider);
        console.log(`${job.phase}${job.progress ? `: ${job.progress}` : ""}`);
        if (
          [
            "SUCCEEDED",
            "SIMULATED",
            "FAILED",
            "SUBMISSION_UNKNOWN",
            "POLL_TIMEOUT",
            "PACKAGE_FAILED",
          ].includes(job.phase)
        )
          break;
      }
      if (job.outputDirectory)
        console.log(`Review: ${resolve(job.outputDirectory, "review.html")}`);
      if (job.error) {
        console.error(job.error);
        process.exitCode = 1;
      }
      console.log(
        "No avatar provider was called. Local and simulated generation do not spend money.",
      );
    } finally {
      store.close();
    }
  } else if (
    (command === "media-status" || command === "media-step" || command === "media-package") &&
    args.length === 1 &&
    args[0]
  ) {
    const store = await MediaStore.open(mediaDatabase);
    try {
      const saved = store.get(args[0]);
      const job =
        command === "media-package"
          ? await rebuildMediaPackage(store, saved.id)
          : command === "media-step"
            ? await advanceMediaJob(store, saved.id, providerForJob(store, saved))
            : saved;
      console.log(
        JSON.stringify(
          {
            id: job.id,
            phase: job.phase,
            progress: job.progress,
            provider: job.request.provider,
            quoteCents: job.quoteCents,
            billedCents: job.billedCents,
            error: job.error,
            outputDirectory: job.outputDirectory,
          },
          null,
          2,
        ),
      );
      if (job.error) process.exitCode = 1;
    } finally {
      store.close();
    }
  } else if (command === "help" && !args.length) {
    console.log(
      "SAP Developer Shorts\n\n  doctor                         Check local prerequisites\n  library                        Build the shared episode review hub\n  serve ARTIFACT_DIRECTORY       Open a local player server on port 4173\n  validate [EPISODE_ID]           Validate content\n  verify EPISODE_ID               Verify a demo or dated news source review\n  preview EPISODE_ID              Create a silent storyboard\n  styles                         Browse presentation formats and tones\n  voices                         List supported Kokoro English voices\n  voice-setup                    Install the selected local neural voice\n  narrate EPISODE_ID              Create/resume a free local voice preview\n  media-simulate EPISODE_ID [mode] Test media job recovery\n  media-status JOB_ID             Read saved media state\n  media-package JOB_ID            Rebuild from saved narration without submitting\n  media-step JOB_ID               Advance a saved job once\n\nSimulation modes: success, lost-submit, unknown-submit, poll-timeout, failure\nNo live avatar generation or publishing is implemented.",
    );
  } else {
    throw new Error("Unknown command or arguments. Run npm run shorts -- help.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
}
