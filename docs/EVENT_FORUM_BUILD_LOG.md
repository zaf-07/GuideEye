# Build Log: Building GuideEye — The Ambient AI Companion for Blind & Deaf Students

> **Submission Track:** Top-5 Build Log Prize ($1,000 Category)  
> **Event:** The BIG HACK GAME 2026 (Stanford vs Cal Hackathon)  
> **Team:** GuideEye  

---

## 🚀 The Inception: Why We Refused to Build Another Phone-Aiming App

If you close your eyes and walk through a hackathon hall, the world immediately shrinks. Every vision tool currently on the market asks blind users to do the one thing that feels unnatural and unsafe: hold a phone out with their dominant hand, aim a camera, and fumble around a glass touchscreen.

That hand is supposed to be holding a white cane or a guide dog harness.

We decided on Day 1: **GuideEye must be hands-free, hybrid by design, and never act without a spoken "Yes".**

---

## 🤝 Hour 9–18: Building the Deaf-Blind Bridge (Two Worlds, Zero Screens)

One of our favorite problems this weekend was communication between two people with complementary sensory impairments:
- What happens when a blind student who speaks wants to talk to a deaf student who signs?

We built the **Deaf-Blind Bridge**:
1. **Camera Signs to Spoken Audio:**
   - On web: MediaPipe 21-joint landmark detection directly in the browser running at 30 FPS.
   - On iOS: Apple's native Vision framework finding joints without sending a single frame to a cloud server.
   - Signs are classified into standard ASL glosses with confidence voting windows. A high-confidence sign is spoken aloud immediately through ElevenLabs natural speech.
2. **Spoken Voice to Live Captions & 3D ASL Avatar:**
   - As the blind partner speaks, live streaming speech recognition updates the deaf student's screen in real-time with high-contrast text.
   - Once completed, our deterministic ASL gloss translator reorders the English sentence into authentic ASL grammar (e.g., WH-questions reordered to the end of the phrase: *"Where is Room 204?"* → `ROOM 2 0 4 WHERE`).
   - A 3D WebGL skeleton avatar dynamically renders the hand poses in 3D space with interactive drag rotation!

---

## 🧠 Hour 19–26: The HarnessRouter Errand Breakthrough (UHP Protocol)

Single-turn models are notorious for hallucinating on physical paperwork. When a blind wearer holds up a hospital discharge summary or a utility bill and asks, *"What does this letter ask me to do?"*, a wrong guess is dangerous.

We integrated **HarnessRouter** (`chrn_e00fb0a783d07115989457c64f6364d0`) using the Universal Harness Protocol (UHP 2026-09-28):
- The document image is uploaded to `/v1/files` with `purpose: user_data`.
- The multi-step errand is dispatched asynchronously via `POST /v1/responses` with `background: true`.
- While the background agent verifies medical codes or billing dates, the app continues to run local safety radar.
- When the errand finishes, GuideEye speaks the concise action plan: *"This is a physical therapy bill for $42.50 due November 28. Should I draft a response?"*
- A spoken *"Yes"* continues the task using `previous_response_id`.

We published our complete, verifiable UHP request/response golden traces in the repo: `docs/HARNESSROUTER_EXECUTION_EVIDENCE.md`.

---

## 🛠️ Hour 27–34: The On-Device Radar & ElevenLabs Voice Pipeline

Safety cannot wait on a cellular handshake:
- **On-Device YOLO11n:** Evaluates camera frames locally in 48ms on the neural engine. Hazards (*"Chair ahead, left"*) are announced once—never nagging.
- **ElevenLabs Speech Flow:** Spoken responses stream natural ElevenLabs audio, with automatic fallback to native iOS/Android TTS if connectivity dips.
- **Private Memory Graph:** No video or images are stored. Only text notes are written to an on-device SQLite graph. One spoken phrase—*"Forget everything"*—wipes the database instantly.

---

## 🏆 Key Takeaways & What's Next

- **Determinism over Hallucination:** Accessibility is an issue of trust. Hard rules decide whether an action sends or pays, never probabilistic LLM weights.
- **Speed through Local Computation:** Moving vision and signs onto the device cut latency by 85%.
- **Customer Commitment:** We secured our first Letter of Intent for a 10-seat campus pilot ($1,470 commitment) to bring GuideEye to students with disabilities.

Check out our repository and build with us:
👉 https://github.com/legiaphat/GuideEye

#HarnessRouter #UHP #BigHackGame #BeatCal
