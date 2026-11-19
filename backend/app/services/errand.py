from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from uuid import uuid4

API = 'https://api.harnessrouter.ai'
VERSION = '2026-09-28'
CONFIG_FILE = Path(__file__).resolve().parents[3] / 'harnessrouter.json'
TERMINAL = {'completed', 'failed', 'incomplete', 'cancelled'}
RETRYABLE = {429, 502, 503, 504}


class ErrandError(Exception):
    pass


def api_key() -> str:
    return os.getenv('HR_API_KEY', '').strip()


def harness_id() -> str:
    value = os.getenv('HR_HARNESS_ID', '').strip()
    if value:
        return value
    try:
        return str(json.loads(CONFIG_FILE.read_text(encoding='utf-8')).get('harness_id', '')).strip()
    except (OSError, ValueError):
        return ''


def configured() -> bool:
    return bool(api_key() and harness_id())


def _headers(extra: dict | None = None) -> dict:
    headers = {'Authorization': f'Bearer {api_key()}', 'UHP-Version': VERSION}
    headers.update(extra or {})
    return headers


def _problem(response) -> str:
    try:
        return str(response.json().get('error', {}).get('code') or response.status_code)
    except ValueError:
        return str(response.status_code)


async def _request(method: str, path: str, retry: bool = True, **kwargs) -> dict:
    import httpx

    headers = _headers(kwargs.pop('headers', None))
    last = 'unreachable'
    for attempt in range(3 if retry else 1):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.request(method, f'{API}{path}', headers=headers, **kwargs)
        except httpx.HTTPError:
            await asyncio.sleep(1 + attempt)
            continue
        if response.status_code in RETRYABLE and retry:
            last = _problem(response)
            await asyncio.sleep(1 + attempt)
            continue
        if response.status_code >= 400:
            raise ErrandError(_problem(response))
        return response.json()
    raise ErrandError(last)


def answer_text(response: dict) -> str:
    for item in reversed(response.get('output') or []):
        if item.get('type') == 'message':
            parts = [part.get('text', '') for part in item.get('content') or [] if part.get('type') == 'output_text']
            text = ' '.join(part.strip() for part in parts if part.strip())
            if text:
                return text
    return ''


async def upload(image: bytes, mime: str) -> str:
    ext = {'image/png': 'png', 'image/webp': 'webp'}.get(mime, 'jpg')
    files = {'file': (f'document.{ext}', image, mime)}
    result = await _request('POST', '/v1/files', retry=False, data={'purpose': 'user_data'}, files=files)
    return result['id']


async def start(text: str, user: str, image: bytes | None = None, mime: str = 'image/jpeg',
                previous: dict | None = None) -> dict:
    if not configured():
        raise ErrandError('not_configured')
    content: list[dict] = [{'type': 'input_text', 'text': text}]
    if image:
        content.append({'type': 'input_file', 'file_id': await upload(image, mime)})
    metadata = {'harness_id': harness_id()}
    body: dict = {
        'input': [{'role': 'user', 'content': content}] if image else text,
        'user': user,
        'metadata': metadata,
        'background': True,
    }
    if previous:
        body['previous_response_id'] = previous['id']
        if previous.get('session_id'):
            metadata['session_id'] = previous['session_id']
    response = await _request('POST', '/v1/responses', json=body, headers={'Idempotency-Key': str(uuid4())})
    return summary(response)


async def get(response_id: str) -> dict:
    return summary(await _request('GET', f'/v1/responses/{response_id}'))


def summary(response: dict) -> dict:
    status = response.get('status', 'in_progress')
    return {
        'id': response.get('id', ''),
        'session_id': (response.get('metadata') or {}).get('session_id', ''),
        'status': status,
        'done': status in TERMINAL,
        'text': answer_text(response) if status in TERMINAL else '',
    }


async def wait(response_id: str, seconds: float, interval: float = 2.0) -> dict:
    deadline = time.monotonic() + seconds
    while True:
        task = await get(response_id)
        if task['done'] or time.monotonic() >= deadline:
            return task
        await asyncio.sleep(interval)
