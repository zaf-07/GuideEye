import { access, cp, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const publicDir = join(mobile, 'public');
const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve('onnxruntime-web'));
const mediapipeDist = dirname(require.resolve('@mediapipe/tasks-vision'));

await mkdir(join(publicDir, 'models'), { recursive: true });
await mkdir(join(publicDir, 'ort'), { recursive: true });
await cp(join(mobile, 'assets', 'models', 'yolox_nano.onnx'), join(publicDir, 'models', 'yolox_nano.onnx'));
await cp(join(mobile, 'assets', 'models', 'yolo11n.onnx'), join(publicDir, 'models', 'yolo11n.onnx'));
await cp(join(mobile, 'assets', 'models', 'asl_fingerspelling_landmarks.json'), join(publicDir, 'models', 'asl_fingerspelling_landmarks.json'));
await cp(join(mobile, 'assets', 'models', 'asl_word_transformer.onnx'), join(publicDir, 'models', 'asl_word_transformer.onnx'));
await cp(join(mobile, 'assets', 'models', 'asl_word_labels.json'), join(publicDir, 'models', 'asl_word_labels.json'));
// The WebGPU bundle runs the object detector on the GPU; it loads the asyncify
// wasm build, and falls back to it on the CPU when WebGPU is unavailable.
for (const name of [
  'ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
  'ort.webgpu.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm',
]) {
  await cp(join(ortDist, name), join(publicDir, 'ort', name));
}

// Sign tracking (MediaPipe) is served by the app itself so the bridge and sign
// mode keep working with no internet ("pull the plug"). The runtime comes from
// node_modules; the model files are downloaded once into a local cache. If a
// download fails, the app falls back to the public CDN at runtime.
const mediapipeDir = join(publicDir, 'mediapipe');
await mkdir(join(mediapipeDir, 'wasm'), { recursive: true });
await mkdir(join(mediapipeDir, 'models'), { recursive: true });
await cp(join(mediapipeDist, 'vision_bundle.mjs'), join(mediapipeDir, 'vision_bundle.mjs'));
// MediaPipe renames its wasm payloads between minor releases: 1.2.0 shipped
// `vision_wasm_nosimd_internal.*`, 1.2.3 replaced it with
// `vision_wasm_module_internal.*`. Copy whatever this version actually ships
// rather than a hardcoded list, so an upstream rename cannot break the build.
const wasmSource = join(mediapipeDist, 'wasm');
const wasmFiles = (await readdir(wasmSource)).filter((name) => /\.(js|mjs|wasm)$/.test(name));
if (!wasmFiles.some((name) => name.endsWith('vision_wasm_internal.wasm'))) {
  throw new Error(`MediaPipe wasm runtime missing from ${wasmSource}; sign tracking would fall back to the CDN.`);
}
for (const name of wasmFiles) {
  await cp(join(wasmSource, name), join(mediapipeDir, 'wasm', name));
}
const mediapipeModels = {
  'hand_landmarker.task': 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'face_landmarker.task': 'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'pose_landmarker_lite.task': 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'holistic_landmarker.task': 'holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task',
};
const modelCache = join(mobile, '.cache', 'mediapipe');
await mkdir(modelCache, { recursive: true });
const exists = (path) => access(path).then(() => true, () => false);
for (const [name, remote] of Object.entries(mediapipeModels)) {
  const cached = join(modelCache, name);
  if (!(await exists(cached)) && process.env.MEDIAPIPE_OFFLINE_MODELS !== 'false') {
    try {
      const response = await fetch(`https://storage.googleapis.com/mediapipe-models/${remote}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await writeFile(`${cached}.part`, Buffer.from(await response.arrayBuffer()));
      await rename(`${cached}.part`, cached);
    } catch (error) {
      console.warn(`MediaPipe model ${name} not cached (${error.message}); sign tracking will use the CDN.`);
    }
  }
  if (await exists(cached)) await cp(cached, join(mediapipeDir, 'models', name));
}

const faviconFiles = [
  'favicon.ico',
  'favicon.svg',
  'favicon.png',
  'favicon-32x32.png',
  'favicon-16x16.png',
  'apple-touch-icon.png',
];

for (const name of faviconFiles) {
  await cp(join(mobile, 'assets', name), join(publicDir, name));
}

await cp(
  join(mobile, 'assets', 'index.template.html'),
  join(publicDir, 'index.html'),
);

