import { initializeApp } from "@firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "@firebase/auth";
import type { Target } from "../../cloud/contracts.js";
import { kokoroVoices } from "../../media/voices.js";
import { voiceReadingScripts } from "../../voice-reading-scripts.js";
import { voiceAudition, voiceReadiness } from "./voice-status.js";

// biome-ignore lint/suspicious/noExplicitAny: Browser DTOs are validated by the private API; the editor preserves source-backed template fields.
type Data = Record<string, any>;
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const field = (id: string) => element<HTMLInputElement>(id);
const notice = (message: string, error = false) => {
  element("notice").textContent = message;
  element("notice").classList.toggle("error", error);
};
const uuid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
const config = await (await fetch("/v1/config")).json();
element("cloud-status").textContent = config.cloudEnabled
  ? "Enabled · on-demand paid compute"
  : "Not configured";
element("worker-commands").textContent = `npm ci
npm run mac:setup
npm run worker:register -- ${location.origin} "Mac mini"
npm run worker:start`;
const auth = getAuth(initializeApp(config));
if (config.authEmulatorUrl)
  element("environment").textContent =
    "LOCAL TEST WORKSPACE · Firebase emulators · No production cloud storage";
if (config.authEmulatorUrl)
  connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
let tenantId = "",
  episodes: Data[] = [],
  voices: Data[] = [],
  photos: Data[] = [],
  workers: Data[] = [],
  templates: Data[] = [],
  current: Data | null = null;
let polling: ReturnType<typeof setInterval> | null = null;
let refreshActive = false,
  generation = 0,
  jobsSignature = "",
  presenterSignature = "",
  recorded: Blob | null = null;
let historyJobs: Data[] = [],
  selectedVoiceId = "",
  voiceViewSignature = "";
const listenedAuditions = new Set<string>();
const urls = new Set<string>();
const photoUrls = new Map<string, Promise<string>>();
function blobUrl(bytes: Blob) {
  const url = URL.createObjectURL(bytes);
  urls.add(url);
  return url;
}
function node(tag: string, text?: string, className?: string) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function action(label: string, callback: () => unknown, style = "secondary") {
  const button = node("button", label, style) as HTMLButtonElement;
  button.type = "button";
  button.onclick = () => run(callback, button);
  return button;
}
async function run(callback: () => unknown, button?: HTMLButtonElement) {
  const version = generation;
  button ??=
    document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined;
  if (button) button.disabled = true;
  try {
    await callback();
  } catch (error) {
    if (version === generation) {
      const code = (error as { code?: string }).code;
      const messages: Record<string, string> = {
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/wrong-password": "Email or password is incorrect.",
        "auth/user-not-found": "Email or password is incorrect.",
        "auth/email-already-in-use":
          "The account could not be created. Try signing in or resetting your password.",
        "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
      };
      notice(code && messages[code] ? messages[code] : (error as Error).message, true);
    }
  } finally {
    if (button) button.disabled = false;
  }
}
async function api(
  path: string,
  input?: unknown,
  method = "POST",
  extra: Record<string, string> = {},
) {
  const version = generation;
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in to continue.");
  const response = await fetch(path, {
    redirect: "error",
    method: input === undefined ? "GET" : method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(input !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  });
  const rawText = await response.text();
  let data: any;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    if (!response.ok) {
      if (response.status === 404)
        throw new Error(
          "API backend unavailable. Connect to your local network (e.g. http://192.168.50.49:5890) where the studio server is running.",
        );
      throw new Error(`Server returned status ${response.status}`);
    }
    throw new Error("Invalid response from server.");
  }
  if (version !== generation) throw new Error("The session changed. Open your workspace again.");
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? "Request failed."), { code: data.code });
  return data;
}
const workspace = (path: string) => `/v1/workspaces/${tenantId}/${path}`;
async function media(assetId: string) {
  const version = generation;
  const token = await auth.currentUser?.getIdToken();
  const result = await fetch(workspace(`assets/${assetId}`), {
    redirect: "error",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!result.ok) throw new Error("This media is unavailable. Refresh the workspace.");
  const bytes = await result.blob();
  if (version !== generation) throw new Error("The session changed.");
  return blobUrl(bytes);
}
async function upload(path: string, bytes: Blob, headers: Record<string, string> = {}) {
  const version = generation;
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(workspace(path), {
    redirect: "error",
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      ...headers,
    },
    body: bytes,
  });
  const result = await response.json();
  if (version !== generation) throw new Error("The session changed.");
  if (!response.ok) throw new Error(result.error ?? "Upload failed.");
  return result;
}
function showTab(tab: string) {
  element("workspace").dataset.section = tab;
  for (const name of ["episodes", "voices", "photos", "engines"])
    element(`${name}-panel`).hidden = tab !== name;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.tab === tab);
  });
}
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
  button.onclick = () => showTab(button.dataset.tab ?? "episodes");
});
async function authenticate(signup = false) {
  await setPersistence(
    auth,
    field("remember").checked ? browserLocalPersistence : browserSessionPersistence,
  );
  if (signup) {
    const result = await createUserWithEmailAndPassword(
      auth,
      field("email").value,
      field("password").value,
    );
    await sendEmailVerification(result.user);
    notice("Account created. Check your verification email.");
  } else await signInWithEmailAndPassword(auth, field("email").value, field("password").value);
}
element<HTMLFormElement>("auth-form").onsubmit = (event) => {
  event.preventDefault();
  void run(() => authenticate());
};
element("signup").onclick = () => run(() => authenticate(true));
element("reset").onclick = () =>
  run(async () => {
    if (!field("email").value) throw new Error("Enter your email first.");
    await sendPasswordResetEmail(auth, field("email").value);
    notice("If an account uses that email, a reset link will arrive shortly.");
  });
element("resend").onclick = () =>
  run(async () => {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser);
    notice("Verification email requested.");
  });
element("verified").onclick = () =>
  run(async () => {
    await auth.currentUser?.reload();
    await auth.currentUser?.getIdToken(true);
    await enter();
  });
