# Nearby conversations

Two GuideEye phones that are close to each other, one set up for a blind or low-vision user and one for a deaf or hard-of-hearing user, are offered a conversation. When both people accept, the Bridge screen opens on both phones with the same conversation.

## Status

| Part | State |
| --- | --- |
| Server: Bridge API, radar matching, WebSocket push (`backend/app/nearby_api.py`, `backend/app/services/nearby.py`) | Built and tested (`backend/tests/test_nearby.py`) |
| App: radar client, connect prompt, settings and onboarding switch | Built. Type-checks, unit-tested, and the client was run against the real server. **Not yet run on a phone** |
| App: Multipeer Connectivity native module (`apps/mobile/modules/guideeye-multipeer`) | Written but **never compiled or run**. Needs a Mac with Xcode and two iPhones |

## How it works

1. A phone with "Find nearby GuideEye users" switched on sends a heartbeat every five seconds while the app is open: its role and its location.
2. The server offers two phones to each other when they have opposite roles and are within `RADAR_RADIUS_M` (50 m by default), or share the same beacon.
3. Each person sees or hears a neutral prompt. A blind user can say "connect" or double tap anywhere; a deaf user gets a sheet with a Connect button.
4. When both accept, the server creates a Bridge conversation and both phones open `/bridge` with its code.

If the server cannot be reached, two iPhones find each other directly over Multipeer Connectivity, ask for consent the same way, and carry the conversation over the peer-to-peer link. When the server can be reached, Multipeer is used only as a proximity signal: both phones send the same beacon so the server matches them even when GPS is poor.

## Privacy rules

- Off by default. The user turns it on in onboarding or Settings.
- A prompt never says who the other person is, their role, or an exact distance. Roles are shown only after both accept.
- Location is used to compare distance and is not stored. Presence expires 20 seconds after the last heartbeat, and the app stops sending when it goes to the background.
- Declining stops that pair being offered again for ten minutes.
- Multipeer advertises a random name, not the device name, and no role. Roles are exchanged inside the encrypted session.

## Running it

Server, reachable from both phones:

```bash
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

App, pointing at that server:

```bash
EXPO_PUBLIC_API_URL=http://<server-address>:8000 npm run mobile:ios
```

For an indoor demo where GPS is unreliable, give both builds the same beacon so they match regardless of location:

```bash
EXPO_PUBLIC_RADAR_BEACON=yc-demo
```

Then on each phone: finish onboarding with opposite profiles and switch on "Find nearby GuideEye users".

## Building the Multipeer module

The module is a local Expo module, linked automatically. It is not available in Expo Go.

```bash
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios --device
```

Test with two physical iPhones and the server switched off. The app asks for local network access the first time. `Info.plist` needs both `_guideeye._tcp` and `_guideeye._udp` under `NSBonjourServices`; `app.config.js` sets them.

Where to look when something fails:

- Swift: `apps/mobile/modules/guideeye-multipeer/ios/GuideEyeMultipeerModule.swift`
- Pairing and consent logic, shared by both paths: `apps/mobile/src/nearby/protocol.ts` (tested in `apps/mobile/tests/nearby.test.cjs`)
- The hook that runs both paths: `apps/mobile/src/nearby/useNearby.ts`

## Server API

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/radar/heartbeat` | `{role, lat, lon, beacon}`. Returns the current offer and match, if any |
| `POST /v1/radar/respond` | `{offer_id, accept}` |
| `POST /v1/radar/leave` | Stop being discoverable |
| `WS /v1/radar/ws` | Pushes `offer`, `offer_update`, `match`, `declined`, `expired`. First message: `{device_id, secret}` |
| `POST /v1/bridge/conversations` | Create a conversation; returns a six-digit code |
| `POST /v1/bridge/conversations/{code}/join` | Join as the second device |
| `GET /v1/bridge/conversations/{code}` | Conversation status |
| `POST /v1/bridge/message`, `GET /v1/bridge/messages` | Send and fetch messages |
| `WS /v1/bridge/ws/{code}` | Pushes new messages to members |

Every request carries `X-Device-ID`. State is kept in memory, so restarting the server ends open conversations.
