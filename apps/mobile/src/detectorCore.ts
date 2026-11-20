import type { LocalDetection } from './detector.types';

export type RgbaFrame = { width: number; height: number; data: ArrayLike<number> };

export type Letterboxed = { input: Float32Array; scale: number; padX: number; padY: number };

export const YOLOX_INPUT_SIZE = 416;
export const YOLOX_CLASSES = 80;
const ROW = 5 + YOLOX_CLASSES;

export const COCO = ['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'];

export const SCORE_THRESHOLD = 0.5;
const IOU_THRESHOLD = 0.45;
const MAX_RESULTS = 20;
const MAX_FRAME_COVERAGE = 0.82;
const LABEL_CONFIDENCE_FLOORS: Record<string, number> = {
  frisbee: 0.72,
  'sports ball': 0.66,
};

const GRID: { x: number; y: number; stride: number }[] = [];
for (const stride of [8, 16, 32]) {
  const size = YOLOX_INPUT_SIZE / stride;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) GRID.push({ x, y, stride });
  }
}
export const YOLOX_ROWS = GRID.length;

/**
 * EXIF orientation (1-8) from the APP1 payload jpeg-js exposes as `exifBuffer`.
 *
 * Phone cameras store the sensor's landscape pixels and record "rotate this
 * for display" in EXIF. A plain JPEG decoder ignores that, so a portrait photo
 * comes out lying on its side. Returns 1 (upright) when nothing usable is found.
 */
export function readExifOrientation(exif: ArrayLike<number> | null | undefined): number {
  if (!exif || exif.length < 14) return 1;
  // The TIFF header ("II*\0" or "MM\0*") follows an "Exif\0\0" marker that
  // decoders strip to different degrees, so look for it rather than assume.
  let start = -1;
  for (let offset = 0; offset <= 8 && offset + 4 <= exif.length; offset += 1) {
    const intel = exif[offset] === 0x49 && exif[offset + 1] === 0x49 && exif[offset + 2] === 0x2a && exif[offset + 3] === 0x00;
    const motorola = exif[offset] === 0x4d && exif[offset + 1] === 0x4d && exif[offset + 2] === 0x00 && exif[offset + 3] === 0x2a;
    if (intel || motorola) {
      start = offset;
      break;
    }
  }
  if (start < 0) return 1;
  const little = exif[start] === 0x49;
  const u16 = (offset: number) => (little
    ? exif[offset] | (exif[offset + 1] << 8)
    : (exif[offset] << 8) | exif[offset + 1]);
  const u32 = (offset: number) => (little
    ? (exif[offset] | (exif[offset + 1] << 8) | (exif[offset + 2] << 16) | (exif[offset + 3] << 24)) >>> 0
    : ((exif[offset] << 24) | (exif[offset + 1] << 16) | (exif[offset + 2] << 8) | exif[offset + 3]) >>> 0);
  if (start + 8 > exif.length) return 1;
  const directory = start + u32(start + 4);
  if (directory + 2 > exif.length) return 1;
  const entries = u16(directory);
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > exif.length) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * The frame as the user sees it: EXIF rotation applied, no larger than
 * `maxSide` on its long edge. Returns the input untouched when it is already
 * upright and small enough.
 */
