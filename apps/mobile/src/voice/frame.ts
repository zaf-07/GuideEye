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

export type SeenObject = { label: string; position: string; distance_m?: number | null };

let seen: { objects: SeenObject[]; at: number } | null = null;

/** What the detector currently sees, kept so a spoken request can carry it to the assistant's memory. */
export function noteSeenObjects(objects: SeenObject[]) {
  seen = { objects: summarizeSeen(objects), at: Date.now() };
}

export function seenObjects(maxAgeMs = FRESH_MS): SeenObject[] {
  return seen && Date.now() - seen.at <= maxAgeMs ? seen.objects : [];
}

/** Labels and positions only, one entry per kind of object and position, nearest first. */
export function summarizeSeen(objects: SeenObject[], limit = 12): SeenObject[] {
  const kept = new Map<string, SeenObject>();
  for (const item of objects) {
    const label = String(item.label || '').trim().toLowerCase();
    if (!label) continue;
    const distance = typeof item.distance_m === 'number' && Number.isFinite(item.distance_m) ? item.distance_m : null;
    const previous = kept.get(label);
    if (previous && (previous.distance_m ?? Infinity) <= (distance ?? Infinity)) continue;
    kept.set(label, { label, position: String(item.position || '').trim().toLowerCase(), distance_m: distance });
  }
  return [...kept.values()]
    .sort((left, right) => (left.distance_m ?? Infinity) - (right.distance_m ?? Infinity))
    .slice(0, limit);
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
function isObjectSearch(text: string): boolean {
  const request = text.trim();
  const explicit = /^(?:please\s+)?(?:look for|find|locate|can you see|where(?:'s| is| are))\s+(.+?)\s+(?:in (?:the |this |my )?(?:camera(?: view)?|frame)|in view)[.!?]*$/i.exec(request);
  const fixture = /^(?:please\s+)?(?:look for|find|locate|can you see|where(?:'s| is| are))\s+((?:(?:a|an|the|any)\s+)?(?:doors?|doorways?|stairs|staircase|light switches?|outlets?|sockets?))[.!?]*$/i.exec(request);
  return Boolean(explicit ?? fixture);
}

export function needsCamera(text: string) {
  return isObjectSearch(text) || VISUAL.test(text.trim());
}
