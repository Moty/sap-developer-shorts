import type { FirebaseClientConfig } from "./config.js";

/**
 * Generates the self-contained browser script (`firebase-bridge.js`) injected
 * into `dist/studio` HTML pages for Firebase Hosting.
 *
 * Dual-Mode Guarantee:
 * - On startup, probes `GET /api/health`. If a local Node studio server
 *   (`npm run shorts -- serve`) responds with `{ status: "ok" }` and has not
 *   opted into static-only mode, the bridge leaves native `/api/*` and
 *   `EventSource` untouched.
 * - On Firebase Hosting (or any static server without `/api/health`), the
 *   bridge intercepts `fetch("/api/*")` and `new EventSource("/api/productions/:id/stream")`
 *   and routes them through Cloud Firestore & Firebase Cloud Storage.
 */
export function renderFirebaseBridgeScript(config: FirebaseClientConfig): string {
  const serializedConfig = JSON.stringify(config);
  return `(() => {
  const CONFIG = window.__FIREBASE_STUDIO_CONFIG__ || ${serializedConfig};
  const nativeFetch = window.fetch.bind(window);
  const NativeEventSource = window.EventSource;

  let bridgeModePromise = null;
  let authTokenPromise = null;
  let cachedToken = null;
  let cachedTokenExpiry = 0;
  let authUnavailableUntil = 0;
  let cachedUid = "studio-browser";
  const inMemoryAvatars = new Map();

  function detectBridgeMode() {
    if (bridgeModePromise) return bridgeModePromise;
    bridgeModePromise = (async () => {
      if (window.__FORCE_FIREBASE_BRIDGE__ === true) return "firebase";
      const host = window.location.hostname || "";
      if (host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) {
        return "firebase";
      }
      try {
        const res = await nativeFetch("/api/health", { cache: "no-store" });
        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.includes("application/json")) {
          const data = await res.json();
          if (data && data.status === "ok" && data.mode !== "firebase-static") {
            return "local";
          }
        }
      } catch {
        /* no local server */
      }
      return "firebase";
    })();
    return bridgeModePromise;
  }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function uuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function ensureAuthToken() {
    if (!CONFIG.apiKey || Date.now() < authUnavailableUntil) return null;
    if (cachedToken && cachedTokenExpiry - Date.now() > 60000) {
      return cachedToken;
    }
    if (authTokenPromise) return authTokenPromise;
    authTokenPromise = (async () => {
      try {
        const stored = sessionStorage.getItem("sap_shorts_fb_auth");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.idToken && parsed.expiresAt - Date.now() > 60000) {
            cachedToken = parsed.idToken;
            cachedTokenExpiry = parsed.expiresAt;
            cachedUid = parsed.localId || cachedUid;
            return cachedToken;
          }
        }
      } catch {}
      try {
        const res = await nativeFetch(
          "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" +
            encodeURIComponent(CONFIG.apiKey),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ returnSecureToken: true }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          cachedToken = data.idToken || null;
          cachedUid = data.localId || cachedUid;
          cachedTokenExpiry = Date.now() + Number(data.expiresIn || 3600) * 1000;
          try {
            sessionStorage.setItem(
              "sap_shorts_fb_auth",
              JSON.stringify({
                idToken: cachedToken,
                localId: cachedUid,
                expiresAt: cachedTokenExpiry,
              })
            );
          } catch {}
          return cachedToken;
        }
        authUnavailableUntil = Date.now() + 300000;
      } catch {
        authUnavailableUntil = Date.now() + 60000;
      }
      return null;
    })().finally(() => {
      authTokenPromise = null;
    });
    return authTokenPromise;
  }

  function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === "boolean") return { booleanValue: val };
    if (typeof val === "number") {
      if (!Number.isFinite(val)) return { nullValue: null };
      if (Number.isSafeInteger(val)) return { integerValue: String(val) };
      return { doubleValue: val };
    }
    if (typeof val === "string") return { stringValue: val };
    if (Array.isArray(val)) {
      const values = val.filter((v) => v !== undefined).map(toFirestoreValue);
      return { arrayValue: values.length ? { values } : {} };
    }
    if (typeof val === "object") {
      const fields = {};
      for (const [k, v] of Object.entries(val)) {
        if (v !== undefined) fields[k] = toFirestoreValue(v);
      }
      return { mapValue: Object.keys(fields).length ? { fields } : {} };
    }
    return { stringValue: String(val) };
  }

  function fromFirestoreValue(val) {
    if (!val || "nullValue" in val) return null;
    if ("booleanValue" in val) return Boolean(val.booleanValue);
    if ("integerValue" in val) return Number(val.integerValue);
    if ("doubleValue" in val) return Number(val.doubleValue);
    if ("stringValue" in val) return val.stringValue;
    if ("timestampValue" in val) return val.timestampValue;
    if ("arrayValue" in val) {
      return (val.arrayValue.values || []).map(fromFirestoreValue);
    }
    if ("mapValue" in val) {
      return fromFirestoreFields(val.mapValue.fields);
    }
    return null;
  }

  function fromFirestoreFields(fields) {
    const out = {};
    if (!fields) return out;
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }

  function firestoreBaseUrl() {
    const db = encodeURIComponent(CONFIG.databaseId || "(default)");
    return (
      "https://firestore.googleapis.com/v1/projects/" +
      encodeURIComponent(CONFIG.projectId) +
      "/databases/" +
      db +
      "/documents"
    );
  }

  async function firestoreHeaders(extra = {}) {
    const token = await ensureAuthToken();
    return {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...extra,
    };
  }

  async function fsGetDoc(collection, docId) {
    const cleanCol = collection
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const url = new URL(
      firestoreBaseUrl() + "/" + cleanCol + "/" + encodeURIComponent(docId)
    );
    if (CONFIG.apiKey) url.searchParams.set("key", CONFIG.apiKey);
    const res = await nativeFetch(url.toString(), {
      headers: await firestoreHeaders(),
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Firestore GET failed: " + res.status);
    const doc = await res.json();
    return fromFirestoreFields(doc.fields);
  }

  async function fsSetDoc(collection, docId, data) {
    const cleanCol = collection
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const url = new URL(
      firestoreBaseUrl() + "/" + cleanCol + "/" + encodeURIComponent(docId)
    );
    if (CONFIG.apiKey) url.searchParams.set("key", CONFIG.apiKey);
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    const res = await nativeFetch(url.toString(), {
      method: "PATCH",
      headers: await firestoreHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error("Firestore write failed (" + res.status + "): " + errText.slice(0, 180));
    }
    const doc = await res.json();
    return fromFirestoreFields(doc.fields);
  }

  async function fsListDocs(collection) {
    const cleanCol = collection
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    const url = new URL(firestoreBaseUrl() + "/" + cleanCol);
    url.searchParams.set("pageSize", "200");
    if (CONFIG.apiKey) url.searchParams.set("key", CONFIG.apiKey);
    const res = await nativeFetch(url.toString(), {
      headers: await firestoreHeaders(),
      cache: "no-store",
    });
    if (res.status === 404) return [];
    if (!res.ok) return [];
    const payload = await res.json();
    return (payload.documents || []).map((doc) => {
      const name = doc.name || "";
      const id = decodeURIComponent(name.slice(name.lastIndexOf("/") + 1));
      return { id, data: fromFirestoreFields(doc.fields) };
    });
  }

  async function storageUpload(storagePath, arrayBuffer, contentType) {
    const cleanPath = storagePath.replace(/^\\/+/u, "");
    const url = new URL(
      "https://firebasestorage.googleapis.com/v0/b/" +
        encodeURIComponent(CONFIG.storageBucket) +
        "/o"
    );
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", cleanPath);
    if (CONFIG.apiKey) url.searchParams.set("key", CONFIG.apiKey);
    const res = await nativeFetch(url.toString(), {
      method: "POST",
      headers: await firestoreHeaders({ "content-type": contentType }),
      body: arrayBuffer,
    });
    if (!res.ok) throw new Error("Storage upload failed (" + res.status + ")");
    const meta = await res.json().catch(() => ({}));
    const token = meta.downloadTokens ? meta.downloadTokens.split(",")[0] : "";
    return (
      "https://firebasestorage.googleapis.com/v0/b/" +
      encodeURIComponent(CONFIG.storageBucket) +
      "/o/" +
      encodeURIComponent(cleanPath) +
      "?alt=media" +
      (token ? "&token=" + encodeURIComponent(token) : "")
    );
  }

  function jsonResponse(status, payload, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...extraHeaders,
      },
    });
  }

  async function loadStaticJson(path, fallback) {
    try {
      const res = await nativeFetch(path, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch {}
    return fallback;
  }

  async function normalizeImageToSquarePng(dataUrl) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not decode uploaded image"));
      img.src = dataUrl;
    });
    const side = Math.min(img.width, img.height);
    let targetSize = 512;
    let canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    let ctx = canvas.getContext("2d");
    ctx.drawImage(
      img,
      (img.width - side) / 2,
      (img.height - side) / 2,
      side,
      side,
      0,
      0,
      targetSize,
      targetSize
    );
    let normalizedDataUrl = canvas.toDataURL("image/png");
    // Ensure inline Firestore fallback stays comfortably below the 1 MiB document cap
    while (normalizedDataUrl.length > 750000 && targetSize > 256) {
      targetSize = Math.round(targetSize * 0.8);
      canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        targetSize,
        targetSize
      );
      normalizedDataUrl = canvas.toDataURL("image/png");
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const arrayBuffer = await blob.arrayBuffer();
    const sha256 = await sha256Hex(arrayBuffer);
    return { normalizedDataUrl, arrayBuffer, sha256 };
  }

  async function handleBridgeFetch(urlObj, init) {
    const path = urlObj.pathname;
    const method = (init?.method || "GET").toUpperCase();

    if (method === "GET" && path === "/api/health") {
      return jsonResponse(200, {
        status: "ok",
        mode: "firebase",
        timestamp: new Date().toISOString(),
      });
    }

    if (method === "GET" && path === "/api/portrait-status") {
      const base = await loadStaticJson("/api-static/portrait-status.json", {
        ready: true,
        engine: "ditto-talkinghead",
        device: "mps",
      });
      const workers = await fsListDocs("workers").catch(() => []);
      const onlineWorker = workers.find(
        (w) =>
          w.data.status !== "OFFLINE" &&
          Date.now() - Date.parse(w.data.lastHeartbeatAt || "0") < 120000
      );
      if (onlineWorker && onlineWorker.data.portraitRuntime) {
        return jsonResponse(200, onlineWorker.data.portraitRuntime);
      }
      return jsonResponse(200, base);
    }

    if (method === "GET" && path === "/api/voices") {
      const base = await loadStaticJson("/api-static/voices.json", { voices: [] });
      return jsonResponse(200, base);
    }

    if (method === "GET" && path === "/api/avatars") {
      const base = await loadStaticJson("/api-static/avatars.json", { avatars: [] });
      const cloudDocs = await fsListDocs("avatars").catch(() => []);
      const merged = new Set(base.avatars || []);
      for (const doc of cloudDocs) {
        if (doc.data.imageId) merged.add(doc.data.imageId);
      }
      for (const key of inMemoryAvatars.keys()) merged.add(key);
      return jsonResponse(200, { avatars: Array.from(merged).sort() });
    }

    if (method === "GET" && path.startsWith("/api/avatars/")) {
      const imageId = decodeURIComponent(path.slice("/api/avatars/".length));
      if (inMemoryAvatars.has(imageId)) {
        const entry = inMemoryAvatars.get(imageId);
        return new Response(entry.arrayBuffer, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-image-sha256": entry.sha256,
            "cache-control": "no-store",
          },
        });
      }
      // Try static bundled avatar first
      try {
        const staticRes = await nativeFetch(
          "/api-static/avatars/" + encodeURIComponent(imageId),
          { cache: "no-store" }
        );
        if (staticRes.ok) {
          const buf = await staticRes.arrayBuffer();
          const sha = await sha256Hex(buf);
          return new Response(buf, {
            status: 200,
            headers: {
              "content-type": staticRes.headers.get("content-type") || "image/png",
              "x-image-sha256": sha,
              "cache-control": "no-store",
            },
          });
        }
      } catch {}
      // Try Firestore / Storage
      const doc = await fsGetDoc("avatars", imageId).catch(() => null);
      if (doc) {
        if (doc.dataUrl) {
          const base64 = doc.dataUrl.split(",")[1] || "";
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const sha = doc.sha256 || (await sha256Hex(bytes.buffer));
          return new Response(bytes.buffer, {
            status: 200,
            headers: {
              "content-type": "image/png",
              "x-image-sha256": sha,
              "cache-control": "no-store",
            },
          });
        }
        if (doc.url) {
          const remoteRes = await nativeFetch(doc.url);
          if (remoteRes.ok) {
            const buf = await remoteRes.arrayBuffer();
            const sha = doc.sha256 || (await sha256Hex(buf));
            return new Response(buf, {
              status: 200,
              headers: {
                "content-type": "image/png",
                "x-image-sha256": sha,
                "cache-control": "no-store",
              },
            });
          }
        }
      }
      return jsonResponse(404, { error: "Avatar image not found" });
    }

    if (method === "POST" && path === "/api/avatars") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (!body.name || !body.dataUrl) {
        return jsonResponse(400, {
          error: "Avatar name and base64 image dataUrl are required",
        });
      }
      const slug =
        String(body.name)
          .toLowerCase()
          .replace(/\\.(png|jpg|jpeg|webp)$/iu, "")
          .replace(/[^a-z0-9_-]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 30) || "portrait";
      const { normalizedDataUrl, arrayBuffer, sha256 } =
        await normalizeImageToSquarePng(body.dataUrl);
      const basePrefix =
        slug === "image" || slug === "portrait" || slug === "photo"
          ? "photo"
          : slug;
      const imageId = basePrefix + "-" + sha256.slice(0, 8) + ".png";
      inMemoryAvatars.set(imageId, { arrayBuffer, sha256 });
      let storageUrl = "/api/avatars/" + encodeURIComponent(imageId);
      try {
        storageUrl = await storageUpload(
          "avatars/" + imageId,
          arrayBuffer,
          "image/png"
        );
      } catch {
        /* fallback to Firestore inline dataUrl if Storage rules or bucket unavailable */
      }
      const now = new Date().toISOString();
      await fsSetDoc("avatars", imageId, {
        imageId,
        sha256,
        url: storageUrl,
        storagePath: "avatars/" + imageId,
        dataUrl: normalizedDataUrl,
        updatedAt: now,
      });
      return jsonResponse(201, {
        imageId,
        sha256,
        url: "/api/avatars/" + encodeURIComponent(imageId),
      });
    }

    if (path === "/api/workflow" && (method === "GET" || method === "POST")) {
      const baseWorkflow = await loadStaticJson("/api-static/workflow.json", {
        episodes: [],
        activeJob: null,
      });
      if (method === "POST") {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const selector = body.selector;
        const renderKey = body.renderKey;
        const action = body.action;
        if (!selector || !["approve", "publish", "reopen"].includes(action)) {
          return jsonResponse(400, {
            error: "Choose a video and a valid review action.",
          });
        }
        const existingItem =
          (baseWorkflow.episodes || []).find((e) => e.selector === selector) || {};
        const existingCloud = await fsGetDoc("workflow", selector).catch(() => null);
        const currentRecord = existingCloud ||
          existingItem.record || {
            selector,
            renderKey: renderKey || existingItem.renderKey || "cloud",
            inputHash: existingItem.inputHash || "cloud",
            videoHash: existingItem.videoHash || "cloud",
            reviewedAt: null,
            publication: null,
          };
        if (action === "approve") {
          if (body.reviewed !== true) {
            return jsonResponse(400, {
              error: "Confirm that you reviewed the video, captions, and sources.",
            });
          }
          currentRecord.reviewedAt =
            currentRecord.reviewedAt || new Date().toISOString();
        } else if (action === "publish") {
          if (!currentRecord.reviewedAt) {
            return jsonResponse(400, {
              error: "Review and approve this video before recording publication.",
            });
          }
          if (!body.url || typeof body.url !== "string") {
            return jsonResponse(400, { error: "Enter the published post URL." });
          }
          let parsedUrl;
          try {
            parsedUrl = new URL(body.url);
          } catch {
            return jsonResponse(400, { error: "Enter a valid HTTP/HTTPS URL." });
          }
          if (
            !["https:", "http:"].includes(parsedUrl.protocol) ||
            parsedUrl.username ||
            parsedUrl.password
          ) {
            return jsonResponse(400, {
              error: "Use an HTTP or HTTPS post URL without credentials.",
            });
          }
          currentRecord.publication = {
            url: parsedUrl.href,
            recordedAt: new Date().toISOString(),
          };
        } else {
          currentRecord.reviewedAt = null;
          currentRecord.publication = null;
        }
        const stage = currentRecord.publication
          ? "published"
          : currentRecord.reviewedAt
            ? "publish"
            : "review";
        const labels = {
          editing: "Editing",
          producing: "Producing",
          review: "To review",
          publish: "To publish",
          published: "Published",
        };
        const savedDoc = {
          selector,
          renderKey: currentRecord.renderKey,
          inputHash: currentRecord.inputHash,
          videoHash: currentRecord.videoHash,
          reviewedAt: currentRecord.reviewedAt,
          publication: currentRecord.publication,
          stage,
          label: labels[stage],
          updatedAt: new Date().toISOString(),
        };
        await fsSetDoc("workflow", selector, savedDoc);
        return jsonResponse(200, {
          stage,
          label: labels[stage],
          record: savedDoc,
        });
      }

      // GET /api/workflow
      const [cloudWorkflows, cloudJobs, cloudWorkers] = await Promise.all([
        fsListDocs("workflow").catch(() => []),
        fsListDocs("productions").catch(() => []),
        fsListDocs("workers").catch(() => []),
      ]);
      const workflowMap = new Map(cloudWorkflows.map((d) => [d.id, d.data]));
      const activeProd = cloudJobs
        .map((d) => d.data)
        .filter((j) =>
          ["PENDING", "PREFLIGHT", "NARRATION", "RENDER", "LIBRARY"].includes(j.stage)
        )
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
      const latestReadyBySelector = new Map();
      for (const jobDoc of cloudJobs) {
        const j = jobDoc.data;
        if (j.stage === "READY" && j.selector) {
          const prev = latestReadyBySelector.get(j.selector);
          if (!prev || String(j.updatedAt || "") > String(prev.updatedAt || "")) {
            latestReadyBySelector.set(j.selector, j);
          }
        }
      }

      const labels = {
        editing: "Editing",
        producing: "Producing",
        review: "To review",
        publish: "To publish",
        published: "Published",
      };

      const episodes = (baseWorkflow.episodes || []).map((ep) => {
        const cloud = workflowMap.get(ep.selector);
        const readyJob = latestReadyBySelector.get(ep.selector);
        const isProducing = activeProd && activeProd.selector === ep.selector;
        let stage = ep.stage;
        let label = ep.label;
        let record = ep.record;
        let renderKey = ep.renderKey;
        let assets = null;

        if (readyJob) {
          renderKey = readyJob.report?.renderKey || renderKey || "cloud-ready";
          assets = readyJob.assets || null;
          if (stage === "editing") {
            stage = "review";
            label = labels.review;
          }
        }
        if (cloud) {
          stage = cloud.stage || stage;
          label = cloud.label || labels[stage] || label;
          record = {
            selector: ep.selector,
            renderKey: cloud.renderKey || renderKey || "cloud",
            inputHash: cloud.inputHash || "cloud",
            videoHash: cloud.videoHash || "cloud",
            reviewedAt: cloud.reviewedAt || null,
            publication: cloud.publication || null,
          };
          if (cloud.assets) assets = cloud.assets;
        }
        if (isProducing) {
          stage = "producing";
          label = labels.producing;
        }
        return {
          ...ep,
          renderKey,
          stage,
          label,
          record,
          ...(assets ? { assets } : {}),
        };
      });

      const onlineWorker = cloudWorkers.find(
        (w) =>
          w.data.status !== "OFFLINE" &&
          Date.now() - Date.parse(w.data.lastHeartbeatAt || "0") < 120000
      );
      setTimeout(() => {
        const syncEl = document.querySelector("#workflow-sync");
        if (syncEl) {
          syncEl.textContent = onlineWorker
            ? "Firebase Cloud · Mac Worker Online (" + (onlineWorker.data.hostname || "Mac") + ")"
            : "Firebase Cloud · Mac Worker Offline (Jobs will queue)";
        }
      }, 20);

      return jsonResponse(200, {
        episodes,
        activeJob: activeProd
          ? {
              id: activeProd.id,
              selector: activeProd.selector,
              stage: activeProd.stage,
              message: activeProd.progressMessage || "Queued for Mac worker...",
            }
          : null,
      });
    }

    if (method === "POST" && path === "/api/scripts") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const def = body?.definition ?? body;
      const baseEpisodeId = def?.baseEpisodeId;
      const variant = def?.presentation?.variant;
      if (!baseEpisodeId || !variant) {
        return jsonResponse(400, {
          error: "A valid baseEpisodeId and presentation.variant are required",
        });
      }
      const selector = baseEpisodeId + "@" + variant;
      const now = new Date().toISOString();
      await fsSetDoc("episodes/" + baseEpisodeId + "/variants", variant, {
        ...def,
        schemaVersion: 1,
        updatedAt: now,
      });
      await fsSetDoc("workflow", selector, {
        selector,
        renderKey: "draft",
        inputHash: "draft",
        videoHash: "draft",
        reviewedAt: null,
        publication: null,
        stage: "editing",
        label: "Editing",
        updatedAt: now,
      });
      return jsonResponse(201, {
        selector,
        file: "content/presentations/" + baseEpisodeId + "--" + variant + ".json",
        libraryUpdated: true,
      });
    }

    if (method === "POST" && path === "/api/produce") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      let selector = body?.selector;
      if (body?.definition) {
        const def = body.definition;
        if (!def.baseEpisodeId || !def.presentation?.variant) {
          return jsonResponse(400, {
            error: "Invalid script definition for production",
          });
        }
        selector = def.baseEpisodeId + "@" + def.presentation.variant;
        await fsSetDoc(
          "episodes/" + def.baseEpisodeId + "/variants",
          def.presentation.variant,
          {
            ...def,
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
          }
        );
      }
      if (
        !selector ||
        !/^(ABAP|CAP|RAP|BTP|AI|NEWS)-\\d{2}(?:@[a-z][a-z0-9-]{0,31})?$/u.test(selector)
      ) {
        return jsonResponse(400, { error: "A valid episode selector is required" });
      }
      const existingJobs = await fsListDocs("productions").catch(() => []);
      const running = existingJobs.find((j) =>
        ["PENDING", "PREFLIGHT", "NARRATION", "RENDER", "LIBRARY"].includes(
          j.data.stage
        )
      );
      if (running) {
        return jsonResponse(409, {
          error: "A production job is already in progress",
          jobId: running.id,
          selector: running.data.selector,
          stage: running.data.stage,
        });
      }
      const jobId = uuid();
      const now = new Date().toISOString();
      await fsSetDoc("productions", jobId, {
        schemaVersion: 1,
        id: jobId,
        selector,
        stage: "PENDING",
        progressMessage: "Queued in Firebase for Local Mac Render Worker...",
        startedAt: now,
        updatedAt: now,
        createdBy: cachedUid,
        ...(body?.definition ? { definition: body.definition } : {}),
      });
      return jsonResponse(202, {
        status: "ACCEPTED",
        jobId,
        selector,
        streamUrl: "/api/productions/" + jobId + "/stream",
        statusUrl: "/api/productions/" + jobId,
      });
    }

    const singleMatch = /^\\/api\\/productions\\/([a-f0-9-]+)$/u.exec(path);
    if (method === "GET" && singleMatch?.[1]) {
      const job = await fsGetDoc("productions", singleMatch[1]);
      if (!job) return jsonResponse(404, { error: "Production job not found" });
      return jsonResponse(200, {
        id: job.id || singleMatch[1],
        selector: job.selector,
        stage: job.stage,
        message: job.progressMessage || "",
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        report: job.report ?? null,
        error: job.error ?? null,
        assets: job.assets ?? null,
      });
    }

    if (method === "POST" && path === "/api/audition") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
        return jsonResponse(400, { error: "Text is required for audition" });
      }
      const auditionId = uuid();
      const now = new Date().toISOString();
      await fsSetDoc("auditions", auditionId, {
        id: auditionId,
        text: body.text.trim(),
        voice: body.voice || "af_heart",
        speed: Number(body.speed || 0.96),
        pronunciation: body.pronunciation || {},
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      });
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 800));
        const doc = await fsGetDoc("auditions", auditionId).catch(() => null);
        if (!doc) continue;
        if (doc.status === "FAILED") {
          return jsonResponse(400, { error: doc.error || "Audition failed on Mac worker" });
        }
        if (doc.status === "READY" && (doc.audioDataUrl || doc.audioUrl)) {
          let wavBuffer;
          if (doc.audioDataUrl) {
            const b64 = doc.audioDataUrl.split(",")[1] || "";
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            wavBuffer = arr.buffer;
          } else {
            const res = await nativeFetch(doc.audioUrl);
            wavBuffer = await res.arrayBuffer();
          }
          return new Response(wavBuffer, {
            status: 200,
            headers: {
              "content-type": "audio/wav",
              "x-spoken-text": encodeURIComponent(doc.spokenText || body.text.trim()),
              "x-duration-seconds": Number(doc.durationSeconds || 1).toFixed(2),
            },
          });
        }
      }
      return jsonResponse(503, {
        error:
          "Mac worker is offline or busy. Start 'npm run shorts -- firebase-worker' on your Mac for live voice audition.",
      });
    }

    return nativeFetch(urlObj.toString(), init);
  }

  window.fetch = async function (input, init) {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input?.url || "";
    const urlObj = new URL(rawUrl, window.location.origin);
    if (
      urlObj.origin === window.location.origin &&
      urlObj.pathname.startsWith("/api/") &&
      !urlObj.pathname.startsWith("/api/face-assets/")
    ) {
      const mode = await detectBridgeMode();
      if (mode === "firebase") {
        return handleBridgeFetch(urlObj, init);
      }
    }
    return nativeFetch(input, init);
  };

  class FirebaseJobEventSource {
    constructor(url, options) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      this._closed = false;
      this._timer = null;
      this._native = null;
      this._lastStage = null;
      this._lastMessage = null;

      const match = /\\/api\\/productions\\/([a-f0-9-]+)\\/stream$/u.exec(
        new URL(url, window.location.origin).pathname
      );
      this._jobId = match ? match[1] : null;
      this._init(options);
    }

    async _init(options) {
      const mode = await detectBridgeMode();
      if (mode === "local" || !this._jobId) {
        this._native = new NativeEventSource(this.url, options);
        for (const [type, set] of this.listeners.entries()) {
          for (const fn of set) this._native.addEventListener(type, fn);
        }
        return;
      }
      this.readyState = 1;
      await this._poll();
      if (!this._closed) {
        this._timer = setInterval(() => void this._poll(), 1200);
      }
    }

    async _poll() {
      if (this._closed || !this._jobId) return;
      try {
        const job = await fsGetDoc("productions", this._jobId);
        if (!job || this._closed) return;
        const stage = job.stage || "PENDING";
        const message =
          job.progressMessage ||
          (stage === "PENDING"
            ? "Queued in Firebase · waiting for Mac Render Worker..."
            : "");
        if (this._lastStage === null) {
          this._emit("status", {
            id: this._jobId,
            selector: job.selector,
            stage: stage === "PENDING" ? "PREFLIGHT" : stage,
            message,
            report: job.report ?? null,
            error: job.error ?? null,
          });
        } else if (stage !== this._lastStage || message !== this._lastMessage) {
          this._emit("progress", {
            stage: stage === "PENDING" ? "PREFLIGHT" : stage,
            message,
          });
        }
        this._lastStage = stage;
        this._lastMessage = message;

        if (["READY", "BLOCKED", "FAILED"].includes(stage)) {
          if (stage === "FAILED" && job.error && !job.report) {
            this._emit("error", { stage: "FAILED", error: job.error });
          } else {
            this._emit("complete", { stage, report: job.report || { stage } });
          }
          this.close();
        }
      } catch {}
    }

    _emit(type, payload) {
      const set = this.listeners.get(type);
      if (!set) return;
      const evt = new MessageEvent(type, { data: JSON.stringify(payload) });
      for (const fn of set) {
        try {
          fn(evt);
        } catch {}
      }
    }

    addEventListener(type, listener) {
      if (this._native) {
        this._native.addEventListener(type, listener);
        return;
      }
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      if (this._native) {
        this._native.removeEventListener(type, listener);
        return;
      }
      this.listeners.get(type)?.delete(listener);
    }

    close() {
      this._closed = true;
      this.readyState = 2;
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      if (this._native) this._native.close();
    }
  }

  window.EventSource = FirebaseJobEventSource;
})();
`;
}
