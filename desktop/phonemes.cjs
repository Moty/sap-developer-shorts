const fs = require("node:fs/promises");
const { resolve } = require("node:path");
const { tmpdir } = require("node:os");
/** eSpeak's native data lookup cannot reliably handle a deeply nested venv path. */
async function preparePhonemes(workspace, dataRoot) {
  const source = resolve(
    workspace,
    ".state/neural-voice/venv/lib/python3.12/site-packages/espeakng_loader/espeak-ng-data",
  );
  try {
    await fs.access(resolve(source, "phontab"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const target = resolve(dataRoot, "phonemes");
  try {
    if (!(await fs.lstat(target)).isDirectory())
      throw new Error("The phoneme cache directory is occupied");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.cp(source, target, { recursive: true, force: true });
  const temporary = await fs.mkdtemp(
    resolve(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "sap-phonemes-"),
  );
  const dataPath = resolve(temporary, "data");
  try {
    await fs.symlink(target, dataPath, "dir");
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { dataPath, cleanup: () => fs.rm(temporary, { recursive: true, force: true }) };
}
module.exports = { preparePhonemes };
