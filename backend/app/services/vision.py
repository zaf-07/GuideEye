"""GuideBand vision: local hazard detection plus a cloud scene description.

Two independent paths, by design:

* Hazard warnings come only from the local YOLO detector. They never wait for,
  or depend on, a cloud model.
* Scene descriptions try each configured cloud provider in order (Gemini first,
  then the earlier Groq/Qwen setup) and fall back to a sentence built from the
  local detections, so the user always gets an answer.

Nothing here stores images. Heavy or optional packages (ultralytics, Pillow,
httpx) are imported lazily so the rest of the backend runs without them.
"""
import base64
import os
import sys
import threading
from io import BytesIO
from pathlib import Path

from . import llm

# Objects worth a spoken warning when they take up enough of the view.
HAZARD_LABELS = {
    'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'train',
    'bench', 'chair', 'couch', 'bed', 'dining table', 'potted plant',
    'fire hydrant', 'stop sign', 'parking meter', 'suitcase', 'backpack',
    'dog', 'cat', 'skateboard', 'toilet', 'tv', 'refrigerator',
}
MIN_HAZARD_AREA = 0.03  # fraction of the frame
MAX_WARNINGS = 3

SYSTEM_PROMPT = (
    'You are GuideBand, speaking through a wearable to a blind or low-vision person. '
    'Answer in one or two short sentences that sound natural when spoken aloud. '
    'Describe only what is actually visible in the image. '
    'Say where things are with words like ahead, left and right. '
    'Never give distances unless the on-device detector explicitly provides an estimated distance. '
    'Never say a path is safe or clear to walk. '
    'If asked to read text, read it exactly. If you are not sure, say so plainly.'
)
DEFAULT_QUESTION = 'Briefly, what is in front of me?'

DEPTH_MODEL_CONFIGS = {
    'vits': {'encoder': 'vits', 'features': 64, 'out_channels': [48, 96, 192, 384]},
    'vitb': {'encoder': 'vitb', 'features': 128, 'out_channels': [96, 192, 384, 768]},
    'vitl': {'encoder': 'vitl', 'features': 256, 'out_channels': [256, 512, 1024, 1024]},
}


def setting(name: str, default: str = '') -> str:
    """Read current Ultralytics-prefixed settings, with legacy fallback."""
    return os.getenv(f'ULTRALYTICS_YOLO_{name}', os.getenv(f'YOLO_{name}', default))


class VisionError(Exception):
    """The image could not be read."""


# ---------- Local detection ----------

def zone(center_x: float) -> str:
    """Horizontal position of a box centre (0 = left edge, 1 = right edge)."""
    if center_x < 0.2:
        return 'on the left'
    if center_x < 0.4:
        return 'ahead, left'
    if center_x <= 0.6:
        return 'ahead'
    if center_x <= 0.8:
        return 'ahead, right'
    return 'on the right'


def make_detection(label: str, confidence: float, box: list[float]) -> dict:
    """box is [x1, y1, x2, y2], each normalised to 0..1."""
    x1, y1, x2, y2 = (min(1.0, max(0.0, float(v))) for v in box)
    return {
        'label': label,
        'confidence': round(float(confidence), 3),
        'box': [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)],
        'position': zone((x1 + x2) / 2),
        'area': round(max(0.0, x2 - x1) * max(0.0, y2 - y1), 4),
    }


def add_distance(detection: dict, metres: float) -> None:
    """Attach only a finite, plausible metric-depth reading."""
    if 0.2 <= metres <= 20.0:
        detection['distance_m'] = round(metres, 1)
        detection['distance_confidence'] = 'estimated'


def distance_phrase(item: dict) -> str:
    metres = item.get('distance_m')
    return f", about {metres:g} metres away" if metres is not None else ''


def hazard_warnings(detections: list[dict]) -> list[str]:
    """Short spoken warnings; distances require a loaded metric-depth model."""
    hazards = [d for d in detections if d['label'] in HAZARD_LABELS and d['area'] >= MIN_HAZARD_AREA]
    hazards.sort(key=lambda d: d['area'], reverse=True)
    warnings: list[str] = []
    for item in hazards:
        text = f"{item['label'].capitalize()} {item['position']}{distance_phrase(item)}."
        if text not in warnings:
            warnings.append(text)
        if len(warnings) == MAX_WARNINGS:
            break
    return warnings


