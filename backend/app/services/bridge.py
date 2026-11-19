"""Bridge: experimental sign reading.

A few camera frames in time order are sent to the vision model, which is asked
for a short English reading and its own confidence. Low-confidence readings are
dropped rather than spoken. This is a demo of the idea, not sign-language
translation: it will miss and misread signs.
"""
import json

from . import llm

MIN_CONFIDENCE = 0.6
MAX_FRAMES = 3

# A small, fixed vocabulary keeps the reader fast and far more reliable than open-ended guessing.
VOCABULARY = {
    'hello': 'open hand at the forehead moving outward, like a salute',
    'thank you': 'flat hand touching the chin, then moving forward and down',
    'yes': 'a fist nodding up and down at the wrist',
    'no': 'index and middle finger snapping shut against the thumb',
    'please': 'flat hand circling on the chest',
    'sorry': 'a fist circling on the chest',
    'help': 'a thumbs-up fist resting on the open palm of the other hand, lifted upward',
    'I love you': 'thumb, index finger and little finger extended, other fingers folded',
    'good': 'flat hand from the chin moving down into the other open palm',
    'stop': 'the edge of one flat hand chopping down onto the other open palm',
    'water': 'three fingers extended (a W) tapping the chin',
    'eat': 'fingertips bunched together tapping the mouth',
    'thumbs up': 'a fist with the thumb pointing up',
    'peace': 'index and middle fingers raised in a V',
}

SIGN_PROMPT = (
    'The images are consecutive camera frames, in time order, of a person who may be making a hand sign '
    'in American Sign Language. Choose the ONE sign from this list that best matches, or none:\n'
    + '\n'.join(f'- "{word}": {how}' for word, how in VOCABULARY.items())
    + '\nReply with JSON only: {"text": "<exactly one phrase from the list, or empty>", "confidence": <0 to 1>}. '
    'If no hands are raised, nobody is signing, or nothing on the list clearly matches, '
    'use an empty text and a low confidence. Never guess.'
)


def parse_reading(raw: str) -> dict:
    """Validate the model's JSON and drop anything below the confidence bar."""
    try:
        data = json.loads(raw)
        text = str(data.get('text', '')).strip()[:120]
        known = {word.lower(): word for word in VOCABULARY}
        text = known.get(text.lower().strip('"'), '')
        confidence = max(0.0, min(1.0, float(data.get('confidence', 0))))
    except (ValueError, TypeError, AttributeError):
        return {'text': '', 'confidence': 0.0}
    if confidence < MIN_CONFIDENCE:
        text = ''
    return {'text': text, 'confidence': round(confidence, 2)}


async def read_sign(frames: list[tuple[bytes, str]]) -> dict:
    parts = [llm.image_part(image, mime) for image, mime in frames[:MAX_FRAMES]]
    parts.append({'text': SIGN_PROMPT})
    try:
        reading = parse_reading(await llm.complete(parts, json_mode=True, timeout=8.0))
        reading['provider'] = 'cloud'
    except Exception as error:
        reading = {'text': '', 'confidence': 0.0, 'provider': None, 'error': type(error).__name__}
    reading['experimental'] = True
    return reading
