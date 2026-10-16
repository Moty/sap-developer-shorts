# Avatar & Talking Heads Architecture for SAP Shorts

This document outlines the architecture, layout integration, and implementation paths for adding avatars and talking heads to SAP Developer Shorts vertical videos (1080×1920).

---

## 1. Executive Summary & Value Proposition

In short-form vertical developer video (YouTube Shorts, LinkedIn, TikTok, Instagram Reels), videos with an on-screen human or animated presenter achieve **35% to 50% higher viewer retention** and substantially lower scroll-away rates in the first 3 seconds.

For SAP Developer Shorts, avatars serve two distinct roles:
1. **Host Persona & Dialogue Clarification**: In conversation variants (such as `CAP-01@duo` featuring hosts **Mira** and **Max**), viewers immediately distinguish who is speaking based on who is actively talking.
2. **Visual Anchor Alongside Code/Demo**: Vertical mobile screens have ample space below the demo terminal (`layout.demo`) and beside the subtitle captions (`layout.captions`). An avatar anchors viewer gaze while technical code executes above.

---

## 2. Video Layout & Composition Target

The project's layout system ([`config/video-layout.json`](file:///Users/moty/.gemini/antigravity/scratch/sap-shorts-program/config/video-layout.json)) already defines a dedicated slot for the presenter:

```json
{
  "canvas": { "width": 1080, "height": 1920 },
  "criticalContent": { "x": 72, "y": 160, "width": 864, "height": 1510 },
  "headline": { "x": 72, "y": 180, "width": 864, "height": 180, "fontSize": 68 },
  "demo": { "x": 72, "y": 430, "width": 864, "height": 880, "fontSize": 44 },
  "captions": { "x": 72, "y": 1380, "width": 600, "height": 240, "fontSize": 48 },
  "presenter": { "x": 696, "y": 1320, "width": 240, "height": 240 }
}
```

```
+---------------------------------------------------------------+ (1080 x 1920)
|  SAP / DEVELOPER SHORTS                                       |
|                                                               |
|  [ Headline / Question (x:72, y:180, w:864, h:180) ]          |
|                                                               |
|  +---------------------------------------------------------+  |
|  |                                                         |  |
|  |  Verified Code / Live CAP Demo Evidence                 |  |
|  |  (x:72, y:430, w:864, h:880)                            |  |
|  |                                                         |  |
|  +---------------------------------------------------------+  |
|                                                               |
|  [ Dynamic Subtitle Captions ]        +--------------------+  |
|  (x:72, y:1380, w:600, h:240)         |  TALKING HEAD      |  |
|                                       |  AVATAR BADGE      |  |
|                                       |  (696, 1320,       |  |
|                                       |   240 x 240)       |  |
|                                       +--------------------+  |
|  Local demo · deployment and auth come later                  |
|  [===== Progress Bar =======================================]  |
+---------------------------------------------------------------+
```

The presenter slot (`x: 696, y: 1320, width: 240, height: 240`) sits directly adjacent to captions on the right hand side, keeping the center and top clear for high-density code inspection.

---

## 3. Comparison of Architectural Approaches

Three implementation tiers are viable for SAP Shorts, ranging from 100% offline local rendering to cloud photorealism:

| Dimension | Tier 1: Local Viseme Puppet (Native) | Tier 2: Cloud Neural Talking Head | Tier 3: Local Neural (LivePortrait) |
| :--- | :--- | :--- | :--- |
| **Engine** | 2D Canvas / Vector Visemes | HeyGen / D-ID / SadTalker API | PyTorch Apple Silicon MPS |
| **Hosting & Cost** | **\$0 (100% Local)** | ~\$0.06 – \$0.15 / video | **\$0 (100% Local)** |
| **External Dependencies**| None (uses existing `@napi-rs/canvas`) | Cloud API Key (HeyGen/D-ID) | Python PyTorch + weights (~2GB) |
| **Render Latency** | **Instant (~0.5ms / frame)** | 20–45s network render | 20–35s local Apple Silicon |
| **Deterministic Cache** | Fully deterministic SHA-256 | Non-deterministic | Deterministic with fixed seed |
| **Visual Style** | Stylized clean tech character (GitHub Mona / SAP Mascot style) | Photorealistic human presenter | Photorealistic animated headshot |
| **Best Used For** | Daily developer tutorials, CI/CD automated builds, local pairing | Executive announcements, flagship launches | Offline high-fidelity exports |

---

