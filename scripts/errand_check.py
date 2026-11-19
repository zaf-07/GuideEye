"""Sync harnessrouter.json from HarnessRouter, then run one real errand through the app's /assistant route.

    python scripts/errand_check.py
    python scripts/errand_check.py "Explain this letter" path/to/photo.jpg
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import load_env  # noqa: E402
from backend.app.services import errand  # noqa: E402


def fetch_harness(harness_id: str) -> dict:
    request = urllib.request.Request(
        f'{errand.API}/v1/harnesses/{harness_id}',
        headers={'Authorization': f'Bearer {errand.api_key()}', 'UHP-Version': errand.VERSION},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def main() -> int:
    load_env()
    if not errand.api_key():
        print('HR_API_KEY is not set. Add it to backend/.env.')
        return 1
    harness_id = errand.harness_id()
    if not harness_id:
        print('No Harness ID. Set harness_id in harnessrouter.json or HR_HARNESS_ID in backend/.env.')
        return 1
    try:
        harness = fetch_harness(harness_id)
    except urllib.error.HTTPError as error:
        print(f'HarnessRouter refused the request ({error.code}). Check the key and the Harness ID.')
        return 1
    except urllib.error.URLError:
        print('HarnessRouter could not be reached from this computer.')
        return 1
    record = {
        'harness_id': harness['id'],
        'name': harness.get('name', ''),
        'base': harness.get('base', ''),
        'model': harness.get('defaultModel', ''),
        'instructions': harness.get('systemPrompt', ''),
    }
    errand.CONFIG_FILE.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Harness: {record["name"]} | base {record["base"]} | model {record["model"] or "default"} | {record["harness_id"]}')

    text = sys.argv[1] if len(sys.argv) > 1 else 'Look up what a discharge summary is and tell me in one sentence.'
    photo = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    os.environ.setdefault('MEMORY_DB', str(Path(tempfile.mkdtemp()) / 'check.db'))
    os.environ.setdefault('ERRAND_WAIT_SECONDS', '240')
    from fastapi.testclient import TestClient

    from backend.app.main import app

    client = TestClient(app)
    files = None
    if photo:
        mime = {'.png': 'image/png', '.webp': 'image/webp'}.get(photo.suffix.lower(), 'image/jpeg')
        files = {'image': (photo.name, photo.read_bytes(), mime)}
    reply = client.post('/assistant', data={'text': text, 'session': 'errand-check'}, files=files).json()
    print(f'Asked: {text}')
    print(f'Intent: {reply.get("intent")} | errand: {reply.get("errand")}')
    print(f'Reply: {reply.get("say")}')
    done = (reply.get('errand') or {}).get('status') == 'completed'
    print('Result: a real answer came back through /assistant.' if done else 'Result: no finished answer yet.')
    return 0 if done else 2


if __name__ == '__main__':
    raise SystemExit(main())
