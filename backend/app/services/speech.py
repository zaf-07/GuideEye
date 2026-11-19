"""Speech through Deepgram (Nova-3 STT + Aura TTS) or ElevenLabs.

Both are optional. Without a key the web client keeps using the browser's own
speech, and hazard warnings always use the local voice so they never wait on
the network.
"""
from __future__ import annotations

import os

DEEPGRAM_API = 'https://api.deepgram.com/v1'
DEFAULT_DEEPGRAM_VOICE = 'aura-asteria-en'
DEFAULT_DEEPGRAM_STT = 'nova-3'

MINIMAX_API = 'https://api.minimax.io/v1'
DEFAULT_MINIMAX_VOICE = 'English_expressive_narrator'
DEFAULT_MINIMAX_TTS = 'speech-2.8-turbo'

ELEVENLABS_API = 'https://api.elevenlabs.io/v1'
DEFAULT_ELEVENLABS_VOICE = 'EXAVITQu4vr4xnSDxMaL'  # "Sarah": calm and clear
MAX_TEXT = 600


class SpeechError(Exception):
    pass


def configured() -> bool:
    return bool(os.getenv('MINIMAX_API_KEY') or os.getenv('DEEPGRAM_API_KEY') or os.getenv('ELEVENLABS_API_KEY'))


def preferred() -> str:
    """SPEECH_VOICE=elevenlabs|deepgram|minimax picks the voice to try first, when its key is set."""
    choice = os.getenv('SPEECH_VOICE', '').strip().lower()
    key = {'elevenlabs': 'ELEVENLABS_API_KEY', 'deepgram': 'DEEPGRAM_API_KEY', 'minimax': 'MINIMAX_API_KEY'}.get(choice)
    return choice if key and os.getenv(key) else ''


def provider() -> str:
    if preferred():
        return preferred()
    if os.getenv('MINIMAX_API_KEY'):
        return 'minimax'
    if os.getenv('DEEPGRAM_API_KEY'):
        return 'deepgram'
    if os.getenv('ELEVENLABS_API_KEY'):
        return 'elevenlabs'
    return 'browser'


async def synthesize(text: str) -> bytes:
    """Text in, MP3 bytes out. Deepgram preferred (hackathon sponsor & ~150ms latency)."""
    deepgram_key = os.getenv('DEEPGRAM_API_KEY')
    if preferred() == 'elevenlabs':
        try:
            return await _synthesize_elevenlabs(text)
        except Exception:
            pass  # e.g. out of credits: fall through to the other voices
    if deepgram_key and preferred() != 'minimax':
        try:
            return await _synthesize_deepgram(text, deepgram_key)
        except Exception:
            pass
    minimax_key = os.getenv('MINIMAX_API_KEY')
    if minimax_key:
        try:
            return await _synthesize_minimax(text, minimax_key)
        except Exception:
            pass
    if os.getenv('ELEVENLABS_API_KEY'):
        return await _synthesize_elevenlabs(text)
    if deepgram_key:
        return await _synthesize_deepgram(text, deepgram_key)
    raise SpeechError('No speech service configured (need DEEPGRAM_API_KEY, MINIMAX_API_KEY or ELEVENLABS_API_KEY)')