async function enter() {
  const user = auth.currentUser;
  element("auth").hidden = !!user;
  element("verification").hidden = !user || user.emailVerified;
  element("workspace").hidden = true;
  element("account").replaceChildren();
  if (!user) return;
  element("account").append(
    node("span", user.email ?? ""),
    action("Sign out", () => signOut(auth), "text"),
  );
  if (!user.emailVerified) return;
  await api("/v1/bootstrap", {});
  const account = await api("/v1/me");
  tenantId = account.workspace.id;
  templates = await api("/v1/templates");
  const select = element<HTMLSelectElement>("template");
  select.replaceChildren();
  for (const template of templates)
    select.add(new Option(template.episode.title, template.selector));
  element("workspace").hidden = false;
  await refresh();
  const pairing = /^#pair=([a-zA-Z0-9_-]+)$/u.exec(location.hash);
  if (pairing) {
    field("pair-id").value = pairing[1] ?? "";
    showTab("engines");
  }
  if (polling) clearInterval(polling);
  polling = setInterval(() => void run(refresh), 8000);
}
onAuthStateChanged(auth, () => {
  generation++;
  historyJobs = [];
  selectedVoiceId = "";
  voiceViewSignature = "";
  listenedAuditions.clear();
  element("voice-library").hidden = false;
  element("voice-form").hidden = true;
  element("editor").hidden = true;
  element("episodes-overview").hidden = false;
  notice("");
  voices = [];
  photos = [];
  workers = [];
  episodes = [];
  document.querySelectorAll<HTMLMediaElement>("audio,video").forEach((player) => {
    player.pause();
    player.removeAttribute("src");
    player.load();
  });
  recorded = null;
  if (recorder?.state === "recording") recorder.stop();
  for (const name of [
    "voice-name",
    "voice-transcript",
    "voice-file",
    "photo-name",
    "photo-file",
    "episode-title",
    "publication",
  ])
    field(name).value = "";
  field("consent").checked = false;
  field("trust-pool").checked = false;
  field("allow-cloud").checked = false;
  element<HTMLAudioElement>("record-preview").removeAttribute("src");
  element("record-preview").hidden = true;
  tenantId = "";
  current = null;
  jobsSignature = "";
  presenterSignature = "";
  photoUrls.clear();
  if (polling) {
    clearInterval(polling);
    polling = null;
  }
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  for (const name of [
    "episode-list",
    "jobs",
    "voice-list",
    "photo-list",
    "archived-photo-list",
    "worker-list",
    "archived-worker-list",
    "scenes",
    "speakers",
  ])
    element(name).replaceChildren();
  field("password").value = "";
  void run(enter);
});
function target(): Target {
  const value = field("destination").value;
  return value === "mac-pool"
    ? { mode: "mac-pool" }
    : value === "cloud"
      ? { mode: "cloud" }
      : { mode: "device", workerId: value };
}
async function refresh() {
  if (!tenantId || refreshActive) return;
  refreshActive = true;
  const version = generation;
  try {
    const [saved, profiles, devices, jobs, assets] = await Promise.all([
      api(workspace("episodes")),
      api(workspace("voices")),
      api(workspace("workers")),
      api(workspace("jobs")),
      api(workspace("assets")),
    ]);
    if (version !== generation || !auth.currentUser) return;
    episodes = saved;
    historyJobs = jobs;
    voices = profiles;
    workers = devices;
    photos = assets.filter((asset: Data) => asset.kind === "portrait");
    renderEpisodes();
    const presenters = JSON.stringify({ voices, photos });
    if (presenters !== presenterSignature) {
      presenterSignature = presenters;
      renderPhotos();
      if (current) renderSpeakers();
    }
    renderWorkers();
    renderVoices();
    renderProductionVoiceCheck();
    const signature = JSON.stringify(jobs);
    if (signature !== jobsSignature) {
      jobsSignature = signature;
      await renderJobs(jobs);
    }
  } finally {
    refreshActive = false;
  }
}
function renderEpisodes() {
  const list = element("episode-list");
  list.replaceChildren();
  if (!episodes.length)
    list.append(node("p", "Create your first draft from a starting script.", "muted"));
  for (const episode of episodes) {
    const item = node("article", undefined, "item");
    item.append(
      node("h3", episode.title),
      node("p", `Saved ${new Date(episode.updatedAt).toLocaleString()}`, "muted"),
      action("Edit script", () => openEditor(episode)),
    );
    list.append(item);
  }
}
const photoName = (photo: Data) => photo.name ?? `Portrait ${String(photo.id).slice(0, 8)}`;
const activePhotos = () => photos.filter((photo) => !photo.archivedAt);
function photoPreview(photo: Data) {
  const image = document.createElement("img");
  image.className = "portrait";
  image.alt = photoName(photo);
  if (!photoUrls.has(photo.id)) photoUrls.set(photo.id, media(photo.id));
  void run(async () => {
    image.src = (await photoUrls.get(photo.id)) as string;
  });
  return image;
}
async function uploadPortrait(file: File, name: string) {
  const photo = await upload("assets", file);
  await api(
    workspace(`assets/${photo.id}`),
    { name: name.trim() || file.name.replace(/\.[^.]+$/u, "").slice(0, 64) || "Portrait" },
    "PATCH",
  );
  return photo;
}
function renderPhotos() {
  const list = element("photo-list"),
    archived = element("archived-photo-list");
  list.replaceChildren();
  archived.replaceChildren();
  if (!activePhotos().length)
    list.append(node("p", "Upload a presenter photo to start your library.", "muted"));
  for (const photo of photos) {
    const card = node("article", undefined, "photo-card");
    card.append(photoPreview(photo), node("h3", photoName(photo)));
    const linked = voices.filter(
      (voice) => voice.status === "active" && voice.portraitIds?.includes(photo.id),
    );
    card.append(
      node(
        "p",
        linked.length
          ? `Linked to ${linked.map((voice) => voice.name).join(", ")}`
          : "Link this photo under My voices.",
        "muted",
      ),
    );
    card.append(
      action(
        "Rename",
        async () => {
          const name = prompt("Photo name", photoName(photo));
          if (name) {
            await api(workspace(`assets/${photo.id}`), { name }, "PATCH");
            await refresh();
          }
        },
        "text",
      ),
    );
    card.append(
      action(
        photo.archivedAt ? "Restore photo" : "Archive photo",
        async () => {
          await api(workspace(`assets/${photo.id}`), { archived: !photo.archivedAt }, "PATCH");
          await refresh();
        },
        "text",
      ),
    );
    (photo.archivedAt ? archived : list).append(card);
  }
  const count = photos.filter((photo) => photo.archivedAt).length;
  element("archived-photos").hidden = count === 0;
  element("archived-photo-count").textContent = `Archived photos (${count})`;
}
element("upload-photo").onclick = () =>
  run(async () => {
    const file = field("photo-file").files?.[0];
    if (!file) throw new Error("Choose a portrait first.");
    await uploadPortrait(file, field("photo-name").value);
    field("photo-file").value = "";
    field("photo-name").value = "";
    notice("Photo saved. Link it to a voice under My voices, or select it in an episode.");
    await refresh();
  });
