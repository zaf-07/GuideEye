# GuideEye

**The AI that sees, remembers, and acts for you.**

GuideEye is a hands-free AI assistant for blind and low-vision people. The user speaks through their phone or browser microphone, and a chest-clipped phone is the eyes. An agent keeps a private memory of what it saw and heard, and takes real actions — like paying — only after a spoken "yes".

Built for The Big Hack Game with HarnessRouter and the Universal Harness Protocol (UHP).

> Prototype assistive technology. GuideEye is not a replacement for a white cane, guide dog, orientation and mobility training, emergency services or verified navigation instructions.

## The problem

Today's vision apps for blind users live on a phone screen. You have to aim the phone and tap buttons, which is exactly what a blind user struggles with. They also forget everything the moment you close them.

## What it does

- **See** — live hazard warnings spoken aloud: "Chair ahead, left."
- **Remember** — ask later: "Where did I leave my keys?" or "What did that sign say?"
- **Act** — "Buy me a coffee": it reads the item and price aloud and pays only after a spoken yes.
- **Bridge** (stretch) — a deaf–blind bridge: sign language voiced aloud, speech shown as large captions.

## How it works

Hybrid by design: safety-critical detection runs locally and privately; reasoning and voice use the cloud.

| Layer | Component | Role |
| --- | --- | --- |
| Input | Phone or browser microphone | Hands-free spoken commands |
| Camera | Phone camera (chest clip) | The eyes |
| Local | Laptop (RTX 4050) | YOLO hazard detection, on-device |
| Agent | HarnessRouter UHP agent | Document errands with explicit confirmation |
| Services | Groq | Vision and reasoning |
| Services | ElevenLabs | Speech in and out |
| Services | Memory store | Objects, text, places |
| Services | Stripe | Test-mode payment |

## Status

This table is the honest state of the repository, not the pitch.

| Part | State |
| --- | --- |
| Landing page (`web/index.html`) | Built |
| Voice app PWA (`web/app.html`): hold-to-talk, reminders, Journey mode, Guardian sharing, Bridge captions, spoken confirmations | Built (demo logic, runs in the browser) |
| Android assistant (`android/`): wake phrase, phone control, confirmation screens | Built |
| Desktop shell (`desktop/`) | Built |
| FastAPI service (`backend/`): command planning, tasks, events | Built |
| Vexo USB + Bluetooth probe (`scripts/vexo_probe.py`) | Built, read-only |
| See — on-device YOLO hazard warnings plus a cloud scene description, with fallbacks | Built: mobile/web use bundled ONNX models; local server development can enable Ultralytics YOLO; hosted Render uses the cloud fallback |
| Remember — private text-only memory and recall | Built: `/memory`, "Where did I leave my keys?" in the demo |
| Act — payment gated by a spoken yes | Built: quote, then pay only on yes. Simulated unless a Stripe **test** key is set; live keys are refused |
| Errands — "Read this letter and tell me what to do", "Explain this discharge summary" | Built: a HarnessRouter agent does the multi-step work in the background and the answer is spoken. It prepares and never sends; a spoken yes continues the same task. Needs `HR_API_KEY` in `backend/.env`; check it with `python scripts/errand_check.py` |
| Assistant — one sentence in, one spoken reply out | Built: `POST /assistant` routes to see, recall, remember and pay |
| Hands-free mode — say "Guide, …" with no buttons; automatic description when the scene changes | Built in the demo (browser speech recognition) |
| Walking directions — "Take me to the nearest supermarket", turn-by-turn by GPS, "Take me back" | Built: OpenStreetMap search and foot routing, `POST /location` |
| Place memory — GPS breadcrumbs of the walked path; notes tagged with the street they were made on | Built. Outdoors only: GPS is unreliable indoors |
| Phone vibration for warnings, confirmations and turns | Built for Android; the Vexo Open band has no vibration motor |
| Always-on microphone — one listener for every tab; acts on "Guide, …" | Built in the demo |
| "Where am I?" — street address from GPS plus a description of the surroundings | Built |
| Pay by code — the camera reads a payment QR code or a price tag, reads it back, and pays only on yes; refuses anything over the spending limit (`PAY_MAX_CENTS`, default $50) | Built: `GET /pay/qr.png` makes demo codes |
| Family — contacts, and "Tell Mom where I am" by WhatsApp after a spoken yes | Built. With Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) the message is delivered directly; without them WhatsApp opens with the message ready and the Send tap is manual |
| Memory of requests and places visited — "Where was I today?", "What did I ask you?" | Built |
| Bridge — two-way and automatic | Built in the demo. Signs are read on-device with MediaPipe hand and face landmarks. Each sign is read as a whole movement (`web/sign-motion.js`): the hands are followed over time, cut into movements, and each finished movement is matched against about twenty signs by its path, handshape and place at the face; still handshapes are read when held. ASL fingerspelling with the letter model from GuideLens (24 letters; J and Z need motion), each with a live confidence. Speech is shown as large text and as ASL fingerspelling images (Wikimedia Commons, public domain). This is not full sign-language translation |
| Bridge — sign reading | Experimental: `POST /bridge/sign`, drops low-confidence readings |
| Voice out | Built: MiniMax Speech 2.8 is preferred when `MINIMAX_API_KEY` is set; Deepgram, ElevenLabs and the browser voice remain fallbacks |
| Voice in | Browser speech recognition in the demo; `POST /speech/transcribe` (ElevenLabs) is ready for microphones the browser cannot transcribe, such as the bracelet |
| Mastra agent, Gemini Live streaming | Planned. The assistant currently uses plain rules plus per-frame Gemini calls |
| Vexo Open microphone | Working over the official contract: 16 kHz mono Opus over USB/BLE; Deepgram helper ready |
| Vexo Open vibration | Not hardware-capable; official contract says the band has no vibration. Android phone haptics are the tactile channel |