def local_description(detections: list[dict]) -> str:
    """Fallback sentence used when no cloud model is available."""
    if not detections:
        return 'I do not recognise anything in view right now.'
    counts: dict[tuple[str, str], int] = {}
    representatives: dict[tuple[str, str], dict] = {}
    for item in sorted(detections, key=lambda d: d['area'], reverse=True):
        key = (item['label'], item['position'])
        counts[key] = counts.get(key, 0) + 1
        representatives.setdefault(key, item)
    parts = []
    for (label, position), count in list(counts.items())[:4]:
        if count > 1:
            parts.append(f'{count} {label}s {position}')
        else:
            parts.append(f'a {label} {position}{distance_phrase(representatives[(label, position)])}')
    listed = parts[0] if len(parts) == 1 else ', '.join(parts[:-1]) + ' and ' + parts[-1]
    return f'I can see {listed}. This is from the on-device detector only.'


class Detector:
    """Lazy wrapper around a compact Ultralytics YOLO model."""

    def __init__(self) -> None:
        self._model = None
        self._error: str | None = None
        self._lock = threading.Lock()

    @staticmethod
    def _weights() -> str:
        configured = setting('MODEL')
        if configured:
            return configured
        bundled = Path(__file__).resolve().parents[2] / 'models' / 'yolo11n.pt'
        # Supplying the full path lets Ultralytics cache a first download in
        # the ignored backend model directory rather than the repository root.
        bundled.parent.mkdir(parents=True, exist_ok=True)
        return str(bundled)

    def _load(self):
        if self._model is None and self._error is None:
            if setting('ENABLED', 'true').lower() in {'0', 'false', 'no'}:
                self._error = 'disabled by ULTRALYTICS_YOLO_ENABLED'
                return None
            try:
                from ultralytics import YOLO
                self._model = YOLO(self._weights())
            except Exception as error:  # missing package, bad weights, no network
                self._error = f'{type(error).__name__}: {error}'
        return self._model

    def status(self) -> dict:
        state = 'ready' if self._model is not None else ('unavailable' if self._error else 'not_loaded')
        return {'state': state, 'model': Path(self._weights()).name, 'error': self._error}

    def detect(self, image: bytes) -> list[dict]:
        """Returns detections, or an empty list when the detector is unavailable."""
        try:
            from PIL import Image
            frame = Image.open(BytesIO(image)).convert('RGB')
        except Exception as error:
            raise VisionError('The image could not be read') from error
        with self._lock:
            model = self._load()
            if model is None:
                return []
            results = model.predict(
                frame,
                conf=float(setting('MIN_CONFIDENCE', '0.35')),
                device=setting('DEVICE') or None,
                verbose=False,
            )
        detections = []
        for result in results:
            for box in result.boxes:
                detections.append(make_detection(
                    result.names[int(box.cls[0])], float(box.conf[0]), box.xyxyn[0].tolist(),
                ))
        return detections


detector = Detector()


class DepthEstimator:
    """Optional Depth Anything V2 metric-depth integration.

    A monocular depth model must be explicitly configured with a local metric
    checkpoint. Without it, no distance field is returned rather than guessing
    from an object's bounding-box size.
    """

    def __init__(self) -> None:
        self._model = None
        self._error: str | None = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is not None or self._error is not None:
            return self._model
        if os.getenv('DEPTH_ANYTHING_ENABLED', 'false').lower() in {'0', 'false', 'no'}:
            self._error = 'disabled by DEPTH_ANYTHING_ENABLED'
            return None
        repo = Path(os.getenv('DEPTH_ANYTHING_REPO', ''))
        checkpoint = Path(os.getenv('DEPTH_ANYTHING_CHECKPOINT', ''))
        variant = os.getenv('DEPTH_ANYTHING_VARIANT', 'vits').lower()
        if os.getenv('DEPTH_ANYTHING_MODE', '').lower() != 'metric':
            self._error = 'DEPTH_ANYTHING_MODE must be metric'
            return None
        if not repo.is_dir() or not checkpoint.is_file() or variant not in DEPTH_MODEL_CONFIGS:
            self._error = 'metric depth repository or checkpoint is unavailable'
            return None
        try:
            import torch
            if str(repo) not in sys.path:
                sys.path.insert(0, str(repo))
            from depth_anything_v2.dpt import DepthAnythingV2
            model = DepthAnythingV2(**DEPTH_MODEL_CONFIGS[variant])
            model.load_state_dict(torch.load(checkpoint, map_location='cpu'))
            model.to(os.getenv('DEPTH_ANYTHING_DEVICE', 'cpu')).eval()
            self._model = model
        except Exception as error:
            self._error = f'{type(error).__name__}: {error}'
        return self._model

    def status(self) -> dict:
        state = 'ready' if self._model is not None else ('unavailable' if self._error else 'not_loaded')
        return {'state': state, 'mode': os.getenv('DEPTH_ANYTHING_MODE', ''), 'error': self._error}

    def annotate(self, image: bytes, detections: list[dict]) -> list[dict]:
        if not detections:
            return detections
        try:
            import numpy as np
            from PIL import Image
            frame = Image.open(BytesIO(image)).convert('RGB')
        except Exception:
            return detections
        with self._lock:
            model = self._load()
            if model is None:
                return detections
            try:
                depth = model.infer_image(np.asarray(frame), input_size=518)
            except Exception as error:
                self._error = f'{type(error).__name__}: {error}'
                return detections
        depth = np.asarray(depth, dtype=float)
        if depth.shape != (frame.height, frame.width):
            depth = np.asarray(Image.fromarray(depth.astype('float32')).resize(frame.size))
        for item in detections:
            x1, y1, x2, y2 = item['box']
            # The lower-centre box area is less likely to sample sky or wall.
            left, right = int((x1 * 0.7 + x2 * 0.3) * frame.width), int((x1 * 0.3 + x2 * 0.7) * frame.width)
            top, bottom = int((y1 * 0.6 + y2 * 0.4) * frame.height), int(y2 * frame.height)
            samples = depth[max(0, top):min(frame.height, bottom), max(0, left):min(frame.width, right)]
            samples = samples[np.isfinite(samples) & (samples > 0)]
            if samples.size:
                add_distance(item, float(np.median(samples)))
        return detections