function voicePhotoLinks(voice: Data) {
  const details = node("details");
  const linked = activePhotos().filter((photo) => voice.portraitIds?.includes(photo.id));
  details.append(node("summary", `Photos for this voice (${linked.length})`));
  if (!activePhotos().length) {
    details.append(
      node("p", "Add photos to your library first.", "muted"),
      action("Open My photos", () => showTab("photos")),
    );
    return details;
  }
  const previews = node("div", undefined, "linked-photos");
  for (const photo of linked) previews.append(photoPreview(photo));
  details.append(previews);
  const label = node("label", "Linked photos"),
    selection = document.createElement("select");
  selection.multiple = true;
  selection.setAttribute("aria-label", `${voice.name} linked photos`);
  for (const photo of activePhotos())
    selection.add(
      new Option(
        photoName(photo),
        photo.id,
        false,
        linked.some((item) => item.id === photo.id),
      ),
    );
  label.append(selection);
  details.append(label);
  const defaultLabel = node("label", "Default photo"),
    defaultChoice = document.createElement("select");
  defaultChoice.setAttribute("aria-label", `${voice.name} default photo`);
  const choices = (previous = defaultChoice.value) => {
    defaultChoice.replaceChildren(new Option("Choose per episode", ""));
    for (const option of selection.selectedOptions)
      defaultChoice.add(new Option(option.text, option.value));
    if ([...defaultChoice.options].some((option) => option.value === previous))
      defaultChoice.value = previous;
  };
  choices(voice.defaultPortraitId ?? "");
  selection.onchange = () => choices();
  defaultLabel.append(defaultChoice);
  details.append(defaultLabel);
  details.append(
    node(
      "p",
      "Select one or more photos. The default is available as a shortcut in the episode editor; each episode keeps its own choice.",
      "muted",
    ),
  );
  details.append(
    action("Save photo links", async () => {
      await api(
        workspace(`voices/${voice.id}`),
        {
          portraitIds: [...selection.selectedOptions].map((option) => option.value),
          defaultPortraitId: defaultChoice.value || null,
          expectedPortraitRevision: voice.portraitRevision ?? null,
        },
        "PATCH",
      );
      notice("Voice photo links saved. Existing episode choices are preserved.");
      await refresh();
    }),
  );
  return details;
}
function selectControl(
  label: string,
  options: [string, string][],
  selected: string,
  change: (value: string) => void,
) {
  const wrapper = node("label", label),
    select = document.createElement("select");
  select.setAttribute("aria-label", label);
  for (const [value, name] of options) select.add(new Option(name, value));
  select.value = selected;
  select.onchange = () => change(select.value);
  wrapper.append(select);
  return wrapper;
}
function editorPane(pane: string) {
  for (const name of ["script", "voice", "review"])
    element(`episode-${name}-pane`).hidden = name !== pane;
  document.querySelectorAll<HTMLButtonElement>("[data-episode-pane]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.episodePane === pane);
    button.setAttribute("aria-current", button.dataset.episodePane === pane ? "step" : "false");
  });
}
document.querySelectorAll<HTMLButtonElement>("[data-episode-pane]").forEach((button) => {
  button.onclick = () => editorPane(button.dataset.episodePane ?? "script");
});
function openEditor(record: Data) {
  current = structuredClone(record);
  element("editor").hidden = false;
  element("episodes-overview").hidden = true;
  editorPane("script");
  field("episode-title").value = current?.episode.title;
  field("publication").value = current?.episode.publication.text;
  const scenes = element("scenes");
  scenes.replaceChildren();
  for (const [index, scene] of (current?.episode.scenes ?? []).entries()) {
    const card = node("details", undefined, "scene") as HTMLDetailsElement;
    card.open = index === 0;
    card.append(node("summary", scene.visual.label));
    const label = node("label", "On-screen heading"),
      overlay = document.createElement("input");
    overlay.value = scene.overlay;
    overlay.oninput = () => {
      scene.overlay = overlay.value;
      dirty();
    };
    label.append(overlay);
    card.append(label);
    if (scene.dialogue)
      for (const turn of scene.dialogue) {
        const label = node("label", `${turn.speakerId} says`),
          input = document.createElement("textarea");
        input.value = turn.text;
        input.oninput = () => {
          turn.text = input.value;
          scene.narration = scene.dialogue.map((part: Data) => part.text).join(" ");
          dirty();
        };
        label.append(input);
        card.append(label);
      }
    else {
      const label = node("label", "Narration"),
        input = document.createElement("textarea");
      input.value = scene.narration;
      input.oninput = () => {
        scene.narration = input.value;
        dirty();
      };
      label.append(input);
      card.append(label);
    }
    scenes.append(card);
  }
  renderSpeakers();
  element("save-state").textContent =
    "Saved version. Voice and portrait changes apply to a new production.";
  element("editor").scrollIntoView({ behavior: "smooth" });
}
function dirty() {
  element("save-state").textContent = "Unsaved changes · Save before producing this version.";
}
function renderSpeakers() {
  const list = element("speakers");
  list.replaceChildren();
  for (const speaker of current?.episode.presentation.speakers ?? []) {
    const card = node("article", undefined, "engine");
    card.append(node("h3", speaker.name));
    const choices: [string, string][] = kokoroVoices.map((voice) => [
      voice.id,
      `${voice.name} · stock`,
    ]);
    for (const voice of voices.filter((voice) => voice.status === "active"))
      choices.push([`profile:${voice.id}:${voice.revision}`, `${voice.name} · My voice`]);
    card.append(
      selectControl(
        `${speaker.name} voice`,
        choices,
        typeof speaker.voice === "string"
          ? speaker.voice
          : `profile:${speaker.voice.profileId}:${speaker.voice.revision}`,
        (value) => {
          const [, profileId, revision] = value.split(":");
          speaker.voice = value.startsWith("profile:")
            ? { kind: "workspace-voice", tenantId, profileId, revision }
            : value;
          dirty();
          renderSpeakers();
        },
      ),
    );
    const profile =
      typeof speaker.voice === "string"
        ? null
        : voices.find((voice) => voice.id === speaker.voice.profileId);
    if (profile) {
      const state = readiness(profile);
      card.append(node("p", state.message, state.ready ? "badge ready" : "badge attention"));
      if (!state.ready) card.append(action("Review voice audition", () => openVoice(profile.id)));
    }
    const defaultPhoto = activePhotos().find((photo) => photo.id === profile?.defaultPortraitId);
    if (defaultPhoto)
      card.append(
        action("Use voice's default photo", () => {
          speaker.avatar = {
            ...speaker.avatar,
            mode: "photo",
            imageId: `${defaultPhoto.id}.png`,
            animation: speaker.avatar?.animation ?? "neural",
            motion: speaker.avatar?.motion ?? { style: "conversational", intensity: 0.7 },
          };
          dirty();
          renderSpeakers();
        }),
      );
    card.append(
      selectControl(
        `${speaker.name} avatar style`,
        [
          ["illustrated", "Illustrated presenter"],
          ["photo", "Photo portrait"],
        ],
        speaker.avatar?.mode ?? "illustrated",
        (value) => {
          speaker.avatar = {
            mode: value,
            ...(value === "photo"
              ? { animation: "neural", motion: { style: "conversational", intensity: 0.7 } }
              : {}),
          };
          dirty();
          renderSpeakers();
        },
      ),
    );
    if (speaker.avatar?.mode === "photo") {
      const ordered = activePhotos().sort(
        (a, b) =>
          Number(profile?.portraitIds?.includes(b.id) ?? false) -
          Number(profile?.portraitIds?.includes(a.id) ?? false),
      );
      const selectedPhoto = speaker.avatar.imageId?.replace(/\.png$/u, "") ?? "";
      const options: [string, string][] = [["", "Choose a saved photo"]];
      for (const photo of ordered)
        options.push([
          photo.id,
          `${photoName(photo)}${profile?.portraitIds?.includes(photo.id) ? " · linked to voice" : ""}`,
        ]);
      const archivedPhoto = photos.find((photo) => photo.id === selectedPhoto && photo.archivedAt);
      if (archivedPhoto)
        options.push([
          archivedPhoto.id,
          `${photoName(archivedPhoto)} · archived, selected for this episode`,
        ]);
      card.append(
        selectControl(`${speaker.name} saved photo`, options, selectedPhoto, (value) => {
          if (!value) delete speaker.avatar.imageId;
          else speaker.avatar.imageId = `${value}.png`;
          dirty();
          renderSpeakers();
        }),
      );
      const label = node("label", "Upload portrait (PNG, JPEG or WebP, up to 4 MB)"),
        uploadInput = document.createElement("input");
      uploadInput.type = "file";
      uploadInput.accept = "image/png,image/jpeg,image/webp";
      uploadInput.onchange = () =>
        run(async () => {
          const file = uploadInput.files?.[0];
          if (!file) return;
          const asset = await uploadPortrait(file, "");
          speaker.avatar.imageId = asset.imageId;
          dirty();
          notice("Portrait saved in your private workspace.");
          await refresh();
        });
      label.append(uploadInput);
      card.append(label);
      if (speaker.avatar.imageId) {
        const image = document.createElement("img");
        image.className = "portrait";
        image.alt = `${speaker.name} portrait`;
        card.append(image);
        void run(async () => {
          image.src = await media(speaker.avatar.imageId.replace(/\.png$/u, ""));
        });
      }
      card.append(
        selectControl(
          `${speaker.name} animation`,
          [
            ["neural", "Realistic portrait (compatible Mac required)"],
            ["mouth-only", "Lightweight lip animation"],
          ],
          speaker.avatar.animation ?? "neural",
          (value) => {
            speaker.avatar.animation = value;
            dirty();
          },
        ),
      );
    }
    list.append(card);
  }
  renderProductionVoiceCheck();
}
element("episode-title").oninput = dirty;
element("publication").oninput = dirty;
element("close-editor").onclick = () => {
  current = null;
  element("editor").hidden = true;
  element("episodes-overview").hidden = false;
};
element("new-script").onclick = () =>
  run(async () => {
    const template = templates.find((item) => item.selector === field("template").value);
    const saved = await api(workspace("episodes"), {
      episode: template?.episode,
      expectedRevision: null,
    });
    await refresh();
    openEditor(saved);
  });
