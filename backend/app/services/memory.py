"""GuideBand's private memory: what was seen, where and when.

Only short text is stored — object labels, positions and brief notes. Images
and audio are never written. Everything lives in one local SQLite file that the
user can wipe at any time.
"""
from __future__ import annotations

import difflib
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

from . import llm
from .navigation import haversine

RECALL_PROMPT = (
    'You are GuideBand, the memory of a blind or low-vision person, speaking aloud. '
    'Answer the question from the memory notes provided, in one or two short sentences. '
    'Use whatever the notes say about the thing: what it was near, which side it was on, the street, and how long ago. '
    'An approximate answer from the notes is better than none. '
    'Notes that start with "I asked" are earlier requests made by the user: for questions about what they asked or said, list those. '
    'Only if the notes say nothing at all about it, say you have not seen it yet. Never invent details.'
)
SNAPSHOT_PROMPT = (
    'Describe this scene for a personal memory log in at most three short sentences. '
    'Name notable objects and say what each one is on or next to. '
    'Quote any clearly readable text exactly. Do not identify or describe people.'
)
STOP_WORDS = {
    'where', 'did', 'does', 'do', 'you', 'see', 'seen', 'saw', 'last', 'leave', 'left', 'put', 'have',
    'what', 'that', 'this', 'the', 'my', 'are', 'is', 'was', 'were', 'say', 'said', 'remember', 'and',
    'for', 'with', 'any', 'there', 'here', 'it', 'me', 'a', 'an', 'of', 'in', 'on', 'i', 'to',
}


def age(seconds: float) -> str:
    if seconds < 45:
        return 'just now'
    minutes = round(seconds / 60)
    if minutes < 60:
        return f'{minutes} minute{"s" if minutes != 1 else ""} ago'
    hours = round(minutes / 60)
    if hours < 24:
        return f'{hours} hour{"s" if hours != 1 else ""} ago'
    days = round(hours / 24)
    return f'{days} day{"s" if days != 1 else ""} ago'


def _sound(word: str) -> str:
    """A rough sound key: consonants only, with common spellings merged (Zack = Zach = Zak)."""
    key = word.lower().replace('ck', 'k').replace('ch', 'k').replace('ph', 'f').replace('c', 'k').replace('z', 's')
    key = key[0] + re.sub(r'[aeiouyh]', '', key[1:])
    return re.sub(r'(.)\1+', r'\1', key)


