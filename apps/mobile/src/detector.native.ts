import { Asset } from 'expo-asset';
import { decode } from 'jpeg-js';
import { analyzeBlockedView } from './blockedView';
import {
  TemporalObjectTracker,
  YOLOX_INPUT_SIZE,
  decodeYolox,
  letterboxBgr,
  readExifOrientation,
  uprightFrame,
} from './detectorCore';
import type { InferenceSession } from 'onnxruntime-react-native';
import { discardFile } from './frameFiles';
import type { DetectionResult } from './detector.types';

/**
 * ONNX Runtime is native code. It is absent in Expo Go and in any build where
 * the module failed to link, and importing it there throws at module scope —
 * which would take the whole camera route down rather than one feature. Load
 * it optionally so a missing runtime degrades to backend-only detection,
 * which `DetectionResult.available: false` already signals to callers.
 */
type OrtModule = typeof import('onnxruntime-react-native');
let ort: OrtModule | null = null;

try {
  ort = require('onnxruntime-react-native') as OrtModule;
} catch {
  ort = null;
}

/**
 * The native image resizer. A camera photo is millions of pixels and the JPEG
 * decoder below is plain JavaScript, so decoding one at full size takes
 * seconds on a phone. Shrinking it natively first takes milliseconds and also
 * bakes the EXIF rotation into the pixels. Optional for the same reason ONNX
 * Runtime is: without it the slow path still works.
 */
type ManipulatorModule = typeof import('expo-image-manipulator');
let manipulator: ManipulatorModule | null = null;

try {
  manipulator = require('expo-image-manipulator') as ManipulatorModule;
} catch {
  manipulator = null;
}

/** True when on-device detection can run at all. */
export function hasLocalDetector(): boolean {
  return ort !== null;
}

const MODEL = require('../assets/models/yolox_nano.onnx');

let sessionPromise: Promise<InferenceSession> | null = null;
let lastDetectorError = '';
let inputBuffer: Float32Array | null = null;
let inputBusy = false;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const [asset] = await Asset.loadAsync(MODEL);
      const rawUri = asset.localUri || asset.uri;
      if (!rawUri) throw new Error('YOLOX model asset is unavailable');
      const modelPath = decodeURIComponent(rawUri.replace(/^file:\/\//, ''));
      const session = await ort!.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        logSeverityLevel: 3,
      });
      console.info(
        `[GuideEye detector] YOLOX loaded; inputs=${session.inputNames.join(',')}; outputs=${session.outputNames.join(',')}`,
      );
      return session;
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

const tracker = new TemporalObjectTracker();

/** A copy of the photo no larger than the model needs, upright. Null when the resizer is unavailable. */
async function shrinkNatively(uri: string): Promise<string | null> {
  const api = manipulator?.ImageManipulator;
  if (!api?.manipulate) return null;
  try {
    const context = api.manipulate(uri, { maxWidth: YOLOX_INPUT_SIZE, maxHeight: YOLOX_INPUT_SIZE });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: manipulator!.SaveFormat.JPEG, compress: 0.8 });
    try {
      rendered.release();
      context.release();
    } catch {
      /* releasing early is an optimisation, not a requirement */
    }
    return saved.uri || null;
  } catch {
    return null;
  }
}

export async function detectObjects(uri: string): Promise<DetectionResult> {
  if (!ort) return { available: false, detections: [] };
  try {
    const [session, small] = await Promise.all([getSession(), shrinkNatively(uri)]);
    const response = await fetch(small ?? uri);
    const bytes = new Uint8Array(await response.arrayBuffer());
    discardFile(small);
    const decoded = decode(bytes, { useTArray: true, formatAsRGBA: true });
    // The native resizer already rotated the pixels; the original has not been.
    const orientation = small ? 1 : readExifOrientation((decoded as { exifBuffer?: Uint8Array }).exifBuffer);
    const frame = uprightFrame(decoded, orientation, YOLOX_INPUT_SIZE);
    const reuse = inputBusy ? undefined : inputBuffer ?? undefined;
    const ownsBuffer = !inputBusy;
    if (ownsBuffer) inputBusy = true;
    try {
      const box = letterboxBgr(frame, YOLOX_INPUT_SIZE, reuse);
      if (ownsBuffer) inputBuffer = box.input;
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (!inputName || !outputName) throw new Error('YOLOX model has no input or output names');
      const output = await session.run({
        [inputName]: new ort!.Tensor('float32', box.input, [1, 3, YOLOX_INPUT_SIZE, YOLOX_INPUT_SIZE]),
      });
      const tensor = output[outputName];
      if (!tensor) throw new Error(`YOLOX did not return its ${outputName} output`);
      const detections = decodeYolox(tensor.data as Float32Array, box, frame);
      const tracked = tracker.update(detections);
      const blocked = analyzeBlockedView(frame.data, frame.width, { x: 0, y: 0, width: frame.width, height: frame.height }, tracked);
      lastDetectorError = '';
      return { available: true, detections: tracked, blocked };
    } finally {
      if (ownsBuffer) inputBusy = false;
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (message !== lastDetectorError) {
      lastDetectorError = message;
      console.error(`[GuideEye detector] ${message}`);
    }
    return { available: false, detections: [] };
  }
}

/** Browser only: the native app has no video element to read from. */
export function detectVideoFrame(_video: unknown): Promise<DetectionResult> | null {
  return null;
}

export async function warmUpDetector(): Promise<void> {
  if (ort) await getSession();
}

export function localDetectorBackend(): 'webgpu' | 'wasm' | null {
  return null;
}