async function save() {
  if (!current) throw new Error("Open a script first.");
  current.episode.title = field("episode-title").value;
  current.episode.publication.text = field("publication").value;
  const saved = await api(workspace(`episodes/${current.id}`), {
    episode: current.episode,
    expectedRevision: current.revision,
  });
  current = saved;
  element("save-state").textContent = "Saved in your private workspace.";
  await refresh();
  return saved;
}
element("save-script").onclick = () => run(save);
element("produce").onclick = () =>
  run(async () => {
    const saved = await save();
    await api(
      workspace("jobs"),
      { kind: "episode", episodeId: saved.id, revision: saved.revision, target: target() },
      "POST",
      { "idempotency-key": uuid() },
    );
    notice("Production queued. Find it in Generation history.");
    await refresh();
  });
function readiness(voice: Data) {
  return voiceReadiness(
    voice as Parameters<typeof voiceReadiness>[0],
    target(),
    workers as Parameters<typeof voiceReadiness>[2],
    config.cloudRuntimeDigest ?? undefined,
  );
}
function auditionFor(voice: Data) {
  return voiceAudition(
    voice as Parameters<typeof voiceAudition>[0],
    historyJobs as (Data & Parameters<typeof voiceAudition>[1][number])[],
    target(),
    workers as Parameters<typeof voiceAudition>[3],
    config.cloudRuntimeDigest ?? undefined,
  );
}
function openVoice(id: string) {
  selectedVoiceId = id;
  showTab("voices");
  element("voice-library").hidden = false;
  element("voice-form").hidden = true;
  renderVoices();
  element("voice-library").scrollIntoView({ block: "start", behavior: "smooth" });
}
function renderProductionVoiceCheck() {
  const list = element("production-voice-check");
  list.replaceChildren();
  let blocked = false;
  for (const speaker of current?.episode.presentation.speakers ?? []) {
    if (typeof speaker.voice === "string") continue;
    const voice = voices.find((item) => item.id === speaker.voice.profileId);
    const state = voice && voice.revision === speaker.voice.revision ? readiness(voice) : null;
    if (state?.ready) continue;
    blocked = true;
    const row = node("div", undefined, "voice-warning");
    row.append(
      node(
        "span",
        `${speaker.name} · ${voice?.name ?? "Personal voice"}: ${state?.message ?? "Voice version unavailable"}.`,
      ),
    );
    if (voice) row.append(action("Review voice audition", () => openVoice(voice.id)));
    list.append(row);
  }
  element<HTMLButtonElement>("produce").disabled = blocked;
}
async function queueAudition(voice: Data) {
  await api(
    workspace("jobs"),
    { kind: "audition", profileId: voice.id, target: target() },
    "POST",
    { "idempotency-key": uuid() },
  );
  notice("Audition queued. Stay here; playback and approval will appear when it finishes.");
  await refresh();
}
function auditionPlayer(job: Data, label: string, onListened?: () => void) {
  const wrapper = node("div", undefined, "audition-player");
  const play = action(label, async () => {
    const assets = await api(workspace("assets"));
    const asset = assets.find(
      (asset: Data) => job.outputIds.includes(asset.id) && asset.kind === "audition",
    );
    if (!asset) throw new Error("This audition is unavailable. Generate a new one.");
    let player = wrapper.querySelector("audio");
    if (!player) {
      player = document.createElement("audio");
      player.controls = true;
      player.setAttribute("aria-label", label);
      player.onended = () => {
        listenedAuditions.add(job.id);
        onListened?.();
      };
      player.src = await media(asset.id);
      wrapper.append(player);
    }
    await player.play();
  });
  wrapper.append(play);
  return wrapper;
}
function renderVoices() {
  const active = voices.filter((voice) => voice.status === "active");
  if (!active.some((voice) => voice.id === selectedVoiceId)) selectedVoiceId = active[0]?.id ?? "";
  const voice = active.find((voice) => voice.id === selectedVoiceId);
  const state = voice ? readiness(voice) : null;
  const audition = voice ? auditionFor(voice) : null;
  const signature = JSON.stringify({
    active: active.map(({ id, name }) => ({ id, name })),
    voice,
    state,
    audition,
    photos: photos.map(({ id, name, archivedAt }) => ({ id, name, archivedAt })),
  });
  if (signature === voiceViewSignature) return;
  voiceViewSignature = signature;
  const select = element<HTMLSelectElement>("saved-voice");
  select.replaceChildren();
  for (const voice of active) select.add(new Option(voice.name, voice.id));
  if (!active.length) select.add(new Option("No personal voices saved yet", ""));
  select.value = selectedVoiceId;
  select.disabled = !active.length;
  const list = element("voice-list");
  list.replaceChildren();
  if (!voice || !state) {
    list.append(
      node(
        "p",
        "Add a short recording to create your personal narrator. Stock voices are ready in the episode editor.",
        "muted",
      ),
    );
    return;
  }
  const summary = node("div", undefined, "voice-summary");
  const recording = node("section");
  const badge = node("span", state.message, state.ready ? "badge ready" : "badge attention");
  recording.append(
    badge,
    node(
      "p",
      `${Number(voice.profile?.durationSeconds ?? 0).toFixed(1)}s reference · ${voice.name}`,
      "muted",
    ),
  );
  if (audition?.state === "SUCCEEDED") {
    let accept: HTMLButtonElement | null = null;
    const approved = state.approval?.auditionJobId === audition.id;
    recording.append(
      auditionPlayer(audition, approved ? "Play approved audition" : "Listen to audition", () => {
        if (accept) accept.disabled = false;
      }),
    );
    if (!approved) {
      recording.append(
        node("p", "Listen to the full audition, then approve it if it sounds like you.", "muted"),
      );
      accept = action(
        "Accept this voice",
        async () => {
          await api(workspace(`jobs/${audition.id}/accept`), {});
          notice(`${voice.name} is ready. Return to your script to produce.`);
          await refresh();
        },
        "",
      );
      accept.disabled = !listenedAuditions.has(audition.id);
      recording.append(accept);
    } else
      recording.append(
        node("p", "Audition approved for the selected rendering destination.", "muted"),
      );
  } else if (audition && !["FAILED", "CANCELLED"].includes(audition.state)) {
    recording.append(
      node(
        "p",
        `${audition.state === "QUEUED" ? "Waiting for a compatible engine" : "Generating your audition"} · this panel updates automatically.`,
        "muted",
      ),
    );
    recording.append(
      action(
        "Cancel audition",
        async () => {
          await api(workspace(`jobs/${audition.id}/cancel`), {});
          await refresh();
        },
        "text",
      ),
    );
  } else {
    recording.append(
      node(
        "p",
        audition?.issue ??
          "Generate a short audition to hear this voice before using it in a video.",
        "muted",
      ),
    );
    recording.append(
      action(audition ? "Try audition again" : "Generate audition", () => queueAudition(voice), ""),
    );
  }
  const options = node("section");
  if (state.ready && current)
    options.append(
      action(
        "Return to script",
        () => {
          showTab("episodes");
          element("editor").scrollIntoView({ block: "start", behavior: "smooth" });
        },
        "",
      ),
    );
  options.append(voicePhotoLinks(voice));
  const settings = node("details"),
    settingsTitle = node("summary", "Reference & voice settings");
  settings.append(settingsTitle);
  settings.append(
    action("Listen to reference", async () => {
      let audio = settings.querySelector("audio");
      if (!audio) {
        audio = document.createElement("audio");
        audio.controls = true;
        audio.src = await media(voice.sampleAssetId);
        settings.append(audio);
      }
      await audio.play();
    }),
  );
  settings.append(action("Generate a new audition", () => queueAudition(voice)));
  settings.append(
    action(
      "Delete voice",
      async () => {
        if (
          !confirm(
            "Delete this voice reference and its auditions? Existing videos remain available.",
          )
        )
          return;
        await api(workspace(`voices/${voice.id}`), {}, "DELETE");
        await refresh();
      },
      "text",
    ),
  );
  options.append(settings);
  summary.append(recording, options);
  list.append(summary);
}
element<HTMLSelectElement>("saved-voice").onchange = () => {
  selectedVoiceId = field("saved-voice").value;
  renderVoices();
};
element("destination").onchange = () => {
  renderVoices();
  renderProductionVoiceCheck();
};
function voiceFormStep(review: boolean) {
  if (recordingPending || recordingStopping || recorder?.state === "recording") return;
  if (review && !recorded && !field("voice-file").files?.length) {
    element("voice-form-status").textContent = "Record or upload your sample first.";
    return;
  }
  element("voice-form-status").textContent = review
    ? "Listen back and check the transcript before saving."
    : "Record one passage. You can review before saving.";
  element(review ? "voice-review-audio" : "voice-record-audio").append(element("record-preview"));
  element("voice-record-pane").hidden = review;
  element("voice-review-pane").hidden = !review;
  element("voice-next").hidden = review;
  element("voice-back").hidden = !review;
  element("upload-voice").hidden = !review;
  element("voice-step-record").setAttribute("aria-current", review ? "false" : "step");
  element("voice-step-review").setAttribute("aria-current", review ? "step" : "false");
}
element("add-voice").onclick = () => {
  element("voice-library").hidden = true;
  element("voice-form").hidden = false;
  voiceFormStep(false);
};
element("close-voice-form").onclick = () => {
  element("voice-library").hidden = false;
  element("voice-form").hidden = true;
};
element("voice-next").onclick = element("voice-step-review").onclick = () => voiceFormStep(true);
element("voice-back").onclick = element("voice-step-record").onclick = () => voiceFormStep(false);
element("cloud-consent").hidden = !config.cloudEnabled;
function renderWorkers() {
  const list = element("worker-list"),
    archived = element("archived-worker-list");
  list.replaceChildren();
  archived.replaceChildren();
  const destination = element<HTMLSelectElement>("destination"),
    previous = destination.value;
  destination.replaceChildren(new Option("Next available compatible Mac", "mac-pool"));
  const trusted = element<HTMLSelectElement>("trusted-devices"),
    selected = new Set([...trusted.selectedOptions].map((option) => option.value));
  trusted.replaceChildren();
  for (const worker of workers.filter((worker) => worker.providerId === "mac")) {
    const card = node("article", undefined, "engine");
    card.append(
      node("h3", worker.name),
      node("span", worker.availability.replaceAll("-", " "), "badge"),
      node(
        "p",
        worker.capabilities.map((cap: Data) => cap.engine).join(" · ") ||
          "Waiting for device diagnostics",
        "muted",
      ),
      node(
        "p",
        worker.lastSeenAt
          ? `Last seen ${new Date(worker.lastSeenAt).toLocaleTimeString()}`
          : "Start the worker on this Mac.",
        "muted",
      ),
    );
    if (worker.activeJobId)
      card.append(node("p", `Current job ${worker.activeJobId.slice(0, 8)}`, "muted"));
    if (worker.status !== "revoked" && !worker.archivedAt) {
      card.append(
        action(worker.status === "active" ? "Pause new jobs" : "Resume", async () => {
          await api(
            workspace(`workers/${worker.id}`),
            { status: worker.status === "active" ? "draining" : "active" },
            "PATCH",
          );
          await refresh();
        }),
        action(
          "Rename",
          async () => {
            const name = prompt("Device name", worker.name);
            if (name) {
              await api(workspace(`workers/${worker.id}`), { name }, "PATCH");
              await refresh();
            }
          },
          "text",
        ),
        action(
          "Revoke",
          async () => {
            if (confirm(`Revoke ${worker.name}? It will lose access to job inputs.`)) {
              await api(workspace(`workers/${worker.id}`), { status: "revoked" }, "PATCH");
              await refresh();
            }
          },
          "text",
        ),
      );
      destination.add(new Option(`${worker.name} · ${worker.availability}`, worker.id));
      const option = new Option(worker.name, worker.id);
      option.selected = selected.has(worker.id);
      trusted.add(option);
    } else if (!worker.archivedAt) {
      card.append(
        action(
          "Archive engine",
          async () => {
            await api(workspace(`workers/${worker.id}`), { archived: true }, "PATCH");
            await refresh();
          },
          "text",
        ),
      );
    }
    (worker.archivedAt ? archived : list).append(card);
  }
  const archivedCount = workers.filter(
    (worker) => worker.providerId === "mac" && worker.archivedAt,
  ).length;
  element("archived-workers").hidden = archivedCount === 0;
  element("archived-worker-count").textContent = `Archived engines (${archivedCount})`;
  if (!workers.some((worker) => worker.providerId === "mac" && !worker.archivedAt))
    list.append(node("p", "No Macs registered. Add your Mac mini or laptop below.", "muted"));
  if (config.cloudEnabled)
    destination.add(new Option("Google Cloud GPU · approved paid compute", "cloud"));
  if ([...destination.options].some((option) => option.value === previous))
    destination.value = previous;
}
function editTimingReview(job: Data) {
  const record = episodes.find((episode) => episode.id === job.episodeId);
  if (!record)
    throw new Error(
      "The original script is unavailable. Create a new draft to revise its narration.",
    );
  showTab("episodes");
  openEditor(record);
  const first = element("scenes").querySelector("details");
  if (!first) return;
  first.open = true;
  const timing = job.timingReview;
  const note = node(
    "p",
    timing.hookTooLong
      ? `This version's opening recorded at ${Number(timing.hookSeconds).toFixed(1)}s; the limit is 3s. Shorten the first spoken line, save, then produce the new version.`
      : `The failed version recorded at ${Number(timing.durationSeconds).toFixed(1)}s; the target is 45–60s. Adjust the spoken narration, save, then produce the new version.`,
    "voice-warning",
  );
  if (record.revision !== job.episodeRevision)
    note.textContent += " This is your latest saved draft; it may differ from the failed version.";
  first.querySelector("summary")?.after(note);
  first.querySelector("textarea")?.focus({ preventScroll: true });
}
async function renderJobs(jobs: Data[]) {
  const list = element("jobs");
  list.replaceChildren();
  if (!jobs.length)
    list.append(node("p", "Your auditions and video productions will appear here.", "muted"));
  for (const job of jobs) {
    const item = node("details", undefined, "item history-job") as HTMLDetailsElement;
    item.open = !["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state);
    const heading = node("summary");
    heading.append(
      node(
        "span",
        job.title ?? (job.kind === "audition" ? "Voice audition" : "Episode production"),
      ),
      node("span", job.timingReview ? "Needs script edit" : job.state, "badge"),
    );
    item.append(heading);
    item.append(
      node("h3", job.title ?? (job.kind === "audition" ? "Voice audition" : "Episode production")),
      node(
        "span",
        job.timingReview ? "Timing review · narration generated" : `${job.state} · ${job.stage}`,
        "badge",
      ),
      node(
        "p",
        `${new Date(job.createdAt).toLocaleString()} · ${workers.find((worker) => worker.id === job.workerId)?.name ?? "Waiting for a compatible engine"}`,
        "muted",
      ),
    );
    if (job.speakers?.length)
      item.append(
        node(
          "p",
          job.speakers.map((speaker: Data) => `${speaker.name}: ${speaker.voice}`).join(" · "),
          "muted",
        ),
      );
    if (job.timingReview) {
      const timing = job.timingReview;
      item.append(
        node(
          "p",
          `Opening: ${Number(timing.hookSeconds).toFixed(1)}s (maximum 3s). Total: ${Number(timing.durationSeconds).toFixed(1)}s (${timing.totalWithinRange ? "within the 45–60s target" : "outside the 45–60s target"}).`,
        ),
      );
      item.append(
        node(
          "p",
          "Revise the spoken script, save, and produce the new version. Retrying unchanged wording can repeat this result.",
          "muted",
        ),
      );
      item.append(
        action(
          timing.hookTooLong ? "Edit opening" : "Edit narration",
          () => editTimingReview(job),
          "",
        ),
      );
    } else if (job.issue) item.append(node("p", job.issue));
    if (!job.timingReview && ["FAILED", "CANCELLED"].includes(job.state))
      item.append(
        action("Retry with selected engine", async () => {
          await api(workspace(`jobs/${job.id}/retry`), { target: target() }, "POST", {
            "idempotency-key": uuid(),
          });
          await refresh();
        }),
      );
    if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state))
      item.append(
        action(
          "Cancel",
          async () => {
            await api(workspace(`jobs/${job.id}/cancel`), {});
            await refresh();
          },
          "text",
        ),
      );
    if (job.state === "SUCCEEDED") {
      let acceptButton: HTMLButtonElement | null = null;
      if (job.kind === "audition" && !job.voiceAcceptedAt) {
        acceptButton = action("Accept this voice", async () => {
          await api(workspace(`jobs/${job.id}/accept`), {});
          notice(
            "Audition accepted for this voice and runtime. Select the saved profile in your script.",
          );
          await refresh();
        });
        acceptButton.disabled = !listenedAuditions.has(job.id);
      }
      if (job.voiceAcceptedAt) item.append(node("p", "Accepted for this voice runtime", "muted"));
      item.append(
        node(
          "p",
          `Generated in ${Math.round(job.metrics.totalMs / 1000)}s · ${Number(job.metrics.durationSeconds).toFixed(1)}s ${job.kind === "audition" ? "audio" : "video"} · waited ${Math.round((job.queueMs ?? 0) / 1000)}s · ready in ${Math.round((job.elapsedMs ?? job.metrics.totalMs) / 1000)}s`,
          "muted",
        ),
      );
      item.append(
        action(job.kind === "audition" ? "Listen to audition" : "Watch video", async () => {
          const assets = await api(workspace("assets"));
          const asset = assets.find(
            (asset: Data) =>
              job.outputIds.includes(asset.id) &&
              asset.kind === (job.kind === "audition" ? "audition" : "video"),
          );
          if (!asset) throw new Error("Media unavailable.");
          const player = document.createElement(job.kind === "audition" ? "audio" : "video");
          player.controls = true;
          player.addEventListener("ended", () => {
            listenedAuditions.add(job.id);
            if (acceptButton) acceptButton.disabled = false;
          });
          player.src = await media(asset.id);
          item.append(player);
          await player.play();
        }),
      );
      if (acceptButton) item.append(acceptButton);
      else if (job.kind === "episode")
        item.append(
          action("Download episode", async () => {
            const assets = await api(workspace("assets"));
            const asset = assets.find(
              (asset: Data) => job.outputIds.includes(asset.id) && asset.kind === "package",
            );
            if (!asset) throw new Error("Package unavailable.");
            const link = document.createElement("a");
            link.href = await media(asset.id);
            link.download = "sap-short.zip";
            link.click();
          }),
        );
    }
    list.append(item);
  }
}
element("refresh").onclick = () => run(refresh);
element("check-interrupted").onclick = () =>
  run(async () => {
    await api(workspace("reconcile"), {});
    await refresh();
  });
