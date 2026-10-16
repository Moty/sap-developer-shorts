# Firebase Cloud Architecture for SAP Developer Shorts

This document outlines the architecture and deployment strategy for transitioning the SAP Developer Shorts Studio from local disk storage and CLI commands to a cloud-connected web application powered by Google Firebase.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Web Studio Dashboard                            │
│  (Hosted on Firebase Hosting / Firebase App Hosting)                   │
│                                                                        │
│  • Visual Episode Catalog & Search                                     │
│  • In-browser Script Editor Workshop                                   │
│  • 1-Click "Produce Video" Button                                      │
│  • Real-time SSE / Firestore Progress Streaming                        │
│  • In-browser MP4 & Subtitle Player                                    │
│  • Episode Package (.zip) Downloads                                    │
└──────────────────┬──────────────────▲──────────────────▲───────────────┘
                   │                  │                  │
                   │ REST / SSE       │ Firestore Sync   │ Media Assets
                   ▼                  │                  │
┌─────────────────────────────────────┴──────────────────┴───────────────┐
│                           Firebase Services                            │
│                                                                        │
│  ┌───────────────────────┐  ┌───────────────────┐  ┌────────────────┐  │
│  │    Firebase Auth      │  │  Cloud Firestore  │  │ Cloud Storage  │  │
│  │                       │  │                   │  │  for Firebase  │  │
│  │ • Role-based access   │  │ • /episodes       │  │ • short.mp4    │  │
│  │   (Reviewer / Editor) │  │ • /variants       │  │ • narration.wav│  │
│  │                       │  │ • /productions    │  │ • captions.vtt │  │
│  │                       │  │ • /topics         │  │ • poster.png   │  │
│  │                       │  │ • /news           │  │ • package.zip  │  │
│  └───────────────────────┘  └─────────▲─────────┘  └────────▲───────┘  │
│                                       │                     │          │
└───────────────────────────────────────┼─────────────────────┼──────────┘
                                        │ Job Queue           │ Uploads
                                        ▼                     │
┌─────────────────────────────────────────────────────────────┴──────────┐
│                   Production Compute Worker Layer                      │
│                                                                        │
│  Option A (Edge Worker):                                               │
│  • Mac mini running `npm run shorts -- worker` daemon                  │
│  • Utilizes Apple Silicon hardware for zero-cost Kokoro TTS & FFmpeg  │
│                                                                        │
│  Option B (Cloud Run Job):                                             │
│  • Containerized Node + Python 3.12 + Kokoro + FFmpeg runner            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cloud Firestore Data Model

### A. Collections Overview

| Collection Path | Purpose | Access Control |
| :--- | :--- | :--- |
| `/episodes/{episodeId}` | Core episode blueprints, claims, target duration, tutorial evidence. | Public Read; Editor Write |
| `/episodes/{episodeId}/variants/{variantId}` | Delivery presentation styles (tone, format, humor, speaker voices, scene narration & overlays). | Public Read; Editor Write |
| `/productions/{jobId}` | Live production jobs & status reports (preflight, narration, render, library, ready). | Authenticated Read & Write |
| `/topics/{topicId}` | Topic ideas, pillars, backlog status, and discovery evidence. | Public Read; Editor Write |
| `/news/{newsId}` | News claim verifications, validThrough dates, official source links. | Public Read; Editor Write |

### B. Document Schemas

#### Production Job (`/productions/{jobId}`)
```json
{
  "schemaVersion": 1,
  "id": "c73838a8-9009-4bfa-bfbf-ea052af5cf11",
  "selector": "CAP-01@casual-v2",
  "stage": "READY",
  "progressMessage": "MP4 verified and ready for review.",
  "startedAt": "2026-10-15T22:54:11.000Z",
  "updatedAt": "2026-10-15T22:55:30.000Z",
  "mediaJobId": "087cf935-09e0-4c95-bc7f-28476de309df",
  "inputHash": "a1b2c3d4...",
  "durationSeconds": 47.73,
  "hookSeconds": 2.8,
  "assets": {
    "videoUrl": "https://firebasestorage.googleapis.com/.../short.mp4",
    "audioUrl": "https://firebasestorage.googleapis.com/.../narration.wav",
    "captionsUrl": "https://firebasestorage.googleapis.com/.../captions.vtt",
    "packageUrl": "https://firebasestorage.googleapis.com/.../package.zip"
  },
  "error": null
}
```

---

## 3. Cloud Storage for Firebase Layout

Files are organized deterministically by episode selector and media type:

```
gs://<bucket-name>/
├── episodes/
│   ├── CAP-01@casual-v2/
│   │   ├── short.mp4            # Final vertical 1080x1920 MP4
│   │   ├── narration.wav        # Measured speech audio
│   │   ├── captions.vtt         # Synchronized WebVTT subtitles
│   │   ├── poster.png           # Video preview card image
│   │   └── package.zip          # Complete downloadable bundle
│   └── NEWS-01/
│       └── ...
└── voices/
    ├── af_heart/
    │   └── sample.wav           # Voice audition audio
    └── am_michael/
        └── sample.wav
```

Cache headers:
- Immutable video and audio files (`mp4`, `wav`) serve with `Cache-Control: public, max-age=31536000, immutable` and `Accept-Ranges: bytes`.
- Subtitles and manifests (`vtt`, `json`) serve with `Cache-Control: no-cache`.

---

## 4. Mac mini Edge Worker (Hybrid Cloud Strategy)

Because Kokoro neural TTS and FFmpeg video encoding run on the CPU with native Apple Silicon hardware acceleration, using this Mac mini as an Edge Worker eliminates cloud GPU/container compute costs.

### Worker Workflow:
1. Worker runs on Mac mini: `export PATH="$(brew --prefix node@22)/bin:$PATH" && npm run shorts -- worker`.
2. Listens to Firestore `productions` collection where `stage == "PENDING"`.
3. When a job is claimed:
   - Updates Firestore stage to `PREFLIGHT` $\to$ `NARRATION` $\to$ `RENDER`.
   - Runs local pipeline (`produce(selector)`).
   - Uploads resulting `short.mp4`, `narration.wav`, `captions.vtt`, and `package.zip` to Firebase Storage.
   - Updates Firestore document with download URLs and marks `stage = "READY"`.
4. The Web Studio UI receives the update in real time via Firestore `onSnapshot` or SSE.

---

## 5. Deployment Guide

### Prerequisites
* Firebase CLI installed (`firebase-tools >= 15.3.1`).
* Firebase project initialized.

### Setup Steps

1. **Log in and select project**:
   ```sh
   firebase login
   firebase use <your-project-id>
   ```

2. **Deploy Security Rules**:
   ```sh
   firebase deploy --only firestore:rules,storage
   ```

3. **Deploy Hosting Studio**:
   ```sh
   npm run build
   npm run shorts -- library
   # Sync latest library to hosting target
   cp -r artifacts/library-*/ dist/studio
   firebase deploy --only hosting
   ```
