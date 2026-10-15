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
  if (
    command === "produce" &&
    args.length >= 1 &&
    args.length <= 2 &&
    args[0] &&
    (!args[1] || args[1] === "--serve")
  ) {
    const { produce } = await import("./production.js");
    const report = await produce(args[0], { progress: (message) => console.log(message) });
    console.log(`Production: ${report.stage}`);
    console.log(`Report: ${resolve(report.directory, "production.json")}`);
    if (report.mediaJobId) console.log(`Media job: ${report.mediaJobId}`);
    if (report.narrationDirectory)
      console.log(`Narration: ${resolve(report.narrationDirectory, "review.html")}`);
    if (report.videoDirectory) console.log(`Video: ${resolve(report.videoDirectory, "short.mp4")}`);
    if (report.libraryDirectory)
      console.log(`Studio: ${resolve(report.libraryDirectory, "review.html")}`);
    if (report.issue) {
      console.error(report.issue.message);
      console.error(`Next: ${report.issue.nextAction}`);
      process.exitCode = 1;
    }
    if (report.stage === "READY" && report.libraryDirectory) {
      console.log(`Serve: npm run shorts -- serve ${report.libraryDirectory}`);
      if (args[1] === "--serve") {
        try {
          const { url } = await startPreviewServer(report.libraryDirectory, 0);
          console.log(`Review: ${url}`);
          console.log("Serving the completed studio locally. Stop with Ctrl+C.");
        } catch (error) {
          console.error(
            `Production remains READY; local serving failed: ${(error as Error).message}`,
          );
          process.exitCode = 1;
        }
      }
    }
  } else if (command === "production-status" && args.length === 1 && args[0]) {
    const { latestProduction } = await import("./production.js");
    const report = await latestProduction(args[0]);
    console.log(
      report ? JSON.stringify(report, null, 2) : "No saved production attempt for this draft.",
    );
  } else if (command === "jobs" && args.length <= 1) {
    const { listMediaJobs } = await import("./media/status.js");
    const jobs = await listMediaJobs(args[0]);
    if (!jobs.length)
      console.log("No saved media jobs. Start with: npm run shorts -- narrate CAP-01");
    for (const job of jobs) {
      console.log(`\n${job.selector} · ${job.phase} · ${job.voices.join(" + ")}`);
      console.log(`${job.id} · ${job.updatedAt}`);
      console.log(
        `${job.style} · ${job.provider} · ${job.billedCents === null ? "cost pending" : `$${(job.billedCents / 100).toFixed(2)} recorded`}`,
      );
      if (!job.scriptMatches) console.log("Saved script differs from the current draft.");
      if (job.generatorFingerprint === "legacy-unrecorded")
        console.log("Earlier recording: synthesis-code fingerprint was not recorded.");
      if (job.retryOf) console.log(`Recovery of: ${job.retryOf}`);
      if (job.provider !== "fake" && !job.settingsMatch)
        console.log("Saved voice settings differ from the current selection.");
      if (job.error) console.log(`Issue: ${job.error}`);
      if (job.outputDirectory)
        console.log(`Review: ${resolve(job.outputDirectory, "review.html")}`);
      console.log(`Next: ${job.nextAction}`);
    }
    console.log(
      "\nSaved states describe prior work; render validates the actual files and timing.",
    );
  } else if (command === "render" && args.length === 1 && args[0]) {
    const { renderVideo } = await import("./video/export.js");
    const result = await renderVideo(args[0], { progress: (message) => console.log(message) });
    console.log(`Video: ${resolve(result.directory, "short.mp4")}`);
    console.log(`Review: ${resolve(result.directory, "review.html")}`);
  } else if (command === "script-import" && args.length === 1 && args[0]) {
    const { importScript } = await import("./script-import.js");
    const result = await importScript(args[0]);
    console.log(`Imported script: ${result.selector}`);
    console.log(`File: ${result.file}`);
    console.log(`Next: npm run shorts -- produce ${result.selector} --serve`);
  } else if (command === "styles" && !args.length) {
    const { presentationFormats, toneLabels, humorLabels } = await import("./presentation.js");
    console.log(`Tones: ${Object.values(toneLabels).join(", ")}`);
    console.log(`Humor: ${Object.values(humorLabels).join(", ")}`);
    for (const format of presentationFormats)
      console.log(`${format.id.padEnd(12)} ${format.name}: ${format.description}`);
    console.log(
      "Prepared scripts: CAP-01 (professional), CAP-01@casual, CAP-01@comic, CAP-01@duo, CAP-02@quiz, NEWS-02@duo.",
    );
  } else if (command === "voices" && args.length <= 1) {
    const { kokoroVoices } = await import("./media/voices.js");
    const { installedKokoroVoices } = await import("./media/voice-audition.js");
    const { effectiveNarrators } = await import("./media/voice-selection.js");
    const settings = await productionSettings();
    const installed = await installedKokoroVoices();
    if (args[0]) {
      const assignment = effectiveNarrators(await readContentEpisode(args[0]), settings);
      console.log(
        `${assignment.selector}: ${assignment.source === "default" ? "uses the default narrator" : "uses explicit presentation speakers; the default does not override them"}.`,
      );
      for (const speaker of assignment.speakers)
        console.log(
          `  ${speaker.name}: ${speaker.voice}${installed.includes(speaker.voice) ? " · installed" : " · setup needed"}`,
        );
      console.log(`Change assignments in ${assignment.configurationFile}.\n`);
    }
    for (const voice of kokoroVoices) {
      const selected =
        settings.localPreview.engine === "kokoro" && settings.localPreview.voice === voice.id;
      console.log(
        `${voice.id.padEnd(13)} ${voice.name.padEnd(9)} ${voice.accent} · ${voice.gender}${selected ? " · selected" : ""}${installed.includes(voice.id) ? " · installed" : " · setup needed"}`,
      );
    }
    console.log(
      "Listen: npm run shorts -- voice-audition af_heart am_michael\nInstall another profile: npm run shorts -- voice-setup af_bella\nListen first: npm run shorts -- voice-audition af_bella\nChoose the default: npm run shorts -- voice-select af_bella\nCreate a new recording: npm run shorts -- produce CAP-01 --serve\nPrepared variants keep their explicit speaker assignments. Run voices SELECTOR to inspect them.",
    );
  } else if (command === "voice-select" && args.length === 1 && args[0]) {
    const { selectNarrator } = await import("./media/voice-selection.js");
    const { selected } = await selectNarrator(args[0]);
    console.log(
      `Default Kokoro narrator: ${selected}. Prepared presentation speakers and saved recordings retain their voices.`,
    );
    console.log(
      `If needed, install: npm run shorts -- voice-setup ${selected}\nListen: npm run shorts -- voice-audition ${selected}\nProduce: npm run shorts -- produce CAP-01 --serve`,
    );
  } else if (command === "voice-audition" && args.length <= 3) {
    const { buildAuditionPage, createVoiceAudition } = await import("./media/voice-audition.js");
    const { kokoroVoice } = await import("./media/voices.js");
    const settings = await productionSettings();
    const ids = [...new Set(args.length ? args : [settings.localPreview.voice])];
    ids.forEach(kokoroVoice);
    const samples = [];
    for (const id of ids) {
      console.log(`Preparing ${id} voice sample…`);
      const { sample, reused } = await createVoiceAudition(id, settings);
      samples.push(sample);
      console.log(
        `${reused ? "Reused verified sample" : "Recorded sample"}: ${id} · ${sample.durationSeconds.toFixed(1)} seconds`,
      );
    }
    const directory = await buildAuditionPage(samples, settings.localPreview.voice);
    console.log(
      `Voice samples: ${resolve(directory, "review.html")}\nServe: npm run shorts -- serve ${directory}\nDefault voice unchanged. Rebuild the library to include these samples in the studio.`,
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
      "SAP Developer Shorts\n\n  doctor                         Check local prerequisites\n  produce EPISODE_ID [--serve]    Create/resume narration, MP4, and studio\n  production-status EPISODE_ID    Read the latest saved production report\n  library                        Build the shared episode review hub\n  serve ARTIFACT_DIRECTORY       Open a local player server on port 4173\n  validate [EPISODE_ID]           Validate content\n  verify EPISODE_ID               Verify a demo or dated news source review\n  preview EPISODE_ID              Create a silent storyboard\n  render EPISODE_ID              Export a verified vertical MP4 from saved narration\n  styles                         Browse presentation formats and tones\n  script-import JSON_FILE         Import a revised script as a new delivery version\n  voices [EPISODE_ID]             List voices and explain speaker assignments\n  voice-setup [VOICE_ID...]        Install selected/additional local voices\n  voice-audition [VOICE_ID...]     Listen to up to three identical voice samples\n  voice-select VOICE_ID            Choose the default Kokoro narrator\n  narrate EPISODE_ID              Create/resume a free local voice preview\n  media-simulate EPISODE_ID [mode] Test media job recovery\n  jobs [EPISODE_ID]               Find saved jobs and recovery actions\n  media-status JOB_ID             Read saved media state\n  media-package JOB_ID            Rebuild from saved narration without submitting\n  media-step JOB_ID               Advance a saved job once\n\nSimulation modes: success, lost-submit, unknown-submit, poll-timeout, failure\nNo live avatar generation or publishing is implemented.",
    );
  } else {
    throw new Error("Unknown command or arguments. Run npm run shorts -- help.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
}
