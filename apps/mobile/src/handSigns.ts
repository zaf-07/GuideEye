export type HandPoint = { x: number; y: number; z?: number };

export type HandSignState = {
  word: string;
  confidence: number;
  progress: number;
  count: number;
};

type Vector = [number, number, number];
type FingerState = 'up' | 'down' | 'half';
type FingerName = 'index' | 'middle' | 'ring' | 'pinky';

type HandShape = {
  size: number;
  thumb: FingerState;
  index: FingerState;
  middle: FingerState;
  ring: FingerState;
  pinky: FingerState;
  thumbUpward: number;
  pinch: number;
};

type TrailFrame = {
  t: number;
  x: number;
  y: number;
  size: number;
  indexX: number;
  fist: boolean;
  open: boolean;
  point: boolean;
  thumbUp: boolean;
  snap: number;
  ringPinkyDown: boolean;
  palmThumbIn: boolean;
  fistThumbIn: boolean;
};

type TrailFlag = 'fist' | 'open' | 'point' | 'thumbUp';

const FINGERS: FingerName[] = ['index', 'middle', 'ring', 'pinky'];
const WINDOW = 10;
const WORD_VOTES = 7;
const TRAIL_MS = 2000;
const MOTION_QUIET_MS = 1500;
const MOTION_REPEAT_MS = 2500;
const MOTION_CONFIDENCE = 0.92;

const sub = (a: HandPoint, b: HandPoint): Vector => [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
const len = (v: Vector) => Math.hypot(v[0], v[1], v[2]) || 1e-6;
const dot = (u: Vector, v: Vector) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const dist = (a: HandPoint, b: HandPoint) => len(sub(a, b));
const span = (values: number[]) => Math.max(...values) - Math.min(...values);

function straightness(p: HandPoint[], base: number, middle: number, tip: number) {
  const first = sub(p[middle], p[base]);
  const second = sub(p[tip], p[middle]);
  return dot(first, second) / (len(first) * len(second));
}

export function handShape(p: HandPoint[]): HandShape {
  const size = dist(p[0], p[9]);
  const finger = (mcp: number, pip: number, dip: number, tip: number): FingerState => {
    const bend = Math.min(straightness(p, mcp, pip, dip), straightness(p, pip, dip, tip));
    const reach = dist(p[tip], p[0]) / dist(p[mcp], p[0]);
    if (bend > 0.75 && reach > 1.45) return 'up';
    if (bend < 0.35 || reach < 1.2) return 'down';
    return 'half';
  };
  const thumbStraight = straightness(p, 2, 3, 4);
  const thumbAway = dist(p[4], p[5]) / size;
  const thumbOut = dist(p[4], p[17]) / dist(p[2], p[17]);
  let thumb: FingerState = 'half';
  if (thumbStraight > 0.7 && thumbAway > 0.6 && thumbOut > 1.15) thumb = 'up';
  else if (thumbAway < 0.45 || thumbOut < 1.0) thumb = 'down';
  const direction = sub(p[4], p[2]);
  return {
    size,
    thumb,
    index: finger(5, 6, 7, 8),
    middle: finger(9, 10, 11, 12),
    ring: finger(13, 14, 15, 16),
    pinky: finger(17, 18, 19, 20),
    thumbUpward: -direction[1] / len(direction),
    pinch: dist(p[4], p[8]) / size,
  };
}

export function readHandshape(p: HandPoint[]): string {
  const shape = handShape(p);
  const up = (name: FingerName) => shape[name] === 'up';
  const down = (name: FingerName) => shape[name] === 'down';
  const fingersUp = FINGERS.filter(up).length;
  const fingersDown = FINGERS.filter(down).length;

  if (shape.pinch < 0.3 && up('middle') && up('ring') && up('pinky') && !up('index')) return 'OK';
  if (up('index') && up('pinky') && down('middle') && down('ring') && shape.thumb !== 'down') return 'I love you';
  if (fingersDown === 4 && shape.thumb === 'up') {
    if (shape.thumbUpward > 0.55) return 'Yes';
    if (shape.thumbUpward < -0.55) return 'No';
    return '';
  }
  if (fingersUp === 4 && shape.thumb === 'up') return 'Hello';
  if (fingersUp === 4 && shape.thumb === 'down') return 'SOS';
  if (up('index') && up('middle') && up('ring') && down('pinky')) return 'Water';
  if (up('index') && up('middle') && down('ring') && down('pinky')) return 'Peace';
  if (up('pinky') && shape.thumb === 'up' && down('index') && down('middle') && down('ring')) return 'Call me';
  if (up('index') && fingersUp === 1 && shape.thumb !== 'up') return 'You';
  return '';
}

function reversals(values: number[], step: number) {
  let changes = 0;
  let direction = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (Math.abs(delta) < step) continue;
    const next = Math.sign(delta);
    if (direction && next !== direction) changes++;
    direction = next;
  }
  return changes;
}

