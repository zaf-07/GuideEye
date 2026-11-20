import { isAssistantBusy, noteFrame } from './voice/frame';
import { NoServerError, apiUrl, isAllowedEndpoint } from './api';
import { FrameJanitor } from './frameFiles';
import type { CameraView } from 'expo-camera';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { detectObjects, detectVideoFrame, localDetectorBackend, warmUpDetector } from './detector';
import type { DetectionResult, LocalDetection } from './detector.types';
import type { BlockedView } from './blockedView';

/** Directions the local camera frame looks blocked in, and when it was seen. */
export type BlockedFrame = BlockedView & { at: number };

export type AssistMode = 'scene' | 'sign';

export type VisionObject = {
  label: string;
  confidence: number;
  position: string;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  distance_m?: number | null;
  relative_proximity?: number | null;
  track_id?: number | null;
  motion?: {
    trend: 'approaching' | 'receding' | 'stable' | 'unknown';
    direction: 'left' | 'ahead' | 'right';
    distance_m?: number | null;
    relative_depth_velocity_mps?: number | null;
    time_to_closest_approach_s?: number | null;
    minimum_separation_m?: number | null;
    confidence: number;
    sample_count: number;
    camera_relative: boolean;
    world_motion_status: string;
    world_speed_mps?: number | null;
    experimental: true;
  } | null;
  spatial?: {
    estimate?: boolean;
    depth_source?: string;
    mask_coverage?: number;
    center_m?: number[];
    extent_m?: number[];
    point_count?: number;
    calibrated_camera?: boolean;
  } | null;
};

export type ApproachingWarning = { label: string; distance_m: number };

export type CameraCoachResult = {
  blur: boolean;
  poor_lighting: boolean;
  overexposed: boolean;
  cropped_labels: string[];
  sharpness_score: number;
  brightness_score: number;
};

export type VisionResult = {
  summary: string;
  speech: string;
  scene_key: string;
  urgency: 'low' | 'medium' | 'high';
  changed: boolean;
  objects: VisionObject[];
  task: AssistMode;
  should_speak?: boolean;
  warnings?: string[];
  approaching?: ApproachingWarning[];
  /** What the result describes, so narration can treat each kind differently. */
  kind?: 'objects' | 'blocked' | 'empty' | 'description';
};

/** The latest sentence from the cloud model about the whole scene. */
export type SceneDescription = { text: string; key: string; at: number };

type TrackingResult = {
  objects: VisionObject[];
  warnings?: string[];
  tracking_latency_ms: number;
  detector: 'yolo11' | 'disabled';
  metric_depth: boolean;
  camera_coach: CameraCoachResult | null;
  collision_warnings_enabled: false;
  obstacle_points?: number[][];
  obstacle_range_m?: number | null;
};

/** Camera-frame [x right, y down, z forward] meter dots for unlabeled surfaces. */
export type ObstacleFrame = {
  /** Increments once per tracking response so the map ingests each frame once. */
  sequence: number;
  capturedAt: number;
  points: Array<[number, number, number]>;
  rangeM: number | null;
};

export type SignTranslation = {
  transcript: string;
  segment: string;
  confidence: number;
  is_final: boolean;
  should_speak: boolean;
};

type VisionState = 'starting' | 'analyzing' | 'live' | 'offline' | 'paused';

export type VisionPerformance = {
  capture_fps: number;
  capture_ms: number | null;
  local_detection_ms: number | null;
  tracking_latency_ms: number | null;
  tracking_age_ms: number | null;
  tracking_status: 'waiting' | 'live' | 'slow' | 'offline';
  /** Where the local detector runs: the GPU (WebGPU), the CPU (wasm), or native. */
  local_backend?: 'webgpu' | 'wasm' | null;
};

// Local object frames should follow camera movement; cloud narration can update less often.
// Expo Camera exposes still capture rather than a native frame processor, so
// each scan is capture + shrink + detect. That work is the pacing; this pause
// only leaves the UI thread room between scans.
const LOCAL_SCAN_INTERVAL_MS = 120;
// A cloud description costs an upload and a rate-limited model call. Ask for a
// new one soon after the scene changes, otherwise only now and then.
const CLOUD_CHANGE_GAP_MS = 5000;
const CLOUD_REFRESH_MS = 20000;
// With no on-device detector the cloud is the only pair of eyes, so it is
// asked steadily, but never back to back.
const CLOUD_ONLY_GAP_MS = 6000;
// A server without its own detector answers the tracking call with nothing.
// Stop sending it a photo every second; look again occasionally.
const TRACKING_RECHECK_MS = 60000;
// While the browser detects straight from the video, the scan loop only
// decides when the server and cloud need a new photo.
const LIVE_SCAN_INTERVAL_MS = 250;
const LIVE_LOCAL_FRESH_MS = 1000;

