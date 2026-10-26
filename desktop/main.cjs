const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Menu,
  powerSaveBlocker,
  systemPreferences,
} = require("electron");
const { fork } = require("node:child_process");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const {
  installWorkspace,
  desktopEnvironment,
  allowedExternal,
  workerInput,
} = require("./core.cjs");
const smoke = process.argv.includes("--smoke-test");
const requestedDataRoot = resolve(
  process.env.SAP_SHORTS_DESKTOP_DATA_DIR || resolve(app.getPath("appData"), "SAP Shorts/Desktop"),
);
require("node:fs").mkdirSync(requestedDataRoot, { recursive: true, mode: 0o700 });
const dataRoot = require("node:fs").realpathSync(requestedDataRoot);
app.setPath("userData", resolve(dataRoot, "shell"));
const setupUrl = pathToFileURL(resolve(__dirname, "ui/index.html")).href;
const payload = app.isPackaged
  ? resolve(process.resourcesPath, "payload")
  : resolve(__dirname, "payload");
const workspace = resolve(dataRoot, "workspace");
let setupWindow,
  backend,
  current = {
    ready: false,
    task: null,
    error: null,
    logs: ["Preparing the desktop workspace…"],
    workspace,
    engines: {},
  };
let quitting = false,
  powerId,
  smokeFinished = false;
const studios = new Set(),
  origins = new Set(),
  pending = new Map();