element<HTMLFormElement>("pair-form").onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    const result = await api(workspace(`pairings/${field("pair-id").value}/approve`), {
      code: field("pair-code").value,
    });
    notice(`Approved ${result.name}. Start its worker to report availability.`);
    field("pair-code").value = "";
    history.replaceState(null, "", "/");
    await refresh();
  });
};
const readingChoice = element<HTMLSelectElement>("voice-reading-choice");
for (const passage of voiceReadingScripts) {
  const option = node("option", passage.label) as HTMLOptionElement;
  option.value = passage.id;
  readingChoice.append(option);
}
function selectedPassage() {
  return (
    voiceReadingScripts.find((passage) => passage.id === readingChoice.value) ??
    voiceReadingScripts[0]
  );
}
function showPassage() {
  const passage = selectedPassage();
  element("voice-reading-text").textContent = passage.text;
  element("voice-reading-guidance").textContent = passage.guidance;
}
readingChoice.onchange = showPassage;
element("voice-reading-use").onclick = () => {
  field("voice-transcript").value = selectedPassage().text;
  element("voice-form-status").textContent =
    "Transcript filled. Read these words, or edit the transcript to match your recording.";
};
showPassage();
if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
  element("record-state").textContent = !window.isSecureContext
    ? "Microphone is blocked by iOS Safari over HTTP. Use 'Or upload audio' below."
    : "Microphone recording is unavailable in this browser.";
}
let recorder: MediaRecorder | null = null;
let recordingPending = false;
let recordingStopping = false;
function lockRecording(locked: boolean) {
  for (const id of [
    "voice-reading-choice",
    "voice-reading-use",
    "voice-transcript",
    "voice-file",
    "upload-voice",
    "close-voice-form",
    "voice-next",
    "voice-back",
    "voice-step-record",
    "voice-step-review",
  ])
    (element(id) as HTMLInputElement).disabled = locked;
}
field("voice-file").onchange = () => {
  const sample = field("voice-file").files?.[0];
  if (!sample) return;
  recorded = null;
  const preview = element<HTMLAudioElement>("record-preview");
  preview.src = blobUrl(sample);
  preview.hidden = false;
  element("record-state").textContent =
    "Uploaded recording selected. Check that its transcript matches.";
};
element("upload-voice").onclick = () =>
  run(async () => {
    if (recordingPending || recordingStopping || recorder?.state === "recording")
      throw new Error("Stop recording before saving a voice sample.");
    const sample = recorded ?? field("voice-file").files?.[0];
    if (!sample) throw new Error("Record or choose a sample first.");
    const metadata = {
      name: field("voice-name").value,
      transcript: field("voice-transcript").value,
      consent: field("consent").checked,
      allowMac: field("allow-mac").checked,
      allowCloud: field("allow-cloud").checked,
      trustedMacPool: field("trust-pool").checked,
      trustedWorkerIds: [...element<HTMLSelectElement>("trusted-devices").selectedOptions].map(
        (option) => option.value,
      ),
    };
    const encoded = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(metadata))),
    );
    const saved = await upload("voices", sample, { "x-voice-metadata": encoded });
    selectedVoiceId = saved.id;
    recorded = null;
    field("voice-file").value = "";
    field("voice-name").value = "";
    field("voice-transcript").value = "";
    field("consent").checked = false;
    const preview = element<HTMLAudioElement>("record-preview");
    preview.pause();
    preview.removeAttribute("src");
    preview.hidden = true;
    notice("Sample saved. Generate an audition here, then listen and accept it.");
    await refresh();
    openVoice(saved.id);
  });