## Repository layout

```
web/        Landing page (index.html) and the voice app PWA (app.html)
android/    Android assistant app
desktop/    Electron shell around the voice app
backend/    FastAPI command / task / event service and tests
scripts/    Vexo Open setup, exact-band bridge and diagnostics
docs/       Product notes and research
```

## Run

### Live demo

The landing page has a working **Live demo** section: camera, voice, hazard warnings, memory, payments and Bridge. It needs the local service, which also serves the web app:

```bash
pip install -r backend/requirements.txt -r backend/requirements-vision.txt
```

```bash
python -m uvicorn backend.app.main:app --port 8000
```

On Windows, double-clicking `run.bat` does the install, starts the service and opens the page.

Open `http://localhost:8000/#demo` in Chrome, turn the camera on and ask: "What's in front of me?", "Remember this", "Where did I leave my keys?", "Buy me a coffee" and then "Yes".

Set `GEMINI_API_KEY` in `backend/.env` first (see below). Without it, answers come from the on-device detector only. To charge a Stripe test card instead of simulating, set `STRIPE_SECRET_KEY` to an `sk_test_` or restricted `rk_test_` key.

On a phone, the camera and microphone need HTTPS: put the service behind a tunnel or a certificate rather than plain `http://<laptop-ip>:8000`.

### Static pages only

Serve the `web` folder:

```bash
python -m http.server 4173 --directory web
```

Open `http://localhost:4173` for the landing page, or `http://localhost:4173/app.html` for the voice app. On Android Chrome, choose **Add to Home screen**. Speech recognition, camera and microphone need HTTPS or localhost; touch controls remain available.

Optional API (macOS / Linux):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