export function uprightFrame(image: RgbaFrame, orientation: number, maxSide: number): RgbaFrame {
  const swap = orientation >= 5 && orientation <= 8;
  const fullWidth = swap ? image.height : image.width;
  const fullHeight = swap ? image.width : image.height;
  const shrink = Math.min(1, maxSide / Math.max(fullWidth, fullHeight));
  if (orientation === 1 && shrink === 1) return image;
  const width = Math.max(1, Math.round(fullWidth * shrink));
  const height = Math.max(1, Math.round(fullHeight * shrink));
  const data = new Uint8Array(width * height * 4);
  const source = image.data;
  const sw = image.width;
  const sh = image.height;
  for (let y = 0; y < height; y += 1) {
    const v = Math.min(fullHeight - 1, Math.floor((y + 0.5) / shrink));
    for (let x = 0; x < width; x += 1) {
      const u = Math.min(fullWidth - 1, Math.floor((x + 0.5) / shrink));
      let sx = u;
      let sy = v;
      switch (orientation) {
        case 2: sx = sw - 1 - u; break;
        case 3: sx = sw - 1 - u; sy = sh - 1 - v; break;
        case 4: sy = sh - 1 - v; break;
        case 5: sx = v; sy = u; break;
        case 6: sx = v; sy = sh - 1 - u; break;
        case 7: sx = sw - 1 - v; sy = sh - 1 - u; break;
        case 8: sx = sw - 1 - v; sy = u; break;
        default: break;
      }
      const from = (sy * sw + sx) * 4;
      const to = (y * width + x) * 4;
      data[to] = source[from];
      data[to + 1] = source[from + 1];
      data[to + 2] = source[from + 2];
      data[to + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Letterbox into the YOLOX input tensor.
 *
 * YOLOX was trained on OpenCV images: channels in blue-green-red order, raw
 * 0-255 values, grey 114 padding. Feeding red-green-blue still "works" but
 * costs accuracy (a cat reads as a dog, a bus drops from 0.84 to 0.54).
 */
export function letterboxBgr(image: RgbaFrame, size = YOLOX_INPUT_SIZE, reuse?: Float32Array): Letterboxed {
  const scale = Math.min(size / image.width, size / image.height);
  const renderedWidth = Math.min(size, Math.round(image.width * scale));
  const renderedHeight = Math.min(size, Math.round(image.height * scale));
  const padX = Math.floor((size - renderedWidth) / 2);
  const padY = Math.floor((size - renderedHeight) / 2);
  const plane = size * size;
  const input = reuse && reuse.length === plane * 3 ? reuse : new Float32Array(plane * 3);
  input.fill(114);
  const columns = new Int32Array(renderedWidth);
  for (let x = 0; x < renderedWidth; x += 1) {
    columns[x] = Math.min(image.width - 1, Math.floor((x + 0.5) / scale)) * 4;
  }
  const data = image.data;
  for (let y = 0; y < renderedHeight; y += 1) {
    const row = Math.min(image.height - 1, Math.floor((y + 0.5) / scale)) * image.width * 4;
    const out = (y + padY) * size + padX;
    for (let x = 0; x < renderedWidth; x += 1) {
      const rgba = row + columns[x];
      input[out + x] = data[rgba + 2];
      input[plane + out + x] = data[rgba + 1];
      input[plane * 2 + out + x] = data[rgba];
    }
  }
  return { input, scale, padX, padY };
}

function iou(a: LocalDetection, b: LocalDetection) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

function suppressOverlaps(items: LocalDetection[]) {
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
  const kept: LocalDetection[] = [];
  for (const candidate of sorted) {
    if (kept.every((existing) => existing.label !== candidate.label || iou(existing, candidate) < IOU_THRESHOLD)) {
      kept.push(candidate);
      if (kept.length === MAX_RESULTS) break;
    }
  }
  return kept;
}

/** Raw YOLOX output rows to boxes normalized to the upright frame. */
export function decodeYolox(values: ArrayLike<number>, box: Letterboxed, frame: { width: number; height: number }): LocalDetection[] {
  if (values.length < YOLOX_ROWS * ROW) throw new Error(`Unexpected YOLOX output length ${values.length}`);
  const renderedWidth = frame.width * box.scale;
  const renderedHeight = frame.height * box.scale;
  const detections: LocalDetection[] = [];
  for (let row = 0; row < YOLOX_ROWS; row += 1) {
    const offset = row * ROW;
    const objectness = values[offset + 4];
    if (objectness < SCORE_THRESHOLD) continue;
    let classIndex = 0;
    let classScore = 0;
    for (let index = 0; index < YOLOX_CLASSES; index += 1) {
      if (values[offset + 5 + index] > classScore) {
        classScore = values[offset + 5 + index];
        classIndex = index;
      }
    }
    const confidence = objectness * classScore;
    const label = COCO[classIndex];
    if (confidence < (LABEL_CONFIDENCE_FLOORS[label] ?? SCORE_THRESHOLD)) continue;
    const grid = GRID[row];
    const centerX = (values[offset] + grid.x) * grid.stride;
    const centerY = (values[offset + 1] + grid.y) * grid.stride;
    const boxWidth = Math.exp(values[offset + 2]) * grid.stride;
    const boxHeight = Math.exp(values[offset + 3]) * grid.stride;
    const left = (centerX - boxWidth / 2 - box.padX) / renderedWidth;
    const top = (centerY - boxHeight / 2 - box.padY) / renderedHeight;
    const right = (centerX + boxWidth / 2 - box.padX) / renderedWidth;
    const bottom = (centerY + boxHeight / 2 - box.padY) / renderedHeight;
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    const width = Math.min(1, right) - x;
    const height = Math.min(1, bottom) - y;
    if (width < 0.025 || height < 0.025) continue;
    // A box swallowing the whole frame is usually a false positive, except a
    // person: someone standing right in front of the wearer fills the view and
    // is exactly what must not be dropped.
    if (label !== 'person' && width * height > MAX_FRAME_COVERAGE) continue;
    detections.push({ label, confidence, x, y, width, height });
  }
  return suppressOverlaps(detections);
}

const OBJECT_HEIGHT_PRIORS: Record<string, number> = {
  person: 1.70,
  bicycle: 1.00,
  car: 1.50,
  motorcycle: 1.10,
  bus: 3.10,
  train: 3.80,
  truck: 2.80,
  traffic_light: 1.20,
  fire_hydrant: 0.70,
  stop_sign: 0.80,
  bench: 0.85,
  cat: 0.30,
  dog: 0.55,
  horse: 1.60,
  backpack: 0.45,
  umbrella: 0.85,
  handbag: 0.35,
  suitcase: 0.65,
  bottle: 0.24,
  wine_glass: 0.20,
  cup: 0.12,
  fork: 0.18,
  knife: 0.20,
  spoon: 0.16,
  bowl: 0.12,
  banana: 0.18,
  apple: 0.08,
  sandwich: 0.10,
  chair: 0.85,
  couch: 0.85,
  potted_plant: 0.45,
  bed: 0.75,
  dining_table: 0.75,
  tv: 0.55,
  laptop: 0.30,
  mouse: 0.06,
  remote: 0.18,
  keyboard: 0.15,
  cell_phone: 0.15,
  microwave: 0.35,
  oven: 0.75,
  sink: 0.60,
  refrigerator: 1.70,
  book: 0.24,
  clock: 0.30,
};

// Focal length over frame height for a phone's main camera held upright
// (about 69 degrees along the long edge). The earlier 1.15 placed everything
// roughly half as far again as it really was, which is the unsafe direction.
const FOCAL_OVER_HEIGHT = 0.75;

export function estimateSpatialInfo(item: LocalDetection): { distance_m: number; direction: 'left' | 'ahead' | 'right' } {
  const prior = OBJECT_HEIGHT_PRIORS[item.label.replace(/\s+/g, '_')] ?? 0.50;
  const raw = (prior * FOCAL_OVER_HEIGHT) / Math.max(0.04, item.height);
  const distance_m = Math.round(Math.max(0.3, Math.min(8.0, raw)) * 10) / 10;
  const centerX = item.x + item.width / 2;
  const direction: 'left' | 'ahead' | 'right' = centerX < 0.35 ? 'left' : centerX > 0.65 ? 'right' : 'ahead';
  return { distance_m, direction };
}

type TrackState = LocalDetection & {
  missed: number;
  id: number;
  prevDistance?: number;
  lastSeenTime: number;
};

/** Smooths boxes between frames and keeps an object alive through a missed frame or two. */
export class TemporalObjectTracker {
  private tracks: TrackState[] = [];
  private nextId = 1;
  private readonly emaAlpha = 0.68;
  private readonly matchIouThreshold = 0.28;

  update(rawDetections: LocalDetection[], now = Date.now()): LocalDetection[] {
    const matchedTracks = new Set<number>();
    const matchedDetections = new Set<number>();

    for (let d = 0; d < rawDetections.length; d += 1) {
      const candidate = rawDetections[d];
      let bestIou = this.matchIouThreshold;
      let bestTrack = -1;
      for (let t = 0; t < this.tracks.length; t += 1) {
        if (matchedTracks.has(t)) continue;
        const track = this.tracks[t];
        if (track.label !== candidate.label) continue;
        const overlap = iou(track, candidate);
        if (overlap > bestIou) {
          bestIou = overlap;
          bestTrack = t;
        }
      }
      if (bestTrack === -1) continue;
      matchedTracks.add(bestTrack);
      matchedDetections.add(d);
      const track = this.tracks[bestTrack];
      track.x = this.emaAlpha * candidate.x + (1 - this.emaAlpha) * track.x;
      track.y = this.emaAlpha * candidate.y + (1 - this.emaAlpha) * track.y;
      track.width = this.emaAlpha * candidate.width + (1 - this.emaAlpha) * track.width;
      track.height = this.emaAlpha * candidate.height + (1 - this.emaAlpha) * track.height;
      track.confidence = this.emaAlpha * candidate.confidence + (1 - this.emaAlpha) * track.confidence;

      const spatial = estimateSpatialInfo(track);
      const dt = Math.max(0.05, (now - track.lastSeenTime) / 1000);
      if (track.prevDistance != null) {
        const speed = (track.prevDistance - spatial.distance_m) / dt;
        track.velocity_mps = Math.round(speed * 10) / 10;
        track.is_approaching = speed > 0.35 && spatial.distance_m <= 2.5 && spatial.direction === 'ahead';
      } else {
        track.is_approaching = false;
        track.velocity_mps = 0;
      }
      track.prevDistance = spatial.distance_m;
      track.lastSeenTime = now;
      track.distance_m = spatial.distance_m;
      track.direction = spatial.direction;
      track.missed = 0;
    }

    for (let d = 0; d < rawDetections.length; d += 1) {
      if (matchedDetections.has(d)) continue;
      const item = rawDetections[d];
      const spatial = estimateSpatialInfo(item);
      this.tracks.push({
        ...item,
        distance_m: spatial.distance_m,
        direction: spatial.direction,
        id: this.nextId,
        missed: 0,
        prevDistance: spatial.distance_m,
        lastSeenTime: now,
        is_approaching: false,
        velocity_mps: 0,
      });
      this.nextId += 1;
      matchedTracks.add(this.tracks.length - 1);
    }

    for (let t = 0; t < this.tracks.length; t += 1) {
      if (matchedTracks.has(t)) continue;
      this.tracks[t].missed += 1;
      this.tracks[t].confidence *= 0.88;
      this.tracks[t].is_approaching = false;
    }

    this.tracks = this.tracks.filter((track) => track.missed <= 2 && track.confidence >= 0.22);

    const sorted = [...this.tracks].sort((a, b) => {
      if (a.is_approaching && !b.is_approaching) return -1;
      if (b.is_approaching && !a.is_approaching) return 1;
      if (a.label === 'person' && b.label !== 'person') return -1;
      if (b.label === 'person' && a.label !== 'person') return 1;
      const distA = a.distance_m ?? 5;
      const distB = b.distance_m ?? 5;
      if (Math.abs(distA - distB) > 0.8) return distA - distB;
      return b.confidence - a.confidence;
    });

    return sorted.map(({ missed: _missed, prevDistance: _prev, lastSeenTime: _seen, ...item }) => item);
  }

  clear() {
    this.tracks = [];
  }
}
