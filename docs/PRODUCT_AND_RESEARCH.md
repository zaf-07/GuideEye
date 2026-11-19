# GuideEye product and research brief

## Product decision

The strongest story is not “voice control for every Android button.” It is one accessible trust layer between a person, wearable and phone: **hear → understand → preview → confirm → act → acknowledge**. The unique feature is Bridge: the same loop works across disability boundaries through captions, speech and later a deliberately limited, validated sign vocabulary.

Recommended wake phrase: **“Guide, I’m ready.”** It is short, brand-linked and does not imply emergency reliability. Push-to-talk remains available because always-on wake-word processing needs battery, privacy and false-activation testing.

## Vexo capability matrix

| Capability | Status | Evidence / decision |
|---|---|---|
| Built-in microphone | Verified on band 20 | Official contract: 16 kHz mono Opus, 20 ms packets. A 3-second USB test received 143 packets without storing or transmitting them. |
| Band vibration | Not present | The official Vexo Open contract explicitly lists vibration as absent. Use Android phone haptics. |
| USB connection | Verified on band 20 | `GET_INFO` returned band 20, firmware 1.1.0 and protocol 1.1 over `/dev/cu.usbmodem1101`. |
| Bluetooth connection | Implemented | Exact name `Vexo-HACK-20` plus official service UUID; the kit verifies the reported band number after connecting. |
| Deepgram live transcription | Implemented, key required | Official kit helper sends Opus directly with `mip_opt_out=true`; key only from `DEEPGRAM_API_KEY` or ignored `.env`. |
| LED feedback | Verified on band 20 | Official `IDENTIFY` produced a four-second white flash. |

## Android feasibility

- Maps: use a Google Maps directions intent. The user remains in control.
- Calls: `ACTION_DIAL` is safer than direct calling because it leaves the final action to the user.
- WhatsApp: deep-link to a contact or prefilled message. Reading all chats is not a general Android permission; it needs WhatsApp support, notification access for future notifications, or AccessibilityService automation.
- Full phone control is possible only in bounded form. An AccessibilityService can observe UI and perform gestures after explicit user enablement, but it is sensitive, brittle and subject to Google Play policy. Use an allowlist, visible state, local audit log, confirmation for consequential actions and an immediate stop control.
- Tracking: background location needs explicit consent, an ongoing notification and secure authenticated sharing. It must be trip-scoped, revocable and never covert.

## Demo flow

1. “Guide, I’m ready. In 30 minutes help me walk to Safeway.”
2. GuideEye repeats the plan and asks for confirmation.
3. At the due time it announces readiness and asks before opening walking directions.
4. Journey mode speaks Maps route instructions and labels separate camera observations as unverified. It never invents distance.
5. A trusted contact can follow only after the user enables Guardian for this trip.
6. In Bridge, another person's speech becomes large text; the user dictates a phrase and the phone speaks it.

## Next slices

1. Run the live Deepgram test after the team sets `DEEPGRAM_API_KEY`; never put the key in source or chat.
2. Wrap the PWA as a Trusted Web Activity or move the shell native for intents, foreground location and camera.
3. Add local wake-word detection with an explicit listening indicator and measured false-positive rate.
4. Add on-device object detection from the prior core behind the new event contract; keep routing and vision warnings independent.
5. Add an allowlisted AccessibilityService only for judge-visible scenarios, with a persistent notification and confirmation gate.
6. Extend Bridge with MediaPipe landmarks and a signer-validated phrase vocabulary. Never claim universal ASL translation.
