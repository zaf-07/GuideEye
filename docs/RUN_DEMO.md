# Run the GuideBand live demo on your laptop

About five minutes. Needs **Python 3.10 or newer**, Chrome, a webcam and a microphone.

## 1. Get the code

```bash
git pull origin main
```

## 2. Install

macOS / Linux:

```bash
python3 -m venv .venv && source .venv/bin/activate
```

Windows PowerShell:

```bash
python -m venv .venv; .\.venv\Scripts\Activate.ps1
```

Then, on any system:

```bash
pip install -r backend/requirements.txt -r backend/requirements-vision.txt
```

The second file installs the local hazard detector (Ultralytics YOLO, with PyTorch and OpenCV). It is a large download. The detector's weights (`yolo11n.pt`, 5 MB) download by themselves the first time the camera is used.

## 3. Add the keys

Keys are **not** in the repository. Copy the example file and fill it in — ask a teammate for the values over a private channel, never in a commit.

```bash
cp backend/.env.example backend/.env
```

| Setting | Needed for | Without it |
| --- | --- | --- |
| `GEMINI_API_KEY` | Scene description, reading text, memory answers | Answers come from the on-device detector only |
| `ELEVENLABS_API_KEY` | Natural voice | The browser's built-in voice is used |
| `STRIPE_SECRET_KEY` (`sk_test_` or `rk_test_`) | A real Stripe test payment | Payments are simulated and labelled so |
| `DEEPGRAM_API_KEY` | Listening through a chosen microphone (the bracelet) | Only the browser's own speech recognition works |
| `WHATSAPP_DESKTOP_SEND=true` | Windows only: press Send in WhatsApp Desktop after a spoken yes | WhatsApp opens with the message ready; you press Send |

## 4. Start

```bash
python -m uvicorn backend.app.main:app --port 8000
```

Open **http://localhost:8000/#demo** in Chrome and allow the microphone, camera and location.

The status line should read `Connected · on-device detector · Gemini connected · …`. Turn the camera on and wait a few seconds for the first frame.

## 5. Try it

Just talk — the microphone is always on.

- "What's in front of me?"
- "Read the text you can see."
- "Remember this." then "Where did I leave my keys?"
- "Where am I?" (turn on **Use my location** first)
- "Take me to the nearest supermarket."
- "Buy me a coffee." then "Yes."
- Show a payment QR code to the camera (link under the chat) and say "Pay this." then "Yes."
- Add a contact in the **Family** tab, then "Tell Tim where I am." then "Yes."
- Open the **Bridge** tab: show a thumbs-up or a peace sign, then speak a sentence.

The shooting script for the demo video is in [DEMO_VIDEO_GUIDE.md](DEMO_VIDEO_GUIDE.md) (in Russian, with the English lines to say).

## If something fails

| Problem | Fix |
| --- | --- |
| `Not connected to the GuideBand service` | The service is not running, or runs on another port. Start it as in step 4 |
| Errors about `float \| None` or `str \| None` at start-up | Python is older than 3.10. Use 3.10 or newer |
| `detector unavailable` in the status line | The vision requirements are not installed; everything else still works |
| No reaction to your voice | Look at the line above the chat. Turn on "Microphone always on"; turn off "Only act when I say Guide first" |
| Robotic voice | No ElevenLabs key, or its credit limit is used up |
| The page looks out of date | Hard-refresh with Ctrl+Shift+R (Cmd+Shift+R on a Mac) |
| Bridge says the sign reader could not load | It needs internet for the hand-tracking library |

Run the tests with:

```bash
python -m unittest discover -s backend/tests
```
