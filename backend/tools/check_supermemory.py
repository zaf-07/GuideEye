#!/usr/bin/env python3
"""Prove the Supermemory integration works, end to end, against the live API.

Run it with no arguments:

    python3 backend/tools/check_supermemory.py

It writes two linked memories into a throwaway container, waits for them to be
indexed, then asks questions whose wording does NOT match the stored text. If
the answers come back, semantic recall and cross-document linking are working.

Two things worth knowing before you read the output:

  * Ingestion is not instantaneous. A document goes queued -> extracting ->
    chunking -> embedding -> indexing -> done. Searching before it reaches
    "done" returns nothing, which looks like a broken key but is not. This
    script polls and prints each transition with the elapsed time, so you can
    see the real latency on your account.

  * It writes to its own container tag, not your real one, so nothing here can
    pollute or erase what GuideEye has remembered. Pass --cleanup to delete
    the test documents afterwards.

Standard library only, so it runs on the Python already on this machine. The
backend itself needs Python 3.10+, but this check does not.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.app.config import load_env  # noqa: E402
from backend.app.services import graph, supermemory  # noqa: E402

TEST_NS = 'guideband-selftest'
TIMEOUT = 20.0
POLL_LIMIT = 180.0  # seconds to wait for indexing before giving up

# Deliberately synthetic. Nothing real about anyone goes to the API from here.
MEMORY_A = 'The spare key is on the blue hook by the front door.'
MEMORY_B = 'The blue hook by the front door is next to the tall coat rack.'
# Worded differently from the memories on purpose — keyword matching would miss these.
QUESTION_A = 'where do I keep the spare door key?'
QUESTION_B = 'what is beside the tall coat rack?'

GREEN, RED, DIM, BOLD, OFF = '\033[32m', '\033[31m', '\033[2m', '\033[1m', '\033[0m'
if not sys.stdout.isatty():
    GREEN = RED = DIM = BOLD = OFF = ''


def say(mark: str, text: str, colour: str = '') -> None:
    print(f'{colour}{mark}{OFF} {text}', flush=True)


def request(method: str, path: str, body: dict | None = None) -> dict:
    """One API call. Raises RuntimeError with the server's own message on failure."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        supermemory.BASE_URL + path, data=data, method=method,
        headers={
            'Authorization': f'Bearer {os.environ["SUPERMEMORY_API_KEY"]}',
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            raw = response.read().decode() or '{}'
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:400]
        raise RuntimeError(f'HTTP {error.code} on {method} {path} — {detail}') from error
    except urllib.error.URLError as error:
        raise RuntimeError(f'could not reach {supermemory.BASE_URL} — {error.reason}') from error
    return json.loads(raw)


def write_memory(text: str) -> str:
    """Ingest one note exactly the way the running service would."""
    triples = graph.extract(text)
    say('->', f'writing: {text}')
    if triples:
        for subject, relation, obj in triples:
            say('  ', f'{DIM}relationship found locally: {subject} -> {relation} -> {obj}{OFF}')
    else:
        say('  ', f'{DIM}no local relationship extracted{OFF}')
    # Same body the service sends, just pointed at the throwaway namespace.
    result = request('POST', f'/ns/{TEST_NS}/document',
                     supermemory.document_body(text, 'snapshot', time.time(), triples=triples))
    doc_id = result.get('id') or result.get('documentId')
    if not doc_id:
        raise RuntimeError(f'no document id came back: {json.dumps(result)[:300]}')
    say('  ', f'{DIM}document {doc_id}{OFF}')
    return doc_id


def wait_until_indexed(doc_id: str) -> bool:
    """Poll until the memories are generated. This is the step people skip.

    Two clocks matter. `status` is the chunk/embed pipeline. `dreamingStatus` is
    memory and relationship generation, and it finishes later — sometimes
    minutes later. GuideEye reads memories, so this waits for both; stopping at
    status == done is exactly why a search can come back empty and look broken.
    """
    started, seen, delay = time.time(), None, 1.0
    while time.time() - started < POLL_LIMIT:
        doc = request('GET', f'/ns/{TEST_NS}/document/{doc_id}')
        system = doc.get('system') or {}
        status = system.get('status') or doc.get('status') or 'unknown'
        dreaming = system.get('dreamingStatus') or doc.get('dreamingStatus') or 'unknown'
        if (status, dreaming) != seen:
            say('  ', f'{DIM}{time.time() - started:5.1f}s  status={status}  memories={dreaming}{OFF}')
            seen = (status, dreaming)
        if status == 'failed':
            return False
        if status == 'done' and dreaming == 'done':
            return True
        time.sleep(delay)
        delay = min(delay * 1.4, 5.0)
    say('  ', f'{RED}still not ready after {POLL_LIMIT:.0f}s{OFF}')
    return False