function detectionSignature(detections: LocalDetection[]) {
  return detections
    .filter((item) => item.confidence >= 0.5)
    .map((item) => item.label)
    .sort()
    .join('|');
}

/** The camera preview's <video> element on web, once it is playing. */
function findCameraVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null;
  for (const video of Array.from(document.querySelectorAll('video'))) {
    if (video.readyState >= 2 && video.videoWidth > 0) return video;
  }
  return null;
}

const nextAnimationFrame = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 16);
});

/**
 * Address resolution lives in `src/api.ts` now. It used to be duplicated here
 * and keyed off `localStorage`, which React Native does not have, so on a
 * phone every one of these helpers resolved to the empty string and the whole
 * vision stack ran "offline" without ever saying why.
 */
export function isSecureEndpoint(urlStr: string): boolean {
  return isAllowedEndpoint(urlStr);
}

export function getApiUrl(): string {
  return apiUrl();
}

/** Whether a server is reachable for the cloud-only features (sign reading). */
export function hasVisionBackend(): boolean {
  return Boolean(apiUrl());
}

function requireApiUrl() {
  const url = getApiUrl();
  if (!url) throw new NoServerError();
  return url;
}

function dataUriToBlob(uri: string): Blob {
  const parts = uri.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(parts[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

type SceneDetection = {
  label: string;
  confidence: number;
  box: [number, number, number, number];
  position: string;
  area: number;
};

type SceneAnalysis = {
  warnings: string[];
  detections: SceneDetection[];
  detector: string;
  description: string | null;
  provider: string | null;
  latency_ms: { detect: number; total: number };
};

type SignReading = { text: string; confidence: number; provider: string | null };

async function frameBlob(uri: string): Promise<Blob> {
  if (uri.startsWith('data:')) return dataUriToBlob(uri);
  const imageResponse = await fetch(uri);
  if (!imageResponse.ok) throw new Error('Camera frame could not be prepared for analysis');
  return await imageResponse.blob();
}

async function appendFrame(data: FormData, field: string, uri: string, name: string) {
  if (typeof window !== 'undefined') {
    data.append(field, await frameBlob(uri), name);
  } else {
    data.append(field, { uri, name, type: 'image/jpeg' } as unknown as Blob);
  }
}

function requestError(message: string, response: Response) {
  const error = new Error(`${message}: ${response.status}`) as Error & { retryAfter?: number };
  error.retryAfter = Number(response.headers.get('retry-after') || 0);
  return error;
}

function sceneObjects(detections: SceneDetection[], limit: number): VisionObject[] {
  return [...detections]
    .sort((left, right) => right.area - left.area)
    .slice(0, limit)
    .map((item) => ({
      label: item.label,
      confidence: item.confidence,
      position: item.position,
      x: item.box[0],
      y: item.box[1],
      width: item.box[2] - item.box[0],
      height: item.box[3] - item.box[1],
    }));
}

function sceneKeyFor(analysis: SceneAnalysis) {
  const seen = [...new Set(analysis.detections.map((item) => `${item.label}@${item.position}`))].sort();
  if (seen.length || analysis.detector === 'ready') return (seen.join('|') || 'empty').replace(/,? /g, '-').slice(0, 80);
  const words = [...new Set((analysis.description || '').toLowerCase().match(/[a-z]{4,}/g) || [])].sort();
  return `text:${words.slice(0, 8).join('-')}`.slice(0, 80);
}

async function analyzeScene(uri: string, describe: boolean, signal: AbortSignal): Promise<SceneAnalysis> {
  const apiUrl = requireApiUrl();
  const data = new FormData();
  await appendFrame(data, 'image', uri, 'frame.jpg');
  data.append('describe', describe ? 'true' : 'false');
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/vision/analyze`, { method: 'POST', body: data, signal });
  } catch {
    throw new Error('Vision server unavailable');
  }
  if (!response.ok) throw requestError('Vision request failed', response);
  return (await response.json()) as SceneAnalysis;
}

async function readSign(frames: string[], signal?: AbortSignal): Promise<SignReading> {
  const apiUrl = requireApiUrl();
  const data = new FormData();
  for (let index = 0; index < frames.length; index++) {
    await appendFrame(data, 'images', frames[index], `frame-${index}.jpg`);
  }
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/bridge/sign`, { method: 'POST', body: data, signal });
  } catch {
    throw new Error('Sign interpretation server offline');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Sign interpretation failed: ${response.status}`);
  }
  return (await response.json()) as SignReading;
}

function signSentence(phrase: string) {
  const text = phrase.trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : '';
}

export function extendSignTranscript(previous: string, phrase: string) {
  const transcript = previous.trim();
  const segment = signSentence(phrase);
  if (!segment) return { transcript, segment: '' };
  const tail = transcript.replace(/[.!?, ]+$/, '').toLowerCase();
  if (tail.endsWith(segment.slice(0, -1).toLowerCase())) return { transcript, segment: '' };
  return { transcript: `${transcript} ${segment}`.trim().slice(-600), segment };
}

async function analyzeFrame(uri: string, mode: AssistMode, previousSceneKey: string, signal: AbortSignal): Promise<VisionResult> {
  if (mode === 'sign') {
    const reading = await readSign([uri], signal);
    const spoken = signSentence(reading.text);
    const key = reading.text.toLowerCase() || 'none';
    return {
      summary: spoken || 'No sign recognised',
      speech: spoken,
      scene_key: key,
      urgency: 'low',
      changed: key !== previousSceneKey,
      objects: [],
      task: 'sign',
      should_speak: Boolean(spoken) && key !== previousSceneKey,
    };
  }
  const analysis = await analyzeScene(uri, true, signal);
  // When its model call fails the server answers with a sentence built from
  // its own detector. With no detections that sentence is only "I do not
  // recognise anything", which is a failure report, not a description.
  const fromModel = Boolean(analysis.provider) && analysis.provider !== 'local';
  const speech = fromModel || analysis.detections.length ? (analysis.description || '').trim() : '';
  const key = sceneKeyFor(analysis);
  return {
    summary: speech.split(/(?<=[.!?])\s+/)[0].slice(0, 100),
    speech: speech.slice(0, 240),
    scene_key: key,
    urgency: analysis.warnings.length ? 'medium' : 'low',
    changed: key !== previousSceneKey,
    objects: sceneObjects(analysis.detections, 8),
    task: 'scene',
    should_speak: analysis.warnings.length > 0 && key !== previousSceneKey,
    warnings: analysis.warnings,
    kind: 'description',
  };
}

async function trackFrame(uri: string, signal: AbortSignal): Promise<TrackingResult> {
  const analysis = await analyzeScene(uri, false, signal);
  return {
    objects: sceneObjects(analysis.detections, 12),
    warnings: analysis.warnings,
    tracking_latency_ms: analysis.latency_ms.detect,
    detector: analysis.detector === 'ready' ? 'yolo11' : 'disabled',
    metric_depth: false,
    camera_coach: null,
    collision_warnings_enabled: false,
  };
}

export async function interpretSignSequence(frames: string[], previousTranscript = '', signal?: AbortSignal): Promise<SignTranslation> {
  if (frames.length !== 3) throw new Error('Three sign-language context frames are required');
  const reading = await readSign(frames, signal);
  const next = extendSignTranscript(previousTranscript, reading.text);
  return {
    transcript: next.transcript,
    segment: next.segment,
    confidence: reading.confidence,
    is_final: Boolean(next.segment),
    should_speak: Boolean(next.segment),
  };
}

async function imageUriToDataUrl(uri: string) {
  if (uri.startsWith('data:')) {
    return uri.replace(/^data:[^;]*;base64,/, 'data:image/jpeg;base64,');
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Camera frame could not be prepared for sign translation');
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Camera frame could not be encoded'));
    reader.onload = () => {
      const encoded = String(reader.result);
      resolve(encoded.replace(/^data:[^;]*;base64,/, 'data:image/jpeg;base64,'));
    };
    reader.readAsDataURL(blob);
  });
}

// Server tracking (metric depth) answers about once a second; the local
// detector runs about five times a second. Keep the last server answer this
// long and lend its measurements to the matching local boxes in between.
const TRACKED_DEPTH_TTL_MS = 2500;

export type TrackedSnapshot = { objects: VisionObject[]; at: number };

function boxMatchScore(left: VisionObject, right: VisionObject) {
  const values = [left.x, left.y, left.width, left.height, right.x, right.y, right.width, right.height];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return 0;
  const [lx, ly, lw, lh, rx, ry, rw, rh] = values as number[];
  const overlapX = Math.max(0, Math.min(lx + lw, rx + rw) - Math.max(lx, rx));
  const overlapY = Math.max(0, Math.min(ly + lh, ry + rh) - Math.max(ly, ry));
  const intersection = overlapX * overlapY;
  const union = lw * lh + rw * rh - intersection;
  const iou = union > 0 ? intersection / union : 0;
  // The camera may have moved a little since the server's frame.
  const centerGap = Math.hypot(lx + lw / 2 - (rx + rw / 2), ly + lh / 2 - (ry + rh / 2));
  return Math.max(iou, 1 - centerGap / 0.15);
}

/**
 * Give local detections the server's measurements (distance, 3D center,
 * motion, track id) when a fresh server object with the same label overlaps.
 *
 * Without this, every local scan replaced the server's objects with copies
 * that had no distance, so the map showed an unhelpful missing range. Local
 * tracker ids are dropped because they share a number space with the server's
 * BoT-SORT ids and would merge two different objects on the map.
 */
export function withTrackedDepth(objects: VisionObject[], tracked: TrackedSnapshot | null, now = Date.now()): VisionObject[] {
  const fresh = tracked && now - tracked.at <= TRACKED_DEPTH_TTL_MS ? tracked.objects : [];
  const used = new Set<number>();
  return objects.map((item) => {
    let best = -1;
    let bestScore = 0.2;
    fresh.forEach((candidate, index) => {
      if (used.has(index) || candidate.label.toLowerCase() !== item.label.toLowerCase()) return;
      const score = boxMatchScore(item, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best < 0) return { ...item, track_id: null };
    used.add(best);
    const match = fresh[best];
    return {
      ...item,
      // Keep the local size-based estimate when the matching cloud frame did
      // not produce metric depth. A valid cloud measurement always wins.
      distance_m: match.distance_m ?? item.distance_m ?? null,
      relative_proximity: match.relative_proximity ?? item.relative_proximity ?? null,
      spatial: match.spatial ?? item.spatial,
      motion: match.motion ?? item.motion,
      track_id: match.track_id ?? null,
    };
  });
}

/** Where a blocked view sits, in words, or null when too little is blocked to say. */
function blockedDirection(blocked: BlockedView | null | undefined): 'ahead' | 'on the left' | 'on the right' | null {
  if (!blocked) return null;
  const centers = blocked.columns.map((value, index) => (value ? blocked.centers[index] : null)).filter((value): value is number => value != null);
  if (centers.length < 3) return null;
  const middle = centers.reduce((sum, value) => sum + value, 0) / centers.length;
  return middle < 0.38 ? 'on the left' : middle > 0.62 ? 'on the right' : 'ahead';
}

const NEAR_METERS = 1.2;

function isNear(item: LocalDetection) {
  return typeof item.distance_m === 'number' && Number.isFinite(item.distance_m) && item.distance_m > 0 && item.distance_m < NEAR_METERS;
}

/**
 * Distance the way a person would say it. The estimate comes from the size of
 * the box and a typical height for the object, so it is rough: say "very
 * close" or a rounded figure, never "2.3 m".
 */
function spokenDistance(item: LocalDetection) {
  const distance = item.distance_m;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0 || distance > 6) return '';
  if (distance < NEAR_METERS) return ', very close';
  const rounded = distance < 3 ? Math.round(distance * 2) / 2 : Math.round(distance);
  return `, about ${rounded} ${rounded === 1 ? 'meter' : 'meters'}`;
}

function plural(label: string) {
  if (label === 'person') return 'people';
  if (/(s|x|ch|sh)$/.test(label)) return `${label}es`;
  if (/[^aeiou]y$/.test(label)) return `${label.slice(0, -1)}ies`;
  if (label.endsWith('fe')) return `${label.slice(0, -2)}ves`;
  return `${label}s`;
}

const WHERE: Record<'ahead' | 'left' | 'right', string> = { ahead: 'ahead', left: 'on your left', right: 'on your right' };

export function synthesizeLocalSceneResult(
  detections: LocalDetection[],
  previousSceneKey: string,
  mode: AssistMode,
  blocked?: BlockedView | null,
): VisionResult {
  const visionObjects: VisionObject[] = detections.map((d) => ({
    label: d.label,
    confidence: d.confidence,
    position: d.direction || 'ahead',
    x: d.x,
    y: d.y,
    width: d.width,
    height: d.height,
    // The local tracker derives an approximate range from the detected box
    // height and a class-height prior. It is useful for the live map, but is
    // not calibrated depth.
    distance_m: typeof d.distance_m === 'number' && Number.isFinite(d.distance_m) && d.distance_m > 0
      ? d.distance_m
      : null,
    relative_proximity: null,
    track_id: d.id ?? null,
  }));

  if (detections.length === 0) {
    // Nothing named is not the same as nothing there: a plain wall, a trunk or
    // a covered lens has no label. Say what the camera can tell, and never
    // call the path clear (it cannot see stairs, curbs or glass either).
    if (blocked && (blocked.covered || blocked.dark)) {
      const scene_key = blocked.dark ? 'view_dark' : 'view_covered';
      return {
        summary: "Camera can't see",
        speech: "The camera can't see. It may be covered or too dark.",
        scene_key,
        urgency: 'medium',
        changed: scene_key !== previousSceneKey,
        objects: [],
        task: mode,
        should_speak: scene_key !== previousSceneKey,
        kind: 'blocked',
      };
    }
    const direction = blockedDirection(blocked);
    if (direction) {
      const scene_key = `view_blocked_${direction.replace(/ /g, '_')}`;
      return {
        summary: `View blocked ${direction}`,
        speech: `Something is blocking the view ${direction}. I can't tell how far.`,
        scene_key,
        urgency: 'medium',
        changed: scene_key !== previousSceneKey,
        objects: [],
        task: mode,
        should_speak: scene_key !== previousSceneKey,
        kind: 'blocked',
      };
    }
    const scene_key = 'empty_path';
    return {
      summary: 'Nothing recognized yet',
      speech: 'Nothing recognized ahead.',
      scene_key,
      urgency: 'low',
      changed: scene_key !== previousSceneKey,
      objects: [],
      task: mode,
      should_speak: false,
      kind: 'empty',
    };
  }

  // One phrase per kind of thing per direction: "2 people ahead", not a list
  // of every box. The tracker has already put approaching and near things first.
  const groups = new Map<string, { label: string; direction: 'ahead' | 'left' | 'right'; items: LocalDetection[] }>();
  for (const item of detections) {
    const direction = item.direction || 'ahead';
    const key = `${item.label}@${direction}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { label: item.label, direction, items: [item] });
  }
  const ordered = [...groups.values()].sort((a, b) => Number(b.direction === 'ahead') - Number(a.direction === 'ahead'));
  const approaching = detections.find((d) => d.is_approaching);
  const phrases = ordered.slice(0, 3).map((group) => {
    const count = group.items.length;
    const name = count > 1 ? `${count} ${plural(group.label)}` : group.label;
    const nearest = group.items.reduce((best, item) => ((item.distance_m ?? 99) < (best.distance_m ?? 99) ? item : best), group.items[0]);
    return `${name[0].toUpperCase()}${name.slice(1)} ${WHERE[group.direction]}${spokenDistance(nearest)}`;
  });
  const speech = `${approaching ? `Careful, ${approaching.label} coming closer. ` : ''}${phrases.join('. ')}.`;
  // The key is what narration compares to decide "has the scene changed". It
  // must not move when a box wobbles, so it holds which things are where and
  // whether one is very close, never a measured distance.
  const scene_key = `${approaching ? 'approach:' : ''}${ordered
    .slice(0, 4)
    .map((group) => `${group.label}@${group.direction}${group.items.some(isNear) ? '!' : ''}`)
    .sort()
    .join('|')}`;

  return {
    summary: phrases[0],
    speech,
    scene_key,
    urgency: approaching ? 'high' : 'low',
    changed: scene_key !== previousSceneKey,
    objects: visionObjects,
    task: mode,
    should_speak: scene_key !== previousSceneKey,
    kind: 'objects',
  };
}

const frameJanitor = new FrameJanitor();

/** Hand a frame captured outside the scan loop to the same clean-up. */
export function trackFrameFile(uri: string | null | undefined) {
  if (uri) frameJanitor.track(uri);
}

export function useVisionLoop(camera: RefObject<CameraView | null>, mode: AssistMode, enabled: boolean) {
  const [result, setResult] = useState<VisionResult | null>(null);
  const [description, setDescription] = useState<SceneDescription | null>(null);
  const [state, setState] = useState<VisionState>('starting');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [detections, setDetections] = useState<LocalDetection[]>([]);
  const [cameraCoach, setCameraCoach] = useState<CameraCoachResult | null>(null);
  const [obstacles, setObstacles] = useState<ObstacleFrame | null>(null);
  const [blocked, setBlocked] = useState<BlockedFrame | null>(null);
  const obstacleSequence = useRef(0);
  const [performance, setPerformance] = useState<VisionPerformance>({
    capture_fps: 0,
    capture_ms: null,
    local_detection_ms: null,
    tracking_latency_ms: null,
    tracking_age_ms: null,
    tracking_status: 'waiting',
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const cloudInFlight = useRef(false);
  const generation = useRef(0);
  const failures = useRef(0);
  const sceneKey = useRef('');
  const descriptionKey = useRef('');
  const localSignature = useRef('');
  // The scene changed since the cloud last described it.
  const cloudDirty = useRef(true);
  const lastCloudRequest = useRef(0);
  const lastTrackingAnalysis = useRef(0);
  const trackingInFlight = useRef(false);
  const trackingFailures = useRef(0);
  const trackingDisabledUntil = useRef(0);
  // Last fresh server tracking answer, lent to local scans until it expires.
  const trackedSnapshot = useRef<TrackedSnapshot | null>(null);
  const withDepth = useCallback((local: VisionResult): VisionResult => (
    { ...local, objects: withTrackedDepth(local.objects, trackedSnapshot.current) }
  ), []);
  const captureTimes = useRef<number[]>([]);
  // Latest result of the browser's live-video detection loop. While it is
  // fresh, the scan loop below uses it instead of capturing and detecting again.
  const liveLocal = useRef<{ result: DetectionResult; at: number } | null>(null);
  const signFrames = useRef<string[]>([]);
  const signTranscript = useRef('');

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    timer.current = null;
    controller.current = null;
    cloudInFlight.current = false;
    trackingInFlight.current = false;
  }, []);

  const run = useCallback(async (runGeneration: number) => {
    if (!enabled || !camera.current || runGeneration !== generation.current) return;
    setState((current) => current === 'offline' ? 'analyzing' : current);
    let nextDelay = mode === 'sign' ? 700 : LOCAL_SCAN_INTERVAL_MS;
    const activeApiUrl = getApiUrl();
    const live = mode === 'scene' && liveLocal.current && Date.now() - liveLocal.current.at <= LIVE_LOCAL_FRESH_MS
      ? liveLocal.current.result
      : null;
    // Is it time to ask the cloud model for a sentence about the scene?
    const cloudIsDue = (now: number, localAvailable: boolean) => {
      if (!activeApiUrl || cloudInFlight.current || isAssistantBusy()) return false;
      const since = now - lastCloudRequest.current;
      if (!localAvailable) return since >= CLOUD_ONLY_GAP_MS;
      return since >= (cloudDirty.current ? CLOUD_CHANGE_GAP_MS : CLOUD_REFRESH_MS);
    };
    const trackingIsDue = (now: number) => Boolean(activeApiUrl)
      && now >= trackingDisabledUntil.current
      && now - lastTrackingAnalysis.current >= 900
      && !trackingInFlight.current;
    const showLocal = (local: DetectionResult) => {
      const localResult = withDepth(synthesizeLocalSceneResult(local.detections, sceneKey.current, mode, local.blocked));
      sceneKey.current = localResult.scene_key;
      setResult(localResult);
      setLastUpdated(Date.now());
    };
    const noteSignature = (local: DetectionResult) => {
      const signature = detectionSignature(local.detections);
      if (signature !== localSignature.current) cloudDirty.current = true;
      localSignature.current = signature;
    };
    try {
      if (live) {
        // Boxes already update every video frame; only capture a photo when the
        // server tracker or the cloud description is due for a new frame.
        nextDelay = LIVE_SCAN_INTERVAL_MS;
        const now = Date.now();
        noteSignature(live);
        failures.current = 0;
        setState('live');
        showLocal(live);
        if (!trackingIsDue(now) && !cloudIsDue(now, true)) return;
      }
      const captureStartedAt = performanceNow();
      const picture = await camera.current.takePictureAsync({
        quality: 0.55,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!picture?.uri) throw new Error('Camera did not return an image');
      noteFrame(picture.uri);
      frameJanitor.track(picture.uri);
      const capturedAt = Date.now();
      const captureEndedAt = performanceNow();
      captureTimes.current.push(captureEndedAt);
      captureTimes.current = captureTimes.current.filter((stamp) => captureEndedAt - stamp <= 5000);
      const captureFps = captureTimes.current.length > 1
        ? (captureTimes.current.length - 1) * 1000 / (captureTimes.current[captureTimes.current.length - 1] - captureTimes.current[0])
        : 0;
      setPerformance((previous) => ({
        ...previous,
        // While live-video detection runs, it reports its own frame rate.
        capture_fps: live ? previous.capture_fps : Math.round(captureFps * 10) / 10,
        capture_ms: Math.round(captureEndedAt - captureStartedAt),
      }));
      if (mode === 'sign') {
        if (!activeApiUrl) {
          setState('offline');
          return;
        }
        const frame = await imageUriToDataUrl(picture.uri);
        signFrames.current.push(frame);
        if (signFrames.current.length > 3) signFrames.current.shift();
        failures.current = 0;
        setState(signFrames.current.length === 3 ? 'live' : 'analyzing');
        if (signFrames.current.length === 3 && !cloudInFlight.current) {
          const cloudController = new AbortController();
          controller.current = cloudController;
          cloudInFlight.current = true;
          const windowFrames = [...signFrames.current];
          // Retain one boundary frame so consecutive windows overlap without
          // resending an entire window or creating gaps between phrases.
          signFrames.current = [signFrames.current[2]];
          void interpretSignSequence(windowFrames, signTranscript.current, cloudController.signal)
            .then((next) => {
              if (cloudController.signal.aborted || runGeneration !== generation.current) return;
              signTranscript.current = next.transcript;
              setResult({
                summary: next.transcript || 'Watching for an ASL phrase…',
                speech: next.segment || next.transcript || 'No clear sign yet.',
                scene_key: next.transcript,
                urgency: 'low',
                changed: Boolean(next.segment),
                objects: [],
                task: 'sign',
                should_speak: next.should_speak,
              });
              setLastUpdated(Date.now());
            })
            .catch((error) => {
              if (!cloudController.signal.aborted) console.warn('Sign translation unavailable', error);
            })
            .finally(() => {
              if (controller.current === cloudController) controller.current = null;
              cloudInFlight.current = false;
            });
        }
        return;
      }
      let local: DetectionResult;
      if (live) {
        local = live;
      } else {
        const localDetectionStartedAt = performanceNow();
        local = await detectObjects(picture.uri);
        const localDetectionMs = Math.round(performanceNow() - localDetectionStartedAt);
        if (runGeneration !== generation.current) return;
        setDetections(local.detections);
        setBlocked(local.blocked ? { ...local.blocked, at: Date.now() } : null);
        setPerformance((previous) => ({ ...previous, local_detection_ms: localDetectionMs }));
        noteSignature(local);
        // The on-device result is shown the moment it exists. It never waits
        // for the network, and a cloud sentence never replaces it.
        if (local.available) showLocal(local);
      }
      const now = Date.now();
      failures.current = 0;
      setState('live');

      // Geometry has its own API path and cadence. It can update tracked boxes
      // while the cloud model is describing an earlier frame; it never creates
      // a spoken collision warning in the client.
      if (trackingIsDue(now)) {
        trackingInFlight.current = true;
        const trackingController = new AbortController();
        const trackingFrameStartedAt = performanceNow();
        void trackFrame(picture.uri, trackingController.signal)
          .then((tracking) => {
            if (runGeneration !== generation.current) return;
            lastTrackingAnalysis.current = Date.now();
            trackingFailures.current = 0;
            if (tracking.detector === 'disabled') {
              // This server has no detector of its own. Its empty answer must
              // not wipe what the phone detected.
              trackingDisabledUntil.current = Date.now() + TRACKING_RECHECK_MS;
              setPerformance((previous) => ({ ...previous, tracking_status: 'waiting' }));
              return;
            }
            const trackingAgeMs = Math.round(performanceNow() - trackingFrameStartedAt);
            setPerformance((previous) => ({
              ...previous,
              tracking_latency_ms: tracking.tracking_latency_ms,
              tracking_age_ms: trackingAgeMs,
              tracking_status: trackingAgeMs > 3000 ? 'slow' : 'live',
            }));
            // Do not let a delayed response overwrite newer camera detections.
            if (trackingAgeMs > 3000 || Date.now() - capturedAt > 3000) return;
            setCameraCoach(tracking.camera_coach || null);
            trackedSnapshot.current = { objects: tracking.objects, at: Date.now() };
            const obstaclePoints = (tracking.obstacle_points || []).filter(
              (point): point is [number, number, number] => Array.isArray(point) && point.length >= 3 && point.slice(0, 3).every(Number.isFinite),
            );
            obstacleSequence.current += 1;
            setObstacles({
              sequence: obstacleSequence.current,
              capturedAt,
              points: obstaclePoints,
              rangeM: typeof tracking.obstacle_range_m === 'number' ? tracking.obstacle_range_m : null,
            });
            setResult((previous) => {
              const base = previous || synthesizeLocalSceneResult(local.detections, sceneKey.current, mode, local.blocked);
              return { ...base, objects: tracking.objects };
            });
          })
          .catch((error) => {
            trackingFailures.current += 1;
            const backoffMs = Math.min(10_000, 1000 * (2 ** trackingFailures.current));
            lastTrackingAnalysis.current = Date.now() + backoffMs - 900;
            setPerformance((previous) => ({ ...previous, tracking_status: 'offline' }));
            console.warn(`Experimental server tracking unavailable (retrying in ${Math.round(backoffMs / 1000)}s)`, error);
          })
          .finally(() => { trackingInFlight.current = false; });
      }

      if (cloudIsDue(now, local.available)) {
        const cloudController = new AbortController();
        controller.current = cloudController;
        cloudInFlight.current = true;
        cloudDirty.current = false;
        lastCloudRequest.current = now;
        void analyzeFrame(picture.uri, mode, descriptionKey.current, cloudController.signal)
          .then((next) => {
            if (cloudController.signal.aborted || runGeneration !== generation.current) return;
            if (!next.speech) {
              // The server could not get a sentence from its model. Try again
              // later instead of showing its "nothing recognised" filler.
              cloudDirty.current = true;
              lastCloudRequest.current = Date.now() + 10_000 - CLOUD_CHANGE_GAP_MS;
              return;
            }
            descriptionKey.current = next.scene_key;
            setDescription({ text: next.speech, key: next.scene_key, at: Date.now() });
            if (!local.available) {
              // No on-device detector: the cloud answer is the only result there is.
              sceneKey.current = next.scene_key;
              setResult(next);
              setLastUpdated(Date.now());
            }
          })
          .catch((error) => {
            if (cloudController.signal.aborted || runGeneration !== generation.current) return;
            // Local detection remains live even when optional cloud narration is unavailable.
            cloudDirty.current = true;
            const retryAfterMs = Math.min(60_000, ((error as Error & { retryAfter?: number }).retryAfter || 0) * 1000);
            lastCloudRequest.current = Date.now() + Math.max(10_000, retryAfterMs) - CLOUD_CHANGE_GAP_MS;
            console.warn('Cloud scene description unavailable (backing off)', error);
          })
          .finally(() => {
            if (controller.current === cloudController) controller.current = null;
            cloudInFlight.current = false;
          });
      }
    } catch (error) {
      if (runGeneration !== generation.current) return;
      console.warn('[GuideEye vision error]', error);
      failures.current += 1;
      setState('offline');
      const retryAfter = (error as Error & { retryAfter?: number }).retryAfter || 0;
      // A single failed capture (the camera was busy for a moment) is retried
      // quickly; only repeated failures back off.
      nextDelay = Math.max(retryAfter * 1000, failures.current === 1 ? 400 : Math.min(1000 * 2 ** (failures.current - 1), 15000));
    } finally {
      controller.current = null;
      if (enabled && runGeneration === generation.current) {
        timer.current = setTimeout(() => void run(runGeneration), nextDelay);
      }
    }
  }, [camera, enabled, mode, withDepth]);

  // Browser: run the local detector on every displayed video frame, so the
  // boxes follow the camera at the detector's real speed (about 30 fps or more
  // on WebGPU) instead of the photo-capture cadence.
  useEffect(() => {
    if (!enabled || mode !== 'scene' || typeof document === 'undefined') return;
    let active = true;
    const frameTimes: number[] = [];
    let lastReport = 0;
    void warmUpDetector().catch(() => {});
    const loop = async () => {
      while (active) {
        const video = findCameraVideo();
        const started = performanceNow();
        const pending = video ? detectVideoFrame(video) : null;
        if (!pending) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        const local = await pending;
        if (!active) return;
        if (!local.available) {
          liveLocal.current = null;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        const finished = performanceNow();
        liveLocal.current = { result: local, at: Date.now() };
        setDetections(local.detections);
        setBlocked(local.blocked ? { ...local.blocked, at: Date.now() } : null);
        frameTimes.push(finished);
        while (frameTimes.length && finished - frameTimes[0] > 2000) frameTimes.shift();
        if (finished - lastReport >= 500) {
          lastReport = finished;
          const fps = frameTimes.length > 1 ? (frameTimes.length - 1) * 1000 / (finished - frameTimes[0]) : 0;
          setPerformance((previous) => ({
            ...previous,
            capture_fps: Math.round(fps * 10) / 10,
            local_detection_ms: Math.round(finished - started),
            local_backend: localDetectorBackend(),
          }));
        }
        // Yield to the browser so the new boxes paint before the next frame.
        // CPU inference blocks the page while it runs, so leave it some room.
        if (localDetectorBackend() === 'wasm') await new Promise((resolve) => setTimeout(resolve, 120));
        await nextAnimationFrame();
      }
    };
    void loop();
    return () => {
      active = false;
      liveLocal.current = null;
    };
  }, [enabled, mode]);

  // Native: load the model while the camera is still opening, so the first
  // scan does not pay for it.
  useEffect(() => {
    if (enabled && mode === 'scene' && typeof document === 'undefined') void warmUpDetector().catch(() => {});
  }, [enabled, mode]);

  // Frames outlive the screen for a moment: an assistant request may still be
  // uploading the last one.
  useEffect(() => () => {
    setTimeout(() => frameJanitor.clear(), 15000);
  }, []);

  const scanNow = useCallback(() => {
    stop();
    cloudDirty.current = true;
    lastCloudRequest.current = 0;
    const current = generation.current;
    void run(current);
  }, [run, stop]);

  useEffect(() => {
    stop();
    generation.current += 1;
    sceneKey.current = '';
    descriptionKey.current = '';
    localSignature.current = '';
    cloudDirty.current = true;
    lastCloudRequest.current = 0;
    lastTrackingAnalysis.current = 0;
    trackingInFlight.current = false;
    trackingFailures.current = 0;
    trackingDisabledUntil.current = 0;
    captureTimes.current = [];
    signFrames.current = [];
    signTranscript.current = '';
    failures.current = 0;
    setResult(null);
    setDescription(null);
    setCameraCoach(null);
    trackedSnapshot.current = null;
    setObstacles(null);
    setBlocked(null);
    setPerformance({ capture_fps: 0, capture_ms: null, local_detection_ms: null, tracking_latency_ms: null, tracking_age_ms: null, tracking_status: 'waiting' });
    if (!enabled) {
      setState('paused');
      return stop;
    }
    const current = generation.current;
    timer.current = setTimeout(() => void run(current), 350);
    return stop;
  }, [enabled, mode, run, stop]);

  return { result, description, state, lastUpdated, detections, cameraCoach, obstacles, blocked, performance, scanNow };
}

function performanceNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