const publish = () => {
  if (setupWindow && !setupWindow.isDestroyed())
    setupWindow.webContents.send("desktop:state", current);
};
function trusted(event) {
  if (
    !setupWindow ||
    event.sender !== setupWindow.webContents ||
    event.senderFrame?.url !== setupUrl
  )
    throw new Error("Desktop controls are only available in the setup window");
}
function external(url) {
  if (allowedExternal(url)) void shell.openExternal(url);
}
function windowSecurity(window, origin) {
  if (origin) origins.add(origin);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (origin && new URL(url, origin).origin === origin) {
      void window.loadURL(url);
    } else external(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if ((origin && new URL(url).origin === origin) || (!origin && url === setupUrl)) return;
    event.preventDefault();
    external(url);
  });
  window.webContents.session.setPermissionRequestHandler(
    async (contents, permission, respond, details) => {
      const source = details.requestingUrl || contents.getURL();
      const valid =
        origin &&
        origins.has(new URL(source).origin) &&
        permission === "media" &&
        details.mediaTypes?.length === 1 &&
        details.mediaTypes[0] === "audio";
      if (!valid) return respond(false);
      respond(await systemPreferences.askForMediaAccess("microphone"));
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      permission === "media" &&
      !!origin &&
      origins.has(requestingOrigin) &&
      details.mediaType === "audio",
  );
}
function showSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    title: "SAP Shorts · Setup & engines",
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: "#080f1c",
    webPreferences: {
      preload: resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:sap-shorts-setup",
    },
  });
  windowSecurity(setupWindow);
  setupWindow.once("ready-to-show", () => {
    setupWindow.show();
    publish();
  });
  void setupWindow.loadURL(setupUrl);
}
function openStudio() {
  if (!current.studioUrl) throw new Error("The local studio is still preparing");
  const origin = new URL(current.studioUrl).origin;
  for (const window of studios)
    if (!window.isDestroyed() && new URL(window.webContents.getURL()).origin === origin) {
      window.show();
      window.focus();
      return;
    }
  const window = new BrowserWindow({
    title: "SAP Shorts · Creator studio",
    width: 1360,
    height: 930,
    backgroundColor: "#f5f7ef",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:sap-shorts-studio",
    },
  });
  studios.add(window);
  window.on("closed", () => studios.delete(window));
  windowSecurity(window, origin);
  window.webContents.session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      defaultPath: resolve(app.getPath("downloads"), item.getFilename()),
    });
  });
  void window.loadURL(current.studioUrl);
}
async function request(input) {
  if (!backend?.connected)
    throw new Error("The local backend is unavailable. Restart the app to repair startup.");
  const id = randomUUID();
  return new Promise((done, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The desktop backend did not respond"));
    }, 15000);
    pending.set(id, { done, reject, timer });
    backend.send({ type: "action", id, input });
  });
}
function power() {
  const active = !!current.task || current.busy || current.worker === "running";
  if (active && powerId === undefined) powerId = powerSaveBlocker.start("prevent-app-suspension");
  if (!active && powerId !== undefined) {
    powerSaveBlocker.stop(powerId);
    powerId = undefined;
  }
}
async function smokeReport() {
  if (!smoke || smokeFinished || (!current.ready && !current.error)) return;
  smokeFinished = true;
  const report = {
    packaged: app.isPackaged,
    ready: current.ready,
    error: current.error,
    workspace,
    studioUrl: current.studioUrl,
    shellVersions: process.versions,
    backendTools: current.tools,
    dataRoot,
    forbiddenHomebrewPath:
      backend?.spawnargs?.some((value) => value.includes("/opt/homebrew")) ?? false,
  };
  if (current.ready) {
    const response = await fetch(current.studioUrl);
    report.studioHttpStatus = response.status;
  }
  await fs.writeFile(resolve(dataRoot, "smoke-report.json"), JSON.stringify(report, null, 2));
  process.exitCode = report.ready && report.studioHttpStatus === 200 ? 0 : 1;
  quitting = true;
  app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showSetup);
  app.whenReady().then(async () => {
    showSetup();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "SAP Shorts",
          submenu: [
            { label: "Setup & engines", click: showSetup },
            {
              label: "Open creator studio",
              click: () => {
                try {
                  openStudio();
                } catch (error) {
                  dialog.showErrorBox("Studio is preparing", error.message);
                }
              },
            },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    ipcMain.handle("desktop:state", (event) => {
      trusted(event);
      return current;
    });
    ipcMain.handle("desktop:action", async (event, input) => {
      trusted(event);
      return request(input);
    });
    ipcMain.handle("desktop:studio", (event) => {
      trusted(event);
      openStudio();
    });
    ipcMain.handle("desktop:online", async (event, origin) => {
      trusted(event);
      const input = workerInput({ origin, name: "Mac" });
      await shell.openExternal(input.origin);
    });
    ipcMain.handle("desktop:files", async (event) => {
      trusted(event);
      await shell.openPath(dataRoot);
    });
    try {
      if (process.platform !== "darwin" || process.arch !== "arm64")
        throw new Error("This installer is built for an Apple Silicon Mac");
      await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
      const manifest = await installWorkspace(payload, workspace);
      current.version = manifest.version;
      current.revision = manifest.revision;
      const log = await fs.open(resolve(dataRoot, "backend.log"), "a", 0o600);
      backend = fork(resolve(workspace, "desktop-runtime/runner.cjs"), [], {
        execPath: resolve(payload, "bin/node"),
        cwd: workspace,
        env: desktopEnvironment(payload, workspace, dataRoot),
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      backend.stdout.on("data", (data) => void log.appendFile(data).catch(() => {}));
      backend.stderr.on("data", (data) => void log.appendFile(data).catch(() => {}));
      backend.on("message", (message) => {
        if (message.type === "state") {
          current = { ...current, ...message.state };
          publish();
          power();
          void smokeReport();
        }
        if (message.type === "reply") {
          const entry = pending.get(message.id);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(message.id);
            if (message.ok) entry.done();
            else entry.reject(new Error(message.error));
          }
        }
      });
      backend.on("exit", (code, signal) => {
        void log.close().catch(() => {});
        if (!quitting) {
          current.error = `Local backend stopped (${signal || code}). Restart the app to recover.`;
          current.ready = false;
          publish();
        }
      });
      backend.on("error", (error) => {
        current.error = error.message;
        publish();
        void smokeReport();
      });
      if (smoke)
        setTimeout(() => {
          if (!smokeFinished) {
            current.error = "Packaged startup exceeded 120 seconds";
            void smokeReport();
          }
        }, 120000).unref();
    } catch (error) {
      current.error = error.message;
      publish();
      void smokeReport();
    }
  });
  app.on("activate", showSetup);
  app.on("window-all-closed", () => {
    /* Keep renders running when a window is closed. Quit from the app menu. */
  });
  app.on("before-quit", (event) => {
    if (!quitting && (current.task || current.busy || current.worker === "running")) {
      event.preventDefault();
      void dialog
        .showMessageBox({
          type: "question",
          message: "Work is running on this Mac",
          detail: "Quitting interrupts active work. Closing a window keeps it running.",
          buttons: ["Keep running", "Quit"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(({ response }) => {
          if (response === 1) {
            quitting = true;
            app.quit();
          }
        });
      return;
    }
    quitting = true;
    if (backend?.pid) {
      try {
        process.kill(-backend.pid, "SIGTERM");
      } catch {
        /* already stopped */
      }
    }
    if (powerId !== undefined) powerSaveBlocker.stop(powerId);
  });
}
