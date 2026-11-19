from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import load_env
from .planner import plan
from .services import bridge, checkout, llm, messaging, navigation, speech, supermemory, vision
from .services.assistant import Assistant
from .services.memory import Memory
from .services.payments import CATALOGUE, Orders, is_test_key, money
from .services.wearable import WearableError, status as wearable_status, listen_band, refresh_band_state

load_env()

MAX_IMAGE_BYTES = int(os.getenv('MAX_IMAGE_BYTES', str(4 * 1024 * 1024)))
IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
DEFAULT_ORIGINS = 'http://localhost:4173,http://127.0.0.1:4173,http://localhost:8000,http://127.0.0.1:8000,https://zaf-07.github.io'

@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv('BAND_AUTOCONNECT', 'true').lower() not in {'0', 'false', 'no'}:
        band_start()
    yield
    band_stop()


app = FastAPI(title='GuideBand Local API', version='0.3.0', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv('CORS_ORIGINS', DEFAULT_ORIGINS).split(',')],
    allow_methods=['GET', 'POST', 'DELETE'],
    allow_headers=['*'],
)
tasks: dict[str, dict] = {}
memory = Memory()
orders = Orders()
navigator = navigation.Navigator()
assistant = Assistant(memory, orders, navigator=navigator)

class Command(BaseModel):
    text: str = Field(min_length=1, max_length=500)

class SignSequence(BaseModel):
    signs: list[str] = Field(min_length=1, max_length=12)

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    delay_minutes: int = Field(ge=0, le=1440)

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

async def read_image(image: UploadFile) -> bytes:
    if image.content_type not in IMAGE_TYPES:
        raise HTTPException(415, 'Send a JPEG, PNG or WebP image')
    body = await image.read(MAX_IMAGE_BYTES + 1)
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(413, 'Image is too large')
    return body

async def detect(body: bytes) -> list[dict]:
    try:
        detections = await asyncio.to_thread(vision.detector.detect, body)
        return await asyncio.to_thread(vision.depth_estimator.annotate, body, detections)
    except vision.VisionError as error:
        raise HTTPException(422, str(error)) from error

@app.get('/health')
def health(): return {'status':'ok','time':now(),'raw_media_storage':False}

@app.get('/maps/config')
def maps_config():
    """Browser map configuration. Restrict this key to approved web origins."""
    return {'embed_key': os.getenv('GOOGLE_MAPS_BROWSER_API_KEY') or os.getenv('GOOGLE_MAPS_API_KEY', '')}

@app.get('/system/status')
def system_status():
    stripe_key = os.getenv('STRIPE_SECRET_KEY', '')
    return {
        'wearable': band_view(),
        'modules': {'commands':'ready','journey':'demo','bridge':'ready','vision':vision.detector.status()['state']},
        'vision': {'detector': vision.detector.status(), 'depth': vision.depth_estimator.status(), 'cloud_providers': vision.configured_providers(), 'model': llm.model()},
        'payments': {'mode': 'stripe_test' if is_test_key(stripe_key) else ('refused_live_key' if stripe_key else 'simulated'),
                     'menu': [{'item': name, 'price': money(cents)} for name, cents in CATALOGUE.values()]},
        'memory': {'notes': len(memory.notes(1000)), 'objects': len(memory.sightings()), 'path_points': len(memory.path()),
                   'connections': len(memory.graph_snapshot(1000)['edges']), 'supermemory': memory.remote_status()},
        'navigation': {'maps': 'google' if os.getenv('GOOGLE_MAPS_API_KEY') else 'openstreetmap'},
        'speech': {'voice': speech.provider() if speech.configured() else 'browser', 'transcription': speech.transcriber()},
        'messages': {'whatsapp': 'direct' if messaging.configured() else ('desktop_send' if messaging.desktop_enabled() else 'opens_whatsapp')},
    }

@app.post('/commands/plan')
def command_plan(command: Command): return plan(command.text)

# ---------- See ----------

