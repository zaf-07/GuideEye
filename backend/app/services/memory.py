"""GuideBand's private memory: what was seen, where and when.

Only short text is stored — object labels, positions and brief notes. Images
and audio are never written. Everything lives in one local SQLite file that the
user can wipe at any time.
"""
from __future__ import annotations

import asyncio
import difflib
import logging
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

from . import graph, llm, supermemory
from .navigation import haversine

log = logging.getLogger(__name__)


def _mirror_requests() -> bool:
    """Whether the wearer's own spoken requests are synced, not just what was seen."""
    return os.getenv('SUPERMEMORY_MIRROR_REQUESTS', '').strip().lower() in {'1', 'true', 'yes', 'on'}

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
            # The relationship graph: what was near, on or inside what.
            self._db.execute(
                'CREATE TABLE IF NOT EXISTS entities ('
                'name TEXT PRIMARY KEY, first_seen REAL, last_seen REAL, mentions INTEGER)'
            )
            self._db.execute(
                'CREATE TABLE IF NOT EXISTS edges ('
                'subject TEXT, relation TEXT, object TEXT, note_id INTEGER, created REAL, times INTEGER, '
                'PRIMARY KEY (subject, relation, object))'
            )
            self._db.execute('CREATE INDEX IF NOT EXISTS edges_subject ON edges (subject)')
            self._db.execute('CREATE INDEX IF NOT EXISTS edges_object ON edges (object)')
        self.last_place = ''
        # Background mirror writes to Supermemory, so speech never waits on the network.
        self._mirrors: set[asyncio.Task] = set()
        self.remote_errors = 0
        self.mirrored = 0
        self.skipped_requests = 0

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
        text = text.strip()
        with self._lock, self._db:
            cursor = self._db.execute('INSERT INTO notes (kind, text, created) VALUES (?, ?, ?)', (kind, text, now))
            # Keep the log small and recent.
            self._db.execute('DELETE FROM notes WHERE id <= ?', (cursor.lastrowid - int(os.getenv('MEMORY_MAX_NOTES', '200')),))
        note = {'id': cursor.lastrowid, 'kind': kind, 'text': text, 'created': now}

        triples = self.record_relations(text, note['id'], now)
        note['relations'] = [{'subject': s, 'relation': r, 'object': o} for s, r, o in triples]
        self._mirror(text, kind, now, place, triples)
        return note

    # ----- the relationship graph -----

    def record_relations(self, text: str, note_id: int | None = None, now: float | None = None) -> list[tuple]:
        """Store the (subject, relation, object) triples a note contains."""
        now = now or time.time()
        triples = graph.extract(text)
        if not triples:
            return []
        with self._lock, self._db:
            for subject, relation, obj in triples:
                for name in (subject, obj):
                    self._db.execute(
                        'INSERT INTO entities VALUES (?, ?, ?, 1) ON CONFLICT(name) DO UPDATE SET '
                        'last_seen = excluded.last_seen, mentions = mentions + 1',
                        (name, now, now),
                    )
                self._db.execute(
                    'INSERT INTO edges VALUES (?, ?, ?, ?, ?, 1) '
                    'ON CONFLICT(subject, relation, object) DO UPDATE SET '
                    'created = excluded.created, note_id = excluded.note_id, times = times + 1',
                    (subject, relation, obj, note_id, now),
                )
        return triples

    def reindex_relations(self) -> dict:
        """Rebuild the graph from the notes already stored.

        Notes written before the graph existed — or by an older version — carry
        no edges, so recall cannot follow them. This re-reads every note and
        extracts their relationships again. Safe to run repeatedly: edges are
        keyed on (subject, relation, object), so repeats update rather than
        duplicate.
        """
        with self._lock, self._db:
            self._db.execute('DELETE FROM edges')
            self._db.execute('DELETE FROM entities')
        notes = self.notes(limit=10_000)
        edges = 0
        for note in notes:
            if note['kind'] == 'asked':
                continue
            edges += len(self.record_relations(note['text'], note['id'], note['created']))
        snapshot = self.graph_snapshot(limit=100_000)
        return {'notes_scanned': len(notes), 'relations_found': edges,
                'entities': len(snapshot['nodes']), 'edges': len(snapshot['edges'])}

    def neighbours(self, name: str, depth: int = 2, limit: int = 40) -> list[dict]:
        """Walk outwards from one entity, following edges in both directions."""
        name = name.strip().lower()
        seen_nodes, found, frontier = {name}, [], [name]
        with self._lock:
            for _ in range(max(1, depth)):
                if not frontier or len(found) >= limit:
                    break
                placeholders = ','.join('?' * len(frontier))
                rows = self._db.execute(
                    f'SELECT subject, relation, object, created FROM edges '
                    f'WHERE subject IN ({placeholders}) OR object IN ({placeholders}) '
                    f'ORDER BY created DESC LIMIT ?',
                    (*frontier, *frontier, limit),
                ).fetchall()
                next_frontier = []
                for subject, relation, obj, created in rows:
                    edge = {'subject': subject, 'relation': relation, 'object': obj, 'created': created}
                    if edge not in found:
                        found.append(edge)
                    for node in (subject, obj):
                        if node not in seen_nodes:
                            seen_nodes.add(node)
                            next_frontier.append(node)
                frontier = next_frontier
        return found[:limit]

    def graph_snapshot(self, limit: int = 120) -> dict:
        """The whole graph, for the Memory panel."""
        with self._lock:
            edges = self._db.execute(
                'SELECT subject, relation, object, created, times FROM edges ORDER BY created DESC LIMIT ?', (limit,)
            ).fetchall()
            nodes = self._db.execute(
                'SELECT name, first_seen, last_seen, mentions FROM entities ORDER BY mentions DESC, last_seen DESC LIMIT ?',
                (limit,),
            ).fetchall()
        return {
            'nodes': [{'name': n[0], 'first_seen': n[1], 'last_seen': n[2], 'mentions': n[3]} for n in nodes],
            'edges': [
                {'subject': e[0], 'relation': e[1], 'object': e[2], 'created': e[3], 'times': e[4]}
                for e in edges
            ],
        }

    def graph_context(self, question: str, now: float | None = None) -> str:
        """The part of the graph the question touches, as lines for the model."""
        now = now or time.time()
        words = {w for w in re.findall(r'[a-z]+', question.lower()) if w not in STOP_WORDS and len(w) > 2}
        words |= {w[:-1] for w in words if w.endswith('s')}
        if not words:
            return ''
        with self._lock:
            names = [row[0] for row in self._db.execute('SELECT name FROM entities').fetchall()]
        starts = [n for n in names if words & set(n.split())]
        lines: list[str] = []
        for start in starts[:4]:
            for edge in self.neighbours(start, depth=2, limit=12):
                line = (
                    f'- {edge["subject"]} is {graph.phrase(edge["relation"])} {edge["object"]} '
                    f'({age(now - edge["created"])})'
                )
                if line not in lines:
                    lines.append(line)
        return '\n'.join(lines[:20])

    # ----- mirroring to Supermemory -----

    def _mirror(self, text: str, kind: str, when: float, place: str, triples: list) -> None:
        """Fire the Supermemory write off in the background and forget about it."""
        if not supermemory.configured():
            return
        # The log of spoken requests is the wearer's own words, so it stays on
        # the device unless they ask for it to be synced. Counted either way:
        # silently dropping every note is indistinguishable from a broken key,
        # and that is exactly how it looks when nothing else is being written.
        if kind == 'asked' and not _mirror_requests():
            self.skipped_requests += 1
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # called from a plain thread; the local note is already safe
        task = loop.create_task(self._mirror_now(text, kind, when, place, triples))
        self._mirrors.add(task)
        task.add_done_callback(self._mirrors.discard)

    async def _mirror_now(self, text: str, kind: str, when: float, place: str, triples: list) -> None:
        try:
            await supermemory.remember(text, kind=kind, when=when, place=place, triples=triples)
            self.mirrored += 1
        except supermemory.SupermemoryError as error:
            self.remote_errors += 1
            log.warning('Supermemory write failed, keeping the local note only: %s', error)

    async def flush(self) -> None:
        """Wait for pending mirror writes. Used by tests and on shutdown."""
        if self._mirrors:
            await asyncio.gather(*list(self._mirrors), return_exceptions=True)

    def remote_status(self) -> dict:
        return {
            'configured': supermemory.configured(),
            'namespace': supermemory.namespace() if supermemory.configured() else None,
            'pending_writes': len(self._mirrors),
            'synced': self.mirrored,
            'errors': self.remote_errors,
            # Named so "nothing is syncing" can be told apart from "nothing is
            # being written" and from "the key is wrong".
            'skipped_requests': self.skipped_requests,
            'mirrors_requests': _mirror_requests(),
        }

    def clear(self) -> None:
        with self._lock, self._db:
            self._db.execute('DELETE FROM sightings')
            self._db.execute('DELETE FROM notes')
            self._db.execute('DELETE FROM path')
            self._db.execute('DELETE FROM edges')
            self._db.execute('DELETE FROM entities')

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
        # "Where are my keys?" must not be answered with "you asked where your keys
        # are" — the log of past requests only counts when the question is about them.
        about_requests = bool(re.search(r'\b(ask|asked|say|said|request)', question.lower()))
        for note in self.notes():
            if note['kind'] == 'asked' and not about_requests:
                continue
            if words & set(re.findall(r'[a-z]+', note['text'].lower())):
                return f'{age(now - note["created"]).capitalize()} I noted: {note["text"]}'
        for sighting in self.sightings():
            if words & set(sighting['label'].split()):
                return f'I last saw a {sighting["label"]} {sighting["position"]}, {age(now - sighting["last_seen"])}.'
        # Nothing matched a note or a sighting: try the relationship graph, which
        # can still place a thing through what it was near.
        with self._lock:
            names = [row[0] for row in self._db.execute('SELECT name FROM entities').fetchall()]
        for name in names:
            if not words & set(name.split()):
                continue
            for edge in self.neighbours(name, depth=1, limit=4):
                if edge['subject'] == name:
                    return (f'The {name} was {graph.phrase(edge["relation"])} the {edge["object"]}, '
                            f'{age(now - edge["created"])}.')
        return 'I have not seen that yet.'

    async def recall(self, question: str) -> dict:
        """Answer from memory, newest and best-connected evidence first.

        Three sources are stacked, each adding what the one before cannot see:
        the recent note log, the local relationship graph, and Supermemory's
        long-term graph. Any of them may be empty; the answer degrades rather
        than fails.
        """
        # The log of past requests only helps when the question is about them.
        about_requests = bool(re.search(r'\b(ask|asked|say|said|request)', question.lower()))
        sources: list[str] = []
        blocks: list[str] = []

        recent = self.context(include_requests=about_requests)
        if recent:
            blocks.append(f'Recent notes:\n{recent}')
            sources.append('local')

        connections = self.graph_context(question)
        if connections:
            blocks.append(f'Known connections between things:\n{connections}')
            sources.append('graph')

        if supermemory.configured():
            try:
                hits = await supermemory.recall(question)
                if hits:
                    blocks.append(f'Long-term memory:\n{supermemory.context(hits)}')
                    sources.append('supermemory')
            except supermemory.SupermemoryError as error:
                self.remote_errors += 1
                log.warning('Supermemory recall failed, answering from local memory: %s', error)

        context = '\n\n'.join(blocks)
        if context and llm.configured():
            try:
                text = await llm.complete(
                    [{'text': f'{context}\n\nQuestion: {question}'}], system=RECALL_PROMPT,
                )
                return {'text': text, 'provider': 'gemini', 'sources': sources}
            except Exception:
                pass  # fall through to keyword recall
        return {'text': self.local_answer(question), 'provider': 'local', 'sources': sources or ['local']}

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
