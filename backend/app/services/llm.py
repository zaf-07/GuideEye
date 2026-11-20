"""Small cloud LLM client shared by vision, memory and Bridge. httpx is imported lazily."""
import base64
import os

GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
MINIMAX_URL = 'https://api.minimax.io/v1/chat/completions'
GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'


def configured() -> bool:
    return bool(os.getenv('GEMINI_API_KEY') or os.getenv('MINIMAX_API_KEY') or os.getenv('GROQ_API_KEY'))


def model() -> str:
    # The lite model answers in about a second, which matters for speech.
    if os.getenv('GEMINI_MODEL'):
        return os.environ['GEMINI_MODEL']
    if not os.getenv('GEMINI_API_KEY') and os.getenv('MINIMAX_API_KEY'):
        return os.getenv('MINIMAX_MODEL', 'MiniMax-M3.1-Flash')
    if not os.getenv('GEMINI_API_KEY') and os.getenv('GROQ_API_KEY'):
        return os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')
    return 'gemini-flash-lite-latest'


def image_part(image: bytes, mime: str) -> dict:
    return {'inlineData': {'mimeType': mime, 'data': base64.b64encode(image).decode('ascii')}}


async def gemini(parts: list[dict], system: str = '', json_mode: bool = False, timeout: float = 10.0) -> str:
    """Send text and image parts, return the reply text. Raises on any failure."""
    import httpx
    config = {'temperature': 0.2, 'maxOutputTokens': 1024}
    if json_mode:
        config['responseMimeType'] = 'application/json'
    payload = {'contents': [{'role': 'user', 'parts': parts}], 'generationConfig': config}
    if system:
        payload['systemInstruction'] = {'parts': [{'text': system}]}
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=4.0)) as client:
        response = await client.post(
            GEMINI_URL.format(model=model()),
            headers={'x-goog-api-key': os.environ['GEMINI_API_KEY']},
            json=payload,
        )
        response.raise_for_status()
    reply = response.json()['candidates'][0]['content']['parts']
    text = ' '.join(part['text'].strip() for part in reply if part.get('text') and not part.get('thought'))
    if not text:
        raise ValueError('Gemini returned no text')
    return text


async def minimax(parts: list[dict], system: str = '', json_mode: bool = False, timeout: float = 10.0) -> str:
    """Call MiniMax's OpenAI-compatible multimodal endpoint."""
    import httpx
    content: list[dict] = []
    for part in parts:
        if 'text' in part:
            content.append({'type': 'text', 'text': part['text']})
        elif 'inlineData' in part:
            item = part['inlineData']
            content.append({
                'type': 'image_url',
                'image_url': {'url': f"data:{item['mimeType']};base64,{item['data']}"},
            })
    messages = []
    if system:
        messages.append({'role': 'system', 'content': system})
    messages.append({'role': 'user', 'content': content})
    payload = {
        'model': os.getenv('MINIMAX_MODEL', 'MiniMax-M3.1-Flash'),
        'messages': messages,
        'max_completion_tokens': 1024,
        'reasoning_effort': os.getenv('MINIMAX_REASONING_EFFORT', 'low'),
    }
    if json_mode:
        payload['response_format'] = {'type': 'json_object'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=4.0)) as client:
        response = await client.post(
            os.getenv('MINIMAX_API_URL', MINIMAX_URL),
            headers={'Authorization': f"Bearer {os.environ['MINIMAX_API_KEY']}"},
            json=payload,
        )
        response.raise_for_status()
    text = (response.json()['choices'][0]['message'].get('content') or '').strip()
    if not text:
        raise ValueError('MiniMax returned no text')
    return text


async def groq(parts: list[dict], system: str = '', json_mode: bool = False, timeout: float = 10.0) -> str:
    """Call Groq's OpenAI-compatible API for text or image-aware requests."""
    content: list[dict] = []
    has_image = False
    for part in parts:
        if 'text' in part:
            content.append({'type': 'text', 'text': part['text']})
        elif 'inlineData' in part:
            item = part['inlineData']
            content.append({'type': 'image_url', 'image_url': {'url': f"data:{item['mimeType']};base64,{item['data']}"}})
            has_image = True
    messages: list[dict] = []
    if system:
        messages.append({'role': 'system', 'content': system})
    messages.append({'role': 'user', 'content': content})
    model_name = os.getenv('GROQ_VISION_MODEL', 'qwen/qwen3.8-27b') if has_image else os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')
    payload: dict = {'model': model_name, 'messages': messages, 'temperature': 0.2, 'max_completion_tokens': 1024}
    if json_mode:
        payload['response_format'] = {'type': 'json_object'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=4.0)) as client:
        response = await client.post(
            os.getenv('GROQ_API_URL', GROQ_URL),
            headers={'Authorization': f"Bearer {os.environ['GROQ_API_KEY']}"},
            json=payload,
        )
        response.raise_for_status()
    text = (response.json()['choices'][0]['message'].get('content') or '').strip()
    if not text:
        raise ValueError('Groq returned no text')
    return text


async def complete(parts: list[dict], system: str = '', json_mode: bool = False, timeout: float = 10.0) -> str:
    """Try each configured general-purpose model, then raise the last error."""
    errors = []
    if os.getenv('GEMINI_API_KEY'):
        try:
            return await gemini(parts, system=system, json_mode=json_mode, timeout=timeout)
        except Exception as error:
            errors.append(error)
    if os.getenv('MINIMAX_API_KEY'):
        try:
            return await minimax(parts, system=system, json_mode=json_mode, timeout=timeout)
        except Exception as error:
            errors.append(error)
    if os.getenv('GROQ_API_KEY'):
        try:
            return await groq(parts, system=system, json_mode=json_mode, timeout=timeout)
        except Exception as error:
            errors.append(error)
    if errors:
        raise errors[-1]
    raise RuntimeError('No LLM provider configured')
