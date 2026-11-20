// A stand-in for the camera: a simple hand skeleton that can be posed, moved and filmed at 15 frames
// a second, so whole signs can be played to the reader in tests.
const ASPECT = 4 / 3;
const FRAME_MS = 66;

const KNUCKLES = { index: [-0.28, -0.92], middle: [0, -1.0], ring: [0.25, -0.93], pinky: [0.48, -0.78] };
const THUMB_BASE = [[-0.35, -0.25], [-0.6, -0.5]];
const THUMB = {
  out: [[-0.8, -0.78], [-0.98, -1.04]],
  in: [[-0.4, -0.6], [-0.2, -0.65]],
  side: [[-0.9, -0.52], [-1.2, -0.54]],
};
const BUNCH = [-0.1, -1.25], PINCH = [-0.5, -1.25];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

function finger(name, state) {
  const base = KNUCKLES[name];
  if (state === 'up') return [base, add(base, [0, -0.42]), add(base, [0, -0.7]), add(base, [0, -0.94])];
  if (state === 'down') return [base, add(base, [0, -0.3]), add(base, [0.02, -0.04]), add(base, [0.02, 0.16])];
  const target = state === 'pinch' ? PINCH : state === 'snap' ? THUMB.out[1] : BUNCH;
  // A finger curling over to meet the thumb: bent at the middle joint, not a straight line.
  const bulge = state === 'bunch' ? 0 : 0.22;
  return [base, add(mix(base, target, 0.45), [bulge, -bulge]), add(mix(base, target, 0.8), [bulge * 0.6, -bulge * 0.4]), target];
}

const SHAPES = {
  five: { fingers: ['up', 'up', 'up', 'up'], thumb: 'out' },
  flat: { fingers: ['up', 'up', 'up', 'up'], thumb: 'in' },
  fist: { fingers: ['down', 'down', 'down', 'down'], thumb: 'in' },
  thumbUp: { fingers: ['down', 'down', 'down', 'down'], thumb: 'out' },
  one: { fingers: ['up', 'down', 'down', 'down'], thumb: 'in' },
  two: { fingers: ['up', 'up', 'down', 'down'], thumb: 'in' },
  three: { fingers: ['up', 'up', 'up', 'down'], thumb: 'in' },
  ily: { fingers: ['up', 'down', 'down', 'up'], thumb: 'out' },
  snapOpen: { fingers: ['up', 'up', 'down', 'down'], thumb: 'out' },
  snapShut: { fingers: ['snap', 'snap', 'down', 'down'], thumb: 'out' },
  bunch: { fingers: ['bunch', 'bunch', 'bunch', 'bunch'], thumb: 'bunch' },
  ok: { fingers: ['pinch', 'up', 'up', 'up'], thumb: 'pinch' },
};

/**
 * 21 landmarks for one hand, as the tracker gives them (0..1 across and down the picture).
 * x, y: the wrist, in picture heights. size: wrist to middle knuckle. roll: radians about the wrist.
 * pitch: 1 = upright, less = knuckles tipped towards the camera (a nod at the wrist).
 */
function hand({ x, y, size = 0.14, shape = 'five', roll = 0, pitch = 1, left = false, noise = 0, seed = 1 }) {
  const { fingers, thumb } = SHAPES[shape];
  const thumbTip = thumb === 'bunch' ? [[-0.4, -0.95], BUNCH] : thumb === 'pinch' ? [[-0.62, -0.9], PINCH] : THUMB[thumb];
  const local = [[0, 0], ...THUMB_BASE, ...thumbTip];
  ['index', 'middle', 'ring', 'pinky'].forEach((name, i) => local.push(...finger(name, fingers[i])));
  let state = seed * 9301 + 49297;
  const jitter = () => { state = (state * 9301 + 49297) % 233280; return (state / 233280 - 0.5) * 2 * noise; };
  const cos = Math.cos(roll), sin = Math.sin(roll);
  return local.map(([lx, ly]) => {
    const px = left ? -lx : lx, py = ly * pitch;
    return { x: (x + (px * cos - py * sin) * size) / ASPECT + jitter(), y: y + (px * sin + py * cos) * size + jitter(), z: 0 };
  });
}

/** Face reference points for a face centred at x (picture heights) with its chin at `chin`. */
function face({ x = ASPECT / 2, chin = 0.5, height = 0.28 } = {}) {
  const at = (dy) => ({ x: x / ASPECT, y: chin - dy * height });
  return { chin: at(0), mouth: at(0.2), brow: at(0.68), forehead: at(1) };
}

/**
 * Film a scene. Each step is { ms, hands(k, t) } where k runs 0..1 through the step and hands returns
 * an array of hand settings (or [] for no hand in view). Returns every word the reader said, with its time.
 */
function film(reader, steps, { face: faceRefs = null, noise = 0.0015, start = 1000, frameMs = FRAME_MS } = {}) {
  const said = [], views = [];
  let t = start, seed = 1;
  for (const step of steps) {
    const frames = Math.max(1, Math.round(step.ms / frameMs));
    for (let i = 0; i < frames; i++) {
      const k = frames === 1 ? 1 : i / (frames - 1);
      const hands = (step.hands ? step.hands(k) : []).map(settings => hand({ noise, seed: seed++, ...settings }));
      const view = reader.step({ t, hands, face: faceRefs, aspect: ASPECT });
      for (const item of view.said) said.push({ ...item, t });
      views.push({ t, ...view });
      t += frameMs;
    }
  }
  return { words: said.map(item => item.word), said, views, end: t };
}

const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k * k * (3 - 2 * k);
/** Common pieces of a scene. */
const scene = {
  nothing: (ms = 600) => ({ ms }),
  hold: (ms, settings) => ({ ms, hands: () => [settings] }),
  move: (ms, from, to, more = {}) => ({
    ms, hands: k => [{ ...from, ...more, x: lerp(from.x, to.x, ease(k)), y: lerp(from.y, to.y, ease(k)),
      size: lerp(from.size ?? 0.14, to.size ?? from.size ?? 0.14, ease(k)) }],
  }),
};

module.exports = { ASPECT, FRAME_MS, hand, face, film, scene, lerp, ease, SHAPES };
