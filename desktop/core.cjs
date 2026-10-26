const fs = require("node:fs/promises");
const { createHash, randomUUID } = require("node:crypto");
const { dirname, resolve, relative, isAbsolute, delimiter } = require("node:path");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function safeRelative(name) {
  if (
    typeof name !== "string" ||
    !name ||
    isAbsolute(name) ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  )
    throw new Error("Unsafe desktop payload path");
  if (/^(?:credentials|node_modules|artifacts)(?:\/|$)/u.test(name))
    throw new Error("Private/runtime dependency paths cannot be workspace seeds");
  return name;
}
async function regular(path) {
  try {
    const s = await fs.lstat(path);
    if (!s.isFile()) throw new Error(`Expected a regular file: ${path}`);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function safeParents(root, name) {
  for (const part of relative(root, dirname(resolve(root, name)))
    .split("/")
    .filter(Boolean)) {
    root = resolve(root, part);
    try {
      if (!(await fs.lstat(root)).isDirectory())
        throw new Error("Workspace directory cannot be a symbolic link");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(root, { mode: 0o700 });
    }
  }
}
async function atomic(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, path);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function installWorkspace(payload, workspace) {
  const manifest = JSON.parse(await fs.readFile(resolve(payload, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files))
    throw new Error("Invalid desktop payload manifest");
  const seen = new Set();
  for (const file of manifest.files) {
    safeRelative(file.path);
    if (
      seen.has(file.path) ||
      !["runtime", "seed"].includes(file.policy) ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    )
      throw new Error("Invalid desktop payload entry");
    const policy =
      file.path.startsWith("content/") || file.path === "config/production.json"
        ? "seed"
        : "runtime";
    if (file.policy !== policy)
      throw new Error("Desktop update policy would overwrite user content");
    seen.add(file.path);
    const source = resolve(payload, "seed", file.path);
    if (!(await regular(source)) || sha(await fs.readFile(source)) !== file.sha256)
      throw new Error(`Desktop payload checksum failed: ${file.path}`);
  }
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  if (!(await fs.lstat(workspace)).isDirectory())
    throw new Error("Workspace cannot be a symbolic link");
  const marker = resolve(workspace, ".desktop-workspace.json");
  if (await regular(marker)) {
    const previous = JSON.parse(await fs.readFile(marker, "utf8"));
    if (previous.application !== "sap-shorts-desktop")
      throw new Error("This directory belongs to another workspace");
  } else {
    if ((await fs.readdir(workspace)).length)
      throw new Error(
        "Choose an empty desktop workspace; existing folders are not imported automatically",
      );
    await atomic(marker, JSON.stringify({ application: "sap-shorts-desktop", installing: true }));
  }
  for (const file of manifest.files) {
    await safeParents(workspace, file.path);
    const target = resolve(workspace, file.path);
    const exists = await regular(target);
    if (exists && (file.policy === "seed" || sha(await fs.readFile(target)) === file.sha256))
      continue;
    await atomic(target, await fs.readFile(resolve(payload, "seed", file.path)));
  }
  for (const directory of [
    "content/drafts",
    "content/presentations",
    "assets/avatars",
    "artifacts",
    ".state",
  ])
    await safeParents(workspace, `${directory}/placeholder`);
  const modules = resolve(workspace, "node_modules");
  try {
    if (!(await fs.lstat(modules)).isSymbolicLink())
      throw new Error("The managed node_modules path is occupied; no user files were removed");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const link = `${modules}.${randomUUID()}.tmp`;
  try {
    await fs.symlink(resolve(payload, "node_modules"), link, "dir");
    await fs.rename(link, modules);
  } finally {
    await fs.rm(link, { force: true });
  }
  await atomic(
    marker,
    `${JSON.stringify({ application: "sap-shorts-desktop", version: manifest.version, revision: manifest.revision, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return manifest;
}
function desktopEnvironment(payload, workspace, dataRoot, inherited = process.env) {
  const env = { ...inherited };
  for (const key of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    "HOST",
    "SHORTS_ARTIFACT_DIR",
    "SHORTS_MODEL_STATE_ROOT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "SHORTS_PRIVATE_CONFIG",
    "HF_TOKEN",
    "HUGGING_FACE_HUB_TOKEN",
  ])
    delete env[key];
  return {
    ...env,
    PATH: [
      resolve(workspace, ".desktop-bin"),
      resolve(payload, "bin"),
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(delimiter),
    SHORTS_WORKSPACE_ROOT: workspace,
    SHORTS_DESKTOP_DATA_ROOT: dataRoot,
    SHORTS_MODEL_STATE_ROOT: resolve(workspace, ".state"),
    SHORTS_KEYCHAIN_HELPER: resolve(payload, "bin/keychain"),
    SHORTS_WORKER_DATA_ROOT: resolve(dataRoot, "worker"),
    HF_HOME: resolve(dataRoot, "cache/huggingface"),
    TORCH_HOME: resolve(dataRoot, "cache/torch"),
    XDG_CACHE_HOME: resolve(dataRoot, "cache"),
    MPLCONFIGDIR: resolve(dataRoot, "cache/matplotlib"),
    UV_PYTHON_INSTALL_DIR: resolve(dataRoot, "python"),
    UV_PYTHON_BIN_DIR: resolve(dataRoot, "python-bin"),
    UV_CACHE_DIR: resolve(dataRoot, "cache/uv"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_PYTHON: "3.12",
    UV_NO_PROGRESS: "1",
    PYTHONUNBUFFERED: "1",
    PYTORCH_ENABLE_MPS_FALLBACK: "1",
  };
}
function workerInput(input) {
  const url = new URL(input?.origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Enter an HTTPS studio origin, such as https://studio.example.com");
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (
    !name ||
    name.length > 80 ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("Enter a device name up to 80 characters");
  return { origin: url.origin, name };
}
function allowedExternal(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
module.exports = {
  sha,
  safeRelative,
  installWorkspace,
  desktopEnvironment,
  workerInput,
  allowedExternal,
};
