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

export async function captureFrame(): Promise<string | null> {
  if (!source) return null;
  try {
    const fresh = await source();
    if (fresh) return fresh;
  } catch {}
  return last && Date.now() - last.at <= FRESH_MS ? last.uri : null;
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