@app.post('/vision/analyze')
async def vision_analyze(
    image: UploadFile = File(...),
    question: str = Form('', max_length=300),
    describe: bool = Form(True),
    remember: bool = Form(False),
    lat: float | None = Form(None),
    lon: float | None = Form(None),
):
    """One camera frame in, spoken-ready text out. The frame is never stored.

    `warnings` always come from the local detector. With `describe=false` the
    cloud is skipped entirely, which is the fast path for a continuous stream.
    """
    body = await read_image(image)
    started = time.monotonic()
    detections = await detect(body)
    memory.record_detections(detections)
    detect_ms = int((time.monotonic() - started) * 1000)
    result = {
        'event': 'scene',
        'timestamp': now(),
        'warnings': vision.hazard_warnings(detections),
        'detections': detections,
        'detector': vision.detector.status()['state'],
        'description': None,
        'provider': None,
        'failed_providers': [],
    }
    if describe:
        answer = await vision.describe(body, image.content_type, question, detections)
        result.update(description=answer['text'], provider=answer['provider'], failed_providers=answer['failed_providers'])
        if remember and answer['provider'] != 'local':
            place = await navigation.place_name(lat, lon) if lat is not None and lon is not None else ''
            memory.add_note('seen', answer['text'], place=place)
    result['latency_ms'] = {'detect': detect_ms, 'total': int((time.monotonic() - started) * 1000)}
    return result

# ---------- Assistant: see, remember, act ----------

@app.post('/assistant')
async def assistant_respond(
    text: str = Form(..., min_length=1, max_length=300),
    session: str = Form('default', max_length=64),
    image: UploadFile | None = File(None),
    lat: float | None = Form(None),
    lon: float | None = Form(None),
):
    """One spoken sentence in, one spoken reply out. `image` is the current camera frame, if any."""
    started = time.monotonic()
    body = await read_image(image) if image is not None else None
    try:
        location = (lat, lon) if lat is not None and lon is not None else None
        reply = await assistant.respond(session, text, body, image.content_type if image is not None else 'image/jpeg', location)
    except vision.VisionError as error:
        raise HTTPException(422, str(error)) from error
    reply['timestamp'] = now()
    reply['latency_ms'] = int((time.monotonic() - started) * 1000)
    return reply

# ---------- Remember ----------

@app.post('/memory/observe')
async def memory_observe(image: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None)):
    """Quietly turn the current frame into a text note. The frame is discarded."""
    body = await read_image(image)
    detections = await detect(body)
    memory.record_detections(detections)
    place = await navigation.place_name(lat, lon) if lat is not None and lon is not None else ''
    return await memory.snapshot(body, image.content_type, vision.local_description(detections), place)

@app.get('/memory')
def memory_list():
    graph = memory.graph_snapshot()
    return {'notes': memory.notes(), 'objects': memory.sightings(), 'path_points': len(memory.path()),
            'connections': graph['edges'], 'stores_media': False, 'supermemory': memory.remote_status()}

@app.post('/memory/sync')
async def memory_sync():
    """Push every stored note to Supermemory, including ones written before it was set up."""
    return await memory.sync_all()

@app.post('/memory/reindex')
def memory_reindex():
    """Rebuild the relationship graph from the notes already stored."""
    return memory.reindex_relations()

@app.get('/memory/graph')
def memory_graph(around: str | None = None, depth: int = 2):
    """The relationship graph: everything, or the part around one thing."""
    if around:
        return {'around': around, 'edges': memory.neighbours(around, depth=depth)}
    return memory.graph_snapshot()

@app.delete('/memory')
def memory_clear():
    memory.clear()
    return {'status': 'cleared'}

# ---------- Recall (the mobile app's memory) ----------
# The GuideEye app keeps a local graph on the phone and mirrors it here, so one
# person's memories follow them between their phone and the desk. The app holds
# no Supermemory key: this server owns it, and these three routes are the only
# way in.

