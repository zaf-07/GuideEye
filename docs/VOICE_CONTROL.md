# Hands-free voice control (iPhone)

For a profile with **Blind or low vision**, GuideEye keeps the microphone on while the app is open.
Say **"Guide"**, then the request, from any screen. No button is needed.

Status: written and unit-tested, **not yet run on a phone**. The checklist below is the first real test.

## Build on a Mac

```bash
git pull
npm install
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:8000 npx expo run:ios --device
```

- Use a real iPhone. Speech recognition is unreliable in the Simulator.
- The backend must be running and reachable from the phone (`./run.sh` or `run.bat`, same Wi-Fi), or use the deployed https address. It can also be typed in Settings.
- Native config changed (permission texts), so let `expo run:ios` regenerate the `ios/` folder; if one already exists, run `npx expo prebuild -p ios --clean` first.

## What to say

| Say | Result |
|---|---|
| "Guide" (pause) | Answers "Yes?" and takes the next sentence without the wake word |
| "Guide, take me to the nearest Safeway" | Walking route, spoken turn by turn |
| "Guide, take me home" | Route home (save it first: "Guide, my home is 123 Main Street") |
| "Guide, which way" / "stop navigation" | Next turn / ends the route |
| "Guide, text Tom I am on my way" then "yes" | Reads the message back, sends after a spoken yes. Tom must be in Family contacts |
| "Guide, call Tim" then "yes" | Starts the call |
| "Guide, in fifteen minutes take me home" | Starts that request in 15 minutes (app must stay open) |
| "Guide, remind me in ten minutes to leave" | Spoken reminder |
| "Guide, where am I" | Current address |
| "Guide, what is in front of me" | Opens the camera in pocket mode |
| "Guide, open settings" / "go back" / "home screen" | Moves between screens |
| "Guide, repeat that" / "stop talking" / "help" | Repeats, silences, lists examples |

## Test checklist

1. Fresh install, choose "Blind or low vision", allow microphone and speech recognition.
2. On the home screen the app says "GuideEye is listening" and a pill at the top shows `Say "Guide, …"`.
3. Each row of the table above.
4. While GuideEye is speaking, it must not react to its own voice (say nothing and check it never answers itself).
5. A message must never send without a spoken "yes".
6. Lock and unlock the phone: listening resumes.
7. Open Bridge: voice control pauses there (Bridge uses the microphone itself) and resumes on leaving.
8. Settings → "Hands-free voice control" off: the pill disappears and the Ask screen shows its "Speak a request" button again.

## Known limits

- English only (`en-US`), both recognition and commands.
- Works only while the app is open and the screen is on. There is no background listening.
- Delayed requests and timers are lost if the app is closed.
- If speech sounds quiet or comes from the earpiece after listening starts, the audio session options in `apps/mobile/src/voice/VoiceControl.tsx` (`iosCategory`) are the place to adjust.

## Where the code is

- `apps/mobile/src/voice/commands.ts` — wake word, on-phone commands, delayed requests (tests: `tests/voiceCommands.test.cjs`)
- `apps/mobile/src/voice/VoiceControl.tsx` — app-wide listener, mounted in `app/_layout.tsx`
- `apps/mobile/src/lib/announce.ts` — tracks when GuideEye is speaking so the microphone ignores it