For vision, copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY`. Local hazard detection additionally needs `pip install -r backend/requirements-vision.txt`; without it the endpoint answers through the cloud model only. If Gemini fails, the optional Groq provider is tried, then a sentence built from the local detections.

On Windows PowerShell, activate with `.\.venv\Scripts\Activate.ps1` instead.

For a phone on the same Wi-Fi, use the computer's LAN address instead of `localhost`. Do not expose the development server publicly.

## Install the Android assistant

Download the APK from the [latest release](https://github.com/zaf-07/GuideBand/releases/latest), or build it locally (below).

After sideloading it:

1. Open GuideEye and tap **Choose GuideEye as assistant**. Accept the Android assistant-role prompt.
2. Tap **Enable phone control** and explicitly enable GuideEye under Accessibility. The service does not passively store screen contents.
3. Tap **Allow notifications**, then **Start voice assistant** while the activity is visible.
4. Keep the persistent "GuideEye is active" notification. Its Stop action immediately ends microphone capture.
5. Say "Guide, open YouTube", "Guide, set a timer for 10 minutes", "Guide, search for coffee nearby", or "Guide, let's walk to Safeway".

Calls, WhatsApp and journey sharing are treated as consequential and show a confirmation screen. Android still owns the final call/send action. The demo recognizer is a software foreground listener; unlike Google Assistant's privileged DSP hotword path it consumes more battery and availability depends on the device speech-recognition service.

Build locally with JDK 17 and Android SDK 35:

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

The release workflow publishes an Android APK, macOS DMG/ZIP, Windows EXE, Linux AppImage/DEB, and the web app on GitHub Pages.

## Vexo Band

The supplied unit enumerates as `Vexo Open band` at `/dev/cu.usbmodem1101` (USB VID `0x2FE3`, PID `0x0004`). Re-check instead of hard-coding the path:

```bash
python3 scripts/vexo_probe.py
```

GuideEye uses the official [`vexo-open-kit`](https://github.com/VexoAI-Org/vexo-open-kit) contract. The team band number is stored once as `20`; every connection targets and re-verifies exactly `Vexo-HACK-20` and service UUID `254f0001-df82-4a9c-a2b5-563a0f6b2021`. It never scans for or connects to another team's band.

Set up the unchanged kit and local dependencies, then verify the real device:

```bash
./scripts/setup_vexo_open_kit.sh
.venv/bin/python scripts/guideband_vexo.py check --transport serial
.venv/bin/python scripts/guideband_vexo.py mic-test --transport serial --seconds 3
```

For Bluetooth, double-tap band 20 so it blinks blue, then use `--transport ble`. `listen` streams the band's Opus packets to Deepgram using the kit's official helper. Put the team's key in `DEEPGRAM_API_KEY` yourself; it is never stored or printed:

```bash
export DEEPGRAM_API_KEY=...
.venv/bin/python scripts/guideband_vexo.py listen --transport ble --seconds 10
```

The Pipecat CLI and its Context Hub can be installed independently of the secret:

```bash
uv tool install "pipecat-ai[cli]" --with pipecat-ai-context-hub
pipecat context-hub install
```

Those commands install developer tooling; they do not contain or create a Deepgram key.
Get the team key from the event credit link, then type the `export` command yourself in
the same terminal. Never paste the key into chat, source control, screenshots, or logs.

The contract explicitly states that Vexo Open has no vibration hardware. `identify` flashes its white LED; tactile confirmations come from the Android phone's vibrator.

## Android reality check

A normal APK with broad permissions cannot silently control every app. Android intents can open calls, maps and WhatsApp. Reading arbitrary chats requires app-supported APIs, user interaction or an explicitly enabled `AccessibilityService`; the latter is privacy-sensitive, brittle and subject to store policy. The MVP previews and confirms every outward action.

## Safety and privacy

- An assistive companion, not a replacement for a white cane, guide dog or orientation training.
- No raw video or audio is stored.
- Low-confidence results are flagged instead of stated as fact.
- Money never moves without a spoken yes; payments run in Stripe test mode.
- Object detection is not distance measurement: GuideEye says where something is in view, not how far away it is.

## Judging & Evidence Documentation

| Section | Link | Purpose |
| :--- | :--- | :--- |
| **HarnessRouter / UHP Evidence** | [docs/HARNESSROUTER_EXECUTION_EVIDENCE.md](docs/HARNESSROUTER_EXECUTION_EVIDENCE.md) | Verifiable UHP execution traces, golden HTTP payloads, and core action proof (`chrn_e00fb0...`) |
| **Distribution & Social Post** | [docs/DISTRIBUTION_AND_POST.md](docs/DISTRIBUTION_AND_POST.md) | Corrected post with `#HarnessRouter #UHP #BigHackGame #BeatCal` & `@HarnessRouter` tag |
| **Commercial Commitment (LOI)** | [docs/COMMERCIAL_LOI_AND_REVENUE.md](docs/COMMERCIAL_LOI_AND_REVENUE.md) | Executed 10-seat paid pilot LOI ($1,470 commitment) for event page revenue field |
| **Event Forum Build Log** | [docs/EVENT_FORUM_BUILD_LOG.md](docs/EVENT_FORUM_BUILD_LOG.md) | Technical build log for the Top-5 Build Log Prize ($1,000 category) |
| **Sustainability & Economics** | [docs/SUSTAINABILITY_AND_UNIT_ECONOMICS.md](docs/SUSTAINABILITY_AND_UNIT_ECONOMICS.md) | Operating cost breakdown ($2.40/user/mo), pricing tiers, and adoption roadmap |

## Testing & Verification

Run the automated verification suite:

```bash
# Verify HarnessRouter UHP execution evidence
python3 scripts/verify_harnessrouter.py

# Run all 181 backend tests (compatible with Python 3.9 - 3.13)
npm test

# Run all 83 mobile unit tests (Bridge, voice, ASL gloss translation, memory)
npm run mobile:test

# Verify mobile TypeScript types
npm run mobile:typecheck
```

## Test

```bash
python3 -m unittest discover -s backend/tests -v
python3 scripts/vexo_probe.py --json
```

## Sources

[Vexo developer docs](https://www.vexoai.com/docs), [Vexo hardware overview](https://www.vexoai.com/), [Android common intents](https://developer.android.com/guide/components/intents-common), [Android accessibility services](https://developer.android.com/guide/topics/ui/accessibility/service).

MIT licensed.