class Memory:
    def __init__(self, path: str | None = None) -> None:
        if path is None:
            path = os.getenv('MEMORY_DB') or str(Path(__file__).resolve().parents[2] / 'data' / 'memory.db')
        if path != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.execute('CREATE TABLE IF NOT EXISTS sightings (label TEXT PRIMARY KEY, position TEXT, last_seen REAL, times INTEGER)')
            self._db.execute('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, kind TEXT, text TEXT, created REAL)')
            self._db.execute('CREATE TABLE IF NOT EXISTS path (id INTEGER PRIMARY KEY, lat REAL, lon REAL, t REAL)')
            self._db.execute('CREATE TABLE IF NOT EXISTS contacts (key TEXT PRIMARY KEY, name TEXT, phone TEXT)')
            self._db.execute('CREATE TABLE IF NOT EXISTS places (name TEXT PRIMARY KEY, label TEXT, lat REAL, lon REAL)')
        self.last_place = ''

    # ----- writing -----

    def record_detections(self, detections: list[dict], now: float | None = None) -> None:
        """Keep the latest position of each kind of object the detector has seen."""
        now = now or time.time()
        latest: dict[str, dict] = {}
        for item in detections:  # one row per label: keep the largest instance
            if item['label'] not in latest or item['area'] > latest[item['label']]['area']:
                latest[item['label']] = item
        with self._lock, self._db:
            for label, item in latest.items():
                self._db.execute(
                    'INSERT INTO sightings VALUES (?, ?, ?, 1) ON CONFLICT(label) DO UPDATE SET '
                    'position = excluded.position, last_seen = excluded.last_seen, times = times + 1',
                    (label, item['position'], now),
                )

    def add_note(self, kind: str, text: str, now: float | None = None, place: str = '') -> dict:
        now = now or time.time()
        if place:
            text = f'{text.strip()} (near {place})'
        with self._lock, self._db:
            cursor = self._db.execute('INSERT INTO notes (kind, text, created) VALUES (?, ?, ?)', (kind, text.strip(), now))
            # Keep the log small and recent.
            self._db.execute('DELETE FROM notes WHERE id <= ?', (cursor.lastrowid - int(os.getenv('MEMORY_MAX_NOTES', '200')),))
        return {'id': cursor.lastrowid, 'kind': kind, 'text': text.strip(), 'created': now}

    def clear(self) -> None:
        with self._lock, self._db:
            self._db.execute('DELETE FROM sightings')
            self._db.execute('DELETE FROM notes')
            self._db.execute('DELETE FROM path')

    def visit(self, place: str) -> bool:
        """Note a place the first time the user reaches it. Returns True when it is new."""
        if not place or place == self.last_place:
            return False
        self.last_place = place
        self.add_note('place', f'I was at {place}.')
        return True

    # ----- contacts (kept when memory is erased) -----

    def add_contact(self, name: str, phone: str) -> dict:
        name, digits = name.strip()[:40], re.sub(r'\D', '', phone)
        if not name or not 7 <= len(digits) <= 15:
            raise ValueError('A contact needs a name and a phone number with country code.')
        with self._lock, self._db:
            self._db.execute('INSERT OR REPLACE INTO contacts VALUES (?, ?, ?)', (name.lower(), name, digits))
        return {'name': name, 'phone': digits}

    def remove_contact(self, name: str) -> None:
        with self._lock, self._db:
            self._db.execute('DELETE FROM contacts WHERE key = ?', (name.strip().lower(),))

    # ----- saved places such as home (kept when memory is erased) -----

    def save_place(self, name: str, label: str, lat: float, lon: float) -> dict:
        with self._lock, self._db:
            self._db.execute('INSERT OR REPLACE INTO places VALUES (?, ?, ?, ?)', (name.lower(), label, lat, lon))
        return {'name': name.lower(), 'label': label, 'lat': lat, 'lon': lon}

    def place(self, name: str) -> dict | None:
        with self._lock:
            row = self._db.execute('SELECT name, label, lat, lon FROM places WHERE name = ?', (name.lower(),)).fetchone()
        return {'name': row[0], 'label': row[1], 'lat': row[2], 'lon': row[3]} if row else None

    def places(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute('SELECT name, label, lat, lon FROM places ORDER BY name').fetchall()
        return [{'name': r[0], 'label': r[1], 'lat': r[2], 'lon': r[3]} for r in rows]

    def remove_place(self, name: str) -> None:
        with self._lock, self._db:
            self._db.execute('DELETE FROM places WHERE name = ?', (name.lower(),))

    def contacts(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute('SELECT name, phone FROM contacts ORDER BY name').fetchall()
        return [{'name': r[0], 'phone': r[1]} for r in rows]

    def find_contact(self, text: str) -> dict | None:
        """The contact the user named. Exact names win; otherwise a name that sounds alike is accepted,
        because speech recognition often hears "Tim" as "team" or "Zack" as "Zach"."""
        words = text.lower()
        contacts = self.contacts()
        for contact in contacts:
            if re.search(rf'\b{re.escape(contact["name"].lower())}\b', words):
                return contact
        heard = {word[:-1] if word.endswith('s') and len(word) > 3 else word for word in re.findall(r"[a-z]+", words)}
        heard -= STOP_WORDS | {'tell', 'text', 'message', 'send', 'write', 'friend', 'please', 'hey', 'whatsapp'}
        heard -= {'them', 'they', 'their', 'there', 'then', 'than', 'this', 'that', 'time', 'some', 'same', 'want', 'what'}  # too common to be a name
        best, best_score = None, 0.0
        for contact in contacts:
            name = contact['name'].lower().split()[0]
            for word in heard:
                if len(word) < 3 or word[0] != name[0]:
                    continue
                score = difflib.SequenceMatcher(None, word, name).ratio()
                if _sound(word) == _sound(name):
                    score = max(score, 0.9)
                if score > best_score:
                    best, best_score = contact, score
        return best if best_score >= 0.74 else None

    def record_location(self, lat: float, lon: float, now: float | None = None) -> bool:
        """Add a breadcrumb to the walked path. Skips points that barely moved."""
        now = now or time.time()
        with self._lock, self._db:
            last = self._db.execute('SELECT lat, lon FROM path ORDER BY id DESC LIMIT 1').fetchone()
            if last and haversine(last[0], last[1], lat, lon) < 8:
                return False
            cursor = self._db.execute('INSERT INTO path (lat, lon, t) VALUES (?, ?, ?)', (lat, lon, now))
            self._db.execute('DELETE FROM path WHERE id <= ?', (cursor.lastrowid - 5000,))
        return True

    # ----- reading -----

    def path(self, limit: int = 5000) -> list[dict]:
        with self._lock:
            rows = self._db.execute('SELECT lat, lon, t FROM path ORDER BY id DESC LIMIT ?', (limit,)).fetchall()
        return [{'lat': r[0], 'lon': r[1], 't': r[2]} for r in reversed(rows)]

    def trip_start(self, now: float | None = None, max_gap: float = 20 * 60) -> dict | None:
        """Where the current walk began: go back through the path until a long pause."""
        now = now or time.time()
        points = self.path()
        if not points or now - points[-1]['t'] > max_gap:
            return None
        start = points[-1]
        for point in reversed(points[:-1]):
            if start['t'] - point['t'] > max_gap:
                break
            start = point
        return start


    def sightings(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute('SELECT label, position, last_seen, times FROM sightings ORDER BY last_seen DESC').fetchall()
        return [{'label': r[0], 'position': r[1], 'last_seen': r[2], 'times': r[3]} for r in rows]

    def notes(self, limit: int = 30) -> list[dict]:
        with self._lock:
            rows = self._db.execute('SELECT id, kind, text, created FROM notes ORDER BY id DESC LIMIT ?', (limit,)).fetchall()
        return [{'id': r[0], 'kind': r[1], 'text': r[2], 'created': r[3]} for r in rows]

    def context(self, now: float | None = None, include_requests: bool = True) -> str:
        """Everything remembered, as plain lines for the language model."""
        now = now or time.time()
        notes = [n for n in self.notes(60) if include_requests or n['kind'] != 'asked'][:30]
        lines = [f'- note, {age(now - n["created"])}: {n["text"]}' for n in notes]
        lines += [f'- detector saw a {s["label"]} {s["position"]}, {age(now - s["last_seen"])}' for s in self.sightings()[:30]]
        return '\n'.join(lines)

    def local_answer(self, question: str, now: float | None = None) -> str:
        """Keyword recall used when no cloud model is available."""
        now = now or time.time()
        words = {w for w in re.findall(r'[a-z]+', question.lower()) if w not in STOP_WORDS and len(w) > 2}
        words |= {w[:-1] for w in words if w.endswith('s')}  # keys -> key
        for note in self.notes():
            if words & set(re.findall(r'[a-z]+', note['text'].lower())):
                return f'{age(now - note["created"]).capitalize()} I noted: {note["text"]}'
        for sighting in self.sightings():
            if words & set(sighting['label'].split()):
                return f'I last saw a {sighting["label"]} {sighting["position"]}, {age(now - sighting["last_seen"])}.'
        return 'I have not seen that yet.'

    async def recall(self, question: str) -> dict:
        # The log of past requests only helps when the question is about them.
        about_requests = bool(re.search(r'\b(ask|asked|say|said|request)', question.lower()))
        context = self.context(include_requests=about_requests)
        if context and llm.configured():
            try:
                text = await llm.complete(
                    [{'text': f'Memory notes:\n{context}\n\nQuestion: {question}'}], system=RECALL_PROMPT,
                )
                return {'text': text, 'provider': 'gemini'}
            except Exception:
                pass  # fall through to keyword recall
        return {'text': self.local_answer(question), 'provider': 'local'}

    async def snapshot(self, image: bytes, mime: str, fallback: str, place: str = '') -> dict:
        """Describe a frame into a text note. The frame itself is discarded."""
        text, provider = fallback, 'local'
        if llm.configured():
            try:
                text = await llm.complete([llm.image_part(image, mime), {'text': SNAPSHOT_PROMPT}])
                provider = 'gemini'
            except Exception:
                pass
        note = self.add_note('snapshot', text, place=place)
        note['provider'] = provider
        return note