depth_estimator = DepthEstimator()


# ---------- Cloud description ----------

def _user_prompt(question: str, detections: list[dict]) -> str:
    text = question.strip() or DEFAULT_QUESTION
    if detections:
        seen = ', '.join(f"{d['label']} ({d['position']})" for d in detections[:8])
        text += f'\nThe on-device detector found: {seen}. Use this only as a hint.'
    return text


async def ask_gemini(image: bytes, mime: str, question: str, detections: list[dict]) -> str:
    return await llm.gemini(
        [llm.image_part(image, mime), {'text': _user_prompt(question, detections)}],
        system=SYSTEM_PROMPT,
    )


async def ask_minimax(image: bytes, mime: str, question: str, detections: list[dict]) -> str:
    return await llm.minimax(
        [llm.image_part(image, mime), {'text': _user_prompt(question, detections)}],
        system=SYSTEM_PROMPT,
    )


async def ask_groq(image: bytes, mime: str, question: str, detections: list[dict]) -> str:
    """The earlier OpenAI-compatible vision setup, kept as a fallback."""
    import httpx
    encoded = base64.b64encode(image).decode('ascii')
    payload = {
        'model': os.getenv('GROQ_VISION_MODEL', 'qwen/qwen3.8-27b'),
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': [
                {'type': 'text', 'text': _user_prompt(question, detections)},
                {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{encoded}'}},
            ]},
        ],
        'temperature': 0.2,
        'max_completion_tokens': 200,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=4.0)) as client:
        response = await client.post(
            os.getenv('GROQ_API_URL', 'https://api.groq.com/openai/v1/chat/completions'),
            headers={'Authorization': f"Bearer {os.environ['GROQ_API_KEY']}"},
            json=payload,
        )
        response.raise_for_status()
    text = (response.json()['choices'][0]['message']['content'] or '').strip()
    if not text:
        raise ValueError('Groq returned no text')
    return text


# name -> (environment variable holding its key, coroutine)
PROVIDERS = {
    'gemini': ('GEMINI_API_KEY', ask_gemini),
    'minimax': ('MINIMAX_API_KEY', ask_minimax),
    'groq': ('GROQ_API_KEY', ask_groq),
}


def configured_providers() -> list[str]:
    """Cloud providers to try, in order, that have a key set."""
    order = [name.strip() for name in os.getenv('VISION_PROVIDERS', 'gemini,minimax,groq').split(',')]
    return [name for name in order if name in PROVIDERS and os.getenv(PROVIDERS[name][0])]


async def describe(image: bytes, mime: str, question: str, detections: list[dict], providers=None) -> dict:
    """Try each cloud provider in turn; fall back to the local detector's sentence."""
    if providers is None:
        providers = [(name, PROVIDERS[name][1]) for name in configured_providers()]
    failed: list[str] = []
    for name, ask in providers:
        try:
            text = await ask(image, mime, question, detections)
            return {'text': text, 'provider': name, 'failed_providers': failed}
        except Exception as error:  # timeout, quota, bad response: try the next one
            failed.append(f'{name}: {type(error).__name__}')
    return {'text': local_description(detections), 'provider': 'local', 'failed_providers': failed}