function circling(points: TrailFrame[]) {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let total = 0;
  let last: number | null = null;
  let radius = 0;
  for (const point of points) {
    const angle = Math.atan2(point.y - cy, point.x - cx);
    if (last !== null) {
      let delta = angle - last;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      total += delta;
    }
    last = angle;
    radius += Math.hypot(point.x - cx, point.y - cy) / points.length;
  }
  const wide = span(points.map((point) => point.x));
  const tall = span(points.map((point) => point.y));
  return { angle: Math.abs(total), radius, round: Math.min(wide, tall) / (Math.max(wide, tall) || 1e-6) };
}

const share = (frames: TrailFrame[], key: TrailFlag) =>
  frames.filter((frame) => frame[key]).length / frames.length;

export class HandSignReader {
  private trail: TrailFrame[] = [];
  private votes: string[] = [];
  private heldWord = '';
  private lastMotion = '';
  private lastMotionAt = -Infinity;
  private motionQuietUntil = -Infinity;
  private count = 0;

  reset() {
    this.trail = [];
    this.votes = [];
    this.heldWord = '';
    this.lastMotion = '';
    this.lastMotionAt = -Infinity;
    this.motionQuietUntil = -Infinity;
  }

  private readMotion(p: HandPoint[], now: number): string {
    const shape = handShape(p);
    const up = (name: FingerName) => shape[name] === 'up';
    const down = (name: FingerName) => shape[name] === 'down';
    const fingersUp = FINGERS.filter(up).length;
    const fingersDown = FINGERS.filter(down).length;
    this.trail.push({
      t: now,
      x: p[0].x,
      y: p[0].y,
      size: shape.size,
      indexX: p[8].x,
      fist: fingersDown === 4,
      open: fingersUp === 4,
      point: up('index') && fingersUp === 1,
      thumbUp: fingersDown === 4 && shape.thumb === 'up' && shape.thumbUpward > 0.55,
      snap: (dist(p[4], p[8]) + dist(p[4], p[12])) / 2 / shape.size,
      ringPinkyDown: down('ring') && down('pinky'),
      palmThumbIn: fingersUp === 4 && shape.thumb === 'down',
      fistThumbIn: fingersDown >= 3 && shape.thumb !== 'up',
    });
    while (this.trail.length && now - this.trail[0].t > TRAIL_MS) this.trail.shift();
    const trail = this.trail;
    if (trail.length < 8 || now < this.motionQuietUntil) return '';
    const size = shape.size;
    const recent = trail.slice(-16);
    const latest = trail[trail.length - 1];

    const before = trail.slice(-24, -4);
    const after = trail.slice(-4);
    const closedOverThumb = after.filter((frame) => frame.fistThumbIn).length >= 3;
    const showedPalm = before.filter((frame) => frame.palmThumbIn).length >= 3;
    if (closedOverThumb && showedPalm && span(recent.map((frame) => frame.x)) < 0.7 * size) return 'SOS';

    if (share(recent, 'thumbUp') > 0.6 && recent[0].y - latest.y > 0.6 * size) return 'Help';

    if (share(recent, 'fist') > 0.6 && share(recent, 'thumbUp') < 0.4) {
      const circle = circling(trail.slice(-20));
      if (circle.round > 0.55 && circle.angle > 2.6 && circle.radius > 0.14 * size) return 'Sorry';
      const ys = recent.map((frame) => frame.y);
      const xs = recent.map((frame) => frame.x);
      if (reversals(ys, 0.04 * size) >= 2 && span(ys) > 0.22 * size && span(xs) < 0.6 * span(ys)) return 'Yes';
    }

    if (latest.ringPinkyDown && !latest.fist && trail.length >= 14) {
      const opened = Math.max(...trail.slice(-14, -3).map((frame) => frame.snap));
      const closed = Math.min(...trail.slice(-3).map((frame) => frame.snap));
      if (opened > 0.75 && closed < 0.42) return 'No';
    }
    if (share(recent, 'point') > 0.6) {
      const xs = recent.map((frame) => frame.indexX);
      if (reversals(xs, 0.04 * size) >= 2 && span(xs) > 0.3 * size) return 'No';
    }

    if (share(recent, 'open') > 0.6) {
      const xs = recent.map((frame) => frame.x);
      const ys = recent.map((frame) => frame.y);
      const earlier = trail.slice(-12, -4).map((frame) => frame.size);
      if (earlier.length && latest.size / Math.min(...earlier) > 1.28) return 'Stop';
      const circle = circling(trail.slice(-20));
      if (circle.round > 0.55 && circle.angle > 2.8 && circle.radius > 0.14 * size) return 'Please';
      if (reversals(xs, 0.05 * size) >= 2 && span(xs) > 0.45 * size && span(ys) < 0.6 * size) return 'Hello';
      const heights = trail.slice(-16, -4).map((frame) => frame.y);
      if (heights.length && latest.y - Math.min(...heights) > 0.75 * size && span(xs) < 0.5 * size) return 'Thank you';
    }
    return '';
  }