element("record").onclick = () =>
  run(async () => {
    if (recordingPending || recordingStopping) return;
    if (recorder?.state === "recording") {
      recordingStopping = true;
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const msg = !window.isSecureContext
        ? "Microphone access is blocked by mobile browsers over unencrypted HTTP. Use 'Or upload audio' below (e.g. from Voice Memos) or open the studio on your Mac at http://localhost:5890."
        : "Microphone recording is unavailable here. Upload an audio recording instead.";
      throw new Error(msg);
    }
    recordingPending = true;
    lockRecording(true);
    const recordingGeneration = generation;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordingGeneration !== generation) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      const chunks: Blob[] = [];
      const activeRecorder = new MediaRecorder(stream);
      recorder = activeRecorder;
      let failed = false;
      let timer: ReturnType<typeof setTimeout>;
      let elapsed: ReturnType<typeof setInterval>;
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(elapsed);
        recordingStopping = false;
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
        lockRecording(false);
      };
      activeRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      activeRecorder.onerror = () => {
        failed = true;
        cleanup();
        if (recordingGeneration === generation) {
          element("record").textContent = "Record sample";
          element("record-state").textContent =
            "Recording failed. Try again or upload a recording.";
        }
      };
      activeRecorder.onstop = () => {
        cleanup();
        if (failed || recordingGeneration !== generation) return;
        recorded = new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" });
        field("voice-file").value = "";
        const preview = element<HTMLAudioElement>("record-preview");
        preview.src = blobUrl(recorded);
        preview.hidden = false;
        element("record").textContent = "Record again";
        element("record-state").textContent =
          "Sample ready. Listen and check the transcript before saving.";
      };
      activeRecorder.start();
      const started = Date.now();
      const updateTime = () => {
        element("record-state").textContent =
          `Recording · ${Math.floor((Date.now() - started) / 1000)}s · stop when finished (auto-stop at 29s)`;
      };
      updateTime();
      elapsed = setInterval(updateTime, 1000);
      // Leave room for encoder padding within the 30s reference limit.
      timer = setTimeout(() => {
        if (activeRecorder.state === "recording") {
          recordingStopping = true;
          activeRecorder.stop();
        }
      }, 29_000);
      element("record").textContent = "Stop recording";
    } catch (error) {
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      lockRecording(false);
      throw error;
    } finally {
      recordingPending = false;
      if (recorder?.state !== "recording") lockRecording(false);
    }
  });