class RecallRemember(BaseModel):
    kind: str = Field(default='note', max_length=32)
    content: str = Field(min_length=1, max_length=4000)
    id: str | None = Field(default=None, max_length=128)
    supportingContext: str | None = Field(default=None, max_length=1500)
    metadata: dict[str, str | int | float | bool] | None = None
    date: str | None = None


class RecallSearch(BaseModel):
    query: str = Field(default='', max_length=500)
    limit: int = Field(default=8, ge=1, le=50)
    kinds: list[str] | None = None


def _recall_when(date: str | None) -> float:
    if not date:
        return time.time()
    try:
        return datetime.fromisoformat(date.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return time.time()


@app.get('/v1/recall/status')
def recall_status():
    """Whether memories written here will actually reach Supermemory."""
    status = memory.remote_status()
    configured = bool(status.get('configured'))
    return {
        **status,
        'configured': configured,
        'reason': None if configured else 'This server has no SUPERMEMORY_API_KEY set.',
    }


@app.post('/v1/recall/remember')
async def recall_remember(body: RecallRemember):
    """Store one memory and report honestly whether it reached Supermemory.

    The write is awaited rather than fired and forgotten. The app used to be
    told nothing at all, so a note that never left the building looked exactly
    like one that synced.
    """
    place = str((body.metadata or {}).get('place', '') or '')
    text = body.content.strip()
    if body.supportingContext:
        text = f'{text}\n\nContext: {body.supportingContext.strip()}'

    before_synced, before_errors = memory.mirrored, memory.remote_errors
    note = memory.add_note(body.kind, text, now=_recall_when(body.date), place=place)
    await memory.flush()

    if not supermemory.configured():
        status = 'local'
    elif memory.mirrored > before_synced:
        status = 'synced'
    elif memory.remote_errors > before_errors:
        status = 'failed'
    else:
        status = 'skipped'

    return {
        'id': body.id or str(note['id']),
        'noteId': note['id'],
        'status': status,
        'relations': note.get('relations', []),
        'namespace': supermemory.namespace() if supermemory.configured() else None,
    }


@app.post('/v1/recall/search')
async def recall_search(body: RecallSearch):
    """Search Supermemory, with the local relationship graph layered on top."""
    question = body.query.strip()
    results: list[dict] = []
    if not question:
        return {'results': results}

    hits: list[dict] = []
    if supermemory.configured():
        try:
            hits = await supermemory.recall(question, limit=body.limit)
        except supermemory.SupermemoryError as error:
            raise HTTPException(502, f'Supermemory search failed: {error}') from error

    # Local edges let a hit carry its connections, which is what makes this a
    # graph answer rather than a list of sentences.
    edges = memory.graph_snapshot(limit=240)['edges']

    for hit in hits:
        if body.kinds and hit.get('kind') not in body.kinds:
            continue
        lowered = hit['text'].lower()
        related = [
            {
                'id': f"{edge['subject']}|{edge['relation']}|{edge['object']}",
                'text': f"{edge['subject']} {edge['relation'].replace('_', ' ')} {edge['object']}",
                'relation': edge['relation'],
            }
            for edge in edges
            if edge['subject'] in lowered or edge['object'] in lowered
        ][:6]
        results.append({
            'id': str(hit.get('id') or ''),
            'text': hit['text'],
            'similarity': float(hit.get('score') or 0.0),
            'kind': hit.get('kind') or 'note',
            'updatedAt': hit.get('when'),
            'related': related,
        })

    return {'results': results}


# ---------- Location and directions ----------

@app.post('/location')
async def location_update(lat: float = Form(..., ge=-90, le=90), lon: float = Form(..., ge=-180, le=180), session: str = Form('default', max_length=64)):
    """One GPS fix in. Adds a breadcrumb to the walked path, notes new places, and returns the next spoken direction, if any."""
    if memory.record_location(lat, lon):
        memory.visit(await navigation.place_name(lat, lon))
    return navigator.update(session, lat, lon)

# ---------- Family contacts ----------

@app.get('/contacts')
def contacts_list(): return memory.contacts()

@app.post('/contacts', status_code=201)
def contacts_add(name: str = Form(..., min_length=1, max_length=40), phone: str = Form(..., min_length=7, max_length=24)):
    try:
        return memory.add_contact(name, phone)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

@app.delete('/contacts/{name}')
def contacts_remove(name: str):
    memory.remove_contact(name)
    return {'status': 'removed'}

# ---------- Saved places ----------

@app.get('/places')
def places_list(): return memory.places()

@app.post('/places', status_code=201)
async def places_save(name: str = Form('home', max_length=20), address: str = Form(..., min_length=3, max_length=200),
                      lat: float | None = Form(None), lon: float | None = Form(None)):
    """Look an address up on the map and remember it under a name such as home."""
    try:
        found = await assistant.resolve_place(address, (lat, lon) if lat is not None and lon is not None else None)
    except Exception as error:
        raise HTTPException(502, 'The map service could not be reached') from error
    if found is None:
        raise HTTPException(404, 'That address was not found on the map. Try a fuller address with the city.')
    return memory.save_place(name, found['label'], found['lat'], found['lon'])

@app.delete('/places/{name}')
def places_remove(name: str):
    memory.remove_place(name)
    return {'status': 'removed'}

# ---------- Pay by code ----------

@app.get('/pay/qr.png')
def pay_qr(item: str = 'Coffee', amount: float = 4.5):
    """A payment QR code for demos: show it to the camera and say "pay this"."""
    if not 0 < amount <= 10000 or len(item) > 60:
        raise HTTPException(422, 'Give an item name and a positive amount')
    try:
        png = checkout.make_qr_png(checkout.payment_code(item, amount))
    except ImportError as error:
        raise HTTPException(503, 'QR codes need OpenCV. Install backend/requirements-vision.txt.') from error
    return Response(png, media_type='image/png')

# ---------- Speech ----------

@app.post('/speech')
async def speech_out(text: str = Form(..., min_length=1, max_length=speech.MAX_TEXT)):
    """Text in, MP3 out, in the ElevenLabs voice."""
    if not speech.configured():
        raise HTTPException(503, 'No voice service is configured')
    try:
        return Response(await speech.synthesize(text), media_type='audio/mpeg', headers={'Cache-Control': 'no-store'})
    except speech.SpeechError as error:
        raise HTTPException(502, str(error)) from error

@app.post('/speech/transcribe')
async def speech_in(audio: UploadFile = File(...)):
    """A short audio clip in, text out. For microphones the browser cannot transcribe, like the bracelet."""
    if speech.transcriber() is None:
        raise HTTPException(503, 'No transcription service is configured')
    body = await audio.read(10 * 1024 * 1024 + 1)
    if len(body) > 10 * 1024 * 1024:
        raise HTTPException(413, 'Audio clip is too large')
    try:
        mime = (audio.content_type or 'application/octet-stream').split(';')[0]
        return {'text': await speech.transcribe(body, mime)}
    except speech.SpeechError as error:
        raise HTTPException(502, str(error)) from error

# ---------- Bridge ----------

@app.post('/bridge/sign')
async def bridge_sign(images: list[UploadFile] = File(...)):
    """Experimental: a few frames of signing in, a cautious English reading out."""
    if not llm.configured():
        raise HTTPException(503, 'Sign reading needs the cloud vision model')
    frames = [(await read_image(image), image.content_type) for image in images[:bridge.MAX_FRAMES]]
    return await bridge.read_sign(frames)

@app.post('/bridge/translate')
def bridge_translate(sequence: SignSequence):
    """Translate one supported sequence of recognized ASL concepts."""
    translation = bridge.translate_sequence(sequence.signs)
    return {'signs': sequence.signs, 'translation': translation, 'supported': bool(translation)}

# ---------- Band microphone ----------
# scripts/band_assistant.py posts each sentence heard through the Vexo band here; the open
# live demo polls for them and treats them exactly like speech from the laptop microphone.
band_heard: list[dict] = []
band_counter = 0

# One background process (scripts/band_assistant.py) keeps a single Bluetooth connection to the band,
# so there is no reconnecting for every sentence. It reports here that it is alive.
band_state = {'connected': False, 'last_seen': 0.0, 'name': None, 'battery': None}
band_process: subprocess.Popen | None = None
BAND_SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'band_assistant.py'
BAND_KIT = Path(__file__).resolve().parents[2] / 'vexo-open-kit'


def band_running() -> bool:
    return band_process is not None and band_process.poll() is None


def band_connected() -> bool:
    return band_state['connected'] and time.time() - band_state['last_seen'] < 15


def band_start() -> bool:
    """Start the permanent band connection, once."""
    global band_process
    if band_running():
        return True
    if not BAND_SCRIPT.is_file() or not BAND_KIT.is_dir():
        return False
    service = f"http://127.0.0.1:{os.getenv('GUIDEBAND_PORT', '8000')}"
    band_process = subprocess.Popen(
        [sys.executable, str(BAND_SCRIPT), '--service', service],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={**os.environ, 'PYTHONUNBUFFERED': '1'},
    )
    return True


def band_stop() -> None:
    global band_process
    if band_running():
        band_process.terminate()
    band_process = None
    band_state.update(connected=False)


def band_view() -> dict:
    """The wearable status, with the live connection taken into account."""
    view = wearable_status()
    view['bridge_running'] = band_running()
    if band_connected():
        view.update(connected=True, transport='ble', streaming=True)
        if band_state['name']:
            view['band_name'] = band_state['name']
        if band_state['battery'] not in (None, ''):
            view['battery'] = {'percent': band_state['battery'], 'charging': False, 'state': 'battery'}
    elif band_running():
        view.update(connected=False, streaming=False)  # still looking for the band
    return view


@app.post('/band/start')
def band_start_endpoint():
    if not band_start():
        raise HTTPException(503, 'The Vexo kit is not installed. Run scripts/setup_vexo_open_kit.sh first.')
    return band_view()


@app.post('/band/stop')
def band_stop_endpoint():
    band_stop()
    return band_view()


@app.post('/band/state')
def band_state_update(connected: bool = Form(...), name: str = Form(''), battery: str = Form('')):
    band_state.update(connected=connected, last_seen=time.time())
    if name:
        band_state['name'] = name
    if battery.isdigit():
        band_state['battery'] = int(battery)
    return {'ok': True}


# While the assistant is speaking, the band must not pass its voice back in as a request.
band_muted_until = 0.0
band_interrupt = False


@app.post('/band/mute')
def band_mute_set(on: bool = Form(...), interrupt: bool = Form(False)):
    """The page calls this when the assistant starts (on) and stops (off) speaking.

    With `interrupt` the band keeps listening while the assistant talks, so the user can cut in;
    the page then removes the assistant's own words from what comes back.
    """
    global band_muted_until, band_interrupt
    # The page repeats 'on' every second while it is really speaking; if it stops, this ends by itself.
    band_muted_until = time.time() + (2.5 if on else 0.25)
    band_interrupt = interrupt
    return {'speaking': on, 'muted': on and not interrupt}


@app.get('/band/mute')
def band_mute_get():
    speaking = time.time() < band_muted_until
    return {'speaking': speaking, 'muted': speaking and not band_interrupt}


@app.post('/band/heard', status_code=201)
def band_heard_add(text: str = Form(..., min_length=1, max_length=300)):
    global band_counter
    band_counter += 1
    band_state.update(connected=True, last_seen=time.time())
    band_heard.append({'id': band_counter, 'text': text.strip()})
    del band_heard[:-20]
    return {'id': band_counter}


@app.get('/band/heard')
def band_heard_list(after: int = 0, client: str = ''):
    items = []
    for item in band_heard:
        if item['id'] <= after:
            continue
        if client:
            owner = item.setdefault('client', client)  # the first page to ask handles the sentence
            if owner != client:
                continue
        items.append({'id': item['id'], 'text': item['text']})
    return {'last': band_counter, 'items': items,
            'band': {'connected': band_connected(), 'running': band_running(),
                     'name': band_state['name'], 'battery': band_state['battery']}}

# ---------- Tasks and events ----------

@app.post('/tasks', status_code=201)
def create_task(data: TaskCreate):
    task={'id':str(uuid4()),'title':data.title,'due_at':(datetime.now(timezone.utc)+timedelta(minutes=data.delay_minutes)).isoformat(),'status':'scheduled'};tasks[task['id']]=task;return task

@app.get('/tasks')
def list_tasks(): return list(tasks.values())

@app.websocket('/events')
async def events(ws: WebSocket):
    await ws.accept()
    await ws.send_json({'event': 'connected', 'timestamp': now()})
    try:
        while True:
            message = await ws.receive_text()
            await ws.send_json({'event': 'ack', 'message': message, 'timestamp': now()})
    except WebSocketDisconnect:
        pass

# ---------- Wearable / Vexo Band ----------

@app.get('/wearable/status')
def get_wearable_status():
    return band_view()

@app.post('/wearable/refresh')
async def post_wearable_refresh():
    if not band_running():
        await refresh_band_state()
    return band_view()

@app.post('/wearable/listen')
async def post_wearable_listen(request: Request):
    content_type = request.headers.get('content-type', '')
    seconds = 7.0
    language = 'multi'
    image_bytes = None
    mime = 'image/jpeg'
    session = 'wearable'
    location = None
    if 'multipart/form-data' in content_type:
        form = await request.form()
        session = str(form.get('session') or 'wearable')[:64]
        try:
            location = (float(form['lat']), float(form['lon']))
        except (KeyError, ValueError, TypeError):
            location = None
        try:
            seconds = float(form.get('seconds', 7.0))
        except (ValueError, TypeError):
            seconds = 7.0
        language = str(form.get('language', 'multi'))
        upload = form.get('image')
        if hasattr(upload, 'read'):
            raw = await upload.read(MAX_IMAGE_BYTES + 1)
            if len(raw) <= MAX_IMAGE_BYTES:
                image_bytes = raw
            mime = getattr(upload, 'content_type', 'image/jpeg') or 'image/jpeg'
    elif 'application/json' in content_type:
        try:
            data = await request.json()
            seconds = float(data.get('seconds', 7.0))
            language = str(data.get('language', 'en'))
        except Exception:
            pass

    seconds = seconds if 1.0 <= seconds <= 30.0 else 7.0
    if band_running():
        return {'ok': False, 'text': '', 'action': None,
                'say': 'The band is already listening all the time. Just speak.' if band_connected()
                else 'I am still looking for the band. Double-tap it and keep it close.'}
    try:
        transcript = await listen_band(seconds=seconds, language=language)
    except WearableError as error:
        raise HTTPException(503, str(error)) from error
    if not transcript:
        return {
            'ok': False,
            'text': '',
            'say': 'No speech was transcribed. Keep the band 10–20 cm from your mouth and speak after the solid blue light appears.',
            'action': None,
        }
    # Same session and location as the page, so a spoken yes confirms what the page is showing.
    reply = await assistant.respond(session, transcript, image_bytes, mime, location)
    return {
        **reply,
        'ok': True,
        'text': transcript,
        'say': reply.get('say', ''),
        'action': reply.get('action'),
        'data': reply.get('data'),
    }

# Serve the web app from the same origin, so one address (and one HTTPS
# certificate or tunnel) covers both the page and the API on a phone.
WEB_DIR = Path(__file__).resolve().parents[2] / 'web'
if WEB_DIR.is_dir():
    app.mount('/', StaticFiles(directory=WEB_DIR, html=True), name='web')
