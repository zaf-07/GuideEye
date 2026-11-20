export type FrameSource = () => Promise<string | null>;

const FRESH_MS = 5000;

let source: FrameSource | null = null;
let last: { uri: string; at: number } | null = null;
const waiters = new Set<() => void>();

export function setFrameSource(next: FrameSource | null) {
  source = next;
  if (!next) {
    last = null;
    return;
  }
  waiters.forEach((resolve) => resolve());
  waiters.clear();
}

export function hasFrameSource() {
  return source !== null;
}

export function noteFrame(uri: string) {
  if (uri) last = { uri, at: Date.now() };
}

export function waitForFrameSource(timeoutMs: number): Promise<boolean> {
  if (source) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiters.delete(done);
      resolve(false);
    }, timeoutMs);
    waiters.add(done);
  });
}

// A frame the scan loop took this recently is as good as a new photo, and
// borrowing it avoids asking the camera for two pictures at once (iOS refuses
// the second, which used to stall scene assist for a couple of seconds).
const REUSE_MS = 1500;

export async function captureFrame(): Promise<string | null> {
  if (!source) return null;
  if (last && Date.now() - last.at <= REUSE_MS) return last.uri;
  try {
    const fresh = await source();
    if (fresh) return fresh;
  } catch {}
  return last && Date.now() - last.at <= FRESH_MS ? last.uri : null;
}

/** The most recent frame the scan loop took, if it is still current. Never takes a photo. */
export function recentFrame(maxAgeMs = FRESH_MS): string | null {
  return last && Date.now() - last.at <= maxAgeMs ? last.uri : null;
}

// Shared attention state. Scene assist reads it so that it neither talks over
// the assistant nor competes with it for the rate-limited cloud model.
let assistantBusy = false;
let attentionUntil = 0;

/** True while an assistant request is being answered. */
export function setAssistantBusy(value: boolean) {
  assistantBusy = value;
}

export function isAssistantBusy() {
  return assistantBusy;
}

/** The user said "Guide" and is about to speak: stay quiet for this long. */
export function holdAttention(ms: number) {
  attentionUntil = ms > 0 ? Date.now() + ms : 0;
}

export function attentionHeld(now = Date.now()) {
  return now < attentionUntil;
}

const VISUAL = new RegExp(
  [
    "\\bread\\b",
    "\\bwhat does (?:it|that|this|the) .*\\bsay\\b",
    "\\bwhat is written\\b",
    "\\b(?:pay|scan|buy)\\b.*\\b(?:this|that|it|code|qr|bill|total)\\b",
    "\\bscan (?:and|to) pay\\b",
    "^\\W*pay\\W*$",
    "\\bremember (?:this|that|where)\\b",
    "\\bsave this\\b",
    "\\bin front of me\\b",
    "\\bahead of me\\b",
    "\\bwhat (?:do|can) you see\\b",
    "\\bdescribe\\b",
    "\\blook (?:at|around)\\b",
    "\\bwhat(?:'s| is) (?:this|that)\\b",
    "\\bwhat colou?r\\b",
    "\\b(?:explain|summari[sz]e) (?:this|that|it)\\b",
    "\\bwhat does (?:this|that|it) (?:mean|ask|want)\\b",
    "\\b(?:this|the|my) (?:letter|document|form|invoice|bill|prescription|label|menu|sign|paper|page)\\b",
  ].join('|'),
  'i',
);

/** True when the request is about what the camera is looking at. */
export function needsCamera(text: string) {
  return VISUAL.test(text.trim());
}