  feed(points: HandPoint[] | null | undefined, now: number): HandSignState {
    const hand = points && points.length >= 21 ? points : null;
    if (!hand) this.trail = [];
    const motion = hand ? this.readMotion(hand, now) : '';
    if (motion && (motion !== this.lastMotion || now - this.lastMotionAt > MOTION_REPEAT_MS)) {
      this.lastMotion = motion;
      this.lastMotionAt = now;
      this.motionQuietUntil = now + MOTION_QUIET_MS;
      this.trail = [];
      this.votes = [];
      this.heldWord = motion;
      this.count += 1;
      return { word: motion, confidence: MOTION_CONFIDENCE, progress: 1, count: this.count };
    }

    const trail = this.trail;
    const recent = trail.slice(-8);
    const steady =
      trail.length >= 6 &&
      Math.hypot(span(recent.map((frame) => frame.x)), span(recent.map((frame) => frame.y))) <
        0.3 * trail[trail.length - 1].size;
    const settled = now - this.lastMotionAt > MOTION_QUIET_MS;
    this.votes.push(hand && steady && settled ? readHandshape(hand) : '');
    if (this.votes.length > WINDOW) this.votes.shift();

    const counts = new Map<string, number>();
    for (const vote of this.votes) if (vote) counts.set(vote, (counts.get(vote) || 0) + 1);
    let word = '';
    let votes = 0;
    for (const [candidate, total] of counts) {
      if (total > votes) {
        word = candidate;
        votes = total;
      }
    }
    if (!hand && this.votes.every((vote) => !vote)) this.heldWord = '';
    if (word && votes >= WORD_VOTES && word !== this.heldWord) {
      this.heldWord = word;
      this.count += 1;
    }
    if (!word && now - this.lastMotionAt < MOTION_QUIET_MS) {
      return { word: this.lastMotion, confidence: MOTION_CONFIDENCE, progress: 1, count: this.count };
    }
    return { word, confidence: votes / WINDOW, progress: Math.min(1, votes / WORD_VOTES), count: this.count };
  }
}