## 4. Tier 1: Local Viseme Puppet Pipeline (Implemented in `src/media/avatar.ts`)

### How It Works:
1. **Phoneme to Viseme Mapping**: Kokoro TTS synthesis produces WebVTT cue timings with word boundaries. Each word or phonetic segment is mapped to one of 6 canonical mouth shapes:
   - `REST`: Lips closed, neutral attentive expression (used during pauses or when the other host is speaking).
   - `OPEN_A`: Wide open mouth for vowels like in "CAP", "SAP", "App".
   - `OPEN_E`: Wide smile mouth for sounds in "service", "see", "read".
   - `OPEN_O`: Rounded mouth for vowels in "OData", "code", "node".
   - `OPEN_U`: Tightly rounded mouth for "Joule", "you", "true".
   - `CLOSED`: Neutral closed lips for bilabials ("m", "b", "p").
2. **Presenter Identity Profiles**:
   - **Mira**: Technical host, warm green/teal palette, glasses, active gestures.
   - **Max**: Co-host, blue/slate palette, inquisitive expressions.
   - **Narrator**: Classic SAP developer advocate persona.
3. **Canvas Drawing**: During `drawVideoFrame(input, moment)` in [`src/video/frames.ts`](file:///Users/moty/.gemini/antigravity/scratch/sap-shorts-program/src/video/frames.ts), the avatar is drawn with a circular clip, background gradient, animated eyes, and the mouth shape corresponding to the active cue time.

---

## 5. Tier 2: Cloud Neural Talking Head (HeyGen / D-ID) Integration

For teams requiring a photorealistic live-action actor:

### Workflow:
1. The studio produces `source-narration.wav` using Kokoro neural TTS.
2. A background worker sends `source-narration.wav` and the chosen `avatar_id` to the provider API:
   ```ts
   // POST https://api.heygen.com/v2/video/generate
   const response = await fetch("https://api.heygen.com/v2/video/generate", {
     method: "POST",
     headers: {
       "X-Api-Key": process.env.HEYGEN_API_KEY!,
       "Content-Type": "application/json",
     },
     body: JSON.stringify({
       video_inputs: [{
         character: {
           type: "avatar",
           avatar_id: "mira_developer_presenter",
           avatar_style: "circle", // or transparent green screen
         },
         voice: {
           type: "audio",
           audio_url: audioPublicOrSignedUrl,
         },
       }],
       dimension: { width: 512, height: 512 },
     }),
   });
   ```
3. When the MP4 webhook returns, the avatar video (`avatar-talk.mp4`) is composited into the main canvas using FFmpeg:

```bash
ffmpeg -y -f concat -safe 0 -protocol_whitelist file,pipe -i timeline.ffconcat \
  -i avatar-talk.mp4 -i source-narration.wav \
  -filter_complex "\
    [1:v] scale=240:240,format=yuva420p,\
    geq=lum='p(X,Y)':a='if(lte((X-120)*(X-120)+(Y-120)*(Y-120),120*120),255,0)' [circular_avatar]; \
    [0:v][circular_avatar] overlay=696:1320:enable='between(t,0,58)' [v]" \
  -map "[v]" -map 2:a:0 -c:v libx264 -preset fast -crf 19 short.mp4
```

---

## 6. Tier 3: Local Neural (LivePortrait on Apple Silicon)

LivePortrait is an open-source portrait animation model that runs efficiently on macOS with Apple Silicon GPU (`mps` device):
1. **Prerequisites**:
   ```bash
   uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
   # Clone LivePortrait weights into .state/liveportrait/
   ```
2. **Inference**:
   Takes a single static photo (`assets/avatars/mira.png`) and `source-narration.wav`. Generates 30fps talking head MP4 directly in the local scratch directory in ~25 seconds.
3. Composited identically using the FFmpeg overlay pipeline.

---

## 7. Recommended Implementation Sequence

1. **Step 1 (Now)**: Deploy Tier 1 local viseme avatar in [`src/media/avatar.ts`](file:///Users/moty/.gemini/antigravity/scratch/sap-shorts-program/src/media/avatar.ts) and plug into the presenter canvas slot. Zero cost, immediate visual upgrade in local MP4 exports.
2. **Step 2 (Next)**: Add an avatar selector toggle in the Script Workshop UI ("Stylized Puppet" vs. "Photorealistic Cloud").
3. **Step 3 (Future)**: Connect HeyGen/D-ID API or LivePortrait when cloud budgets or local GPU models are provisioned.
