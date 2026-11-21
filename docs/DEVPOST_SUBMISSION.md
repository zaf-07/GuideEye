# GuideEye — Devpost submission

**Project name:** GuideEye

**Tagline (short description field):**
The hands-free AI that sees, remembers, and acts for blind and low-vision people — and never acts without a spoken yes.

Copy each section below into the matching Devpost field.

---

## Inspiration

**Every vision app for blind people asks them to do the one thing that is hardest: aim a phone and tap a screen.**

That takes the hand they need for a white cane or a guide dog. And the moment the app closes, it forgets everything it saw.


GuideEye combines voice commands with a chest-clipped phone camera. It doesn't just describe the world. It **sees, remembers, and acts** — and it never acts without your spoken yes.

## What it does

You just talk. No screen, no aiming, no buttons.

### 👁 See
- **Instant hazard warnings.** An on-device detector watches the way ahead and speaks up the moment something appears: *"Chair ahead, left."* It says it once — it does not nag.
- **Ask anything.** *"What's in front of me?"* gets a short spoken description. *"Read the text"* reads signs and labels word for word.

### 🧠 Remember
- **A private memory of your day.** GuideEye notes what it saw, what you asked, and where you were — as text only. No photos, no video, no audio are ever stored.
- **Ask later.** *"Where did I leave my keys?"* — it answers from its notes. If it never saw them, it says so. **It does not guess.**
- **Yours to erase.** *"Forget everything"* wipes it.

### 💳 Act
- **Pay by voice.** Say *"Buy me a coffee"*, or hold up a payment QR code and say *"Pay this."* GuideEye reads the item and price aloud, then pays through Stripe **only after you say "Yes."**
- **A spending limit it will not cross.** Anything over the limit is refused out loud.
- **Reach your family.** *"Tell Mom where I am"* drafts a WhatsApp message with your address, reads it back, and sends it after the same spoken yes.

### 🧭 Navigate
- *"Where am I?"* — your street address and what is around you.
- *"Take me to the nearest supermarket"* — spoken, turn-by-turn walking directions.
- *"Take me back"* — a route to where your walk began.

### 🤝 Bridge
A two-way conversation between a blind person and a deaf person, with nobody touching a screen:
- **Their signs become your audio.** Hand signs and ASL fingerspelling are read on the device and spoken aloud, with a live confidence score.
- **Your voice becomes their text.** What you say appears word by word as large text and ASL fingerspelling, on a full-screen view you turn towards them.

### 🔊 Micro-Whisper
Short directional cues — *"Left"*, *"Forward"*, *"Right"*, *"Stop!"* — for orientation without a screen.

## How we built it

GuideEye is **hybrid by design: anything safety-critical runs on the device, and only reasoning and voice use the cloud.**

| Layer | What we used | What it does |
| --- | --- | --- |
| **Speech in** | **Deepgram Nova-3** | Turns microphone audio into text |
| **Reasoning** | **Google Gemini** | Describes scenes, reads text, answers from memory |
| **Speech out** | **ElevenLabs**, Deepgram Aura | A natural voice for every reply |
| **Payments** | **Stripe** | Real payments behind a spoken confirmation and a spending limit |
| **On-device vision** | YOLO11n | Hazard warnings in well under a tenth of a second per frame, no network needed |
| **On-device signs** | MediaPipe hand tracking + our fingerspelling model | Reads signs at camera frame rate, entirely in the browser |
| **Maps** | OpenStreetMap | Addresses and walking routes |
| **Platform** | FastAPI, SQLite, Electron | Backend, private memory, web app and a native macOS build |

**The voice path:** microphone → Deepgram → the assistant → Gemini → a spoken reply.

**The safety design, in three rules:**
1. **Rules decide, not the model.** Whether a sentence is a payment — and whether you said yes — is decided by deterministic code, never by a language model.
2. **Read back, then wait.** Anything that leaves the device on your behalf, money or a message, is spoken first and held until you confirm. Unanswered requests expire.
3. **Honest about limits.** Camera warnings give direction only, never a distance. Low-confidence sign readings are dropped, not spoken. Live payment keys are refused in code.

## Challenges we ran into

- **An assistant that must not guess.** A wrong answer is an inconvenience for most users and a hazard for ours. We moved every consequential decision out of the language model and into tested rules.
- **Speech recognition in a loud hackathon hall.** Browser recognition often never decides a sentence has ended. We wrote our own end-of-sentence detection, plus a filter so the assistant stops hearing its own voice.
- **Sign reading that was too slow.** Our first version sent frames to the cloud and took seconds. We rebuilt it to run on the device, and it became instant.

## Accomplishments that we're proud of

- **Five capabilities, one conversation.** See, Remember, Act, Navigate and Bridge all work together in a single live demo — you can ask what's ahead, pay for a coffee and message your family without touching anything.
- **A real payment by voice.** A Stripe payment, triggered by speech, gated by a spoken yes, and capped by a limit.
- **An end-to-end voice pipeline** from the microphone to a spoken answer.
- **Privacy we can prove.** The memory stores text only, and one sentence erases it.
- **Sign reading with no server.** It runs entirely in the browser.
- **67 automated tests** covering payments, confirmations, memory and navigation — the parts that must never be wrong.

## What we learned

**Accessibility is a trust problem before it is an AI problem.** A user who cannot see the screen has to be able to trust that nothing happens behind their back. That shaped everything: say what you will do, wait for a yes, admit when you are not sure.

We also learned that the most impressive demo is not the most useful product. Speed came from moving work onto the device, not from a bigger model.

## What's next for GuideEye

- **A phone app for the chest camera**, for real outdoor navigation.
- **A larger sign vocabulary**, built with Deaf signers rather than for them.
- **Fully offline mode**, with vision models running on the phone.
- **Public transit**: bus arrivals and station guidance.


*Prior work: GuideEye builds on ideas from our earlier project GuideLens and reuses its ASL fingerspelling model.*

---

## Other Devpost fields

**Built with** (tags):
`python` `fastapi` `javascript` `google-gemini` `deepgram` `elevenlabs` `stripe` `yolo` `mediapipe` `openstreetmap` `sqlite` `electron`

**Try it out** (links):
- Repository: https://github.com/zaf-07/GuideEye
- Landing page: https://guideeye.onrender.com/

The live demo on the landing page needs the local service running; setup is in `docs/RUN_DEMO.md`.

---

## Why this version is written the way it is

- **The first line of every section carries the point.** Judges skim; the bold lines alone tell the story.
- **Each sponsor has its own row** with a concrete job, so sponsor-prize judges find their technology in seconds.
- **"Never acts without a spoken yes" appears in the tagline, the opening and the safety rules.** It is the one idea to be remembered for.
- **The safety design is three numbered rules.** It answers the first question a judge asks about an AI that spends money.

## Before you submit — confirm these are true

This text describes three things that were still being finished when it was written. Check each, or soften the sentence:

1. **"The voice path: microphone → Deepgram → the assistant → Gemini → a spoken reply"** and **"An end-to-end voice pipeline from the microphone to a spoken answer."** Confirm the microphone transcript reaches the assistant.
2. **"67 automated tests."** Re-run `python -m unittest discover -s backend/tests` and update the number if it changed.
3. **"Sends it after the same spoken yes"** (WhatsApp). Automatic sending works on the Windows laptop through WhatsApp Desktop; on other machines the chat opens with the message ready.

No latency figures are stated for the cloud path on purpose — none were measured end to end. The one speed claim made ("well under a tenth of a second per frame" for hazard detection) was measured at 46–78 ms.
