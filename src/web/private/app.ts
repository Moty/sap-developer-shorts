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
import { kokoroVoices } from "../../media/voices.js";

// biome-ignore lint/suspicious/noExplicitAny: Browser DTOs are validated by the private API; the editor preserves source-backed template fields.
type Data = Record<string, any>;
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const field = (id: string) => element<HTMLInputElement>(id);
const notice = (message: string, error = false) => {
  element("notice").textContent = message;
  element("notice").classList.toggle("error", error);
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
  const data = await response.json();
  if (version !== generation) throw new Error("The session changed. Open your workspace again.");
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
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
function target() {
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
    voices = profiles;
    workers = devices;
    photos = assets.filter((asset: Data) => asset.kind === "portrait");
    renderEpisodes();
    const presenters = JSON.stringify({ voices, photos });
    if (presenters !== presenterSignature) {
      presenterSignature = presenters;
      renderPhotos();
      renderVoices();
      if (current) renderSpeakers();
    }
    renderWorkers();
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
function openEditor(record: Data) {
  current = structuredClone(record);
  element("editor").hidden = false;
  field("episode-title").value = current?.episode.title;
  field("publication").value = current?.episode.publication.text;
  const scenes = element("scenes");
  scenes.replaceChildren();
  for (const scene of current?.episode.scenes ?? []) {
    const card = node("div", undefined, "scene");
    card.append(node("h3", scene.visual.label));
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
}
element("episode-title").oninput = dirty;
element("publication").oninput = dirty;
element("close-editor").onclick = () => {
  current = null;
  element("editor").hidden = true;
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
      { "idempotency-key": crypto.randomUUID() },
    );
    notice("Production queued. Find it in Generation history.");
    await refresh();
  });
function renderVoices() {
  const list = element("voice-list");
  list.replaceChildren();
  if (!voices.length) list.append(node("p", "Your saved samples will appear here.", "muted"));
  for (const voice of voices) {
    const item = node("article", undefined, "item");
    item.append(
      node("h3", voice.name),
      node(
        "p",
        `${Number(voice.profile?.durationSeconds ?? 0).toFixed(1)}s reference · ${voice.status}`,
        "muted",
      ),
    );
    if (voice.status !== "active") {
      list.append(item);
      continue;
    }
    item.append(voicePhotoLinks(voice));
    item.append(
      action("Generate audition", async () => {
        await api(
          workspace("jobs"),
          { kind: "audition", profileId: voice.id, target: target() },
          "POST",
          { "idempotency-key": crypto.randomUUID() },
        );
        notice("Audition queued. Listen in Generation history, then accept it.");
        await refresh();
        showTab("episodes");
      }),
      action("Listen to reference", async () => {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = await media(voice.sampleAssetId);
        item.append(audio);
        await audio.play();
      }),
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
    list.append(item);
  }
}
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
async function renderJobs(jobs: Data[]) {
  const list = element("jobs");
  list.replaceChildren();
  if (!jobs.length)
    list.append(node("p", "Your auditions and video productions will appear here.", "muted"));
  for (const job of jobs) {
    const item = node("article", undefined, "item");
    item.append(
      node("h3", job.title ?? (job.kind === "audition" ? "Voice audition" : "Episode production")),
      node("span", `${job.state} · ${job.stage}`, "badge"),
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
    if (job.issue) item.append(node("p", job.issue));
    if (["FAILED", "CANCELLED"].includes(job.state))
      item.append(
        action("Retry with selected engine", async () => {
          await api(workspace(`jobs/${job.id}/retry`), { target: target() }, "POST", {
            "idempotency-key": crypto.randomUUID(),
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
        acceptButton.disabled = true;
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
element("upload-voice").onclick = () =>
  run(async () => {
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
    await upload("voices", sample, { "x-voice-metadata": encoded });
    recorded = null;
    field("voice-file").value = "";
    notice("Voice sample saved in this workspace. Generate an audition to approve how it sounds.");
    await refresh();
  });
let recorder: MediaRecorder | null = null;
element("record").onclick = () =>
  run(async () => {
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const recordingGeneration = generation;
    const activeRecorder = recorder;
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      if (recordingGeneration !== generation) return;
      recorded = new Blob(chunks, { type: recorder?.mimeType ?? "audio/webm" });
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      const preview = element<HTMLAudioElement>("record-preview");
      preview.src = blobUrl(recorded);
      preview.hidden = false;
      element("record").textContent = "Record again";
      element("record-state").textContent = "Sample ready to save";
    };
    recorder.start();
    element("record").textContent = "Stop recording";
    element("record-state").textContent = "Recording · stop after 10–15 seconds";
    setTimeout(() => {
      if (activeRecorder.state === "recording") activeRecorder.stop();
    }, 30_000);
  });
