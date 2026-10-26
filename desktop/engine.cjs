const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const root = process.env.SHORTS_WORKSPACE_ROOT;
const load = (name) => import(pathToFileURL(resolve(root, "dist/src", name)).href);
(async () => {
  switch (process.argv[2]) {
    case "kokoro": {
      const { withModelLock } = await load("media/model-lock.js");
      const { setupNeuralVoice } = await load("media/neural.js");
      await withModelLock(() => setupNeuralVoice(["af_heart", "am_michael"]));
      break;
    }
    case "qwen":
      await (await load("media/qwen.js")).setupQwenVoice();
      break;
    case "portrait":
      await (await load("media/talking-head.js")).setupTalkingHead(console.log);
      break;
    case "face":
      await (await load("media/face-assets.js")).setupFaceLandmarker();
      break;
    case "test": {
      const { produce } = await load("production.js");
      const report = await produce("CAP-01@feed-pop", { progress: console.log });
      if (report.stage !== "READY")
        throw new Error(report.issue?.message ?? "Test production did not finish");
      console.log("Test video ready. Open the studio to review CAP-01 · feed-pop.");
      break;
    }
    default:
      throw new Error("Unknown desktop engine action");
  }
  console.log("Completed successfully.");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