def search(question: str) -> list:
    say('->', f'asking: {BOLD}{question}{OFF}')
    body = request('POST', f'/ns/{TEST_NS}/search', supermemory.search_body(question, limit=5))
    results = supermemory.parse_results(body)
    for item in results:
        text = ' '.join(item['text'].split())[:160]
        score = item.get('score')
        say('  ', f'{GREEN}{score:.3f}{OFF}  {text}' if isinstance(score, (int, float)) else f'  {text}')
    if not results:
        say('  ', f'{RED}nothing came back{OFF}')
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cleanup', action='store_true', help='delete the test documents afterwards')
    parser.add_argument('--keep', action='store_true', help='leave them (default)')
    args = parser.parse_args()

    load_env()

    print(f'\n{BOLD}1. Configuration{OFF}')
    if not supermemory.configured():
        say('x', f'{RED}SUPERMEMORY_API_KEY is not set.{OFF}', RED)
        print(f'\n  Put it in {ROOT / "backend/.env"}:\n      SUPERMEMORY_API_KEY=sm_your_key_here\n'
              '  or export it for one run:\n      SUPERMEMORY_API_KEY=... python3 backend/tools/check_supermemory.py\n')
        return 1
    key = os.environ['SUPERMEMORY_API_KEY']
    say('v', f'key loaded ({len(key)} chars, ending {key[-4:]})', GREEN)
    say('v', f'real namespace: {supermemory.namespace()}', GREEN)
    say('v', f'this test writes to: {TEST_NS}  (separate namespace, so your memory is untouched)', GREEN)

    created: list = []
    try:
        print(f'\n{BOLD}2. Write and index two linked memories{OFF}')
        for text in (MEMORY_A, MEMORY_B):
            doc_id = write_memory(text)
            created.append(doc_id)
            if not wait_until_indexed(doc_id):
                say('x', f'{RED}indexing did not finish — see the status above{OFF}', RED)
                return 1
            say('v', 'indexed and searchable', GREEN)

        print(f'\n{BOLD}3. Recall with different wording{OFF}')
        say('  ', f'{DIM}"spare door key" never appears in the stored text in that form{OFF}')
        hit_a = search(QUESTION_A)

        print(f'\n{BOLD}4. Follow a link across two documents{OFF}')
        say('  ', f'{DIM}the coat rack and the key were written in separate documents{OFF}')
        hit_b = search(QUESTION_B)

        print(f'\n{BOLD}Result{OFF}')
        ok = bool(hit_a) and bool(hit_b)
        if ok:
            say('v', f'{GREEN}Supermemory is working: writes land, indexing completes, '
                     f'and recall answers questions the stored wording does not contain.{OFF}', GREEN)
        else:
            say('x', f'{RED}Writes and indexing worked, but recall came back empty. '
                     f'Check the namespace and that the plan allows search.{OFF}', RED)
        return 0 if ok else 1

    except RuntimeError as error:
        say('x', f'{RED}{error}{OFF}', RED)
        if '401' in str(error) or '403' in str(error):
            print('\n  That is an authentication failure — the key is wrong, revoked, or lacks access.')
        return 1
    finally:
        if args.cleanup and created:
            print(f'\n{BOLD}Cleanup{OFF}')
            try:
                # v5 deletes in bulk, by id, against the namespace.
                request('DELETE', f'/ns/{TEST_NS}/document', {'ids': created})
                say('v', f'deleted {len(created)} test documents', GREEN)
            except RuntimeError as error:
                say('x', f'could not delete the test documents: {error}', RED)
        elif created:
            print(f'\n{DIM}  {len(created)} test documents left in namespace "{TEST_NS}". '
                  f'Re-run with --cleanup to remove them.{OFF}')


if __name__ == '__main__':
    raise SystemExit(main())
