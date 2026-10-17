# Hybrid Firebase Studio & Local Mac Render Worker

The SAP Developer Shorts platform supports dual-mode operation:
1. **Local & Offline Mode**: Run the creator studio and video rendering entirely on your local Mac using Node.js, Kokoro neural TTS, and Ditto Apple Silicon MPS acceleration.
2. **Hybrid Cloud Mode**: Host the Creator Studio UI on Google Firebase Hosting (accessible on desktop, iPad, or mobile), with heavy neural speech and video rendering running on your local Mac mini or Apple Silicon laptop via Cloud Firestore and Cloud Storage.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Firebase Studio Web UI                          │
│        (https://sap-shorts-160871.web.app/review.html)                 │
│                                                                        │
│  • Responsive Creator Studio (Desktop & Mobile)                        │
│  • In-browser Script Editor & Delivery Styles                          │
│  • Real-time SSE / Firestore Progress Streaming                        │
│  • Custom Photo Avatar Upload & MediaPipe Face Calibration             │
│  • In-browser Video Player with synchronized WebVTT Subtitles          │
│  • Complete Episode Package (.zip) Downloads                           │
└──────────────────┬──────────────────▲──────────────────▲───────────────┘
                   │                  │                  │
                   │ REST / Jobs      │ Firestore Sync   │ Media Assets
                   ▼                  │                  │
┌─────────────────────────────────────┴──────────────────┴───────────────┐
│                           Firebase Services                            │
│                                                                        │
│  ┌───────────────────────┐  ┌───────────────────┐  ┌────────────────┐  │
│  │    Firebase Hosting   │  │  Cloud Firestore  │  │ Cloud Storage  │  │
│  │                       │  │                   │  │  for Firebase  │  │
│  │ • Static Studio HTML  │  │ • /episodes       │  │ • short.mp4    │  │
│  │ • templates, css, js  │  │ • /variants       │  │ • narration.wav│  │
│  │ • MediaPipe models    │  │ • /productions    │  │ • captions.vtt │  │
│  │ • client-bridge.js    │  │ • /avatars        │  │ • poster.png   │  │
│  │ • Byte-range headers  │  │ • /auditions      │  │ • package.zip  │  │
│  │                       │  │ • /workflow       │  │ • avatars/     │  │
│  └───────────────────────┘  └─────────▲─────────┘  └────────▲───────┘  │
│                                       │                     │          │
└───────────────────────────────────────┼─────────────────────┼──────────┘
                                        │ Claim Job           │ Uploads
                                        ▼                     │
┌─────────────────────────────────────────────────────────────┴──────────┐
│                   Local Mac Render Worker (Daemon)                     │
│                                                                        │
│  `npm run firebase:worker`                                             │
│  • Apple Silicon MPS (Metal Performance Shaders) Hardware Acceleration │
│  • Kokoro-82M Neural Text-to-Speech (Zero Cloud API Costs)             │
│  • Ditto MPS Talking-Head Neural Mesh Warp & Lip-Sync                  │
│  • Real-time heartbeat & stage progress streaming                      │
│  • Automatic bidirectional sync of presentations, avatars, and review  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Components

### A. Zero-Dependency Client Bridge (`src/firebase/client-bridge.ts`)
The Firebase Studio uses a transparent client bridge script injected as `/firebase-bridge.js` during export:
* **Dual-Mode Detection**: In local mode (`window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"`), it steps aside and lets all requests pass through directly to the local Node.js server.
* **REST Emulation**: In Firebase Hosting mode, it intercepts `/api/presentations`, `/api/avatars`, `/api/productions`, `/api/workflow`, and `/api/auditions` and routes them directly to Cloud Firestore REST and Cloud Storage endpoints without requiring heavy Firebase SDK bundles.
* **SSE Emulation**: Intercepts `new EventSource("/api/productions/:id/stream")` and polls Firestore status, providing continuous SSE progress updates to the UI.
* **Collision-Proof Uploads**: Appends an 8-character SHA-256 hash to uploaded photo filenames (e.g. `photo-a1b2c3d4.png`) to avoid collisions when iOS cameras upload generic `image.jpg` files.

### B. Mac Render Worker Daemon (`src/firebase/worker.ts`)
The worker runs locally on your Apple Silicon Mac:
* Polls `/productions` in Firestore for jobs in state `PENDING`.
* Atomically claims jobs using host-aware identity (e.g. `mac-MMMacMini-arm64`).
* Streams stage updates (`PREFLIGHT` $\to$ `NARRATION` $\to$ `RENDER` $\to$ `LIBRARY` $\to$ `READY`).
* Generates audio via Kokoro neural TTS and renders vertical 1080x1920 MP4s with Ditto talking-head animation.
* Uploads the rendered `short.mp4`, `narration.wav`, `captions.vtt`, `poster.png`, and `package.zip` directly to Firebase Storage.
* Updates the Firestore production document with permanent CDN download URLs.
* Maintains a 30-second heartbeat in Firestore `/workers/{workerId}`.

### C. Turnkey Mac Bootstrap (`src/mac-setup.ts`)
A single command prepares any new Apple Silicon Mac (such as an Apple M5 laptop or Mac mini):
```sh
npm run mac:setup
```
This script checks and installs:
1. Node.js (>= 22.13.0)
2. Homebrew tools (`ffmpeg`, `ffprobe`, `uv`)
3. MediaPipe face landmark detection task model (`face_landmarker.task`)
4. Kokoro neural voice models (`af_heart`, `am_michael`, etc.)
5. Ditto MPS neural talking-head runtime
6. Baseline studio build

---

## Personal voice boundary

Qwen **My voice** is available only through the loopback studio on the rendering
Mac. Profiles, samples, enrollment auditions, cloned definitions and their media
are not synchronized or rendered for cloud requests. Firebase export checks the
actual saved library before copying files, including older output whose current
script now selects a stock voice. Use `npm run shorts -- library --stock-only`
and export that printed directory. See [Qwen privacy and setup](QWEN_VOICES.md).

## 3. Quick Start: Clone & Run on a New Mac (e.g. Apple M5 Laptop)

### Step 1: Clone Repository
```sh
git clone https://github.com/Moty/sap-developer-shorts.git
cd sap-developer-shorts
```

### Step 2: Run Turnkey Setup
```sh
npm ci
npm run mac:setup
```

### Step 3: Configure Firebase Client (Optional if using default project)
The default project is configured in `config/firebase-client.json`:
```json
{
  "schemaVersion": 1,
  "projectId": "sap-shorts-160871",
  "appId": "1:995012285324:web:6555e8f4f140bc98c13ca9",
  "authDomain": "sap-shorts-160871.firebaseapp.com",
  "storageBucket": "sap-shorts-160871.firebasestorage.app",
  "databaseId": "(default)",
  "apiKey": "AIzaSyDwn-xp_W-1T7h3HjpQI_p3aTzHsMe8u9k"
}
```

### Step 4: Choose Your Mode

#### Option A: Run Local Studio
To run purely locally:
```sh
npm run shorts -- produce CAP-01@duo --serve
# Or to browse the existing library:
npm run shorts -- serve dist/studio
```

#### Option B: Run Hybrid Cloud Worker
To connect your Mac as a background render worker for the Firebase cloud studio:
```sh
npm run firebase:worker
```
Then open the Firebase Studio on your phone or laptop:
[https://sap-shorts-160871.web.app/review.html](https://sap-shorts-160871.web.app/review.html)

Any edit, avatar upload, or "Produce Video" request triggered from the cloud UI will immediately be claimed, synthesized, and rendered by your Mac!

---

## 4. Commands Reference

| Command | Description |
| :--- | :--- |
| `npm run mac:setup` | Turnkey setup for Apple Silicon Mac (installs models, voices, verifies runtimes). |
| `npm run firebase:export` | Bundles Studio HTML, CSS, JS, MediaPipe models, and `/firebase-bridge.js` into `dist/studio`. |
| `npm run firebase:deploy` | Exports the studio and deploys to Firebase Hosting (`firebase deploy`). |
| `npm run firebase:worker` | Starts the local Mac render worker daemon polling Firestore for production jobs. |
| `npm run firebase:sync` | Performs a one-time bidirectional sync between local files and Cloud Firestore / Storage. |
| `npm run shorts -- serve dist/studio` | Serves the exported studio locally with byte-range streaming. |

---

## 5. Security & CSP Configuration

### Content Security Policy (`firebase.json`)
The Firebase Hosting environment applies strict security headers while permitting MediaPipe WebAssembly and responsive studio inline scripts:
```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://firebasestorage.googleapis.com; media-src 'self' data: blob: https://firebasestorage.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://firebasestorage.googleapis.com https://cdn.jsdelivr.net; frame-src 'self';"
}
```

### Firestore Security Rules (`firestore.rules`)
All documents enforce strict schema validation:
- `/episodes/{episodeId}` & `/variants/{variantId}`: Validates episode format, tone, scenes, and duration limits.
- `/productions/{jobId}`: Validates stage transitions (`PENDING`, `PREFLIGHT`, `NARRATION`, `RENDER`, `LIBRARY`, `READY`, `BLOCKED`, `FAILED`).
- `/avatars/{avatarId}`: Validates avatar photo metadata, mime types, and MediaPipe face landmark calibration arrays.
- `/auditions/{auditionId}`: Validates voice speed, speaker ID, and synthesized audio attributes.
- `/workflow/{selector}`: Validates approval state, publication status, and verified media digests.