async def _synthesize_minimax(text: str, key: str) -> bytes:
    """Synchronous MiniMax Speech 2.8; the API returns MP3 as hexadecimal."""
    import httpx
    payload = {
        'model': os.getenv('MINIMAX_TTS_MODEL', DEFAULT_MINIMAX_TTS),
        'text': text[:MAX_TEXT],
        'stream': False,
        'language_boost': 'auto',
        'output_format': 'hex',
        'voice_setting': {
            'voice_id': os.getenv('MINIMAX_VOICE_ID', DEFAULT_MINIMAX_VOICE),
            'speed': 1,
            'vol': 1,
            'pitch': 0,
        },
        'audio_setting': {'sample_rate': 32000, 'bitrate': 128000, 'format': 'mp3', 'channel': 1},
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=4.0)) as client:
            response = await client.post(
                f'{MINIMAX_API}/t2a_v2',
                headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
            if result.get('base_resp', {}).get('status_code', 0) != 0:
                raise ValueError('MiniMax returned an unsuccessful status')
            audio = bytes.fromhex(result.get('data', {}).get('audio', ''))
            if not audio:
                raise ValueError('MiniMax returned no audio')
            return audio
    except Exception as error:
        raise SpeechError(f'MiniMax voice failed: {type(error).__name__}') from error


async def _synthesize_deepgram(text: str, key: str) -> bytes:
    import httpx
    voice = os.getenv('DEEPGRAM_VOICE_MODEL', DEFAULT_DEEPGRAM_VOICE)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
            response = await client.post(
                f'{DEEPGRAM_API}/speak',
                params={'model': voice},
                headers={'Authorization': f'Token {key}', 'Content-Type': 'application/json'},
                json={'text': text[:MAX_TEXT]},
            )
            response.raise_for_status()
    except Exception as error:
        raise SpeechError(f'Deepgram voice failed: {type(error).__name__}') from error
    return response.content


async def _synthesize_elevenlabs(text: str) -> bytes:
    import httpx
    voice = os.getenv('ELEVENLABS_VOICE_ID', DEFAULT_ELEVENLABS_VOICE)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
            response = await client.post(
                f'{ELEVENLABS_API}/text-to-speech/{voice}',
                params={'output_format': 'mp3_44100_64'},
                headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY']},
                json={'text': text[:MAX_TEXT], 'model_id': os.getenv('ELEVENLABS_TTS_MODEL', 'eleven_flash_v2_5')},
            )
            response.raise_for_status()
    except Exception as error:
        raise SpeechError(f'ElevenLabs voice failed: {type(error).__name__}') from error
    return response.content


def transcriber() -> str | None:
    """Which service turns audio into text: Deepgram when set, otherwise ElevenLabs."""
    if os.getenv('DEEPGRAM_API_KEY'):
        return 'deepgram'
    return 'elevenlabs' if configured() else None


async def _deepgram(audio: bytes, mime: str) -> str:
    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=4.0)) as client:
        response = await client.post(
            'https://api.deepgram.com/v1/listen',
            params={'model': os.getenv('DEEPGRAM_MODEL', 'nova-3'), 'smart_format': 'true', 'language': 'en'},
            headers={'Authorization': f"Token {os.environ['DEEPGRAM_API_KEY']}", 'Content-Type': mime},
            content=audio,
        )
        response.raise_for_status()
    return response.json()['results']['channels'][0]['alternatives'][0]['transcript'].strip()


async def _elevenlabs(audio: bytes, mime: str) -> str:
    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=4.0)) as client:
        response = await client.post(
            f'{API}/speech-to-text',
            headers=_headers(),
            data={'model_id': os.getenv('ELEVENLABS_STT_MODEL', 'scribe_v1')},
            files={'file': ('speech', audio, mime)},
        )
        response.raise_for_status()
    return (response.json().get('text') or '').strip()


async def transcribe(audio: bytes, mime: str) -> str:
    """Short audio clip in, text out. The clip is not stored here."""
async def transcribe(audio: bytes, mime: str) -> str:
    """Short audio clip in, text out. The clip is not stored here."""
    deepgram_key = os.getenv('DEEPGRAM_API_KEY')
    if deepgram_key:
        try:
            return await _transcribe_deepgram(audio, mime, deepgram_key)
        except Exception:
            pass
    if os.getenv('ELEVENLABS_API_KEY'):
        return await _transcribe_elevenlabs(audio, mime)
    raise SpeechError('No speech transcription service configured')


async def _transcribe_deepgram(audio: bytes, mime: str, key: str) -> str:
    import httpx
    model = os.getenv('DEEPGRAM_STT_MODEL', DEFAULT_DEEPGRAM_STT)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=3.0)) as client:
            response = await client.post(
                f'{DEEPGRAM_API}/listen',
                params={'model': model, 'smart_format': 'true'},
                headers={'Authorization': f'Token {key}', 'Content-Type': mime or 'application/octet-stream'},
                content=audio,
            )
            response.raise_for_status()
            data = response.json()
            channels = data.get('results', {}).get('channels', [])
            if channels and channels[0].get('alternatives'):
                return (channels[0]['alternatives'][0].get('transcript') or '').strip()
            return ''
    except Exception as error:
        raise SpeechError(f'Deepgram transcription failed: {type(error).__name__}') from error


async def _transcribe_elevenlabs(audio: bytes, mime: str) -> str:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=4.0)) as client:
            response = await client.post(
                f'{ELEVENLABS_API}/speech-to-text',
                headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY']},
                data={'model_id': os.getenv('ELEVENLABS_STT_MODEL', 'scribe_v1')},
                files={'file': ('speech', audio, mime)},
            )
            response.raise_for_status()
    except Exception as error:
        raise SpeechError(f'ElevenLabs transcription failed: {type(error).__name__}') from error
    return (response.json().get('text') or '').strip()
