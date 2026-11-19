"""Supermemory: long-term, relationship-aware recall for GuideBand.

The local SQLite memory stays the source of truth and keeps working with no
network. When SUPERMEMORY_API_KEY is set, every note is mirrored to Supermemory,
which extracts entities and the links between them on its side, and recall asks
it first. That buys three things the local store cannot do on its own:

  * meaning, not keywords — "where's my wallet" finds "left the brown billfold
    on the hall shelf";
  * memory that outlives one device, shared across the phone, band and desktop;
  * connections across notes, so an answer can be assembled from several
    sightings days apart.

Nothing is sent unless a key is configured, and only the short text notes are
mirrored — never frames, audio or location fixes.

API: the namespace-scoped v5 API (https://supermemory.ai/docs/migration/api-v5).
Everything is scoped to one namespace — our per-wearer space — so the paths carry
it: POST /ns/{namespace}/document to ingest, POST /ns/{namespace}/search to
recall. The older /v3/documents and /v3/search routes are deprecated.
"""
from __future__ import annotations

import os
import time
import urllib.parse

BASE_URL = os.getenv('SUPERMEMORY_BASE_URL', 'https://api.supermemory.ai')
DEFAULT_NAMESPACE = 'guideband-user'

# A write must never make the wearer wait; a read is on the critical path of speech.
WRITE_TIMEOUT = 8.0
READ_TIMEOUT = 6.0


class SupermemoryError(RuntimeError):
    """Raised for any non-success response, so callers can fall back locally."""


def configured() -> bool:
    return bool(os.getenv('SUPERMEMORY_API_KEY'))


def namespace() -> str:
    """One namespace per wearer. Keeps several users on one key from seeing each other."""
    name = (os.getenv('SUPERMEMORY_NAMESPACE')
            # Accepted for continuity with the v3 field name.
            or os.getenv('SUPERMEMORY_CONTAINER_TAG')
            or DEFAULT_NAMESPACE).strip()
    return name or DEFAULT_NAMESPACE


# Kept so existing callers and status output keep working.
def container_tag() -> str:
    return namespace()


def ingest_path() -> str:
    return f'/ns/{urllib.parse.quote(namespace(), safe="")}/document'


def search_path() -> str:
    return f'/ns/{urllib.parse.quote(namespace(), safe="")}/search'


def document_path(doc_id: str) -> str:
    return f'/ns/{urllib.parse.quote(namespace(), safe="")}/document/{urllib.parse.quote(doc_id, safe="")}'


def _headers() -> dict:
    return {
        'Authorization': f'Bearer {os.environ["SUPERMEMORY_API_KEY"]}',
        'Content-Type': 'application/json',
    }


def _iso(when: float) -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(when))


def compose(text: str, kind: str, when: float, place: str = '', triples: list | None = None) -> str:
    """Write the note the way Supermemory reads best: the fact, then its context.

    Spelling the relationships out as their own lines gives the extractor clean
    subject-relation-object pairs to hang the graph on, instead of leaving it to
    re-derive them from prose.
    """
    lines = [text.strip()]
    if place:
        lines.append(f'Where: {place}.')
    lines.append(f'When: {_iso(when)}.')
    lines.append(f'Kind of note: {kind}.')
    for subject, relation, obj in triples or []:
        lines.append(f'Relationship: {subject} -> {relation.replace("_", " ")} -> {obj}.')
    return '\n'.join(lines)


def document_body(
    text: str,
    kind: str = 'note',
    when: float | None = None,
    place: str = '',
    triples: list | None = None,
    extra: dict | None = None,
) -> dict:
    """The v5 ingest body. Namespace lives in the path, not in here."""
    when = when or time.time()
    metadata = {'kind': kind, 'source': 'guideband', 'recorded': _iso(when)}
    if place:
        metadata['place'] = place
    for key, value in (extra or {}).items():
        if isinstance(value, (str, int, float, bool)):
            metadata[key] = value
    return {
        'content': compose(text, kind, when, place, triples),
        'metadata': metadata,
        # The content is from when it was seen, not when it was uploaded, so
        # "20 minutes ago" resolves against the sighting.
        'date': _iso(when),
        'supportingContext': (
            'Memories of a blind or low-vision person wearing GuideBand. Entities are '
            'everyday objects, places and people. Relationships are mostly spatial '
            '(on, in, under, next to) and temporal (where something was last seen).'
        ),
    }


def search_body(question: str, limit: int = 8) -> dict:
    """The v5 search body. `rerank` is a mode here, not a boolean."""
    return {
        'query': question,
        'limit': max(1, min(limit, 100)),
        # Memories are the extracted, linked facts — what the graph is made of.
        'searchMode': 'memories',
        # Rewriting costs a little latency and buys a lot on the vague, spoken
        # questions this gets ("where'd I put that thing").
        'rewriteQuery': True,
        'rerank': 'order',
        'include': {'documents': True, 'related': True},
    }


async def remember(
    text: str,
    kind: str = 'note',
    when: float | None = None,
    place: str = '',
    triples: list | None = None,
    extra: dict | None = None,
) -> dict:
    """Mirror one note. Raises SupermemoryError so the caller can carry on locally."""
    import httpx

    payload = document_body(text, kind, when, place, triples, extra)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(WRITE_TIMEOUT, connect=4.0)) as client:
            response = await client.post(BASE_URL + ingest_path(), headers=_headers(), json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as error:  # network, auth, rate limit — all non-fatal here
        raise SupermemoryError(str(error)) from error


def parse_results(body: dict) -> list[dict]:
    """Flatten a v5 search response.

    A result carries a `memory`, a `chunk`, or both, so branch on what is there
    rather than assuming one shape.
    """
    results = []
    for item in body.get('results') or []:
        memory = item.get('memory')
        chunk = item.get('chunk')
        text = ''
        for candidate in (memory, chunk):
            if isinstance(candidate, dict):
                text = (candidate.get('content') or candidate.get('text') or '').strip()
            elif isinstance(candidate, str):
                text = candidate.strip()
            if text:
                break
        if not text:
            text = (item.get('content') or item.get('summary') or '').strip()
        if not text:
            continue
        metadata = item.get('metadata') or {}
        system = item.get('system') or {}
        results.append({
            'text': text,
            'title': (item.get('included', {}).get('document', {}) or {}).get('title', ''),
            'score': item.get('score'),
            'when': metadata.get('recorded') or system.get('createdAt'),
            'kind': metadata.get('kind') or 'note',
            'id': item.get('id') or item.get('documentId'),
        })
    return results


async def recall(question: str, limit: int = 8) -> list[dict]:
    """Search the graph. Returns the matching memories, best first."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT, connect=4.0)) as client:
            response = await client.post(
                BASE_URL + search_path(), headers=_headers(), json=search_body(question, limit),
            )
            response.raise_for_status()
            body = response.json()
    except Exception as error:
        raise SupermemoryError(str(error)) from error
    return parse_results(body)


def context(results: list[dict]) -> str:
    """Search hits as plain lines for the language model."""
    lines = []
    for item in results:
        stamp = f' ({item["when"]})' if item.get('when') else ''
        body = ' '.join(item['text'].split())
        lines.append(f'- remembered{stamp}: {body}')
    return '\n'.join(lines)
